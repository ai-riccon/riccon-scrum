import { createHash } from 'node:crypto';
import type { Category, EntitySearchHit, EntitySearchResult } from '@riccon-scrum/shared';
import { getGlobalSettings } from './settings';
import {
  getEntityEmbedding,
  latestRequirementVersion,
  listCategories,
  listRequirements,
  listStories,
  listTags,
  saveEntityEmbedding,
  tagsByEntity,
} from './db';

interface SearchDoc {
  type: 'requirement' | 'story';
  id: string;
  title: string;
  text: string;
  snippet: string;
  status: string;
  categoryId: string | null;
  tags: string[];
  requirementId: string | null;
}

const CJK = /[\u4e00-\u9fff]+/g;
const LATIN = /[a-z0-9_]+/g;

function tokens(text: string): string[] {
  const normalized = text.toLowerCase();
  const out: string[] = [];
  for (const match of normalized.match(LATIN) ?? []) out.push(match);
  for (const run of normalized.match(CJK) ?? []) {
    if (run.length === 1) {
      out.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}

function categoryName(categories: Map<string, Category>, id: string | null): string {
  return id ? categories.get(id)?.name ?? '' : '';
}

function buildDocs(projectId: string): SearchDoc[] {
  const categories = new Map(listCategories(projectId).map((category) => [category.id, category]));
  const requirementTags = tagsByEntity(projectId, 'requirement');
  const storyTags = tagsByEntity(projectId, 'story');
  const requirements = listRequirements(projectId).filter((item) => item.status !== 'archived');
  const requirementTitles = new Map(requirements.map((item) => [item.id, item.title]));
  const docs: SearchDoc[] = [];

  for (const requirement of requirements) {
    const version = latestRequirementVersion(requirement.id);
    const draft = version?.draft;
    const tags = requirementTags.get(requirement.id) ?? [];
    const text = [
      requirement.title,
      requirement.rawInput,
      requirement.intake?.goal,
      requirement.intake?.users,
      requirement.intake?.constraints,
      requirement.intake?.nonGoals,
      requirement.intake?.successMetrics,
      requirement.intake?.examples,
      draft?.summary,
      draft?.goals.join(' '),
      draft?.nonGoals.join(' '),
      draft?.openQuestions.join(' '),
      draft?.stories.map((story) => `${story.title} ${story.persona} ${story.value} ${story.acceptance.map((ac) => `${ac.given} ${ac.when} ${ac.then}`).join(' ')}`).join(' '),
      categoryName(categories, requirement.categoryId),
      tags.map((tag) => tag.name).join(' '),
    ]
      .filter(Boolean)
      .join('\n');
    docs.push({
      type: 'requirement',
      id: requirement.id,
      title: requirement.title,
      text,
      snippet: (draft?.summary || requirement.rawInput).slice(0, 220).replace(/\n/g, ' '),
      status: requirement.status,
      categoryId: requirement.categoryId,
      tags: tags.map((tag) => tag.name),
      requirementId: null,
    });
  }

  for (const story of listStories(projectId)) {
    const tags = storyTags.get(story.id) ?? [];
    const text = [
      story.title,
      story.description,
      story.acceptanceCriteria,
      categoryName(categories, story.categoryId),
      tags.map((tag) => tag.name).join(' '),
      story.requirementId ? requirementTitles.get(story.requirementId) ?? '' : '',
    ]
      .filter(Boolean)
      .join('\n');
    docs.push({
      type: 'story',
      id: story.id,
      title: story.title,
      text,
      snippet: story.description.slice(0, 220).replace(/\n/g, ' ') || story.acceptanceCriteria.slice(0, 220),
      status: story.status,
      categoryId: story.categoryId,
      tags: tags.map((tag) => tag.name),
      requirementId: story.requirementId,
    });
  }
  return docs;
}

function lexicalScores(docs: SearchDoc[], query: string): Map<string, number> {
  const queryTokens = tokens(query);
  if (queryTokens.length === 0) return new Map();
  const docTokens = docs.map((doc) => tokens(doc.text));
  const df = new Map<string, number>();
  for (const list of docTokens) {
    for (const token of new Set(list)) df.set(token, (df.get(token) ?? 0) + 1);
  }
  const avgLength = docTokens.reduce((sum, list) => sum + list.length, 0) / Math.max(1, docTokens.length);
  const scores = new Map<string, number>();
  docs.forEach((doc, index) => {
    const list = docTokens[index];
    const frequency = new Map<string, number>();
    for (const token of list) frequency.set(token, (frequency.get(token) ?? 0) + 1);
    let score = 0;
    for (const token of queryTokens) {
      const tf = frequency.get(token) ?? 0;
      if (tf === 0) continue;
      const idf = Math.log((docs.length + 1) / ((df.get(token) ?? 0) + 1)) + 1;
      score += idf * (tf / (tf + 1.2 + 0.75 * (list.length / Math.max(1, avgLength)) * 0.2));
    }
    const titleTokens = new Set(tokens(doc.title));
    for (const token of queryTokens) {
      if (titleTokens.has(token)) score += 1.5;
    }
    if (query.trim() && doc.title.toLowerCase().includes(query.trim().toLowerCase())) score += 3;
    if (score > 0) scores.set(`${doc.type}:${doc.id}`, score);
  });
  return scores;
}

function hashText(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

async function embed(
  texts: string[],
  embedding: { url: string; apiKey: string; model: string },
): Promise<number[][] | null> {
  if (!embedding.url || texts.length === 0) return null;
  try {
    const response = await fetch(embedding.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(embedding.apiKey ? { Authorization: `Bearer ${embedding.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: embedding.model, input: texts }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { data?: { embedding?: number[] }[] };
    const vectors = (data.data ?? []).map((item) => item.embedding).filter((vector): vector is number[] => Array.isArray(vector));
    return vectors.length === texts.length ? vectors : null;
  } catch {
    return null;
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let left = 0;
  let right = 0;
  const size = Math.min(a.length, b.length);
  for (let i = 0; i < size; i++) {
    dot += a[i] * b[i];
    left += a[i] * a[i];
    right += b[i] * b[i];
  }
  return left && right ? dot / Math.sqrt(left * right) : 0;
}

export async function searchEntities(projectId: string, query: string, limit = 12): Promise<EntitySearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { mode: 'lexical', hits: [] };
  const docs = buildDocs(projectId);
  const lexical = lexicalScores(docs, trimmed);
  let mode: EntitySearchResult['mode'] = 'lexical';
  const vectorScore = new Map<string, number>();
  const settings = getGlobalSettings();
  const embedding = {
    url: settings.embeddingUrl,
    apiKey: settings.embeddingApiKey,
    model: settings.embeddingModel,
  };

  if (embedding.url) {
    const missing: { doc: SearchDoc; hash: string }[] = [];
    for (const doc of docs.slice(0, 200)) {
      const hash = hashText(`${doc.title}\n${doc.text}`);
      const cached = getEntityEmbedding(doc.type, doc.id);
      if (!cached || cached.model !== embedding.model || cached.hash !== hash) missing.push({ doc, hash });
    }
    for (let i = 0; i < missing.length; i += 24) {
      const batch = missing.slice(i, i + 24);
      const vectors = await embed(batch.map((item) => `${item.doc.title}\n${item.doc.text}`.slice(0, 8000)), embedding);
      if (!vectors) break;
      batch.forEach((item, index) => {
        saveEntityEmbedding({
          entityType: item.doc.type,
          entityId: item.doc.id,
          model: embedding.model,
          hash: item.hash,
          vector: vectors[index],
        });
      });
    }
    const queryVector = await embed([trimmed], embedding);
    if (queryVector) {
      mode = 'hybrid';
      for (const doc of docs) {
        const cached = getEntityEmbedding(doc.type, doc.id);
        if (cached && cached.model === embedding.model) {
          vectorScore.set(`${doc.type}:${doc.id}`, cosine(queryVector[0], cached.vector));
        }
      }
    }
  }

  const maxLexical = Math.max(1, ...lexical.values());
  const hits: EntitySearchHit[] = docs
    .map((doc) => {
      const key = `${doc.type}:${doc.id}`;
      const lex = (lexical.get(key) ?? 0) / maxLexical;
      const vec = vectorScore.get(key) ?? 0;
      const score = mode === 'hybrid' ? vec * 0.6 + lex * 0.4 : lex;
      return { doc, score };
    })
    .filter((item) => item.score > 0.001)
    .sort((a, b) => b.score - a.score)
    .slice(0, Number.isFinite(limit) ? Math.max(1, Math.min(limit, 50)) : 12)
    .map((item) => ({
      type: item.doc.type,
      id: item.doc.id,
      title: item.doc.title,
      snippet: item.doc.snippet,
      status: item.doc.status,
      categoryId: item.doc.categoryId,
      tags: item.doc.tags,
      requirementId: item.doc.requirementId,
      score: Number(item.score.toFixed(4)),
    }));
  return { mode, hits };
}

export function semanticSearchConfigured(): boolean {
  return Boolean(getGlobalSettings().embeddingUrl);
}
