import path from 'node:path';
import type { AgentSession, Story } from '@acp-scrum/shared';
import { bus } from './bus';
import { config } from './config';
import {
  createApproval,
  decideApproval,
  dodItemsForStory,
  getProject,
  getStory,
  listStories,
  sessionsForStory,
  setDodResult,
  setStoryWorktree,
  resetDodItems,
  WORKTREES_DIR,
} from './db';
import { assertRepo, commitAll, createWorktree, currentBranch, hasChanges, mergeBranch, removeWorktree, slugify } from './git';
import { manager } from './acp/manager';
import { evaluateDod, storyDiff, transition } from './ops';
import { runTeamCycle } from './team';
import { getIndexContext } from './indexer';

export { evaluateDod, storyDiff } from './ops';

export function approveStory(storyId: string): Story {
  return transition(storyId, 'ready');
}

function buildPrompt(story: Story, dodCommands: { label: string; command: string }[], codeContext = ''): string {
  const lines = [
    `# 用户故事：${story.title}`,
    '',
    story.description,
    '',
    '## 验收标准',
    story.acceptanceCriteria || '（未提供，请按故事标题推断最小可验证行为）',
    '',
    '## 完成定义（DoD）',
    '你的改动将通过以下门禁命令验证，请确保它们全部通过：',
    ...dodCommands.map((c) => `- ${c.label}: \`${c.command}\``),
    codeContext ? '\n' + codeContext : '',
    '',
    '## 约束',
    '- 只在当前工作目录（独立 git worktree）内修改文件。',
    '- 完成后不要自行合并分支；合并由人工验收触发。',
    '- 如需执行敏感操作，会弹出权限请求，等待人工批准。',
  ];
  return lines.join('\n');
}

export async function startStory(storyId: string): Promise<{ story: Story; session: AgentSession | null }> {
  const story = getStory(storyId);
  if (story.status !== 'ready') throw new Error(`story must be ready, got ${story.status}`);
  const project = getProject(story.projectId);
  await assertRepo(project.repoPath);

  const inDev = listStories(project.id).filter((s) => s.status === 'in_dev').length;
  if (inDev >= config.wipLimit) throw new Error(`WIP 上限 ${config.wipLimit}：请先完成或验收进行中的故事`);

  const base = project.defaultBranch || (await currentBranch(project.repoPath));
  const shortId = story.id.slice(0, 8);
  const branch = `story/${shortId}-${slugify(story.title)}`;
  const worktreePath = path.join(WORKTREES_DIR, story.id);
  await createWorktree(project.repoPath, branch, worktreePath, base);
  setStoryWorktree(storyId, branch, worktreePath);
  resetDodItems(storyId);
  transition(storyId, 'in_dev');

  if (project.teamMode) {
    void runTeamCycle(storyId).catch((err) => {
      bus.publish(storyId, { type: 'session.status', sessionId: '', status: 'error', detail: err instanceof Error ? err.message : String(err) });
    });
    return { story: getStory(storyId), session: null };
  }

  const session = await manager.startRunner(storyId, worktreePath, [worktreePath], project.agentKind, 'solo');
  const codeContext = getIndexContext(project.id, `${story.title} ${story.description}`);
  const prompt = buildPrompt(story, project.dodCommands, codeContext);
  void runDevCycle(storyId, session.id, prompt).catch((err) => {
    bus.publish(storyId, { type: 'session.status', sessionId: session.id, status: 'error', detail: err instanceof Error ? err.message : String(err) });
  });
  return { story: getStory(storyId), session };
}

async function runDevCycle(storyId: string, sessionId: string, prompt: string): Promise<void> {
  await manager.prompt(sessionId, prompt);
  const allPass = await evaluateDod(storyId);
  if (allPass) {
    transition(storyId, 'review');
  } else {
    bus.publish(storyId, {
      type: 'agent.message',
      sessionId,
      role: 'agent',
      text: '[平台] DoD 门禁未全部通过，故事保持 in_dev，请根据失败证据修复后重新提交。',
    });
  }
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
  const project = getProject(story.projectId);
  const prior = [...sessionsForStory(storyId)].reverse().find((s) => s.acpSessionId);
  if (!prior?.acpSessionId) throw new Error('no prior agent session to resume');

  if (story.status !== 'in_dev') transition(storyId, 'in_dev');
  const session = await manager.startRunner(storyId, story.worktreePath, [story.worktreePath], project.agentKind, prior.role, prior.acpSessionId);

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
  await mergeBranch(project.repoPath, story.branch, `merge story ${story.id.slice(0, 8)}: ${story.title}`);

  const human = items.find((i) => i.kind === 'human');
  if (human) {
    setDodResult(human.id, 'pass', '人工验收通过，已合并到 ' + base);
    bus.publish(storyId, { type: 'dod.result', itemId: human.id, status: 'pass', evidence: '人工验收通过' });
  }

  await manager.stopStoryRunners(storyId, sessionsForStory(storyId));
  const done = transition(storyId, 'done');
  await removeWorktree(project.repoPath, story.worktreePath).catch(() => undefined);
  return done;
}