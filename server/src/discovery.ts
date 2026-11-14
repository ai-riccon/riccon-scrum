import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import type * as acp from '@agentclientprotocol/sdk';
import type {
  EventPayload,
  Project,
  Requirement,
  RequirementAcceptanceCriterion,
  RequirementDraft,
  RequirementFeedback,
  RequirementFeedbackDecision,
  RequirementIssue,
  RequirementJob,
  RequirementStatus,
  RequirementStoryDraft,
  Story,
} from '@riccon-scrum/shared';
import { bus } from './bus';
import { config } from './config';
import {
  addRequirementFeedback,
  addRequirementVersion,
  createAcceptance,
  createStory,
  finishRequirementJob,
  getProject,
  getRequirement,
  getRequirementJob,
  getProfileRecord,
  heartbeatRequirementJob,
  historicalRequirementStoryTitles,
  insertDependency,
  latestRequirementVersion,
  listProjects,
  listRequirementFeedback,
  listRunningRequirementJobs,
  listStories,
  markRequirementApproved,
  requestRequirementCancel,
  setRequirementStatus,
  setStoryCategory,
  setStoryStatus,
  startRequirementJob,
  transaction,
} from './db';
import { AcpRunner, type RunnerHost } from './acp/runner';
import { getAgentSpec } from './acp/agents';
import { createDetachedWorktree, currentBranch, pruneWorktrees, removeWorktree } from './git';
import { getIndexContext } from './indexer';
import { getKnowledgeContext } from './knowledge';
import { parseJsonBlock, requirementCriticPrompt, requirementDraftPrompt } from './templates';
import { requirementDependencyContext } from './dependencies';
import { applyDraftTaxonomy, taxonomyContext } from './taxonomy';
import { getDocumentContext } from './document-context';
import { generateRequirementDocuments } from './documents';

const MIN_STORIES = 3;
const MAX_STORIES = 8;
const MAX_DRAFT_ATTEMPTS = 2;
const MAX_FEEDBACK_ROUNDS = 2;
const DRAFT_PROMPT_TIMEOUT_MS = 3 * 60_000;
const CRITIC_PROMPT_TIMEOUT_MS = 90_000;
const MAX_ARCHITECTURE_CHARS = 4000;

const inFlight = new Set<string>();
const activeRunners = new Map<string, AcpRunner>();
const activeWorktrees = new Set<string>();

