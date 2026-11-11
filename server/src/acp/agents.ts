import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { config } from '../config';

export interface AgentSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export const AGENT_KINDS = ['opencode', 'claude-code'] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

const require = createRequire(import.meta.url);

function resolveClaudeAcpEntry(): string {
  const pkgPath = require.resolve('@zed-industries/claude-code-acp/package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { bin: string | Record<string, string> };
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin['claude-code-acp'];
  return path.join(path.dirname(pkgPath), bin);
}

export function getAgentSpec(kind: string, opts: { model?: string; dbPath?: string }): AgentSpec {
  if (kind === 'claude-code') {
    // The adapter is a Node ESM script; run it with the current Node binary (no shell shim).
    return { command: process.execPath, args: [resolveClaudeAcpEntry()], env: {} };
  }
  const env: Record<string, string> = {};
  if (opts.model) {
    env.OPENCODE_MODEL = opts.model;
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ model: opts.model });
  }
  if (opts.dbPath) env.OPENCODE_DB = opts.dbPath;
  return { command: config.agentCommand, args: config.agentArgs, env };
}