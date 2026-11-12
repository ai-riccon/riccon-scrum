import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import type * as acp from '@agentclientprotocol/sdk';
import type {
  Category,
  EventPayload,
  Project,
  RequirementDraft,
  Requirement,
  Story,
  Tag,
  TaxonomyAssignment,
  TaxonomyCategoryNode,
  TaxonomyProposal,
} from '@riccon-scrum/shared';
import { bus } from './bus';
import { config } from './config';
import {
  createCategory,
  createTag,
  getProject,
  getRequirement,
  getStory,
  listCategories,
  listRequirements,
  listStories,
  listTags,
  setEntityTags,
  setRequirementCategory,
  setStoryCategory,
  tagsForEntity,
} from './db';
import { AcpRunner, type RunnerHost } from './acp/runner';
import { getAgentSpec } from './acp/agents';
import { parseJsonBlock, taxonomyPrompt } from './templates';
import { createDetachedWorktree, currentBranch, removeWorktree } from './git';

const MAX_CATEGORIES = 30;
const MAX_DEPTH = 3;
const MAX_TAGS = 60;
const MAX_ASSIGNMENTS = 200;
const TIMEOUT_MS = 3 * 60_000;
const activeWorktrees = new Set<string>();

function sweepTaxonomyWorktrees(): void {
  const tmp = os.tmpdir();
  for (const name of fs.readdirSync(tmp)) {
    if (!name.startsWith('riccon-taxonomy-')) continue;
    const full = path.join(tmp, name);
    if (activeWorktrees.has(full)) continue;
    try {
      fs.rmSync(full, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // next sweep will retry
    }
  }
}

function raceTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void, message: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error(message));
    }, Math.max(1, ms));
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item.trim() : asText((item as { name?: unknown })?.name))).filter(Boolean);
  }
  return [];
}

function categoryNameMap(categories: Category[]): Map<string, Category> {
  return new Map(categories.map((category) => [category.id, category]));
}

function categoryPathName(category: Category, byId: Map<string, Category>): string {
  const names: string[] = [];
  let current: Category | undefined = category;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.join('/');
}

function categoryPaths(projectId: string): Map<string, Category> {
  const categories = listCategories(projectId);
  const byId = categoryNameMap(categories);
  return new Map(categories.map((category) => [categoryPathName(category, byId).toLowerCase(), category]));
}

function normalizeCategories(raw: unknown): TaxonomyCategoryNode[] {
  if (!Array.isArray(raw)) return [];
  const walk = (items: unknown[], depth: number): TaxonomyCategoryNode[] => {
    if (depth > MAX_DEPTH) return [];
    return items
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        name: asText(item.name ?? item.title),
        children: Array.isArray(item.children) ? walk(item.children, depth + 1) : undefined,
      }))
      .filter((item) => item.name);
  };
  return walk(raw, 1);
}

function normalizeTags(raw: unknown): { name: string; color?: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === 'string' ? { name: item.trim() } : {
      name: asText((item as { name?: unknown })?.name),
      color: asText((item as { color?: unknown })?.color) || undefined,
    }))
    .filter((item) => item.name);
}

function normalizeAssignments(raw: unknown): TaxonomyAssignment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      entityType: item.entityType === 'story' ? ('story' as const) : ('requirement' as const),
      entityId: asText(item.entityId),
      categoryPath: asText(item.categoryPath) || undefined,
      tags: asList(item.tags),
      confidence: typeof item.confidence === 'number' ? item.confidence : undefined,
      reason: asText(item.reason) || undefined,
    }))
    .filter((item) => item.entityId);
}

function flattenCategoryNames(nodes: TaxonomyCategoryNode[], prefix = '', depth = 1): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    const full = prefix ? `${prefix}/${node.name}` : node.name;
    out.push(full);
    if (node.children?.length && depth < MAX_DEPTH) out.push(...flattenCategoryNames(node.children, full, depth + 1));
  }
  return out;
}

function validateProposal(projectId: string, proposal: TaxonomyProposal): TaxonomyProposal {
  const names = flattenCategoryNames(proposal.categories);
  if (names.length === 0) throw new Error('AI 未生成有效分类');
  if (names.length > MAX_CATEGORIES) throw new Error(`分类数量 ${names.length} 超过上限 ${MAX_CATEGORIES}`);
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) throw new Error('AI 分类存在重复名称');
  const tags = proposal.tags.filter((tag) => tag.name).slice(0, MAX_TAGS);
  const requirements = new Set(listRequirements(projectId).map((item) => item.id));
  const stories = new Set(listStories(projectId).map((item) => item.id));
  const assignments = proposal.assignments
    .filter((item) => (item.entityType === 'requirement' ? requirements.has(item.entityId) : stories.has(item.entityId)))
    .slice(0, MAX_ASSIGNMENTS)
    .map((item) => ({
      ...item,
      entityTitle:
        item.entityType === 'requirement' ? getRequirement(item.entityId).title : getStory(item.entityId).title,
    }));
  return { ...proposal, tags, assignments };
}