function sweepDiscoveryWorktrees(): void {
  const tmp = os.tmpdir();
  for (const name of fs.readdirSync(tmp)) {
    if (!name.startsWith('riccon-discovery-')) continue;
    const full = path.join(tmp, name);
    if (activeWorktrees.has(full)) continue;
    try {
      fs.rmSync(full, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // still locked; next sweep will retry
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

export function isGenerating(requirementId: string): boolean {
  return inFlight.has(requirementId);
}

function profileSummary(projectId: string): string {
  const record = getProfileRecord(projectId);
  if (!record.profile) return '';
  const p = record.profile;
  return [
    `- 语言：${p.languages.join(', ') || '未知'}`,
    `- 框架/工具：${p.frameworks.join(', ') || '未知'}`,
    `- 包管理：${p.packageManager ?? '未知'}`,
    `- 测试命令：${p.testCommands.join(', ') || '未发现'}`,
    `- 构建命令：${p.buildCommands.join(', ') || '未发现'}`,
    `- 顶层结构：${p.structure.join(', ') || '未知'}`,
  ].join('\n');
}

function architectureOf(projectId: string): string {
  const record = getProfileRecord(projectId);
  if (!record.architecture) return '';
  return record.architecture.length > MAX_ARCHITECTURE_CHARS
    ? record.architecture.slice(0, MAX_ARCHITECTURE_CHARS) + '\n…（已截断）'
    : record.architecture;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : asText((item as { text?: unknown })?.text)))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/\n|;|；/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function parseGwtText(text: string): RequirementAcceptanceCriterion[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim().replace(/^[-*]\s*/, ''))
    .filter(Boolean);
  const out: RequirementAcceptanceCriterion[] = [];
  let current: RequirementAcceptanceCriterion | null = null;
  let fallback = '';
  for (const line of lines) {
    const match = line.match(/^(given|when|then|假设|前提|当|那么|则)\s*[：:]\s*(.+)$/i);
    if (!match) {
      fallback += (fallback ? ' ' : '') + line;
      continue;
    }
    const label = match[1].toLowerCase();
    const value = match[2].trim();
    if (['given', '假设', '前提'].includes(label)) {
      current = { id: `AC${out.length + 1}`, given: value, when: '', then: '' };
      out.push(current);
    } else if (current && ['when', '当'].includes(label)) {
      current.when = value;
    } else if (current && ['then', '那么', '则'].includes(label)) {
      current.then = value;
    }
  }
  if (out.length === 0 && fallback) {
    out.push({ id: 'AC1', given: '', when: '', then: fallback });
  }
  return out;
}

function normalizeAcceptance(value: unknown): RequirementAcceptanceCriterion[] {
  if (typeof value === 'string') return parseGwtText(value);
  if (!Array.isArray(value)) return [];
  const out: RequirementAcceptanceCriterion[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      out.push(...parseGwtText(item));
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    out.push({
      id: asText(r.id) || `AC${out.length + 1}`,
      given: asText(r.given ?? r.g ?? r.前提),
      when: asText(r.when ?? r.w ?? r.当),
      then: asText(r.then ?? r.t ?? r.那么),
      test: asText(r.test ?? r.testHint ?? r.testName ?? r.verification),
    });
  }
  return out;
}

function normalizeStory(value: unknown, index: number): RequirementStoryDraft | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  return {
    key: asText(r.key ?? r.id) || `R1-S${index + 1}`,
    title: asText(r.title ?? r.name ?? r.story),
    persona: asText(r.persona ?? r.role ?? r.asA),
    value: asText(r.value ?? r.benefit ?? r.iWant),
    description: asText(r.description ?? r.details),
    acceptance: normalizeAcceptance(r.acceptance ?? r.acceptanceCriteria ?? r.criteria ?? r.ac),
    dod: asList(r.dod ?? r.dodCommands ?? r.dod_commands),
    size: asText(r.size) || 'M',
    dependsOn: asList(r.dependsOn ?? r.depends_on ?? r.dependencies),
    clauses: asList(r.clauses ?? r.traces ?? r.traceability),
    outOfScope: asList(r.outOfScope ?? r.out_of_scope ?? r.nonGoals),
  };
}

export function normalizeRequirementDraft(raw: unknown): RequirementDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = Array.isArray(raw) ? { stories: raw } : (raw as Record<string, unknown>);
  const storyField = source.stories ?? source.userStories ?? source.user_stories;
  const storiesRaw = Array.isArray(storyField) ? storyField : [];
  return {
    summary: asText(source.summary ?? source.understanding),
    goals: asList(source.goals ?? source.objectives),
    nonGoals: asList(source.nonGoals ?? source.non_goals ?? source.outOfScope),
    personas: asList(source.personas ?? source.users),
    assumptions: asList(source.assumptions),
    openQuestions: asList(source.openQuestions ?? source.open_questions ?? source.questions),
    categoryPath: asText(source.categoryPath ?? source.category_path ?? source.category) || undefined,
    tags: asList(source.tags ?? source.labels),
    stories: storiesRaw
      .map((s, i) => normalizeStory(s, i))
      .filter((s): s is RequirementStoryDraft => s !== null),
  };
}

function normalizeTitle(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function bigrams(text: string): Set<string> {
  const normalized = normalizeTitle(text);
  const out = new Set<string>();
  if (normalized.length <= 1) {
    if (normalized) out.add(normalized);
    return out;
  }
  for (let i = 0; i < normalized.length - 1; i++) out.add(normalized.slice(i, i + 2));
  return out;
}

function similarity(a: string, b: string): number {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection++;
  return intersection / (left.size + right.size - intersection);
}

function sameTitle(a: string, b: string): boolean {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 6 && right.length >= 6 && (left.includes(right) || right.includes(left))) return true;
  return similarity(left, right) >= 0.9;
}

