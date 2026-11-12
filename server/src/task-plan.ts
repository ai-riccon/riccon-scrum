import path from 'node:path';
import type { StoryTask, StoryTaskDraft, StoryTaskEdge, StoryTaskPlan, TaskPlanIssue } from '@riccon-scrum/shared';
import { config } from './config';
import { bus } from './bus';
import {
  acceptanceForStory,
  createSession,
  createStoryTask,
  deleteStoryTask,
  getProject,
  getStory,
  getStoryTask,
  getStoryTaskPlanMeta,
  insertTaskDependency,
  listStoryTasks,
  listTaskEdges,
  replaceStoryTasks,
  replaceTaskDependencies,
  saveStoryTaskPlan,
  updateSession,
  updateStoryTask,
} from './db';
import { AcpRunner } from './acp/runner';
import { getAgentSpec } from './acp/agents';
import { readOnlyHost } from './acp/readonly';
import { planningContext } from './context';
import { normalizeStoryTaskPlan, parseJsonBlock, storyTaskPlanPrompt } from './templates';
import { getGlobalSettings } from './settings';

const PLANNER_TIMEOUT_MS = 120_000;

function fallbackDrafts(story: { title: string; description: string }, acIds: string[]): StoryTaskDraft[] {
  return [
    {
      key: 'T1',
      title: story.title,
      description: story.description || '按故事验收标准完成实现。',
      files: [],
      acIds,
      dependsOn: [],
      verifyCommand: null,
    },
  ];
}

function placeholderTitle(title: string): boolean {
  return /^(待定|todo|tbd|其他|杂项|重构|优化|完善|处理一下)/i.test(title.trim());
}

