import type { Release } from '@riccon-scrum/shared';
import { bus } from './bus';
import { createRelease, getProject, getStory, latestReleaseForStory, updateRelease } from './db';
import { runDodCommand } from './dod';

const RELEASE_TIMEOUT_MS = 10 * 60 * 1000;

export async function releaseStory(storyId: string): Promise<Release> {
  const story = getStory(storyId);
  if (story.status !== 'done') throw new Error(`只有已完成故事可以发布，当前 ${story.status}`);
  const project = getProject(story.projectId);
  if (!project.releaseCommand.trim()) throw new Error('项目未配置发布命令');
  const previous = latestReleaseForStory(storyId);
  if (previous?.status === 'succeeded') throw new Error('该故事已成功发布，如需重新部署请先回滚');

  const release = createRelease(storyId, project.id, project.releaseCommand);
  bus.publish(storyId, {
    type: 'release.result',
    storyId,
    releaseId: release.id,
    status: 'running',
    evidence: `开始发布：${project.releaseCommand}`,
  });
  const result = await runDodCommand(project.releaseCommand, project.repoPath, RELEASE_TIMEOUT_MS);
  const status = result.ok ? 'succeeded' : 'failed';
  const updated = updateRelease(release.id, status, result.output);
  bus.publish(storyId, {
    type: 'release.result',
    storyId,
    releaseId: release.id,
    status,
    evidence: result.output.slice(-2000),
  });
  return updated;
}

export async function rollbackStory(storyId: string): Promise<Release> {
  const story = getStory(storyId);
  const project = getProject(story.projectId);
  if (!project.rollbackCommand.trim()) throw new Error('项目未配置回滚命令');
  const previous = latestReleaseForStory(storyId);
  if (!previous || previous.status !== 'succeeded') throw new Error('没有可回滚的成功发布');

  const release = createRelease(storyId, project.id, project.rollbackCommand);
  bus.publish(storyId, {
    type: 'release.result',
    storyId,
    releaseId: release.id,
    status: 'running',
    evidence: `开始回滚：${project.rollbackCommand}`,
  });
  const result = await runDodCommand(project.rollbackCommand, project.repoPath, RELEASE_TIMEOUT_MS);
  const status = result.ok ? 'rolled_back' : 'rollback_failed';
  const updated = updateRelease(release.id, status, result.output);
  bus.publish(storyId, {
    type: 'release.result',
    storyId,
    releaseId: release.id,
    status,
    evidence: result.output.slice(-2000),
  });
  return updated;
}

export function releaseStatus(storyId: string): Release | null {
  return latestReleaseForStory(storyId);
}