export function validateRequirementDraft(
  draft: RequirementDraft | null,
  opts: {
    existingStories: Story[];
    historicalTitles: string[];
    requireMachineDod: boolean;
    dodCommandCount: number;
  },
): RequirementIssue[] {
  const issues: RequirementIssue[] = [];
  if (!draft) {
    return [{ severity: 'error', code: 'schema', message: '模型输出无法解析为结构化草稿' }];
  }
  if (!draft.summary.trim()) {
    issues.push({ severity: 'warn', code: 'summary', message: '缺少需求理解摘要' });
  }
  if (draft.goals.length === 0) {
    issues.push({ severity: 'error', code: 'goals', message: '缺少可衡量目标（DoR 阻断）' });
  }
  if (opts.requireMachineDod && opts.dodCommandCount === 0) {
    issues.push({ severity: 'error', code: 'dod-project', message: '项目要求机器 DoD，但尚未配置任何 DoD 命令' });
  }
  if (draft.stories.length === 0) {
    issues.push({ severity: 'error', code: 'stories-empty', message: '至少需要 1 个用户故事' });
  } else if (draft.stories.length < MIN_STORIES) {
    issues.push({ severity: 'error', code: 'stories-min', message: `至少需要 ${MIN_STORIES} 个用户故事（DoR 阻断）` });
  }
  if (draft.stories.length > MAX_STORIES) {
    issues.push({ severity: 'error', code: 'stories-limit', message: `故事数 ${draft.stories.length} 超过上限 ${MAX_STORIES}` });
  }

  const keys = new Set<string>();
  const titles = new Set<string>();
  const draftTitles: string[] = [];
  const existingTitles = opts.existingStories.map((s) => s.title);
  const historicalTitles = opts.historicalTitles;
  for (const story of draft.stories) {
    const at = story.key || story.title;
    if (!story.key.trim()) {
      issues.push({ severity: 'error', code: 'story-key', message: '故事缺少 key', storyKey: at });
    } else if (keys.has(story.key)) {
      issues.push({ severity: 'error', code: 'story-key-dup', message: `故事 key 重复：${story.key}`, storyKey: story.key });
    }
    keys.add(story.key);

    if (!story.title.trim()) {
      issues.push({ severity: 'error', code: 'story-title', message: '故事标题为空', storyKey: at });
    } else {
      const normalized = normalizeTitle(story.title);
      if (titles.has(normalized)) {
        issues.push({ severity: 'error', code: 'story-title-dup', message: `草稿内故事标题重复：${story.title}`, storyKey: story.key });
      } else {
        const near = draftTitles.find((t) => similarity(t, normalized) >= 0.9);
        if (near) {
          issues.push({ severity: 'error', code: 'story-title-dup', message: `草稿内故事高度相似：${story.title}`, storyKey: story.key });
        } else if (draftTitles.some((t) => similarity(t, normalized) >= 0.72)) {
          issues.push({ severity: 'warn', code: 'story-title-near', message: `草稿内故事可能重复：${story.title}`, storyKey: story.key });
        }
        titles.add(normalized);
        draftTitles.push(normalized);
      }
      let existingHit: { title: string; score: number } | null = null;
      for (const existingTitle of existingTitles) {
        const score = sameTitle(existingTitle, story.title) ? 1 : similarity(existingTitle, normalized);
        if (score >= 0.9 && (!existingHit || score > existingHit.score)) existingHit = { title: existingTitle, score };
      }
      if (existingHit) {
        issues.push({
          severity: 'error',
          code: 'story-title-existing',
          message: `与现有故事高度重复：${existingHit.title}`,
          storyKey: story.key,
        });
      } else {
        const historicalHit = historicalTitles.find((t) => sameTitle(t, story.title));
        if (historicalHit) {
          issues.push({
            severity: 'error',
            code: 'story-title-history',
            message: `与历史需求故事高度重复：${historicalHit}`,
            storyKey: story.key,
          });
        } else {
          const nearExisting = existingTitles.find((t) => similarity(t, normalized) >= 0.72);
          if (nearExisting) {
            issues.push({ severity: 'warn', code: 'story-title-existing-near', message: `可能与现有故事重复：${nearExisting}`, storyKey: story.key });
          }
        }
      }
    }
    if (!story.persona.trim()) {
      issues.push({ severity: 'error', code: 'story-persona', message: '缺少目标角色 persona（DoR 阻断）', storyKey: story.key });
    }
    if (!story.value.trim()) {
      issues.push({ severity: 'error', code: 'story-value', message: '缺少用户/业务价值（DoR 阻断）', storyKey: story.key });
    }
    if (!story.description.trim()) {
      issues.push({ severity: 'warn', code: 'story-description', message: '缺少故事描述', storyKey: story.key });
    }
    if (story.acceptance.length === 0) {
      issues.push({ severity: 'error', code: 'ac-empty', message: '至少需要 1 条验收标准', storyKey: story.key });
    }
    if (story.acceptance.length > 5) {
      issues.push({ severity: 'warn', code: 'ac-limit', message: `验收标准 ${story.acceptance.length} 条，建议不超过 5 条`, storyKey: story.key });
    }
    for (const [i, ac] of story.acceptance.entries()) {
      if (!ac.given.trim() || !ac.when.trim() || !ac.then.trim()) {
        issues.push({
          severity: 'error',
          code: 'ac-gwt',
          message: `验收标准 ${ac.id || i + 1} 必须是完整的 Given/When/Then`,
          storyKey: story.key,
        });
      }
      if (!ac.test?.trim()) {
        issues.push({
          severity: 'error',
          code: 'ac-test',
          message: `验收标准 ${ac.id || i + 1} 缺少测试映射（DoR 阻断）`,
          storyKey: story.key,
        });
      } else if (!ac.test.toLowerCase().includes((ac.id || '').toLowerCase())) {
        issues.push({
          severity: 'error',
          code: 'ac-test-trace',
          message: `测试映射必须包含验收标准 ID ${ac.id}，便于从 DoD 输出定位证据`,
          storyKey: story.key,
        });
      }
    }
    if (opts.requireMachineDod && opts.dodCommandCount > 0 && story.dod.length === 0) {
      issues.push({ severity: 'error', code: 'dod-mapping', message: '未标注该故事对应的 DoD（DoR 阻断）', storyKey: story.key });
    }
    if (story.clauses.length === 0) {
      issues.push({ severity: 'error', code: 'clauses', message: '未标注来源条款（DoR 阻断）', storyKey: story.key });
    }
    if (['L', 'XL'].includes(story.size.toUpperCase())) {
      issues.push({ severity: 'error', code: 'story-size', message: `故事规模 ${story.size}，必须拆分为 S/M（DoR 阻断）`, storyKey: story.key });
    }
  }

  const storyKeys = new Set(draft.stories.map((story) => story.key));
  for (const story of draft.stories) {
    for (const dependency of story.dependsOn) {
      if (dependency === story.key) {
        issues.push({ severity: 'error', code: 'dep-self', message: `故事不能依赖自身：${story.key}`, storyKey: story.key });
      } else if (!storyKeys.has(dependency)) {
        issues.push({
          severity: 'error',
          code: 'dep-unknown',
          message: `依赖的故事 key 不存在：${dependency}`,
          storyKey: story.key,
        });
      }
    }
  }
  const cycle = findStoryCycle(draft.stories);
  if (cycle.length > 0) {
    issues.push({ severity: 'error', code: 'dep-cycle', message: `故事依赖存在循环：${cycle.join(' → ')}` });
  }
  return issues;
}

