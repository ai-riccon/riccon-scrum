import fs from 'node:fs';
import path from 'node:path';
import type { AgentSession, StoryTask, StoryTaskPlan } from '@riccon-scrum/shared';
import { bus } from './bus';
import {
  eventsForStory,
  getProject,
  getStory,
  getStoryTask,
  listStoryTasks,
  listTaskEdges,
  updateStoryTask,
  WORKTREES_DIR,
} from './db';
import { manager } from './acp/manager';
import { getGlobalSettings } from './settings';
import { buildStoryContext } from './context';
import { taskExecutionPrompt } from './templates';
import {
  buildStoryTaskPlan,
  isTaskRunnable,
  nextRunnableTask,
  planRequiresReview,
  planStoryTasks,
  topoOrder,
} from './task-plan';
import { evaluateDod, transition } from './ops';
import { runDodCommand } from './dod';
import { commitAll, createWorktree, git, hasChanges, removeWorktree } from './git';

function evidenceTail(text: string, max = 1200): string {
  return text.length > max ? text.slice(-max) : text;
}

function safeTaskKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || 'task';
}

let taskMergeQueue: Promise<void> = Promise.resolve();

async function withTaskMergeLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const slot = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = taskMergeQueue;
  taskMergeQueue = previous.then(() => slot);
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

function sessionUsage(storyId: string, sessionId: string): number {
  let max = 0;
  for (const event of eventsForStory(storyId)) {
    if (event.payload.type !== 'usage' || event.payload.sessionId !== sessionId) continue;
    max = Math.max(max, event.payload.tokens);
  }
  return max;
}

function blocked(storyId: string, detail: string): void {
  const story = getStory(storyId);
  bus.publish(storyId, { type: 'agent.message', sessionId: '', role: 'agent', text: `[平台] ${detail}` });
  if (story.status === 'in_dev') transition(storyId, 'blocked');
}

function setTaskStatus(storyId: string, task: StoryTask, to: StoryTask['status'], patch: { evidence?: string | null; attempts?: number; sessionId?: string; tokens?: number } = {}): StoryTask {
  const updated = updateStoryTask(task.id, {
    status: to,
    attempts: patch.attempts,
    evidence: patch.evidence !== undefined ? patch.evidence : task.evidence,
    sessionId: patch.sessionId ?? task.sessionId,
    tokens: patch.tokens,
  });
  bus.publish(storyId, {
    type: 'task.status',
    storyId,
    taskId: task.id,
    taskKey: task.key,
    from: task.status,
    to,
    evidence: patch.evidence ?? undefined,
  });
  return updated;
}

async function startTaskSession(storyId: string, role: 'solo' | 'dev'): Promise<AgentSession> {
  const story = getStory(storyId);
  const project = getProject(story.projectId);
  if (!story.worktreePath) throw new Error('故事没有工作树');
  return manager.startRunner(
    storyId,
    story.worktreePath,
    [story.worktreePath],
    project.agentKind,
    role,
    undefined,
    project.model || undefined,
  );
}

