import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type * as acp from '@agentclientprotocol/sdk';

interface TerminalEntry {
  child: ChildProcess;
  output: string;
  byteLimit: number;
  truncated: boolean;
  exited: boolean;
  exitCode: number | null;
  signal: string | null;
  exitWaiters: Array<(v: { exitCode: number | null; signal: string | null }) => void>;
}

const DEFAULT_BYTE_LIMIT = 256 * 1024;

export class TerminalManager {
  private terminals = new Map<string, TerminalEntry>();

  create(params: acp.CreateTerminalRequest): acp.CreateTerminalResponse {
    const id = randomUUID();
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const v of params.env ?? []) env[v.name] = v.value;
    const child = spawn(params.command, params.args ?? [], {
      cwd: params.cwd ?? undefined,
      env,
      shell: false,
      windowsHide: true,
    });
    const entry: TerminalEntry = {
      child,
      output: '',
      byteLimit: params.outputByteLimit ?? DEFAULT_BYTE_LIMIT,
      truncated: false,
      exited: false,
      exitCode: null,
      signal: null,
      exitWaiters: [],
    };
    const append = (chunk: Buffer) => {
      entry.output += chunk.toString('utf8');
      const bytes = Buffer.byteLength(entry.output, 'utf8');
      if (bytes > entry.byteLimit) {
        entry.output = entry.output.slice(entry.output.length - entry.byteLimit);
        entry.truncated = true;
      }
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('error', (err) => {
      append(Buffer.from(`\n[terminal error] ${err.message}\n`));
      this.finish(entry, null, 'error');
    });
    child.on('exit', (code, signal) => this.finish(entry, code, signal));
    this.terminals.set(id, entry);
    return { terminalId: id };
  }

  private finish(entry: TerminalEntry, code: number | null, signal: NodeJS.Signals | null | string) {
    if (entry.exited) return;
    entry.exited = true;
    entry.exitCode = code;
    entry.signal = signal ?? null;
    for (const w of entry.exitWaiters.splice(0)) w({ exitCode: code, signal: entry.signal });
  }

  private get(terminalId: string): TerminalEntry {
    const entry = this.terminals.get(terminalId);
    if (!entry) throw new Error(`unknown terminal: ${terminalId}`);
    return entry;
  }

  output(params: acp.TerminalOutputRequest): acp.TerminalOutputResponse {
    const entry = this.get(params.terminalId);
    return {
      output: entry.output,
      truncated: entry.truncated,
      exitStatus: entry.exited ? { exitCode: entry.exitCode, signal: entry.signal } : null,
    };
  }

  async waitForExit(params: acp.WaitForTerminalExitRequest): Promise<acp.WaitForTerminalExitResponse> {
    const entry = this.get(params.terminalId);
    if (entry.exited) return { exitCode: entry.exitCode, signal: entry.signal };
    return new Promise((resolve) => entry.exitWaiters.push(resolve));
  }

  kill(params: acp.KillTerminalRequest): acp.KillTerminalResponse {
    const entry = this.get(params.terminalId);
    if (!entry.exited) entry.child.kill();
    return {};
  }

  release(params: acp.ReleaseTerminalRequest): acp.ReleaseTerminalResponse {
    const entry = this.get(params.terminalId);
    if (!entry.exited) entry.child.kill();
    this.terminals.delete(params.terminalId);
    return {};
  }

  disposeAll(): void {
    for (const [, entry] of this.terminals) {
      if (!entry.exited) entry.child.kill();
    }
    this.terminals.clear();
  }
}