function readOnlyHost(projectId: string): RunnerHost {
  return {
    publish: (streamId: string, payload: EventPayload) => {
      if (streamId !== projectId) return;
      if (payload.type === 'session.status') bus.publish(projectId, payload);
    },
    requestPermission: async (
      _storyId: string,
      _sessionId: string,
      params: acp.RequestPermissionRequest,
    ): Promise<acp.RequestPermissionResponse> => {
      const kind = params.toolCall.kind ?? null;
      const allow = params.options.find((o) => o.kind === 'allow_once') ?? params.options.find((o) => o.kind.startsWith('allow'));
      if (allow && (kind === 'read' || kind === 'search')) {
        return { outcome: { outcome: 'selected', optionId: allow.optionId } };
      }
      return { outcome: { outcome: 'cancelled' } };
    },
  };
}

export function taxonomyContext(projectId: string): string {
  const categories = listCategories(projectId);
  const byId = categoryNameMap(categories);
  const tags = listTags(projectId);
  if (categories.length === 0 && tags.length === 0) return '';
  return [
    '## 现有分类与标签（优先复用，不要制造同义分类）',
    categories.length ? `分类路径：${categories.map((category) => categoryPathName(category, byId)).join('；')}` : '分类：暂无',
    tags.length ? `标签：${tags.map((tag) => tag.name).join('、')}` : '标签：暂无',
    'categoryPath 必须来自上面的分类路径；没有合适分类时留空。tags 最多 5 个，可复用现有标签或提出简短新标签。',
  ].join('\n');
}