async function executeTask(
  storyId: string,
  task: StoryTask,
  sessionId: string,
  resumeMessage?: string,
): Promise<{ ok: boolean; retryable: boolean }> {
  const story = getStory(storyId);
  const project = getProject(story.projectId);
  if (!story.worktreePath) throw new Error('故事没有工作树');
  const settings = getGlobalSettings();
  const attempt = task.attempts + 1;
  setTaskStatus(storyId, task, 'in_progress', { attempts: attempt, sessionId, evidence: null });
  const baselineUsage = sessionUsage(storyId, sessionId);
  const retry = task.status === 'failed' ? task.evidence ?? undefined : undefined;
  const context = buildStoryContext(storyId, task.id, settings.taskContextChars);
  const prompt = [
    taskExecutionPrompt({
      story,
      task,
      context,
      dod: project.dodCommands,
      retry,
    }),
    resumeMessage ? `## 人工继续/返工指令（必须优先落实）\n${resumeMessage}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    await manager.prompt(sessionId, prompt);
    const used = Math.max(0, sessionUsage(storyId, sessionId) - baselineUsage);
    if (task.verifyCommand) {
      const result = await runDodCommand(task.verifyCommand, story.worktreePath);
      bus.publish(storyId, {
        type: 'task.verify',
        storyId,
        taskId: task.id,
        taskKey: task.key,
        ok: result.ok,
        evidence: evidenceTail(result.output),
      });
      if (!result.ok) {
        const failed = setTaskStatus(storyId, task, 'failed', {
          attempts: attempt,
          evidence: evidenceTail(result.output),
          sessionId,
          tokens: task.tokens + used,
        });
        return { ok: false, retryable: failed.attempts < settings.maxTaskAttempts };
      }
      setTaskStatus(storyId, task, 'done', {
        attempts: attempt,
        evidence: `验证通过：${task.verifyCommand}\n${evidenceTail(result.output, 600)}`,
        sessionId,
        tokens: task.tokens + used,
      });
      return { ok: true, retryable: false };
    }
    setTaskStatus(storyId, task, 'done', {
      attempts: attempt,
      evidence: `agent 完成当前任务；最终由 Story DoD/AC 证据验证。`,
      sessionId,
      tokens: task.tokens + used,
    });
    return { ok: true, retryable: false };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const failed = setTaskStatus(storyId, task, 'failed', {
      attempts: attempt,
      evidence: detail,
      sessionId,
      tokens: task.tokens,
    });
    return { ok: false, retryable: failed.attempts < settings.maxTaskAttempts };
  }
}

async function recoverInterruptedTasks(storyId: string): Promise<void> {
  const story = getStory(storyId);
  const project = getProject(story.projectId);
  for (const task of listStoryTasks(storyId)) {
    if (task.status !== 'in_progress') continue;
    if (task.worktreePath) {
      await removeWorktree(project.repoPath, task.worktreePath).catch(() => undefined);
      try {
        fs.rmSync(task.worktreePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
      } catch {
        // best effort
      }
      updateStoryTask(task.id, { worktreePath: null });
    }
    setTaskStatus(storyId, task, 'pending', { evidence: '上次执行中断，已重置为待执行' });
  }
}

function pickParallelBatch(tasks: StoryTask[], edges: ReturnType<typeof listTaskEdges>, slots: number): StoryTask[] {
  const runnable = topoOrder(tasks, edges).filter((task) => isTaskRunnable(task, tasks, edges));
  const selected: StoryTask[] = [];
  const usedFiles = new Set<string>();
  for (const task of runnable) {
    if (task.files.length === 0) continue;
    if (task.files.some((file) => usedFiles.has(file))) continue;
    selected.push(task);
    for (const file of task.files) usedFiles.add(file);
    if (selected.length >= slots) break;
  }
  if (selected.length === 0 && runnable.length > 0) selected.push(runnable[0]);
  return selected;
}

async function runParallelTask(
  storyId: string,
  task: StoryTask,
  role: 'solo' | 'dev',
  resumeMessage?: string,
): Promise<{ ok: boolean; retryable: boolean; session: AgentSession | null }> {
  const story = getStory(storyId);
  const project = getProject(story.projectId);
  const settings = getGlobalSettings();
  if (!story.worktreePath || !story.branch) throw new Error('故事没有可用的工作树/分支');
  const attempt = task.attempts + 1;
  const stamp = Date.now();
  const safeKey = safeTaskKey(task.key);
  const branch = `task/${story.id.slice(0, 8)}-${safeKey.toLowerCase()}-${stamp}`;
  const worktree = path.join(WORKTREES_DIR, 'tasks', story.id, `task-${safeKey}-${stamp}`);
  let session: AgentSession | null = null;
  let verifyEvidence = '';
  try {
    fs.mkdirSync(path.dirname(worktree), { recursive: true });
    await createWorktree(project.repoPath, branch, worktree, story.branch);
    const started = updateStoryTask(task.id, {
      status: 'in_progress',
      attempts: attempt,
      evidence: null,
      worktreePath: worktree,
      branch,
      sessionId: null,
    });
    bus.publish(storyId, {
      type: 'task.status',
      storyId,
      taskId: task.id,
      taskKey: task.key,
      from: task.status,
      to: 'in_progress',
      evidence: `并行 worktree：${worktree}`,
    });
    session = await manager.startRunner(
      storyId,
      worktree,
      [worktree],
      project.agentKind,
      role,
      undefined,
      project.model || undefined,
    );
    updateStoryTask(task.id, { sessionId: session.id });
    const baseline = sessionUsage(storyId, session.id);
    const context = buildStoryContext(storyId, task.id, settings.taskContextChars);
    const prompt = [
      taskExecutionPrompt({
        story,
        task: started,
        context,
        dod: project.dodCommands,
        retry: task.status === 'failed' ? task.evidence ?? undefined : undefined,
      }),
      resumeMessage ? `## 人工继续/返工指令（必须优先落实）\n${resumeMessage}` : '',
      `## 并行执行约束\n你当前在独立 worktree 中执行任务 ${task.key}；其他任务可能并行进行。`,
    ]
      .filter(Boolean)
      .join('\n\n');
    await manager.prompt(session.id, prompt);
    const used = Math.max(0, sessionUsage(storyId, session.id) - baseline);
    if (task.verifyCommand) {
      const result = await runDodCommand(task.verifyCommand, worktree);
      verifyEvidence = evidenceTail(result.output);
      bus.publish(storyId, {
        type: 'task.verify',
        storyId,
        taskId: task.id,
        taskKey: task.key,
        ok: result.ok,
        evidence: verifyEvidence,
      });
      if (!result.ok) {
        setTaskStatus(storyId, getStoryTask(task.id), 'failed', {
          attempts: attempt,
          evidence: verifyEvidence,
          tokens: task.tokens + used,
        });
        return { ok: false, retryable: attempt < settings.maxTaskAttempts, session };
      }
    }
    if (await hasChanges(worktree)) {
      await commitAll(worktree, `task(${task.key}): ${task.title}`);
    }
    await withTaskMergeLock(async () => {
      try {
        await git(story.worktreePath as string, 'merge', '--no-ff', branch, '-m', `merge task ${task.key}: ${task.title}`);
      } catch (err) {
        await git(story.worktreePath as string, 'merge', '--abort').catch(() => undefined);
        throw new Error(`任务 ${task.key} 合并冲突：${err instanceof Error ? err.message : String(err)}`);
      }
    });
    setTaskStatus(storyId, getStoryTask(task.id), 'done', {
      attempts: attempt,
      evidence: `并行执行并已合并${verifyEvidence ? `；验证：${verifyEvidence}` : ''}`,
      tokens: task.tokens + used,
    });
    return { ok: true, retryable: false, session };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const failed = setTaskStatus(storyId, getStoryTask(task.id), 'failed', {
      attempts: attempt,
      evidence: detail,
      tokens: task.tokens,
    });
    return { ok: false, retryable: failed.attempts < settings.maxTaskAttempts, session };
  } finally {
    if (session) await manager.stopRunner(session.id).catch(() => undefined);
    await removeWorktree(project.repoPath, worktree).catch(() => undefined);
    try {
      fs.rmSync(worktree, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
    } catch {
      // next sweep will retry
    }
  }
}

