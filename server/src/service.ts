import path from 'node:path';
import type { AgentSession, Story } from '@riccon-scrum/shared';
import { bus } from './bus';
import {
  acceptanceForStory,
  createApproval,
  decideApproval,
  dodItemsForStory,
  ensureDodItems,
  ensurePolicyGates,
  eventsForStory,
  getProject,
  getStory,
  listStories,
  saveHandoff,
  sessionsForStory,
  setDodResult,
  setStoryWorktree,
  resetDodItems,
  WORKTREES_DIR,
} from './db';
import { getGlobalSettings } from './settings';
import { assertRepo, commitAll, createWorktree, currentBranch, hasChanges, mergeBranch, removeWorktree, slugify } from './git';
import { manager } from './acp/manager';
import { evaluateDod, storyDiff, summarizeDiff, transition } from './ops';
import { runTeamCycle } from './team';
import { runDodCommand } from './dod';
import { storyDependencyInfo } from './dependencies';
import { executeTaskPlan, runSoloTaskExecution } from './task-runner';
import { listStoryTasks } from './db';
import { markBugFixedForStory } from './bugs';
import { refreshProjectDocuments } from './documents';

export { evaluateDod, storyDiff } from './ops';

let mergeQueue: Promise<void> = Promise.resolve();

async function withMergeLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const slot = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = mergeQueue;
  mergeQueue = previous.then(() => slot);
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

export function approveStory(storyId: string): Story {
  const story = getStory(storyId);
  const project = getProject(story.projectId);
  ensureDodItems(storyId, project.dodCommands);
  ensurePolicyGates(storyId, project.policyGates);
  if (!story.acceptanceCriteria.trim()) {
    throw new Error('就绪门禁：请先填写 BDD 验收标准（Given/When/Then），否则 agent 缺少可验证目标');
  }
  if (project.requireMachineDod && !dodItemsForStory(storyId).some((i) => i.command)) {
    throw new Error('就绪门禁：至少需要一条机器可验证的 DoD 命令（可在「设置」页配置）');
  }
  return transition(storyId, 'ready');
}

export async function startStory(
  storyId: string,
  opts: { override?: boolean; reason?: string } = {},
): Promise<{ story: Story; session: AgentSession | null }> {
  const story = getStory(storyId);
  if (story.status !== 'ready') throw new Error(`story must be ready, got ${story.status}`);
  const project = getProject(story.projectId);
  await assertRepo(project.repoPath);

  const inDev = listStories(project.id).filter((s) => s.status === 'in_dev').length;
  if (inDev >= getGlobalSettings().wipLimit) throw new Error(`WIP 上限 ${getGlobalSettings().wipLimit}：请先完成或验收进行中的故事`);

  const blockers = storyDependencyInfo(storyId).blockedBy;
  if (blockers.length > 0) {
    if (!opts.override) {
      throw new Error(`前置未完成：${blockers.map((item) => item.title).join('；')}`);
    }
    const reason = opts.reason?.trim();
    if (!reason) throw new Error('强制开始需要填写原因');
    bus.publish(storyId, {
      type: 'dependency.override',
      storyId,
      predecessors: blockers.map((item) => item.title),
      reason,
    });
  }

  const base = project.defaultBranch || (await currentBranch(project.repoPath));
  const shortId = story.id.slice(0, 8);
  const branch = `story/${shortId}-${slugify(story.title)}`;
  const worktreePath = path.join(WORKTREES_DIR, story.id);
  await createWorktree(project.repoPath, branch, worktreePath, base);
  setStoryWorktree(storyId, branch, worktreePath);
  resetDodItems(storyId);
  ensurePolicyGates(storyId, project.policyGates);
  transition(storyId, 'in_dev');

  if (project.teamMode) {
    void runTeamCycle(storyId).catch((err) => {
      bus.publish(storyId, { type: 'session.status', sessionId: '', status: 'error', detail: err instanceof Error ? err.message : String(err) });
    });
    return { story: getStory(storyId), session: null };
  }

  void runSoloTaskExecution(storyId).catch((err) => {
    bus.publish(storyId, { type: 'session.status', sessionId: '', status: 'error', detail: err instanceof Error ? err.message : String(err) });
  });
  return { story: getStory(storyId), session: null };
}