export async function generateTaxonomy(projectId: string): Promise<TaxonomyProposal> {
  const project: Project = getProject(projectId);
  const categories = listCategories(projectId);
  const byId = categoryNameMap(categories);
  const tags = listTags(projectId);
  const requirements = listRequirements(projectId).filter((item) => item.status !== 'archived');
  const stories = listStories(projectId).filter((item) => item.status !== 'draft');
  const worktree = path.join(os.tmpdir(), `riccon-taxonomy-${projectId.slice(0, 8)}-${Date.now()}`);
  let runner: AcpRunner | null = null;

  try {
    const base = project.defaultBranch || (await currentBranch(project.repoPath));
    sweepTaxonomyWorktrees();
    await createDetachedWorktree(project.repoPath, worktree, base);
    activeWorktrees.add(worktree);
    const model = project.discoveryModel || project.model;
    const spec = getAgentSpec(project.agentKind, { model: model || config.agentModel, dbPath: config.opencodeDb });
    runner = new AcpRunner({
      storyId: projectId,
      sessionId: `taxonomy-${projectId.slice(0, 8)}-${Date.now()}`,
      cwd: worktree,
      spec,
      host: readOnlyHost(projectId),
      allowedRoots: [worktree],
      model: model || undefined,
    });
    await raceTimeout(runner.start(), 60_000, () => void runner?.stop().catch(() => undefined), 'agent 启动超时');
    const prompt = taxonomyPrompt({
      projectName: project.name,
      categories: categories.map((category) => `- ${categoryPathName(category, byId)}`).join('\n'),
      tags: tags.map((tag) => `- ${tag.name}`).join('\n'),
      requirements: requirements
        .slice(0, 80)
        .map((item) => `- [${item.status}] ${item.title} (entityId=${item.id}) ${item.rawInput.slice(0, 160).replace(/\n/g, ' ')}`),
      stories: stories
        .slice(0, 80)
        .map((item) => `- [${item.status}] ${item.title} (entityId=${item.id}) ${item.description.slice(0, 120).replace(/\n/g, ' ')}`),
    });
    await raceTimeout(runner.prompt(prompt), TIMEOUT_MS, () => void runner?.stop().catch(() => undefined), '分类/标签生成超时');
    const parsed = parseJsonBlock<Record<string, unknown>>(runner.responseText);
    const proposal: TaxonomyProposal = {
      summary: asText(parsed?.summary),
      categories: normalizeCategories(parsed?.categories),
      tags: normalizeTags(parsed?.tags),
      assignments: normalizeAssignments(parsed?.assignments),
      model: model || null,
    };
    return validateProposal(projectId, proposal);
  } finally {
    activeWorktrees.delete(worktree);
    if (runner) await runner.stop().catch(() => undefined);
    await removeWorktree(project.repoPath, worktree).catch(() => undefined);
    try {
      fs.rmSync(worktree, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // next sweep will retry
    }
  }
}

function colorFor(name: string): string {
  const palette = ['#5b8cff', '#36d6c3', '#ffb454', '#ff6b9a', '#a78bfa', '#4ade80', '#f472b6'];
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % palette.length;
  return palette[hash];
}

export function applyTaxonomy(
  projectId: string,
  rawProposal: TaxonomyProposal,
): { categoriesCreated: number; tagsCreated: number; assignmentsApplied: number } {
  const proposal = validateProposal(projectId, rawProposal);
  const existingCategories = listCategories(projectId);
  const byId = categoryNameMap(existingCategories);
  const existingByPath = new Map(existingCategories.map((category) => [categoryPathName(category, byId).toLowerCase(), category]));
  let categoriesCreated = 0;

  const ensureCategory = (node: TaxonomyCategoryNode, parent: Category | null): Category => {
    const key = parent ? `${categoryPathName(parent, byId)}/${node.name}`.toLowerCase() : node.name.toLowerCase();
    const existing = existingByPath.get(key);
    if (existing) {
      byId.set(existing.id, existing);
      return existing;
    }
    const created = createCategory({
      projectId,
      name: node.name,
      parentId: parent?.id ?? null,
      source: 'ai',
      status: 'active',
    });
    categoriesCreated++;
    byId.set(created.id, created);
    existingByPath.set(key, created);
    return created;
  };

  const walk = (nodes: TaxonomyCategoryNode[], parent: Category | null) => {
    for (const node of nodes) {
      const category = ensureCategory(node, parent);
      if (node.children?.length && category.depth < MAX_DEPTH) walk(node.children, category);
    }
  };
  walk(proposal.categories, null);

  const existingTags = new Map(listTags(projectId).map((tag) => [tag.name.toLowerCase(), tag]));
  let tagsCreated = 0;
  for (const item of proposal.tags) {
    const key = item.name.toLowerCase();
    if (existingTags.has(key)) continue;
    const tag = createTag({ projectId, name: item.name, color: item.color || colorFor(item.name), source: 'ai' });
    existingTags.set(key, tag);
    tagsCreated++;
  }

  let assignmentsApplied = 0;
  for (const assignment of proposal.assignments) {
    const entity = assignment.entityType === 'requirement' ? getRequirement(assignment.entityId) : getStory(assignment.entityId);
    if (entity.projectId !== projectId) continue;
    if (assignment.categoryPath) {
      const category = existingByPath.get(assignment.categoryPath.toLowerCase());
      if (category) {
        if (assignment.entityType === 'requirement') setRequirementCategory(assignment.entityId, category.id);
        else setStoryCategory(assignment.entityId, category.id);
      }
    }
    if (assignment.tags?.length) {
      const current = tagsForEntity(assignment.entityType, assignment.entityId);
      const wanted = new Map(current.map((tag) => [tag.id, tag]));
      for (const name of assignment.tags.slice(0, 5)) {
        const tag = existingTags.get(name.toLowerCase());
        if (tag) wanted.set(tag.id, tag);
      }
      setEntityTags(assignment.entityType, assignment.entityId, [...wanted.keys()]);
    }
    assignmentsApplied++;
  }
  return { categoriesCreated, tagsCreated, assignmentsApplied };
}

export function applyDraftTaxonomy(requirementId: string, draft: RequirementDraft): {
  categoryApplied: boolean;
  tagsApplied: number;
} {
  const requirement = getRequirement(requirementId);
  let categoryApplied = false;
  const categoryPath = draft.categoryPath?.trim();
  if (categoryPath) {
    const match = categoryPaths(requirement.projectId).get(categoryPath.toLowerCase());
    if (match) {
      setRequirementCategory(requirementId, match.id);
      categoryApplied = true;
    }
  }
  const names = (draft.tags ?? []).map((tag) => tag.trim()).filter(Boolean).slice(0, 5);
  if (names.length === 0) return { categoryApplied, tagsApplied: 0 };
  const existing = new Map(listTags(requirement.projectId).map((tag) => [tag.name.toLowerCase(), tag]));
  const wanted: Tag[] = [];
  for (const name of names) {
    let tag = existing.get(name.toLowerCase());
    if (!tag) {
      tag = createTag({ projectId: requirement.projectId, name, color: colorFor(name), source: 'ai' });
      existing.set(name.toLowerCase(), tag);
    }
    wanted.push(tag);
  }
  const current = tagsForEntity('requirement', requirementId);
  const merged = new Map([...current, ...wanted].map((tag) => [tag.id, tag]));
  setEntityTags('requirement', requirementId, [...merged.keys()]);
  const stories = listStories(requirement.projectId).filter((story) => story.requirementId === requirementId);
  for (const story of stories) {
    const storyTags = tagsForEntity('story', story.id);
    setEntityTags('story', story.id, [...new Set([...storyTags, ...wanted].map((tag) => tag.id))]);
  }
  return { categoryApplied, tagsApplied: wanted.length };
}

export function cleanupTaxonomyState(): void {
  sweepTaxonomyWorktrees();
}
