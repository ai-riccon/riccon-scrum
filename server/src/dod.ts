import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface DodRunResult {
  ok: boolean;
  output: string;
}

// DoD commands are admin-configured project settings (like CI config), not
// per-request user input; shell execution is intentional to support "npm test && ...".
export async function runDodCommand(command: string, cwd: string, timeoutMs = 300_000): Promise<DodRunResult> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    return { ok: true, output: tail(stdout + stderr) };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
    const note = e.killed ? '\n[timeout]' : '';
    return { ok: false, output: tail(`${e.stdout ?? ''}${e.stderr ?? ''}\n${e.message ?? ''}${note}`) };
  }
}

function tail(text: string, max = 8000): string {
  return text.length > max ? text.slice(text.length - max) : text;
}