export async function reworkStory(storyId: string): Promise<Story> {
  const story = getStory(storyId);
  if (story.status !== 'review') throw new Error(`story must be in review, got ${story.status}`);
  return transition(storyId, 'in_dev');
}

export async function resumeStory(storyId: string, message: string): Promise<{ story: Story; session: AgentSession }> {
  const story = getStory(storyId);
  if (!story.worktreePath) throw new Error('story has no worktree');
  if (!['in_dev', 'review', 'blocked'].includes(story.status)) throw new Error(`story not resumable in ${story.status}`);
  if (!message.trim()) throw new Error('请提供继续/返工指令，说明本轮要完成或修改什么');
  const project = getProject(story.projectId);
  const candidates = [...sessionsForStory(storyId)].reverse().filter((s) => s.acpSessionId);
  // Team cycles end on a QA session; a human follow-up belongs to the implementer.
  const prior = candidates.find((s) => s.role === 'dev' || s.role === 'solo');
  const hasTasks = listStoryTasks(storyId).length > 0;
  if (!prior?.acpSessionId && !hasTasks) throw new Error('no prior agent session to resume');

  if (story.status !== 'in_dev') transition(storyId, 'in_dev');
  const role = prior?.role === 'dev' ? 'dev' : 'solo';
  const session = await manager.startRunner(
    storyId,
    story.worktreePath,
    [story.worktreePath],
    project.agentKind,
    prior?.role ?? 'solo',
    prior?.acpSessionId ?? undefined,
    project.model || undefined,
  );

  if (hasTasks) {
    void executeTaskPlan(storyId, { role, session, resumeMessage: message })
      .then(async (result) => {
        if (!result.ok) return;
        const allPass = await evaluateDod(storyId);
        if (allPass) transition(storyId, 'review');
      })
      .catch((err) => {
        bus.publish(storyId, { type: 'session.status', sessionId: session.id, status: 'error', detail: err instanceof Error ? err.message : String(err) });
      });
    return { story: getStory(storyId), session };
  }

  void (async () => {
    await manager.prompt(session.id, message);
    const allPass = await evaluateDod(storyId);
    if (allPass) transition(storyId, 'review');
  })().catch((err) => {
    bus.publish(storyId, { type: 'session.status', sessionId: session.id, status: 'error', detail: err instanceof Error ? err.message : String(err) });
  });

  return { story: getStory(storyId), session };
}

