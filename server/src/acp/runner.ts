import { spawn, type ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as acp from '@agentclientprotocol/sdk';
import type { EventPayload } from '@riccon-scrum/shared';
import { TerminalManager } from './terminal';
import type { AgentSpec } from './agents';

export interface RunnerHost {
  publish(storyId: string, payload: EventPayload): void;
  requestPermission(
    storyId: string,
    sessionId: string,
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse>;
}

export interface RunnerOptions {
  storyId: string;
  sessionId: string;
  cwd: string;
  spec: AgentSpec;
  host: RunnerHost;
  allowedRoots: string[];
  model?: string;
}

function textOf(content: acp.ContentBlock): string {
  return content.type === 'text' ? content.text : `[${content.type}]`;
}

export function normalizeUpdate(sessionId: string, update: acp.SessionUpdate): EventPayload | null {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return { type: 'agent.message', sessionId, role: 'agent', text: textOf(update.content) };
    case 'user_message_chunk':
      return { type: 'agent.message', sessionId, role: 'user', text: textOf(update.content) };
    case 'agent_thought_chunk':
      return { type: 'agent.message', sessionId, role: 'thought', text: textOf(update.content) };
    case 'tool_call':
      return {
        type: 'agent.tool',
        sessionId,
        toolCallId: update.toolCallId,
        title: update.title,
        kind: update.kind ?? null,
        status: update.status ?? 'pending',
        locations: (update.locations ?? []).map((l) => l.path),
      };
    case 'tool_call_update':
      return {
        type: 'agent.tool',
        sessionId,
        toolCallId: update.toolCallId,
        title: update.title ?? '',
        kind: update.kind ?? null,
        status: update.status ?? 'in_progress',
        locations: (update.locations ?? []).map((l) => l.path),
      };
    case 'plan':
      return {
        type: 'agent.plan',
        sessionId,
        entries: update.entries.map((e) => ({ content: e.content, status: e.status, priority: e.priority })),
      };
    case 'usage_update':
      return { type: 'usage', sessionId, tokens: update.used };
    default:
      return null;
  }
}

export class AcpRunner {
  private child: ChildProcess | null = null;
  private connection: acp.ClientConnection | null = null;
  private ctx: acp.ClientContext | null = null;
  private terminals = new TerminalManager();
  private acpSessionId: string | null = null;
  private stopped = false;
  private loading = false;
  private lastText = '';
  private queue: (acp.SessionUpdate | null)[] = [];
  private waiter: ((v: acp.SessionUpdate | null) => void) | null = null;

  constructor(private opts: RunnerOptions) {}

  private pushUpdate(u: acp.SessionUpdate | null): void {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(u);
    } else {
      this.queue.push(u);
    }
  }

  private nextUpdate(): Promise<acp.SessionUpdate | null> {
    if (this.queue.length) return Promise.resolve(this.queue.shift() as acp.SessionUpdate | null);
    return new Promise((res) => {
      this.waiter = res;
    });
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  get alive(): boolean {
    return !this.stopped && this.child !== null && this.child.exitCode === null;
  }

  get sessionId(): string | null {
    return this.acpSessionId;
  }

  get responseText(): string {
    return this.lastText;
  }

  private assertInScope(filePath: string): string {
    const resolved = path.resolve(filePath);
    const ok = this.opts.allowedRoots.some((root) => {
      const r = path.resolve(root);
      return resolved === r || resolved.startsWith(r + path.sep);
    });
    if (!ok) throw new Error(`path outside allowed scope: ${filePath}`);
    return resolved;
  }

  private buildApp(): acp.ClientApp {
    const { host, storyId, sessionId } = this.opts;
    const app = acp.client({ name: 'riccon-scrum' });

    app.onRequest(acp.methods.client.fs.readTextFile, async ({ params }) => {
      const target = this.assertInScope(params.path);
      let content = await fs.readFile(target, 'utf8');
      if (params.line != null || params.limit != null) {
        const lines = content.split('\n');
        const start = Math.max(0, (params.line ?? 1) - 1);
        const end = params.limit != null ? start + params.limit : lines.length;
        content = lines.slice(start, end).join('\n');
      }
      return { content };
    });

    app.onRequest(acp.methods.client.fs.writeTextFile, async ({ params }) => {
      const target = this.assertInScope(params.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, params.content, 'utf8');
      return {};
    });

    app.onRequest(acp.methods.client.session.requestPermission, ({ params }) =>
      host.requestPermission(storyId, sessionId, params),
    );

    app.onRequest(acp.methods.client.terminal.create, ({ params }) => this.terminals.create(params));
    app.onRequest(acp.methods.client.terminal.output, ({ params }) => this.terminals.output(params));
    app.onRequest(acp.methods.client.terminal.waitForExit, ({ params }) => this.terminals.waitForExit(params));
    app.onRequest(acp.methods.client.terminal.kill, ({ params }) => this.terminals.kill(params));
    app.onRequest(acp.methods.client.terminal.release, ({ params }) => this.terminals.release(params));

    app.onNotification(acp.methods.client.session.update, ({ params }) => {
      if (this.loading) return;
      if (params.sessionId !== this.acpSessionId) return;
      this.pushUpdate(params.update);
    });

    return app;
  }

  async start(resumeSessionId?: string): Promise<void> {
    const { host, storyId, sessionId, cwd, spec } = this.opts;
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of spec.envUnset ?? []) delete env[key];
    Object.assign(env, spec.env);
    const child = spawn(spec.command, spec.args, {
      cwd,
      shell: false,
      windowsHide: true,
      env,
    });
    this.child = child;
    if (!child.stdin || !child.stdout) throw new Error('agent process has no stdio');

    child.stderr?.on('data', (d: Buffer) => {
      const line = d.toString('utf8').trim();
      if (line) host.publish(storyId, { type: 'agent.message', sessionId, role: 'thought', text: `[stderr] ${line}` });
    });
    child.once('error', (err) => {
      try {
        this.connection?.close();
      } catch {
        // already closed
      }
      host.publish(storyId, {
        type: 'session.status',
        sessionId,
        status: 'error',
        detail: `进程启动失败：${err.message}`,
      });
    });
    child.on('exit', (code) => {
      if (!this.stopped) {
        host.publish(storyId, { type: 'session.status', sessionId, status: 'error', detail: `agent exited (${code})` });
      }
    });

    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );

    const app = this.buildApp();
    const connection = app.connect(stream);
    this.connection = connection;
    const ctx = connection.agent;
    this.ctx = ctx;

    await ctx.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      clientInfo: { name: 'riccon-scrum', version: '0.0.1' },
    });

    if (resumeSessionId) {
      this.acpSessionId = resumeSessionId;
      this.loading = true;
      await ctx.request(acp.methods.agent.session.load, { sessionId: resumeSessionId, cwd, mcpServers: [] });
      this.loading = false;
    } else {
      const resp = await ctx.request(acp.methods.agent.session.new, { cwd, mcpServers: [] });
      this.acpSessionId = resp.sessionId;
    }
    if (spec.modelConfigId && this.opts.model) {
      try {
        await ctx.request(acp.methods.agent.session.setConfigOption, {
          sessionId: this.acpSessionId,
          configId: spec.modelConfigId,
          value: this.opts.model,
        });
      } catch (err) {
        host.publish(storyId, {
          type: 'agent.message',
          sessionId,
          role: 'thought',
          text: `[平台] 模型钉住失败（${this.opts.model}）：${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
    host.publish(storyId, { type: 'session.status', sessionId, status: 'running' });
  }

  async prompt(text: string): Promise<acp.StopReason> {
    if (!this.ctx || !this.acpSessionId) throw new Error('session not started');
    const { host, storyId, sessionId } = this.opts;
    this.lastText = '';
    const turn = this.ctx.request(acp.methods.agent.session.prompt, {
      sessionId: this.acpSessionId,
      prompt: [{ type: 'text', text }],
    });
    turn.then(() => this.pushUpdate(null)).catch(() => this.pushUpdate(null));
    for (;;) {
      const update = await this.nextUpdate();
      if (update === null) break;
      const payload = normalizeUpdate(sessionId, update);
      if (payload) {
        if (payload.type === 'agent.message' && payload.role === 'agent') this.lastText += payload.text;
        host.publish(storyId, payload);
      }
    }
    const resp = await turn;
    return resp.stopReason;
  }

  async cancel(): Promise<void> {
    if (this.connection && this.acpSessionId) {
      await this.connection.agent.notify(acp.methods.agent.session.cancel, { sessionId: this.acpSessionId });
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.terminals.disposeAll();
    try {
      this.connection?.close();
    } catch {
      // already closed
    }
    if (this.child && this.child.exitCode === null) this.child.kill();
    this.opts.host.publish(this.opts.storyId, {
      type: 'session.status',
      sessionId: this.opts.sessionId,
      status: 'stopped',
    });
  }
}