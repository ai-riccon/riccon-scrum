import type { Story, StoryStatus } from '@riccon-scrum/shared';
import { bus } from './bus';
import { acceptanceForStory, dodItemsForStory, getProject, getStory, setAcceptanceResult, setDodResult, setStoryStatus } from './db';
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
  let ranCommand = false;
  const failedLabels: string[] = [];
  const outputs: string[] = [];
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
    ranCommand = true;
    outputs.push(result.output);
    const status = result.ok ? 'pass' : 'fail';
    setDodResult(item.id, status, result.output);
    bus.publish(storyId, { type: 'dod.result', itemId: item.id, status, evidence: result.output });
    if (!result.ok && item.blocking !== false) {
      allPass = false;
      failedLabels.push(item.label);
    }
  }

  const acceptance = acceptanceForStory(storyId);
  if (acceptance.length > 0) {
    const output = outputs.join('\n');
    const suitePass = ranCommand && failedLabels.length === 0;
    for (const ac of acceptance) {
      const testSeen = !!ac.test && output.includes(ac.test);
      const ok = suitePass && testSeen;
      const evidence = ok
        ? `DoD 通过；测试映射命中：${ac.test}`
        : !ranCommand
          ? '没有可执行的机器 DoD，无法证明验收标准'
          : !testSeen
            ? `测试映射未在 DoD 输出中出现：${ac.test ?? '未配置'}`
            : `DoD 未通过：${failedLabels.join(', ')}`;
      setAcceptanceResult(ac.id, ok ? 'pass' : 'fail', evidence);
      bus.publish(storyId, {
        type: 'acceptance.result',
        acceptanceId: ac.id,
        acId: ac.acId,
        storyId,
        status: ok ? 'pass' : 'fail',
        evidence,
      });
      if (!ok) allPass = false;
    }
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

export type DiffRisk = 'high' | 'medium' | 'low';

export interface DiffFileSummary {
  path: string;
  added: number;
  removed: number;
  risk: DiffRisk;
}

const HIGH_RISK = /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|Dockerfile|docker-compose|migrations?|auth|security|permissions?|routes?|api)(\/|\.|$)/i;

export function summarizeDiff(diff: string): { files: DiffFileSummary[]; risk: DiffRisk } {
  const files = new Map<string, DiffFileSummary>();
  let current: DiffFileSummary | null = null;
  for (const line of diff.split('\n')) {
    const header = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (header) {
      current = { path: header[2], added: 0, removed: 0, risk: HIGH_RISK.test(header[2]) ? 'high' : 'low' };
      files.set(current.path, current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) current.added++;
    else if (line.startsWith('-')) current.removed++;
  }
  for (const file of files.values()) {
    const changes = file.added + file.removed;
    if (file.risk !== 'high' && changes > 250) file.risk = 'medium';
  }
  const list = [...files.values()];
  const risk: DiffRisk = list.some((f) => f.risk === 'high')
    ? 'high'
    : list.some((f) => f.risk === 'medium')
      ? 'medium'
      : 'low';
  return { files: list, risk };
}