export async function acceptStory(storyId: string): Promise<Story> {
  const story = getStory(storyId);
  if (story.status !== 'review') throw new Error(`story must be in review, got ${story.status}`);
  const project = getProject(story.projectId);
  if (!story.worktreePath || !story.branch) throw new Error('story has no worktree/branch');

  const items = dodItemsForStory(storyId);
  const failed = items.filter((i) => i.command && i.status !== 'pass');
  if (failed.length > 0) throw new Error(`DoD not satisfied: ${failed.map((f) => f.label).join(', ')}`);

  if (project.contractCommand.trim()) {
    const contract = await runDodCommand(project.contractCommand, story.worktreePath);
    bus.publish(storyId, { type: 'contract.result', storyId, ok: contract.ok, evidence: contract.output.slice(-2000) });
    if (!contract.ok) throw new Error(`契约检查未通过：${contract.output.slice(-500)}`);
  }

  const acceptance = createApproval({
    storyId,
    kind: 'accept',
    title: `人工验收并合并：${story.title}`,
    requestJson: JSON.stringify({ branch: story.branch, base: project.defaultBranch }),
  });
  // The accept endpoint is itself the human decision; record it as approved for audit.
  const decided = decideApproval(acceptance.id, { status: 'approved', decidedBy: 'human' });
  bus.publish(storyId, { type: 'approval.decided', approval: decided });

  if (await hasChanges(story.worktreePath)) {
    await commitAll(story.worktreePath, `story(${story.id.slice(0, 8)}): ${story.title}`);
  }
  const base = project.defaultBranch || (await currentBranch(project.repoPath));
  await withMergeLock(() => mergeBranch(project.repoPath, story.branch!, `merge story ${story.id.slice(0, 8)}: ${story.title}`));

  const human = items.find((i) => i.kind === 'human');
  if (human) {
    setDodResult(human.id, 'pass', '人工验收通过，已合并到 ' + base);
    bus.publish(storyId, { type: 'dod.result', itemId: human.id, status: 'pass', evidence: '人工验收通过' });
  }

  let diffSummary: ReturnType<typeof summarizeDiff> = { files: [], risk: 'low' };
  try {
    diffSummary = summarizeDiff(await storyDiff(storyId));
  } catch {
    // worktree may already be clean; handoff still carries DoD/AC evidence
  }
  const storyEvents = eventsForStory(storyId);
  const contractEvent = [...storyEvents].reverse().find((event) => event.payload.type === 'contract.result');
  const contracts =
    contractEvent?.payload.type === 'contract.result'
      ? `${contractEvent.payload.ok ? '通过' : '失败'}：${contractEvent.payload.evidence.split('\n')[0]}`
      : null;
  const migrations = diffSummary.files.map((file) => file.path).filter((file) => /migrations?\/|\.sql$|schema\.(prisma|sql)$/i.test(file));
  const dod = dodItemsForStory(storyId)
    .filter((item) => item.status === 'pass' && (item.command || item.kind === 'human'))
    .map((item) => `${item.label}: ${(item.evidence ?? 'pass').split('\n')[0]}`);
  const acceptanceEvidence = acceptanceForStory(storyId)
    .filter((item) => item.status === 'pass')
    .map((item) => `${item.acId}: ${item.then}`);
  const decisions: string[] = [];
  for (const event of storyEvents) {
    const payload = event.payload;
    if (payload.type === 'approval.decided') decisions.push(`${payload.approval.title}：${payload.approval.status}`);
    if (payload.type === 'team.verdict') {
      decisions.push(`QA ${payload.verdict.pass ? '通过' : '不通过'}${payload.verdict.issues.length ? '：' + payload.verdict.issues.join('；') : ''}`);
    }
    if (payload.type === 'dependency.override') {
      decisions.push(`跳过前置 ${payload.predecessors.join('、')}：${payload.reason}`);
    }
  }
  const done = transition(storyId, 'done');
  try {
    markBugFixedForStory(storyId);
  } catch (err) {
    console.error('[bug] mark fixed failed', err);
  }
  try {
    saveHandoff({
      projectId: story.projectId,
      entityType: 'story',
      entityId: storyId,
      title: story.title,
      summary:
        diffSummary.files.length > 0
          ? `改动 ${diffSummary.files.length} 个文件，风险 ${diffSummary.risk}；关键文件：${diffSummary.files
              .slice(0, 6)
              .map((file) => file.path)
              .join('、')}`
          : story.description || '无代码变更',
      files: diffSummary.files,
      contracts,
      migrations,
      dod,
      acceptance: acceptanceEvidence,
      decisions: decisions.slice(-8),
    });
  } catch (err) {
    console.error('[handoff] save failed', err);
  }
  await manager.stopStoryRunners(storyId, sessionsForStory(storyId));
  await removeWorktree(project.repoPath, story.worktreePath).catch(() => undefined);
  try {
    await refreshProjectDocuments(story.projectId, true);
  } catch (err) {
    console.error('[documents] refresh after story done failed', err);
  }
  return done;
}