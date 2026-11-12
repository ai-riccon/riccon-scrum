import path from 'node:path';
import type { Project } from '@riccon-scrum/shared';
import { config } from '../config';
import { createSession, updateSession } from '../db';
import { AcpRunner } from './runner';
import { getAgentSpec } from './agents';
import { readOnlyHost } from './readonly';

export async function runReadOnlyPrompt(input: {
  streamId: string;
  sessionStoryId?: string;
  project: Project;
  prompt: string;
  timeoutMs?: number;
}): Promise<string> {
  const model = input.project.model || config.agentModel;
  const session = createSession(input.sessionStoryId ?? input.streamId, input.project.agentKind, 'lead', model || null);
  const spec = getAgentSpec(input.project.agentKind, { model: model || config.agentModel, dbPath: config.opencodeDb });
  const cwd = path.resolve(input.project.repoPath);
  const runner = new AcpRunner({
    storyId: input.streamId,
    sessionId: session.id,
    cwd,
    spec,
    host: readOnlyHost(input.streamId),
    allowedRoots: [cwd],
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
        reject(new Error('只读分析超时'));
      }, input.timeoutMs ?? 90_000);
    });
    await Promise.race([runner.prompt(input.prompt), timeout]);
    return runner.responseText;
  } finally {
    if (timer) clearTimeout(timer);
    await runner.stop().catch(() => undefined);
    updateSession(session.id, { status: 'stopped' });
  }
}