function findStoryCycle(stories: RequirementStoryDraft[]): string[] {
  const graph = new Map(stories.map((story) => [story.key, story.dependsOn]));
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  let found: string[] = [];
  const visit = (key: string): boolean => {
    const current = state.get(key) ?? 0;
    if (current === 2) return false;
    if (current === 1) {
      const start = stack.indexOf(key);
      found = stack.slice(start >= 0 ? start : 0).concat(key);
      return true;
    }
    state.set(key, 1);
    stack.push(key);
    for (const next of graph.get(key) ?? []) {
      if (graph.has(next) && visit(next)) return true;
    }
    stack.pop();
    state.set(key, 2);
    return false;
  };
  for (const story of stories) {
    if (visit(story.key)) break;
  }
  return found;
}

function applyTargetedRevision(
  requirementId: string,
  previousVersion: number,
  previous: RequirementDraft | null,
  next: RequirementDraft,
): { draft: RequirementDraft; restored: number } {
  if (!previous) return { draft: next, restored: 0 };
  const feedback = listRequirementFeedback(requirementId).filter((f) => f.version === previousVersion);
  const hasGlobal = feedback.some((f) => !f.storyKey && f.decision !== 'approve' && (f.comment ?? '').trim());
  const targeted = new Set(
    feedback.filter((f) => f.storyKey && f.decision !== 'approve').map((f) => f.storyKey as string),
  );
  if (hasGlobal || targeted.size === 0) return { draft: next, restored: 0 };

  const previousMap = new Map(previous.stories.map((s) => [s.key, s]));
  let restored = 0;
  const stories = next.stories.map((story) => {
    const old = previousMap.get(story.key);
    if (!old || targeted.has(story.key)) return story;
    if (JSON.stringify(old) !== JSON.stringify(story)) restored++;
    return old;
  });
  for (const old of previous.stories) {
    if (!targeted.has(old.key) && !next.stories.some((s) => s.key === old.key)) {
      stories.push(old);
      restored++;
    }
  }
  return { draft: { ...next, stories }, restored };
}

function feedbackBlock(requirementId: string, version: number): string {
  const rows = listRequirementFeedback(requirementId).filter((f) => f.version === version);
  if (rows.length === 0) return '';
  return rows
    .map((f) => {
      const target = f.storyKey ? `故事 ${f.storyKey}` : '整体';
      return `- [${target} ${f.decision}] ${f.comment ?? ''}`.trim();
    })
    .join('\n');
}

