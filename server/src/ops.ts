import type { Story, StoryStatus } from '@acp-scrum/shared';
import { bus } from './bus';
import { dodItemsForStory, getProject, getStory, setDodResult, setStoryStatus } from './db';
import { currentBranch, diffAgainst, docChanges, workingDiff } from './git';
import { runDodCommand } from './dod';

export function transition(storyId: string, to: StoryStatus): Story {
  const before = getStory(storyId);
  const after = setStoryStatus(storyId, to);
  bus.publish(storyId, { type: 'story.status', from: before.status, to: after.status });
  return after;
}

export async function evaluateDod(storyId: string): Promise<boolean> {
  const story = getStory(storyId);
  if (!story.worktreePath) throw new Error('story has no worktree');
  const items = dodItemsForStory(storyId);
  let allPass = true;
  for (const item of items) {
    if (item.kind === 'doc') {
      const docs = await docChanges(story.worktreePath);
      const ok = docs.length > 0;
      const evidence = ok ? `更新文档：${docs.join(', ')}` : '未检测到文档（.md / docs/）更新';
      setDodResult(item.id, ok ? 'pass' : 'fail', evidence);
      bus.publish(storyId, { type: 'dod.result', itemId: item.id, status: ok ? 'pass' : 'fail', evidence });
      if (!ok) allPass = false;
      continue;
    }
    if (!item.command) continue;
    const result = await runDodCommand(item.command, story.worktreePath);
    const status = result.ok ? 'pass' : 'fail';
    setDodResult(item.id, status, result.output);
    bus.publish(storyId, { type: 'dod.result', itemId: item.id, status, evidence: result.output });
    if (!result.ok) allPass = false;
  }
  return allPass;
}

export async function storyDiff(storyId: string): Promise<string> {
  const story = getStory(storyId);
  const project = getProject(story.projectId);
  if (!story.worktreePath) return '';
  const base = project.defaultBranch || (await currentBranch(project.repoPath));
  const committed = await diffAgainst(story.worktreePath, base).catch(() => '');
  const working = await workingDiff(story.worktreePath).catch(() => '');
  return [committed, working].filter(Boolean).join('\n');
}