async function executeTaskPlanParallel(
  storyId: string,
  opts: { role?: 'solo' | 'dev'; session?: AgentSession; resumeMessage?: string },
): Promise<{ ok: boolean; session: AgentSession | null; reason?: string }> {
  const settings = getGlobalSettings();
  if (opts.session) await manager.stopRunner(opts.session.id).catch(() => undefined);
  let primary: AgentSession | null = null;
  let resumePrompt: string | null = opts.resumeMessage?.trim() || null;
  for (;;) {
    const tasks = listStoryTasks(storyId);
    const edges = listTaskEdges(storyId);
    const exhausted = tasks.find((task) => task.status === 'failed' && task.attempts >= settings.maxTaskAttempts);
    if (exhausted) {
      blocked(storyId, `任务 ${exhausted.key} ${exhausted.title} 已达到最大尝试次数，故事阻塞。`);
      return { ok: false, session: primary, reason: 'max-attempts' };
    }
    const runnable = topoOrder(tasks, edges).filter((task) => isTaskRunnable(task, tasks, edges));
    if (runnable.length === 0) {
      const pending = tasks.filter((task) => ['pending', 'in_progress', 'failed'].includes(task.status));
      if (pending.length > 0) {
        blocked(storyId, `仍有未完成任务：${pending.map((task) => `${task.key} ${task.title}`).join('；')}`);
        return { ok: false, session: primary, reason: 'pending-tasks' };
      }
      return { ok: true, session: primary };
    }
    const batch = pickParallelBatch(tasks, edges, Math.max(1, settings.maxParallelTasks));
    const results = await Promise.all(
      batch.map((task) => runParallelTask(storyId, task, opts.role ?? 'solo', resumePrompt ?? undefined)),
    );
    resumePrompt = null;
    primary = results.find((result) => result.session)?.session ?? primary;
    const failed = results.find((result) => !result.ok);
    if (failed && !failed.retryable) {
      blocked(storyId, '并行任务失败且达到最大尝试次数，故事阻塞。');
      return { ok: false, session: primary, reason: 'task-failed' };
    }
  }
}