function buildPrompt(
  project: Project,
  requirement: Requirement,
  previousDraft: RequirementDraft | null,
  version: number,
  confirmedIntake = false,
): string {
  const stories = [
    ...listStories(project.id).map((s) => `[${s.status}] ${s.title}`),
    ...historicalRequirementStoryTitles(project.id, requirement.id).map((t) => `[历史需求] ${t}`),
  ];
  return requirementDraftPrompt({
    projectName: project.name,
    requirementTitle: requirement.title,
    rawInput: requirement.rawInput,
    intake: requirement.intake,
    profileSummary: profileSummary(project.id),
    architecture: architectureOf(project.id),
    documentContext: getDocumentContext(
      project.id,
      'requirement',
      `${requirement.title} ${requirement.rawInput} ${requirement.intake?.goal ?? ''}`,
      4500,
    ).text,
    glossary: project.glossary,
    knowledge: getKnowledgeContext(project.id, `${requirement.title} ${requirement.rawInput}`),
    codeContext: getIndexContext(project.id, `${requirement.title} ${requirement.rawInput}`),
    existingStories: stories,
    previousDraft,
    feedback: version > 0 ? feedbackBlock(requirement.id, version) : '',
    issues: previousDraft ? (latestRequirementVersion(requirement.id)?.issues ?? []) : [],
    confirmedIntake,
    dependencyContext: requirementDependencyContext(requirement.id),
    taxonomy: taxonomyContext(project.id),
  });
}

function normalizeCriticIssues(raw: unknown): RequirementIssue[] {
  const issues = (raw as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(issues)) return [];
  return issues
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      severity: item.severity === 'error' ? ('error' as const) : ('warn' as const),
      code: asText(item.code) || 'critic',
      message: asText(item.message),
      storyKey: asText(item.storyKey) || null,
    }))
    .filter((item) => item.message)
    .slice(0, 8);
}

async function criticReview(
  prompt: (text: string) => Promise<string>,
  draft: RequirementDraft,
): Promise<RequirementIssue[]> {
  const text = await prompt(requirementCriticPrompt(draft));
  return normalizeCriticIssues(parseJsonBlock<unknown>(text));
}

function repairPrompt(issues: RequirementIssue[]): string {
  return [
    '上一版输出未通过平台校验：',
    ...issues.filter((i) => i.severity === 'error').map((i) => `- ${i.storyKey ? i.storyKey + '：' : ''}${i.message}`),
    '',
    '请修复上述问题，只修改必要的部分，并重新输出完整的 JSON 代码块。不要输出解释。',
  ].join('\n');
}

function createReadOnlyHost(requirementId: string): RunnerHost {
  return {
    publish: (streamId: string, payload: EventPayload) => {
      if (streamId === requirementId) bus.publish(requirementId, payload);
    },
    requestPermission: async (
      _storyId: string,
      _sessionId: string,
      params: acp.RequestPermissionRequest,
    ): Promise<acp.RequestPermissionResponse> => {
      const kind = params.toolCall.kind ?? null;
      const allow =
        params.options.find((o) => o.kind === 'allow_once') ?? params.options.find((o) => o.kind.startsWith('allow'));
      if (allow && (kind === 'read' || kind === 'search')) {
        return { outcome: { outcome: 'selected', optionId: allow.optionId } };
      }
      return { outcome: { outcome: 'cancelled' } };
    },
  };
}

function moveRequirement(id: string, to: RequirementStatus): Requirement {
  const before = getRequirement(id);
  if (before.status === to) return before;
  const after = setRequirementStatus(id, to);
  bus.publish(id, { type: 'requirement.status', requirementId: id, from: before.status, to: after.status });
  return after;
}