export function validateTaskPlan(
  drafts: StoryTaskDraft[],
  acIds: string[],
  maxTasks: number,
  minTasks = 2,
  completed: { key: string; acIds: string[] }[] = [],
): TaskPlanIssue[] {
  const issues: TaskPlanIssue[] = [];
  const add = (severity: TaskPlanIssue['severity'], code: string, message: string, taskKey?: string) =>
    issues.push({ severity, code, message, taskKey: taskKey ?? null });

  if (drafts.length === 0) {
    add('error', 'task-empty', '没有生成任何任务');
    return issues;
  }
  if (drafts.length < minTasks) add('error', 'task-too-few', `至少需要 ${minTasks} 个任务，当前 ${drafts.length} 个`);
  if (drafts.length > maxTasks) add('error', 'task-too-many', `最多 ${maxTasks} 个任务，当前 ${drafts.length} 个`);

  const keys = new Set<string>();
  const titles = new Set<string>();
  const known = new Set([...drafts.map((draft) => draft.key), ...completed.map((task) => task.key)]);
  const completedKeys = new Set(completed.map((task) => task.key));
  for (const draft of drafts) {
    if (!draft.key.trim()) add('error', 'task-key-empty', '任务 key 不能为空');
    if (keys.has(draft.key)) add('error', 'task-key-duplicate', `任务 key 重复：${draft.key}`, draft.key);
    if (completedKeys.has(draft.key)) add('error', 'task-key-conflict', `任务 key 与已完成任务冲突：${draft.key}`, draft.key);
    keys.add(draft.key);
    if (!draft.title.trim()) add('error', 'task-title-empty', '任务标题不能为空', draft.key);
    if (placeholderTitle(draft.title)) add('error', 'task-placeholder', '任务标题过于空泛，无法验证', draft.key);
    const titleKey = draft.title.trim().toLowerCase();
    if (titles.has(titleKey)) add('warn', 'task-title-duplicate', `任务标题重复：${draft.title}`, draft.key);
    titles.add(titleKey);
    if (draft.acIds.length === 0) add('warn', 'task-ac-empty', '任务未关联任何 AC', draft.key);
    for (const acId of draft.acIds) {
      if (acIds.length > 0 && !acIds.includes(acId)) add('error', 'task-ac-unknown', `未知的 AC：${acId}`, draft.key);
      if (acIds.length === 0) add('warn', 'task-ac-unstructured', `故事没有结构化 AC ID，任务映射 ${acId} 仅作参考`, draft.key);
    }
    for (const dependency of draft.dependsOn) {
      if (dependency === draft.key) add('error', 'task-dep-self', '任务不能依赖自身', draft.key);
      else if (!known.has(dependency)) add('error', 'task-dep-unknown', `依赖不存在的任务：${dependency}`, draft.key);
    }
  }

  if (acIds.length > 0) {
    const covered = new Set([...drafts.flatMap((draft) => draft.acIds), ...completed.flatMap((task) => task.acIds)]);
    for (const acId of acIds) {
      if (!covered.has(acId)) add('error', 'task-ac-uncovered', `验收标准 ${acId} 未被任何任务覆盖`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byKey = new Map(drafts.map((draft) => [draft.key, draft]));
  const visit = (key: string, stack: string[]): void => {
    if (visited.has(key)) return;
    if (visiting.has(key)) {
      add('error', 'task-dep-cycle', `任务依赖形成循环：${[...stack, key].join(' → ')}`, key);
      return;
    }
    visiting.add(key);
    for (const dependency of byKey.get(key)?.dependsOn ?? []) {
      if (byKey.has(dependency)) visit(dependency, [...stack, key]);
    }
    // 依赖已完成任务是合法的重规划起点，不参与新计划环检测。
    visiting.delete(key);
    visited.add(key);
  };
  for (const draft of drafts) visit(draft.key, []);
  return issues;
}

export function topoOrder(tasks: StoryTask[], edges: StoryTaskEdge[]): StoryTask[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const indegree = new Map<string, number>(tasks.map((task) => [task.id, 0]));
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    if (!byId.has(edge.taskId) || !byId.has(edge.dependsOnTaskId)) continue;
    indegree.set(edge.taskId, (indegree.get(edge.taskId) ?? 0) + 1);
    const list = next.get(edge.dependsOnTaskId) ?? [];
    list.push(edge.taskId);
    next.set(edge.dependsOnTaskId, list);
  }
  const ready = tasks.filter((task) => (indegree.get(task.id) ?? 0) === 0).sort((a, b) => a.seq - b.seq);
  const out: StoryTask[] = [];
  while (ready.length) {
    const task = ready.shift() as StoryTask;
    out.push(task);
    for (const id of next.get(task.id) ?? []) {
      indegree.set(id, (indegree.get(id) ?? 1) - 1);
      if ((indegree.get(id) ?? 0) === 0) {
        const candidate = byId.get(id);
        if (candidate) {
          ready.push(candidate);
          ready.sort((a, b) => a.seq - b.seq);
        }
      }
    }
  }
  if (out.length < tasks.length) {
    const appended = tasks.filter((task) => !out.some((item) => item.id === task.id)).sort((a, b) => a.seq - b.seq);
    out.push(...appended);
  }
  return out;
}

export function taskBlockers(task: StoryTask, tasks: StoryTask[], edges: StoryTaskEdge[]): string[] {
  const byId = new Map(tasks.map((item) => [item.id, item]));
  return edges
    .filter((edge) => edge.taskId === task.id)
    .map((edge) => byId.get(edge.dependsOnTaskId))
    .filter((item): item is StoryTask => item !== undefined && item.status !== 'done' && item.status !== 'skipped')
    .map((item) => item.id);
}

export function isTaskRunnable(task: StoryTask, tasks: StoryTask[], edges: StoryTaskEdge[]): boolean {
  if (task.status !== 'pending' && task.status !== 'failed') return false;
  return taskBlockers(task, tasks, edges).length === 0;
}

export function nextRunnableTask(tasks: StoryTask[], edges: StoryTaskEdge[]): StoryTask | null {
  const order = topoOrder(tasks, edges);
  return order.find((task) => isTaskRunnable(task, tasks, edges)) ?? null;
}

export function criticalPath(tasks: StoryTask[], edges: StoryTaskEdge[]): string[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const predecessors = new Map<string, string[]>();
  for (const edge of edges) {
    if (!byId.has(edge.taskId) || !byId.has(edge.dependsOnTaskId)) continue;
    const list = predecessors.get(edge.taskId) ?? [];
    list.push(edge.dependsOnTaskId);
    predecessors.set(edge.taskId, list);
  }
  const memo = new Map<string, string[]>();
  const visiting = new Set<string>();
  const longest = (id: string): string[] => {
    if (memo.has(id)) return memo.get(id) as string[];
    if (visiting.has(id)) return [];
    visiting.add(id);
    let best: string[] = [];
    for (const predecessor of predecessors.get(id) ?? []) {
      const candidate = longest(predecessor);
      if (candidate.length > best.length) best = candidate;
    }
    visiting.delete(id);
    const path = [...best, byId.get(id)?.key ?? id];
    memo.set(id, path);
    return path;
  };
  let result: string[] = [];
  for (const task of tasks) {
    const path = longest(task.id);
    if (path.length > result.length) result = path;
  }
  return result;
}

export function buildStoryTaskPlan(storyId: string): StoryTaskPlan {
  const tasks = listStoryTasks(storyId);
  const edges = listTaskEdges(storyId);
  const meta = getStoryTaskPlanMeta(storyId);
  return {
    storyId,
    strategy: meta?.strategy ?? '',
    model: meta?.model ?? null,
    source: meta?.source ?? 'fallback',
    tasks,
    edges,
    criticalPath: criticalPath(tasks, edges),
    parallel: getGlobalSettings().parallelTasks,
  };
}

async function runPlanner(storyId: string, prompt: string): Promise<{ text: string; model: string | null; sessionId: string }> {
  const story = getStory(storyId);
  if (!story.worktreePath) throw new Error('规划需要先创建工作树');
  const project = getProject(story.projectId);
  const model = project.model || config.agentModel;
  const session = createSession(storyId, project.agentKind, 'lead', model || null);
  const spec = getAgentSpec(project.agentKind, { model: model || config.agentModel, dbPath: config.opencodeDb });
  const runner = new AcpRunner({
    storyId,
    sessionId: session.id,
    cwd: path.resolve(story.worktreePath),
    spec,
    host: readOnlyHost(storyId),
    allowedRoots: [path.resolve(story.worktreePath)],
    model: model || undefined,
  });
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await runner.start();
    updateSession(session.id, {
      pid: runner.pid ?? undefined,
      acpSessionId: runner.sessionId ?? undefined,
      status: 'running',
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void runner.stop().catch(() => undefined);
        reject(new Error('任务规划超时'));
      }, PLANNER_TIMEOUT_MS);
    });
    await Promise.race([runner.prompt(prompt), timeout]);
    return { text: runner.responseText, model, sessionId: session.id };
  } finally {
    if (timer) clearTimeout(timer);
    await runner.stop().catch(() => undefined);
    updateSession(session.id, { status: 'stopped' });
  }
}

