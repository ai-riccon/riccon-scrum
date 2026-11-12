import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { config } from '../config';

export interface AgentSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
  envUnset?: string[];
  modelConfigId?: string;
}

export const AGENT_KINDS = ['opencode', 'claude-code', 'qoder-cli'] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

const require = createRequire(import.meta.url);

function resolveClaudeAcpEntry(): string {
  const pkgPath = require.resolve('@zed-industries/claude-code-acp/package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { bin: string | Record<string, string> };
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin['claude-code-acp'];
  return path.join(path.dirname(pkgPath), bin);
}

function resolveQoderCli(): { command: string; args: string[] } {
  if (process.env.QODERCLI_BIN) return { command: process.env.QODERCLI_BIN, args: ['--acp'] };
  const nodeGlobal = path.join(path.dirname(process.execPath), 'node_global', 'node_modules');
  const bundles = [
    path.join(nodeGlobal, '@qodercn-ai', 'qoderclicn', 'bundle', 'qoderclicn.js'),
    path.join(nodeGlobal, '@qoder-ai', 'qodercli', 'bundle', 'qodercli.js'),
  ];
  for (const bundle of bundles) {
    if (fs.existsSync(bundle)) return { command: process.execPath, args: [bundle, '--acp'] };
  }
  const exe = path.join(os.homedir(), '.qoder', 'bin', 'qodercli', 'qodercli.exe');
  if (fs.existsSync(exe)) return { command: exe, args: ['--acp'] };
  return { command: 'qodercli', args: ['--acp'] };
}

export function getAgentSpec(kind: string, opts: { model?: string; dbPath?: string }): AgentSpec {
  if (kind === 'claude-code') {
    // The adapter is a Node ESM script; run it with the current Node binary (no shell shim).
    return { command: process.execPath, args: [resolveClaudeAcpEntry()], env: {} };
  }
  if (kind === 'qoder-cli') {
    const { command, args } = resolveQoderCli();
    const env: Record<string, string> = { NO_BROWSER: '1' };
    if (process.env.QODER_MODEL) env.QODER_MODEL = process.env.QODER_MODEL;
    return {
      command,
      // Empty MCP config keeps platform sessions out of the user's Desktop MCP servers.
      args: [...args, '--mcp-config', '{"mcpServers":{}}', '--strict-mcp-config'],
      env,
      // Desktop-injected QODER* vars force SDK mode / app auth into the child; strip them all.
      envUnset: Object.keys(process.env).filter((k) => k.startsWith('QODER')),
      modelConfigId: 'model',
    };
  }
  const env: Record<string, string> = {};
  if (opts.model) {
    env.OPENCODE_MODEL = opts.model;
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ model: opts.model });
  }
  if (opts.dbPath) env.OPENCODE_DB = opts.dbPath;
  return { command: config.agentCommand, args: config.agentArgs, env };
}