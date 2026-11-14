import path from 'node:path';
import fs from 'node:fs';

function resolveOpencodeBin(): string {
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN;
  const roots = [
    path.join(path.dirname(process.execPath), 'node_global', 'node_modules'),
    path.join(path.dirname(process.execPath), 'node_modules'),
    process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'node_modules') : '',
  ].filter(Boolean);
  for (const root of roots) {
    const candidates = [
      path.join(root, '@opencode', 'cli', 'bin', 'opencode.exe'),
      path.join(root, 'opencode-ai', 'bin', 'opencode.exe'),
      path.join(root, '@opencode', 'cli', 'bin', 'opencode'),
      path.join(root, 'opencode-ai', 'bin', 'opencode'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return 'opencode';
}

const agentModel = process.env.OPENCODE_MODEL ?? 'opencode-go/deepseek-v4.1-flash';
const baseArgs = (process.env.OPENCODE_ARGS ?? 'acp').split(' ');
const dataDir = process.env.RICCON_DATA_DIR
  ? path.resolve(process.env.RICCON_DATA_DIR)
  : path.resolve(import.meta.dirname, '../data');

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
  discoveryTimeoutMs: Number(process.env.DISCOVERY_TIMEOUT_MS ?? 10 * 60 * 1000),
  discoveryHeartbeatMs: Number(process.env.DISCOVERY_HEARTBEAT_MS ?? 10_000),
  intakeIdleMs: Number(process.env.INTAKE_IDLE_MS ?? 10 * 60 * 1000),
  embeddingUrl: process.env.EMBEDDING_URL ?? '',
  embeddingApiKey: process.env.EMBEDDING_API_KEY ?? '',
  embeddingModel: process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
  budgets: {
    maxTurns: Number(process.env.BUDGET_MAX_TURNS ?? 12),
    maxWallMs: Number(process.env.BUDGET_MAX_WALL_MS ?? 15 * 60 * 1000),
    maxTokens: Number(process.env.BUDGET_MAX_TOKENS ?? 200_000),
  },
};