function savePlan(storyId: string, projectId: string, strategy: string, model: string | null, source: 'ai' | 'fallback', drafts: StoryTaskDraft[]): StoryTaskPlan {
  replaceStoryTasks(storyId, projectId, strategy, model, source, drafts);
  const plan = buildStoryTaskPlan(storyId);
  bus.publish(storyId, {
    type: 'task.plan',
    storyId,
    tasks: plan.tasks.length,
    criticalPath: plan.criticalPath,
    model: plan.model,
  });
  return plan;
}

export async function planStoryTasks(storyId: string, opts: { force?: boolean } = {}): Promise<{ plan: StoryTaskPlan; fallback: boolean }> {
  const existing = listStoryTasks(storyId);
  if (existing.length > 0 && !opts.force) return { plan: buildStoryTaskPlan(storyId), fallback: false };
  if (opts.force && existing.some((task) => task.status === 'done' || task.status === 'in_progress')) {
    throw new Error('已有完成或执行中的任务，不能整体重规划；请使用重试/跳过或重规划剩余任务');
  }

  const story = getStory(storyId);
  const project = getProject(story.projectId);
  const acIds = acceptanceForStory(storyId).map((ac) => ac.acId);
  const settings = getGlobalSettings();
  if (!settings.taskPlanning) {
    return { plan: savePlan(storyId, project.id, '未启用 AI 任务规划，按单任务执行。', null, 'fallback', fallbackDrafts(story, acIds)), fallback: true };
  }

  try {
    const context = planningContext(storyId);
    const firstPrompt = storyTaskPlanPrompt({ story, acIds, context, maxTasks: settings.maxStoryTasks });
    const first = await runPlanner(storyId, firstPrompt);
    let parsed = normalizeStoryTaskPlan(parseJsonBlock(first.text));
    let drafts = (parsed?.tasks ?? []) as StoryTaskDraft[];
    let issues = validateTaskPlan(drafts, acIds, settings.maxStoryTasks);
    if (issues.some((issue) => issue.severity === 'error')) {
      const repairPrompt = storyTaskPlanPrompt({
        story,
        acIds,
        context,
        maxTasks: settings.maxStoryTasks,
        issues,
        failure: first.text.slice(-2500),
      });
      const repaired = await runPlanner(storyId, repairPrompt);
      parsed = normalizeStoryTaskPlan(parseJsonBlock(repaired.text));
      drafts = (parsed?.tasks ?? []) as StoryTaskDraft[];
      issues = validateTaskPlan(drafts, acIds, settings.maxStoryTasks);
    }
    if (!parsed || drafts.length === 0 || issues.some((issue) => issue.severity === 'error')) {
      throw new Error(`任务计划校验未通过：${issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message).join('；') || '无任务'}`);
    }
    return {
      plan: savePlan(storyId, project.id, parsed.strategy || 'AI 规划', first.model, 'ai', drafts),
      fallback: false,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[task-plan] fallback to single task', detail);
    return {
      plan: savePlan(
        storyId,
        project.id,
        `任务规划失败，降级为单任务：${detail.slice(0, 300)}`,
        null,
        'fallback',
        fallbackDrafts(story, acIds),
      ),
      fallback: true,
    };
  }
}

export function updateTaskPlanTask(
  storyId: string,
  taskId: string,
  patch: {
    title?: string;
    description?: string;
    files?: string[];
    acIds?: string[];
    verifyCommand?: string | null;
    dependsOnKeys?: string[];
  },
): StoryTaskPlan {
  const story = getStory(storyId);
  const task = getStoryTask(taskId);
  if (task.storyId !== storyId) throw new Error('任务不属于该故事');
  if (task.status === 'done') throw new Error('已完成的任务不能编辑');
  if (task.status === 'in_progress') throw new Error('执行中的任务不能编辑');
  const tasks = listStoryTasks(storyId);
  const edges = listTaskEdges(storyId);
  const byId = new Map(tasks.map((item) => [item.id, item]));
  const dependenciesByKey = new Map(
    tasks.map((item) => [
      item.key,
      edges.filter((edge) => edge.taskId === item.id).map((edge) => byId.get(edge.dependsOnTaskId)?.key).filter((key): key is string => Boolean(key)),
    ]),
  );
  if (patch.dependsOnKeys) {
    for (const key of patch.dependsOnKeys) {
      if (!tasks.some((item) => item.key === key)) throw new Error(`依赖不存在的任务：${key}`);
    }
    dependenciesByKey.set(task.key, patch.dependsOnKeys);
  }
  const drafts: StoryTaskDraft[] = tasks.map((item) => ({
    key: item.key,
    title: item.id === taskId ? patch.title ?? item.title : item.title,
    description: item.id === taskId ? patch.description ?? item.description : item.description,
    files: item.id === taskId ? patch.files ?? item.files : item.files,
    acIds: item.id === taskId ? patch.acIds ?? item.acIds : item.acIds,
    dependsOn: dependenciesByKey.get(item.key) ?? [],
    verifyCommand: item.id === taskId ? patch.verifyCommand !== undefined ? patch.verifyCommand : item.verifyCommand : item.verifyCommand,
  }));
  const issues = validateTaskPlan(drafts, acceptanceForStory(storyId).map((ac) => ac.acId), getGlobalSettings().maxStoryTasks, 1);
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) throw new Error(`任务计划校验未通过：${errors.map((issue) => issue.message).join('；')}`);
  updateStoryTask(taskId, {
    title: patch.title ?? task.title,
    description: patch.description ?? task.description,
    files: patch.files ?? task.files,
    acIds: patch.acIds ?? task.acIds,
    verifyCommand: patch.verifyCommand !== undefined ? patch.verifyCommand : task.verifyCommand,
    source: 'manual',
  });
  if (patch.dependsOnKeys) {
    const idByKey = new Map(tasks.map((item) => [item.key, item.id]));
    replaceTaskDependencies(
      taskId,
      patch.dependsOnKeys.map((key) => idByKey.get(key)).filter((id): id is string => Boolean(id)),
    );
  }
  return buildStoryTaskPlan(storyId);
}