export async function generateRequirementDraft(
  requirementId: string,
  opts: { confirmedIntake?: boolean } = {},
): Promise<void> {
  if (inFlight.has(requirementId)) throw new Error('该需求正在生成中，请稍候');
  const requirement = getRequirement(requirementId);
  if (['approved', 'decomposed', 'split', 'archived'].includes(requirement.status)) {
    throw new Error(`需求状态 ${requirement.status} 不允许重新生成`);
  }
  inFlight.add(requirementId);
  startRequirementJob(requirementId);
  const heartbeat = setInterval(() => heartbeatRequirementJob(requirementId), config.discoveryHeartbeatMs);
  heartbeat.unref();

  const project = getProject(requirement.projectId);
  const previousVersion = latestRequirementVersion(requirementId);
  const firstDraftFromClarify = requirement.status === 'clarifying' && requirement.currentVersion === 0;
  const nextStatus: RequirementStatus =
    requirement.status === 'intake' || requirement.status === 'blocked' || firstDraftFromClarify ? 'drafting' : 'revising';
  moveRequirement(requirementId, nextStatus);

  const deadline = Date.now() + config.discoveryTimeoutMs;
  const worktree = path.join(os.tmpdir(), `riccon-discovery-${requirementId.slice(0, 8)}-${Date.now()}`);
  let runner: AcpRunner | null = null;

  const promptWithGuards = async (text: string, maxMs: number): Promise<string> => {
    if (getRequirementJob(requirementId)?.cancelRequested) throw new Error('生成已取消');
    const remaining = Math.min(deadline - Date.now(), maxMs);
    if (remaining <= 0) throw new Error(`生成超时（${Math.round(config.discoveryTimeoutMs / 1000)}s）`);
    if (!runner) throw new Error('agent 未启动');
    await raceTimeout(
      runner.prompt(text),
      remaining,
      () => {
        void runner?.stop().catch(() => undefined);
      },
      `生成超时（${Math.round(maxMs / 1000)}s）`,
    );
    if (getRequirementJob(requirementId)?.cancelRequested) throw new Error('生成已取消');
    return runner.responseText;
  };

  try {
    const base = project.defaultBranch || (await currentBranch(project.repoPath));
    sweepDiscoveryWorktrees();
    await createDetachedWorktree(project.repoPath, worktree, base);
    activeWorktrees.add(worktree);
    const discoveryModel = project.discoveryModel || project.model;
    const spec = getAgentSpec(project.agentKind, {
      model: discoveryModel || config.agentModel,
      dbPath: config.opencodeDb,
    });
    runner = new AcpRunner({
      storyId: requirementId,
      sessionId: `discovery-${requirementId.slice(0, 8)}-${Date.now()}`,
      cwd: worktree,
      spec,
      host: createReadOnlyHost(requirementId),
      allowedRoots: [worktree],
      model: discoveryModel || undefined,
      thinking: project.thinking || undefined,
    });
    activeRunners.set(requirementId, runner);
    await raceTimeout(
      runner.start(),
      Math.min(60_000, Math.max(1, deadline - Date.now())),
      () => {
        void runner?.stop().catch(() => undefined);
      },
      'agent 启动超时',
    );

    let draft: RequirementDraft | null = null;
    let issues: RequirementIssue[] = [];
    let restored = 0;
    for (let attempt = 0; attempt < MAX_DRAFT_ATTEMPTS; attempt++) {
      const promptText =
        attempt === 0
          ? buildPrompt(project, requirement, previousVersion?.draft ?? null, previousVersion?.version ?? 0, opts.confirmedIntake)
          : repairPrompt(issues);
      const text = await promptWithGuards(promptText, DRAFT_PROMPT_TIMEOUT_MS);
      draft = normalizeRequirementDraft(parseJsonBlock<unknown>(text));
      if (draft && previousVersion?.draft) {
        const merged = applyTargetedRevision(requirementId, previousVersion.version, previousVersion.draft, draft);
        draft = merged.draft;
        restored = Math.max(restored, merged.restored);
      }
      issues = validateRequirementDraft(draft, {
        existingStories: listStories(project.id),
        historicalTitles: historicalRequirementStoryTitles(project.id, requirementId),
        requireMachineDod: project.requireMachineDod,
        dodCommandCount: project.dodCommands.length,
      });
      if (draft && !issues.some((i) => i.severity === 'error')) {
        try {
          issues.push(...(await criticReview((criticText) => promptWithGuards(criticText, CRITIC_PROMPT_TIMEOUT_MS), draft)));
        } catch (err) {
          if (getRequirementJob(requirementId)?.cancelRequested) throw err;
          issues.push({
            severity: 'warn',
            code: 'critic-skipped',
            message: `Critic 评审未完成，已跳过：${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
      if (restored > 0) {
        issues.push({
          severity: 'warn',
          code: 'targeted-revision',
          message: `已保留 ${restored} 个未受反馈影响的故事的上一版内容（定向修订）`,
        });
      }
      if (!issues.some((i) => i.severity === 'error')) break;
    }

    const version = addRequirementVersion(requirementId, draft, issues, discoveryModel || null);
    bus.publish(requirementId, {
      type: 'requirement.draft',
      requirementId,
      version: version.version,
      stories: draft?.stories.length ?? 0,
      issues: issues.filter((i) => i.severity === 'error').length,
      model: version.model,
    });
    const needsClarification = version.version === 1 && (draft?.openQuestions.length ?? 0) > 0;
    moveRequirement(requirementId, needsClarification ? 'clarifying' : 'in_review');
    finishRequirementJob(requirementId, 'completed');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const cancelled = Boolean(getRequirementJob(requirementId)?.cancelRequested);
    if (cancelled) {
      bus.publish(requirementId, {
        type: 'agent.message',
        sessionId: '',
        role: 'agent',
        text: '[平台] 生成已取消，已保留上一版草稿。',
      });
    } else {
      bus.publish(requirementId, { type: 'session.status', sessionId: '', status: 'error', detail });
    }
    const current = getRequirement(requirementId);
    if (!['in_review', 'approved', 'decomposed', 'archived'].includes(current.status)) {
      const target: RequirementStatus = current.currentVersion > 0 ? 'in_review' : 'blocked';
      try {
        moveRequirement(requirementId, target);
      } catch {
        // keep the original failure
      }
    }
    finishRequirementJob(requirementId, cancelled ? 'cancelled' : 'failed', cancelled ? '用户取消' : detail);
    throw err;
  } finally {
    clearInterval(heartbeat);
    activeRunners.delete(requirementId);
    activeWorktrees.delete(worktree);
    inFlight.delete(requirementId);
    if (runner) await runner.stop().catch(() => undefined);
    await removeWorktree(project.repoPath, worktree).catch(() => undefined);
    try {
      fs.rmSync(worktree, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // next generation/startup sweep will retry
    }
  }
}

export async function cancelRequirementGeneration(requirementId: string): Promise<RequirementJob | null> {
  const job = getRequirementJob(requirementId);
  if (!job || job.status !== 'running') return job;
  requestRequirementCancel(requirementId);
  await activeRunners.get(requirementId)?.stop().catch(() => undefined);
  return getRequirementJob(requirementId);
}

export async function cleanupDiscoveryState(): Promise<void> {
  for (const job of listRunningRequirementJobs()) {
    finishRequirementJob(job.requirementId, 'failed', '服务重启，生成任务已中断');
    const requirement = getRequirement(job.requirementId);
    if (['drafting', 'revising'].includes(requirement.status)) {
      try {
        moveRequirement(job.requirementId, 'blocked');
      } catch {
        // already moved or archived
      }
    }
  }
  const tmp = os.tmpdir();
  for (const name of fs.readdirSync(tmp)) {
    if (!name.startsWith('riccon-discovery-')) continue;
    try {
      fs.rmSync(path.join(tmp, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // ignore locked leftovers; next sweep retries
    }
  }
  for (const project of listProjects()) {
    await pruneWorktrees(project.repoPath).catch(() => undefined);
  }
}

export function submitRequirementFeedback(
  requirementId: string,
  input: {
    comment?: string;
    decisions?: { storyKey?: string | null; decision: RequirementFeedbackDecision; comment?: string }[];
  },
): RequirementFeedback[] {
  const requirement = getRequirement(requirementId);
  if (!['in_review', 'clarifying'].includes(requirement.status)) {
    throw new Error(`需求状态 ${requirement.status} 不允许提交反馈`);
  }
  if (requirement.currentVersion === 0) throw new Error('尚无草稿可反馈');
  if (requirement.currentVersion > MAX_FEEDBACK_ROUNDS) {
    throw new Error(`已达到 ${MAX_FEEDBACK_ROUNDS} 轮人工反馈上限，请直接批准、手工调整或归档`);
  }
  const comment = input.comment?.trim() ?? '';
  const decisions = input.decisions ?? [];
  if (!comment && decisions.length === 0) throw new Error('请提供整体意见或逐故事决策');
  const saved: RequirementFeedback[] = [];
  if (comment) {
    saved.push(
      addRequirementFeedback({ requirementId, version: requirement.currentVersion, decision: 'comment', comment }),
    );
  }
  for (const d of decisions) {
    saved.push(
      addRequirementFeedback({
        requirementId,
        version: requirement.currentVersion,
        storyKey: d.storyKey ?? null,
        decision: d.decision,
        comment: d.comment?.trim() || null,
      }),
    );
  }
  for (const f of saved) {
    bus.publish(requirementId, {
      type: 'requirement.feedback',
      requirementId,
      version: f.version,
      storyKey: f.storyKey,
      decision: f.decision,
    });
  }
  return saved;
}

function formatAcceptance(story: RequirementStoryDraft): string {
  return story.acceptance
    .map((ac, i) => {
      const id = ac.id || `AC${i + 1}`;
      return [
        `${id}`,
        `Given ${ac.given}`,
        `When ${ac.when}`,
        `Then ${ac.then}`,
        ac.test ? `Test: ${ac.test}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

function formatDescription(requirement: Requirement, version: number, story: RequirementStoryDraft): string {
  const lines = [
    story.persona && story.value ? `作为${story.persona}，我希望${story.value}。` : '',
    story.description,
    story.clauses.length ? `来源条款：${story.clauses.join(', ')}` : '',
    story.dependsOn.length ? `依赖故事：${story.dependsOn.join(', ')}` : '',
    story.outOfScope.length ? `不在范围：${story.outOfScope.join('；')}` : '',
    `需求来源：${requirement.title}（v${version}）`,
  ];
  return lines.filter(Boolean).join('\n\n');
}

export function approveRequirement(requirementId: string): { requirement: Requirement; stories: Story[]; version: number } {
  const requirement = getRequirement(requirementId);
  if (requirement.status !== 'in_review') throw new Error(`需求状态 ${requirement.status} 不允许批准`);
  const version = latestRequirementVersion(requirementId);
  if (!version?.draft) throw new Error('尚无结构化草稿可批准');
  const project = getProject(requirement.projectId);
  const issues = validateRequirementDraft(version.draft, {
    existingStories: listStories(project.id),
    historicalTitles: historicalRequirementStoryTitles(project.id, requirementId),
    requireMachineDod: project.requireMachineDod,
    dodCommandCount: project.dodCommands.length,
  });
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) throw new Error(`需求校验未通过：${errors.map((e) => e.message).join('；')}`);

  const stories = transaction(() => {
    setRequirementStatus(requirementId, 'approved');
    markRequirementApproved(requirementId, version.version);
    addRequirementFeedback({
      requirementId,
      version: version.version,
      decision: 'approve',
      comment: `人工批准需求范围（${version.draft!.stories.length} 个故事）`,
      decidedBy: 'human',
    });
    const created = version.draft!.stories.map((story) => {
      const storyRow = createStory({
        projectId: requirement.projectId,
        title: story.title,
        description: formatDescription(requirement, version.version, story),
        acceptanceCriteria: formatAcceptance(story),
        requirementId,
        sourceVersion: version.version,
        sourceVersionId: version.id,
        sourceStoryKey: story.key,
        sourceClause: story.clauses.join(', '),
      });
      if (requirement.categoryId) setStoryCategory(storyRow.id, requirement.categoryId);
      for (const ac of story.acceptance) {
        createAcceptance(storyRow.id, {
          acId: ac.id,
          given: ac.given,
          when: ac.when,
          then: ac.then,
          test: ac.test ?? null,
        });
      }
      return setStoryStatus(storyRow.id, 'ready');
    });
    const idByKey = new Map(created.map((story) => [story.sourceStoryKey ?? '', story.id]));
    for (const story of version.draft!.stories) {
      for (const predecessorKey of story.dependsOn) {
        const predecessorId = idByKey.get(predecessorKey);
        const successorId = idByKey.get(story.key);
        if (!predecessorId || !successorId) continue;
        insertDependency({
          projectId: requirement.projectId,
          predecessorType: 'story',
          predecessorId,
          successorType: 'story',
          successorId,
        });
      }
    }
    setRequirementStatus(requirementId, 'decomposed');
    return created;
  });

  bus.publish(requirementId, { type: 'requirement.status', requirementId, from: 'in_review', to: 'approved' });
  bus.publish(requirementId, {
    type: 'requirement.feedback',
    requirementId,
    version: version.version,
    storyKey: null,
    decision: 'approve',
  });
  for (const story of stories) {
    bus.publish(story.id, { type: 'story.status', from: 'draft', to: 'ready' });
  }
  bus.publish(requirementId, { type: 'requirement.status', requirementId, from: 'approved', to: 'decomposed' });
  bus.publish(requirementId, {
    type: 'requirement.materialized',
    requirementId,
    version: version.version,
    storyIds: stories.map((s) => s.id),
  });
  try {
    applyDraftTaxonomy(requirementId, version.draft!);
  } catch (err) {
    console.error('[taxonomy] apply draft failed', err);
  }
  try {
    generateRequirementDocuments(requirement.projectId);
  } catch (err) {
    console.error('[documents] requirement docs failed', err);
  }
  return { requirement: getRequirement(requirementId), stories, version: version.version };
}

export function archiveRequirement(requirementId: string): Requirement {
  const requirement = getRequirement(requirementId);
  if (requirement.status === 'decomposed') throw new Error('已物化需求不能归档，请直接管理生成的故事');
  if (requirement.status === 'archived') return requirement;
  const after = setRequirementStatus(requirementId, 'archived');
  bus.publish(requirementId, { type: 'requirement.status', requirementId, from: requirement.status, to: 'archived' });
  return after;
}
