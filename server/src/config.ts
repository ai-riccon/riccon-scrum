import path from 'node:path';
import fs from 'node:fs';

function resolveOpencodeBin(): string {
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN;
  if (process.platform === 'win32') {
    const candidate = path.join(
      path.dirname(process.execPath),
      'node_global',
      'node_modules',
      'opencode-ai',
      'bin',
      'opencode.exe',
    );
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'opencode';
}

const agentModel = process.env.OPENCODE_MODEL ?? 'opencode/deepseek-v4.1-flash-free';
const baseArgs = (process.env.OPENCODE_ARGS ?? 'acp').split(' ');
const dataDir = path.resolve(import.meta.dirname, '../data');

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '127.0.0.1',
  agentCommand: resolveOpencodeBin(),
  agentModel,
  agentArgs: baseArgs,
  // Isolated DB so platform agent sessions never touch the user's interactive opencode data.
  opencodeDb: process.env.OPENCODE_DB ?? path.join(dataDir, 'opencode-platform.db'),
  wipLimit: Number(process.env.WIP_LIMIT ?? 3),
  maxRework: Number(process.env.MAX_REWORK ?? 2),
  budgets: {
    maxTurns: Number(process.env.BUDGET_MAX_TURNS ?? 12),
    maxWallMs: Number(process.env.BUDGET_MAX_WALL_MS ?? 15 * 60 * 1000),
    maxTokens: Number(process.env.BUDGET_MAX_TOKENS ?? 200_000),
  },
};