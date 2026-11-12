import path from 'node:path';
import os from 'node:os';
import type { BaselineResult } from '@riccon-scrum/shared';
import { getProject, saveArchitecture, saveBaseline, saveProfile, setProfileStatus, updateProjectSettings } from './db';
import { scanProject } from './scanner';
import { createDetachedWorktree, currentBranch, removeWorktree } from './git';
import { runDodCommand } from './dod';
import { indexProject } from './indexer';
import { generateCodeGraphDocument, generateOverviewDocument } from './documents';
import { generateAgentDocument, generateLegacyRequirementsBaseline } from './document-generator';

export async function onboardProject(projectId: string): Promise<void> {
  const project = getProject(projectId);
  try {
    setProfileStatus(projectId, 'scanning');
    const profile = await scanProject(project.repoPath);
    saveProfile(projectId, profile);
    if (project.dodCommands.length === 0 && profile.testCommands.length > 0) {
      updateProjectSettings(projectId, {
        dodCommands: profile.testCommands.map((cmd) => ({ kind: 'test', label: `基线测试：${cmd}`, command: cmd })),
      });
    }
    await indexProject(projectId, project.repoPath);
    generateOverviewDocument(projectId);
    generateCodeGraphDocument(projectId);

    setProfileStatus(projectId, 'analyzing');
    const architecture = await generateAgentDocument(projectId, 'architecture');
    saveArchitecture(projectId, architecture.content);
    try {
      await generateLegacyRequirementsBaseline(projectId);
    } catch (err) {
      console.error('[onboard] legacy requirements baseline failed', err);
    }

    const base = project.defaultBranch || (await currentBranch(project.repoPath));
    const worktree = path.join(os.tmpdir(), `acp-onboard-${projectId.slice(0, 8)}-${Date.now()}`);
    await createDetachedWorktree(project.repoPath, worktree, base);
    try {
      setProfileStatus(projectId, 'baselining');
      const baseline: BaselineResult[] = [];
      for (const cmd of profile.testCommands) {
        const r = await runDodCommand(cmd, worktree);
        baseline.push({ command: cmd, ok: r.ok, output: r.output });
      }
      saveBaseline(projectId, baseline);
    } finally {
      await removeWorktree(project.repoPath, worktree).catch(() => undefined);
    }
    setProfileStatus(projectId, 'done');
  } catch (err) {
    setProfileStatus(projectId, 'error', err instanceof Error ? err.message : String(err));
  }
}