export async function replanRemainingTasks(
  storyId: string,
  failure = '',
): Promise<{ plan: StoryTaskPlan; fallback: boolean }> {
  const story = getStory(storyId);
  const project = getProject(story.projectId);
  if (['review', 'done'].includes(story.status)) throw new Error(`故事状态 ${story.status} 不允许重规划`);
  const tasks = listStoryTasks(storyId);
  if (tasks.some((task) => task.status === 'in_progress')) throw new Error('有任务正在执行，不能重规划');
  const completed = tasks.filter((task) => task.status === 'done' || task.status === 'skipped');
  const removable = tasks.filter((task) => task.status === 'pending' || task.status === 'failed');
  if (removable.length === 0) throw new Error('没有需要重规划的任务');
  const acIds = acceptanceForStory(storyId).map((ac) => ac.acId);
  const settings = getGlobalSettings();
  const context = planningContext(storyId);
  const completedLines = completed.map((task) => `${task.key} 已完成：${task.title}（${task.acIds.join(', ') || '无 AC'}）`);
  const prompt = storyTaskPlanPrompt({
    story,
    acIds,
    context,
    maxTasks: settings.maxStoryTasks,
    completed: completedLines,
    failure,
  });
  let parsed = normalizeStoryTaskPlan(parseJsonBlock((await runPlanner(storyId, prompt)).text));
  let drafts = (parsed?.tasks ?? []) as StoryTaskDraft[];
  let issues = validateTaskPlan(drafts, acIds, settings.maxStoryTasks, 1, completed);
  if (issues.some((issue) => issue.severity === 'error')) {
    const repairPrompt = storyTaskPlanPrompt({
      story,
      acIds,
      context,
      maxTasks: settings.maxStoryTasks,
      completed: completedLines,
      failure,
      issues,
    });
    parsed = normalizeStoryTaskPlan(parseJsonBlock((await runPlanner(storyId, repairPrompt)).text));
    drafts = (parsed?.tasks ?? []) as StoryTaskDraft[];
    issues = validateTaskPlan(drafts, acIds, settings.maxStoryTasks, 1, completed);
  }
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (!parsed || drafts.length === 0 || errors.length > 0) {
    throw new Error(`重规划校验未通过：${errors.map((issue) => issue.message).join('；') || '无任务'}`);
  }

  for (const task of removable) deleteStoryTask(task.id);
  const kept = listStoryTasks(storyId);
  const keptByKey = new Map(kept.map((task) => [task.key, task]));
  let seq = kept.reduce((max, task) => Math.max(max, task.seq), 0);
  const created = drafts.map((draft) => {
    seq++;
    return createStoryTask({
      projectId: project.id,
      storyId,
      seq,
      key: draft.key,
      title: draft.title,
      description: draft.description,
      files: draft.files,
      acIds: draft.acIds,
      verifyCommand: draft.verifyCommand ?? null,
      source: 'ai',
    });
  });
  const idByKey = new Map([...keptByKey, ...created.map((task) => [task.key, task] as const)]);
  for (let index = 0; index < drafts.length; index++) {
    for (const key of drafts[index].dependsOn) {
      const predecessor = idByKey.get(key);
      if (predecessor) insertTaskDependency(created[index].id, predecessor.id);
    }
  }
  saveStoryTaskPlan({
    storyId,
    projectId: project.id,
    strategy: parsed.strategy || 'AI 重规划',
    model: null,
    source: 'ai',
  });
  const plan = buildStoryTaskPlan(storyId);
  bus.publish(storyId, {
    type: 'task.plan',
    storyId,
    tasks: plan.tasks.length,
    criticalPath: plan.criticalPath,
    model: plan.model,
  });
  return { plan, fallback: false };
}

export function planRequiresReview(plan: StoryTaskPlan): boolean {
  const mode = getGlobalSettings().taskPlanReview;
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  return plan.tasks.some((task) => {
    const text = `${task.title} ${task.description} ${task.files.join(' ')}`;
    return /(auth|security|permission|migration|migrate|contract|delete|drop|token|secret|鉴权|权限|迁移|契约|删除|密钥|安全)/i.test(text);
  });
}
