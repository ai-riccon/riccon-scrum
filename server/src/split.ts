import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import type * as acp from '@agentclientprotocol/sdk';
import type {
  EventPayload,
  Project,
  Requirement,
  RequirementSplitChild,
  RequirementSplitDraft,
} from '@riccon-scrum/shared';
import { bus } from './bus';
import { generateRequirementDocuments } from './documents';
import { config } from './config';
import {
  createRequirement,
  deleteRequirementSplitDraft,
  getProject,
  getRequirement,
  getRequirementSplitDraft,
  insertDependency,
  latestRequirementVersion,
  listDependencies,
  listRequirements,
  saveRequirementSplitDraft,
  setRequirementStatus,
  transaction,
} from './db';
import { AcpRunner, type RunnerHost } from './acp/runner';
import { getAgentSpec } from './acp/agents';
import { parseJsonBlock, requirementSplitPrompt } from './templates';
import { createDetachedWorktree, currentBranch, removeWorktree } from './git';

const MAX_CHILDREN = 6;
const MIN_CHILDREN = 2;
const MAX_DEPTH = 3;
const TIMEOUT_MS = 3 * 60_000;
const activeWorktrees = new Set<string>();

type ChildDraft = RequirementSplitChild;

function sweepSplitWorktrees(): void {
  const tmp = os.tmpdir();
  for (const name of fs.readdirSync(tmp)) {
    if (!name.startsWith('riccon-split-')) continue;
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
    return value.map((item) => (typeof item === 'string' ? item.trim() : asText((item as { text?: unknown })?.text))).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/\n|;|；/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeChildren(raw: unknown): ChildDraft[] {
  const list = (raw as { children?: unknown } | null)?.children;
  if (!Array.isArray(list)) return [];
  return list
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item, index) => ({
      key: asText(item.key ?? item.id) || `R2.${index + 1}`,
      title: asText(item.title ?? item.name),
      goal: asText(item.goal ?? item.objective),
      scope: asText(item.scope ?? item.description),
      acceptance: asList(item.acceptance ?? item.acceptanceCriteria ?? item.outcomes),
      dependsOn: asList(item.dependsOn ?? item.depends_on ?? item.dependencies),
      size: asText(item.size) || 'M',
    }));
}

function findCycle(children: ChildDraft[]): string[] {
  const graph = new Map(children.map((child) => [child.key, child.dependsOn]));
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
  for (const child of children) {
    if (visit(child.key)) break;
  }
  return found;
}

function validateChildren(children: ChildDraft[], existingTitles: string[]): void {
  if (children.length < MIN_CHILDREN || children.length > MAX_CHILDREN) {
    throw new Error(`需求拆分需要 ${MIN_CHILDREN}–${MAX_CHILDREN} 个子需求，当前 ${children.length} 个`);
  }
  const keys = new Set<string>();
  const titles = new Set(existingTitles.map((title) => title.trim()));
  for (const child of children) {
    if (!child.title) throw new Error('子需求标题不能为空');
    if (!child.goal) throw new Error(`子需求「${child.title}」缺少业务目标`);
    if (child.acceptance.length === 0) throw new Error(`子需求「${child.title}」缺少验收要点`);
    if (keys.has(child.key)) throw new Error(`子需求 key 重复：${child.key}`);
    keys.add(child.key);
    if (titles.has(child.title)) throw new Error(`子需求标题重复或已存在：${child.title}`);
    titles.add(child.title);
  }
  for (const child of children) {
    for (const dependency of child.dependsOn) {
      if (dependency === child.key) throw new Error(`子需求不能依赖自身：${child.key}`);
      if (!keys.has(dependency)) throw new Error(`子需求依赖的 key 不存在：${dependency}`);
    }
  }
  const cycle = findCycle(children);
  if (cycle.length > 0) throw new Error(`子需求依赖存在循环：${cycle.join(' → ')}`);
}

function requirementDepth(id: string): number {
  let depth = 1;
  let current = getRequirement(id);
  const seen = new Set<string>();
  while (current.parentRequirementId && !seen.has(current.id)) {
    seen.add(current.id);
    try {
      current = getRequirement(current.parentRequirementId);
      depth++;
    } catch {
      break;
    }
  }
  return depth;
}

