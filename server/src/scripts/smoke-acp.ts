import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type * as acp from '@agentclientprotocol/sdk';
import type { EventPayload } from '@riccon-scrum/shared';
import { AcpRunner } from '../acp/runner';
import { getAgentSpec } from '../acp/agents';
import { config } from '../config';

async function git(cwd: string, ...args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', args, { cwd, shell: false });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`git ${args.join(' ')} -> ${code}`))));
  });
}

async function main() {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'riccon-smoke-'));
  await git(repo, 'init', '-b', 'main');
  await git(repo, 'config', 'user.email', 'smoke@test.local');
  await git(repo, 'config', 'user.name', 'smoke');
  await fs.writeFile(path.join(repo, 'README.md'), '# smoke fixture\n');
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-m', 'init');
  console.log('[smoke] fixture repo:', repo);
  const kind = process.env.SMOKE_AGENT ?? 'opencode';
  console.log('[smoke] agent kind:', kind);
  console.log('[smoke] agent binary:', config.agentCommand);

  const events: EventPayload[] = [];
  const runner = new AcpRunner({
    storyId: 'smoke-story',
    sessionId: 'smoke-session',
    cwd: repo,
    spec: getAgentSpec(kind, kind === 'opencode' ? { model: config.agentModel, dbPath: path.join(repo, '.opencode-platform.db') } : {}),
    allowedRoots: [repo],
    host: {
      publish: (_storyId, payload) => {
        events.push(payload);
        if (payload.type === 'agent.message') console.log(`[event] ${payload.role}: ${payload.text.slice(0, 160)}`);
        else if (payload.type === 'agent.tool') console.log(`[event] tool: ${payload.title} [${payload.status}]`);
        else if (payload.type === 'agent.plan') console.log(`[event] plan: ${payload.entries.map((e) => e.content).join(' | ')}`);
        else console.log(`[event] ${payload.type}`);
      },
      requestPermission: async (_s, _sess, params) => {
        const allow = params.options.find((o) => o.kind.startsWith('allow')) ?? params.options[0];
        console.log('[smoke] auto-approve permission:', params.toolCall.title);
        return { outcome: { outcome: 'selected', optionId: allow.optionId } } as acp.RequestPermissionResponse;
      },
    },
  });

  try {
    console.log('[smoke] starting ACP runner (initialize + session/new)...');
    await runner.start();
    console.log('[smoke] HANDSHAKE OK, acpSessionId =', runner.sessionId, 'pid =', runner.pid);
  } catch (err) {
    console.error('[smoke] HANDSHAKE FAILED:', err instanceof Error ? err.message : err);
    await runner.stop().catch(() => undefined);
    process.exit(1);
  }

  try {
    console.log('[smoke] sending prompt...');
    const reason = await runner.prompt("Create a file named hello.txt containing exactly 'hello world'. Then stop.");
    console.log('[smoke] PROMPT OK, stopReason =', reason);
    const hello = await fs.readFile(path.join(repo, 'hello.txt'), 'utf8').catch(() => '<missing>');
    console.log('[smoke] hello.txt content:', JSON.stringify(hello));
  } catch (err) {
    console.error('[smoke] PROMPT FAILED (likely no model credentials):', err instanceof Error ? err.message : err);
  }

  await runner.stop().catch(() => undefined);
  console.log('[smoke] total events:', events.length);
  console.log('[smoke] done');
  process.exit(0);
}

main().catch((err) => {
  console.error('[smoke] fatal:', err);
  process.exit(1);
});