export async function executeTaskPlan(
  storyId: string,
  opts: {
    role?: 'solo' | 'dev';
    session?: AgentSession;
    resumeMessage?: string;
  } = {},
): Promise<{ ok: boolean; session: AgentSession | null; reason?: string }> {
  await recoverInterruptedTasks(storyId);
  const settings = getGlobalSettings();
  if (settings.parallelTasks && listStoryTasks(storyId).length > 1) {
    return executeTaskPlanParallel(storyId, opts);
  }
  let session: AgentSession = opts.session ?? (await startTaskSession(storyId, opts.role ?? 'solo'));
  let resumePrompt: string | null = opts.resumeMessage?.trim() || null;

  for (;;) {
    const tasks = listStoryTasks(storyId);
    const edges = listTaskEdges(storyId);
    const task = nextRunnableTask(tasks, edges);
    if (!task) break;
    if (task.attempts >= settings.maxTaskAttempts) {
      setTaskStatus(storyId, task, 'failed', { evidence: task.evidence });
      blocked(storyId, `任务 ${task.key} ${task.title} 已达到最大尝试次数，故事阻塞。`);
      return { ok: false, session, reason: 'max-attempts' };
    }

    let outcome: { ok: boolean; retryable: boolean };
    try {
      outcome = await executeTask(storyId, task, session.id, resumePrompt ?? undefined);
      resumePrompt = null;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (/no active runner/i.test(detail)) {
        session = await startTaskSession(storyId, opts.role ?? 'solo');
        outcome = await executeTask(storyId, getStoryTask(task.id), session.id, resumePrompt ?? undefined);
        resumePrompt = null;
      } else {
        throw err;
      }
    }

    if (!outcome.ok && !outcome.retryable) {
      blocked(storyId, `任务 ${task.key} ${task.title} 失败且达到最大尝试次数，故事阻塞。`);
      return { ok: false, session, reason: 'task-failed' };
    }
    if (!outcome.ok) {
      bus.publish(storyId, {
        type: 'agent.message',
        sessionId: session.id,
        role: 'agent',
        text: `[平台] 任务 ${task.key} 未通过验证，准备重试（${task.attempts + 1}/${settings.maxTaskAttempts}）。`,
      });
    }
  }

  const pending = listStoryTasks(storyId).filter((task) =>
    ['pending', 'in_progress', 'failed'].includes(task.status),
  );
  if (pending.length > 0) {
    blocked(storyId, `仍有未完成任务：${pending.map((task) => `${task.key} ${task.title}`).join('；')}`);
    return { ok: false, session, reason: 'pending-tasks' };
  }
  return { ok: true, session };
}

export async function prepareStoryPlan(storyId: string): Promise<StoryTaskPlan | null> {
  const existing = listStoryTasks(storyId);
  const { plan } = await planStoryTasks(storyId);
  if (existing.length === 0 && planRequiresReview(plan)) {
    const decision = await manager.requestDecision(
      storyId,
      'plan',
      `任务计划需人工确认（${plan.tasks.length} 项）`,
      JSON.stringify({ plan: buildStoryTaskPlan(storyId) }),
    );
    if (decision.status !== 'approved') {
      blocked(storyId, '任务计划被人工拒绝，故事阻塞。');
      return null;
    }
  }
  return plan;
}

export async function runSoloTaskExecution(storyId: string): Promise<void> {
  const plan = await prepareStoryPlan(storyId);
  if (!plan) return;
  const result = await executeTaskPlan(storyId, { role: 'solo' });
  if (!result.ok) return;
  const allPass = await evaluateDod(storyId);
  if (allPass) transition(storyId, 'review');
  else {
    bus.publish(storyId, {
      type: 'agent.message',
      sessionId: result.session?.id ?? '',
      role: 'agent',
      text: '[平台] 所有 Task 已完成，但 Story DoD 未全部通过，故事保持 in_dev，请根据失败证据修复后重新提交。',
    });
  }
}

export async function retryStoryTask(storyId: string, taskId: string): Promise<StoryTask> {
  const task = getStoryTask(taskId);
  if (task.storyId !== storyId) throw new Error('任务不属于该故事');
  if (!['failed', 'skipped'].includes(task.status)) throw new Error('只有失败或跳过的任务可以重试');
  const updated = updateStoryTask(task.id, { status: 'pending', attempts: 0, evidence: null });
  bus.publish(storyId, {
    type: 'task.status',
    storyId,
    taskId: task.id,
    taskKey: task.key,
    from: task.status,
    to: 'pending',
    evidence: '人工重试',
  });
  return updated;
}

export async function skipStoryTask(storyId: string, taskId: string, reason: string): Promise<StoryTask> {
  const task = getStoryTask(taskId);
  if (task.storyId !== storyId) throw new Error('任务不属于该故事');
  if (!reason.trim()) throw new Error('跳过任务需要填写原因');
  if (task.status === 'done') throw new Error('已完成的任务不能跳过');
  const updated = updateStoryTask(task.id, { status: 'skipped', evidence: `人工跳过：${reason.trim()}` });
  bus.publish(storyId, {
    type: 'task.status',
    storyId,
    taskId: task.id,
    taskKey: task.key,
    from: task.status,
    to: 'skipped',
    evidence: reason.trim(),
  });
  return updated;
}

export { buildStoryTaskPlan };
