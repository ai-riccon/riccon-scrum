import path from 'node:path';
import os from 'node:os';
import type * as acp from '@agentclientprotocol/sdk';
import type { BaselineResult, ProjectProfile } from '@acp-scrum/shared';
import { getProject, saveArchitecture, saveBaseline, saveProfile, setProfileStatus } from './db';
import { scanProject } from './scanner';
import { architectPrompt } from './templates';
import { AcpRunner } from './acp/runner';
import { getAgentSpec } from './acp/agents';
import { config } from './config';
import { createDetachedWorktree, currentBranch, removeWorktree } from './git';
import { runDodCommand } from './dod';

function profileSummary(p: ProjectProfile): string {
  return [
    `- 语言：${p.languages.join(', ') || '未知'}`,
    `- 框架/工具：${p.frameworks.join(', ') || '未知'}`,
    `- 包管理：${p.packageManager ?? '未知'}`,
    `- 清单：${p.manifests.join(', ')}`,
    `- 入口：${p.entryPoints.join(', ') || '未知'}`,
    `- 测试命令：${p.testCommands.join(', ') || '未发现'}`,
    `- 构建命令：${p.buildCommands.join(', ') || '未发现'}`,
    `- 顶层结构：${p.structure.join(', ')}`,
  ].join('\n');
}

async function generateArchitecture(worktree: string, profile: ProjectProfile, agentKind: string): Promise<string> {
  const spec = getAgentSpec(agentKind, { model: config.agentModel, dbPath: config.opencodeDb });
  const runner = new AcpRunner({
    storyId: 'onboarding',
    sessionId: `onboard-${Date.now()}`,
    cwd: worktree,
    spec,
    allowedRoots: [worktree],
    host: {
      publish: () => undefined,
      requestPermission: async (_s, _sess, params) => {
        const allow = params.options.find((o) => o.kind.startsWith('allow')) ?? params.options[0];
        return { outcome: { outcome: 'selected', optionId: allow.optionId } } as acp.RequestPermissionResponse;
      },
    },
  });
  await runner.start();
  try {
    await runner.prompt(architectPrompt(profileSummary(profile)));
    return runner.responseText;
  } finally {
    await runner.stop();
  }
}

export async function onboardProject(projectId: string): Promise<void> {
  const project = getProject(projectId);
  try {
    setProfileStatus(projectId, 'scanning');
    const profile = await scanProject(project.repoPath);
    saveProfile(projectId, profile);

    const base = project.defaultBranch || (await currentBranch(project.repoPath));
    const worktree = path.join(os.tmpdir(), `acp-onboard-${projectId.slice(0, 8)}-${Date.now()}`);
    await createDetachedWorktree(project.repoPath, worktree, base);
    try {
      setProfileStatus(projectId, 'analyzing');
      const architecture = await generateArchitecture(worktree, profile, project.agentKind);
      saveArchitecture(projectId, architecture);

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