function readOnlyHost(requirementId: string): RunnerHost {
  return {
    publish: (streamId: string, payload: EventPayload) => {
      if (streamId !== requirementId) return;
      if (payload.type !== 'session.status') return;
      bus.publish(requirementId, payload);
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

function assertSplitReady(requirementId: string): { requirement: Requirement; project: Project; depth: number; version: number } {
  const requirement = getRequirement(requirementId);
  if (!['in_review', 'clarifying'].includes(requirement.status)) {
    throw new Error(`需求状态 ${requirement.status} 不允许拆分`);
  }
  const depth = requirementDepth(requirementId);
  if (depth >= MAX_DEPTH) throw new Error(`需求层级最多 ${MAX_DEPTH} 层，当前第 ${depth} 层不能再拆`);
  const version = latestRequirementVersion(requirementId);
  if (!version?.draft) throw new Error('请先生成需求草稿再拆分');
  return { requirement, project: getProject(requirement.projectId), depth, version: version.version };
}

export async function generateSplitDraft(requirementId: string): Promise<RequirementSplitDraft> {
  const { requirement, project, depth, version: currentVersion } = assertSplitReady(requirementId);
  const version = latestRequirementVersion(requirementId)!;
  const worktree = path.join(os.tmpdir(), `riccon-split-${requirementId.slice(0, 8)}-${Date.now()}`);
  let runner: AcpRunner | null = null;

  try {
    const base = project.defaultBranch || (await currentBranch(project.repoPath));
    sweepSplitWorktrees();
    await createDetachedWorktree(project.repoPath, worktree, base);
    activeWorktrees.add(worktree);
    const model = project.discoveryModel || project.model;
    const spec = getAgentSpec(project.agentKind, { model: model || config.agentModel, dbPath: config.opencodeDb });
    runner = new AcpRunner({
      storyId: requirementId,
      sessionId: `split-${requirementId.slice(0, 8)}-${Date.now()}`,
      cwd: worktree,
      spec,
      host: readOnlyHost(requirementId),
      allowedRoots: [worktree],
      model: model || undefined,
    });
    await raceTimeout(runner.start(), 60_000, () => void runner?.stop().catch(() => undefined), 'agent 启动超时');
    const prompt = requirementSplitPrompt({
      projectName: project.name,
      title: requirement.title,
      rawInput: requirement.rawInput,
      intake: requirement.intake,
      draft: version.draft,
      existingRequirements: listRequirements(project.id)
        .filter((item) => item.id !== requirementId && item.status !== 'archived')
        .map((item) => item.title),
      depth,
      maxDepth: MAX_DEPTH,
    });
    await raceTimeout(runner.prompt(prompt), TIMEOUT_MS, () => void runner?.stop().catch(() => undefined), '需求拆分超时');
    const parsed = parseJsonBlock<{ summary?: unknown }>(runner.responseText);
    const children = normalizeChildren(parsed);
    validateChildren(children, listRequirements(project.id).map((item) => item.title));
    return saveRequirementSplitDraft({
      requirementId,
      version: currentVersion,
      summary: asText(parsed?.summary),
      children,
      model: model || null,
      createdAt: new Date().toISOString(),
    });
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

export function confirmSplit(
  requirementId: string,
  inputChildren?: RequirementSplitChild[],
): { parent: Requirement; children: Requirement[] } {
  const { requirement, project, version } = assertSplitReady(requirementId);
  const draft = getRequirementSplitDraft(requirementId);
  if (!draft) throw new Error('请先生成拆分草案');
  if (draft.version !== version) throw new Error('需求草稿已更新，请重新生成拆分草案');
  const source = inputChildren !== undefined ? normalizeChildren({ children: inputChildren }) : draft.children;
  const selectedKeys = new Set(source.map((child) => child.key));
  const children = source.map((child) => ({
    ...child,
    dependsOn: child.dependsOn.filter((key) => selectedKeys.has(key)),
  }));
  validateChildren(children, listRequirements(project.id).map((item) => item.title));

  const created = transaction(() => {
    setRequirementStatus(requirementId, 'split');
    const rows = children.map((child) =>
      createRequirement({
        projectId: project.id,
        title: child.title,
        rawInput: [
          `目标：${child.goal}`,
          child.scope ? `范围：${child.scope}` : '',
          child.acceptance.length ? `验收要点：${child.acceptance.join('；')}` : '',
          `来源：需求拆分（${requirement.title}）`,
        ]
          .filter(Boolean)
          .join('\n'),
        intake: {
          goal: child.goal,
          users: requirement.intake?.users ?? '',
          constraints: requirement.intake?.constraints ?? '',
          nonGoals: requirement.intake?.nonGoals ?? '',
          successMetrics: child.acceptance.join('；'),
          examples: child.scope,
        },
        source: 'decomposition',
        parentRequirementId: requirementId,
        categoryId: requirement.categoryId,
      }),
    );
    const idByKey = new Map(rows.map((row, index) => [children[index].key, row.id]));
    const inherited = listDependencies(project.id, 'requirement').filter((dep) => dep.successorId === requirementId);
    for (const row of rows) {
      for (const dep of inherited) {
        insertDependency({
          projectId: project.id,
          predecessorType: 'requirement',
          predecessorId: dep.predecessorId,
          successorType: 'requirement',
          successorId: row.id,
        });
      }
    }
    for (const child of children) {
      const successorId = idByKey.get(child.key);
      if (!successorId) continue;
      for (const dependency of child.dependsOn) {
        const predecessorId = idByKey.get(dependency);
        if (!predecessorId) continue;
        insertDependency({
          projectId: project.id,
          predecessorType: 'requirement',
          predecessorId,
          successorType: 'requirement',
          successorId,
        });
      }
    }
    deleteRequirementSplitDraft(requirementId);
    return rows;
  });

  bus.publish(requirementId, { type: 'requirement.status', requirementId, from: requirement.status, to: 'split' });
  bus.publish(requirementId, { type: 'requirement.split', requirementId, children: created.length });
  try {
    generateRequirementDocuments(project.id);
  } catch (err) {
    console.error('[documents] requirement docs failed after split', err);
  }
  return { parent: getRequirement(requirementId), children: created };
}

export function getSplitDraft(requirementId: string): RequirementSplitDraft | null {
  return getRequirementSplitDraft(requirementId);
}

export function cleanupSplitState(): void {
  sweepSplitWorktrees();
}
