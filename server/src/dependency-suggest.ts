import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import type * as acp from '@agentclientprotocol/sdk';
import type {
  DependencyEntityType,
  DependencySuggestion,
  EventPayload,
  Project,
  Requirement,
  Story,
} from '@riccon-scrum/shared';
import { bus } from './bus';
import { config } from './config';
import {
  getProject,
  getRequirement,
  getStory,
  latestRequirementVersion,
  listDependencies,
  listRequirements,
  listStories,
} from './db';
import { AcpRunner, type RunnerHost } from './acp/runner';
import { getAgentSpec } from './acp/agents';
import { dependencySuggestPrompt, parseJsonBlock } from './templates';
import { createDetachedWorktree, currentBranch, removeWorktree } from './git';
import { searchEntities } from './semantic';
import { validateDependency } from './dependencies';

const TIMEOUT_MS = 3 * 60_000;
const MAX_SUGGESTIONS = 5;
const activeWorktrees = new Set<string>();

function sweepWorktrees(): void {
  const tmp = os.tmpdir();
  for (const name of fs.readdirSync(tmp)) {
    if (!name.startsWith('riccon-depsuggest-')) continue;
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

function requirementSummary(requirement: Requirement): string {
  const draft = latestRequirementVersion(requirement.id)?.draft;
  return draft?.summary || requirement.rawInput;
}

function storySummary(story: Story): string {
  return `${story.title}\n${story.description}\n${story.acceptanceCriteria}`;
}

function readOnlyHost(streamId: string): RunnerHost {
  return {
    publish: (id: string, payload: EventPayload) => {
      if (id === streamId && payload.type === 'session.status') bus.publish(streamId, payload);
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

export async function suggestDependencies(input: {
  projectId: string;
  entityType: DependencyEntityType;
  entityId: string;
}): Promise<DependencySuggestion[]> {
  const project: Project = getProject(input.projectId);
  const target = input.entityType === 'requirement' ? getRequirement(input.entityId) : getStory(input.entityId);
  const targetTitle = target.title;
  const targetSummary = input.entityType === 'requirement' ? requirementSummary(target as Requirement) : storySummary(target as Story);

  const hits = await searchEntities(input.projectId, `${targetTitle} ${targetSummary.slice(0, 400)}`, 30);
  const candidateIds = new Set(
    hits.hits
      .filter((hit) => hit.type === input.entityType && hit.id !== input.entityId)
      .map((hit) => hit.id),
  );
  if (candidateIds.size < 5) {
    const fallback =
      input.entityType === 'requirement'
        ? listRequirements(input.projectId).filter((item) => item.id !== input.entityId && item.status !== 'archived')
        : listStories(input.projectId).filter((item) => item.id !== input.entityId);
    for (const item of fallback.slice(0, 25)) candidateIds.add(item.id);
  }
  const candidates = [...candidateIds].slice(0, 25);
  if (candidates.length === 0) return [];

  const candidateLines = candidates.map((id) => {
    if (input.entityType === 'requirement') {
      const item = getRequirement(id);
      return `- [${item.status}] ${item.title} (id=${id}) ${requirementSummary(item).slice(0, 180).replace(/\n/g, ' ')}`;
    }
    const item = getStory(id);
    return `- [${item.status}] ${item.title} (id=${id}) ${item.description.slice(0, 180).replace(/\n/g, ' ')}`;
  });
  const existing = listDependencies(input.projectId, input.entityType)
    .filter((dep) => dep.predecessorId === input.entityId || dep.successorId === input.entityId)
    .map((dep) => `- ${dep.predecessorId} -> ${dep.successorId}`);

  const worktree = path.join(os.tmpdir(), `riccon-depsuggest-${input.entityId.slice(0, 8)}-${Date.now()}`);
  let runner: AcpRunner | null = null;
  try {
    const base = project.defaultBranch || (await currentBranch(project.repoPath));
    sweepWorktrees();
    await createDetachedWorktree(project.repoPath, worktree, base);
    activeWorktrees.add(worktree);
    const model = project.discoveryModel || project.model;
    const spec = getAgentSpec(project.agentKind, { model: model || config.agentModel, dbPath: config.opencodeDb });
    runner = new AcpRunner({
      storyId: input.entityId,
      sessionId: `depsuggest-${input.entityId.slice(0, 8)}-${Date.now()}`,
      cwd: worktree,
      spec,
      host: readOnlyHost(input.entityId),
      allowedRoots: [worktree],
      model: model || undefined,
    });
    await raceTimeout(runner.start(), 60_000, () => void runner?.stop().catch(() => undefined), 'agent 启动超时');
    await raceTimeout(
      runner.prompt(
        dependencySuggestPrompt({
          projectName: project.name,
          entityType: input.entityType,
          targetId: input.entityId,
          targetTitle,
          targetSummary: targetSummary.slice(0, 2000),
          candidates: candidateLines,
          existing,
        }),
      ),
      TIMEOUT_MS,
      () => void runner?.stop().catch(() => undefined),
      '依赖建议超时',
    );
    const parsed = parseJsonBlock<{ suggestions?: unknown }>(runner.responseText);
    const raw = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
    const allowed = new Set([input.entityId, ...candidates]);
    const result: DependencySuggestion[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const predecessorId = asText(record.predecessorId);
      const successorId = asText(record.successorId);
      const confidence = typeof record.confidence === 'number' ? record.confidence : 0;
      const reason = asText(record.reason);
      if (!predecessorId || !successorId || confidence < 0.5) continue;
      if (!allowed.has(predecessorId) || !allowed.has(successorId)) continue;
      if (predecessorId === successorId) continue;
      if (predecessorId !== input.entityId && successorId !== input.entityId) continue;
      const key = `${predecessorId}|${successorId}`;
      if (seen.has(key)) continue;
      try {
        validateDependency({
          projectId: input.projectId,
          predecessorType: input.entityType,
          predecessorId,
          successorType: input.entityType,
          successorId,
        });
      } catch {
        continue;
      }
      const predecessorTitle =
        predecessorId === input.entityId
          ? targetTitle
          : input.entityType === 'requirement'
            ? getRequirement(predecessorId).title
            : getStory(predecessorId).title;
      const successorTitle =
        successorId === input.entityId
          ? targetTitle
          : input.entityType === 'requirement'
            ? getRequirement(successorId).title
            : getStory(successorId).title;
      seen.add(key);
      result.push({
        predecessorType: input.entityType,
        predecessorId,
        predecessorTitle,
        successorType: input.entityType,
        successorId,
        successorTitle,
        reason,
        confidence,
      });
      if (result.length >= MAX_SUGGESTIONS) break;
    }
    return result.sort((a, b) => b.confidence - a.confidence);
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

export function cleanupDependencySuggestState(): void {
  sweepWorktrees();
}
