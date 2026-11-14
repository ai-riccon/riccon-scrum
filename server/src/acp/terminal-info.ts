import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import type { TerminalChoice, TerminalConfigOption, TerminalInfo } from '@riccon-scrum/shared';
import { config } from '../config';
import { AGENT_KINDS, getAgentSpec } from './agents';
import { flattenSelectOptions, modelConfigOption, toTerminalConfigOptions } from './config-options';

const require = createRequire(import.meta.url);

interface TerminalMeta {
  label: string;
  description: string;
  npmPackage: string | null;
  homepage: string | null;
}

const META: Record<string, TerminalMeta> = {
  opencode: {
    label: 'opencode',
    description: '默认终端，ACP 模式；平台使用独立数据库，模型通过 OPENCODE_MODEL 注入。',
    npmPackage: '@opencode/cli',
    homepage: 'https://github.com/anomalyco/opencode',
  },
  'claude-code': {
    label: 'Claude Code',
    description: '通过 @zed-industries/claude-code-acp 适配器以 Node ESM 启动，需先完成 Anthropic 鉴权。',
    npmPackage: '@zed-industries/claude-code-acp',
    homepage: 'https://github.com/zed-industries/claude-code-acp',
  },
  'qoder-cli': {
    label: 'Qoder CLI',
    description: '使用隐藏 --acp 模式；剥离 QODER* 环境变量，模型与思考强度通过 ACP config option 设置。',
    npmPackage: '@qoder-ai/qodercli',
    homepage: 'https://qoder.com',
  },
};

const DETECT_TTL = 60_000;
const PROBE_TIMEOUT = 25_000;
const VERSION_TIMEOUT = 6_000;
const UPDATE_TIMEOUT = 8_000;

interface DetectRecord {
  at: number;
  command: string;
  installed: boolean;
  version: string | null;
  versionError: string | null;
  packageName: string | null;
}

interface ProbeRecord {
  at: number;
  version: string | null;
  models: TerminalChoice[];
  configOptions: TerminalConfigOption[];
  authMethods: string[];
  probeError: string | null;
  probedAt: string | null;
}

interface UpdateRecord {
  at: number;
  latestVersion: string | null;
  updateError: string | null;
}

const detectCache = new Map<string, DetectRecord>();
const probeCache = new Map<string, ProbeRecord>();
const updateCache = new Map<string, UpdateRecord>();

function metaOf(kind: string): TerminalMeta {
  return (
    META[kind] ?? {
      label: kind,
      description: '自定义 ACP 终端。',
      npmPackage: null,
      homepage: null,
    }
  );
}

function isFresh(at: number, ttl: number): boolean {
  return Date.now() - at < ttl;
}

function firstLine(text: string, limit = 240): string {
  return text.trim().split('\n')[0].slice(0, limit);
}

function parseSemver(text: string): string | null {
  const match = text.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
  return match ? match[1] : null;
}

function semverParts(version: string): number[] {
  const core = version.split(/[-+]/)[0];
  return core.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

function isNewer(latest: string, current: string): boolean {
  const a = semverParts(latest);
  const b = semverParts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

function resolveExecutable(command: string): string | null {
  if (path.isAbsolute(command) || command.includes(path.sep)) {
    return fs.existsSync(command) && fs.statSync(command).isFile() ? command : null;
  }
  const pathExt = process.platform === 'win32' ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';') : [''];
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of ['', ...pathExt]) {
      const candidate = path.join(dir, command + ext);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // ignore unreadable PATH entries
      }
    }
  }
  return null;
}

function readPackageVersion(pkgName: string): string | null {
  try {
    const pkgPath = require.resolve(`${pkgName}/package.json`);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

function packageNameFromPath(filePath: string): string | null {
  if (!filePath) return null;
  const match = filePath.replace(/\\/g, '/').match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  return match ? match[1] : null;
}

function runForOutput(
  command: string,
  args: string[],
  timeoutMs: number,
  cwd: string,
): Promise<{ output: string; error: string | null }> {
  return new Promise((resolve) => {
    let output = '';
    let stderr = '';
    let settled = false;
    const finish = (error: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ output: `${output}\n${stderr}`.trim(), error });
    };
    const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
    let child: ChildProcess;
    try {
      child = spawn(command, args, { cwd, shell, windowsHide: true });
    } catch (err) {
      resolve({ output: '', error: err instanceof Error ? err.message : String(err) });
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      finish(`版本命令超时（${timeoutMs}ms）`);
    }, timeoutMs);
    child.stdout?.on('data', (data: Buffer) => {
      output = (output + data.toString('utf8')).slice(-4000);
    });
    child.stderr?.on('data', (data: Buffer) => {
      stderr = (stderr + data.toString('utf8')).slice(-4000);
    });
    child.once('error', (err) => finish(`无法执行 ${command}：${err.message}`));
    child.once('exit', () => finish(null));
  });
}

async function detectTerminal(kind: string): Promise<DetectRecord> {
  const cached = detectCache.get(kind);
  if (cached && isFresh(cached.at, DETECT_TTL)) return cached;
  const meta = metaOf(kind);
  let spec: ReturnType<typeof getAgentSpec>;
  try {
    spec = getAgentSpec(kind, { dbPath: config.opencodeDb });
  } catch (err) {
    const record: DetectRecord = {
      at: Date.now(),
      command: kind,
      installed: false,
      version: null,
      versionError: firstLine(err instanceof Error ? err.message : String(err)),
      packageName: meta.npmPackage,
    };
    detectCache.set(kind, record);
    return record;
  }
  const resolved = resolveExecutable(spec.command);
  const command = resolved ?? spec.command;

  let installed = Boolean(resolved);
  let version: string | null = null;
  let versionError: string | null = null;
  let packageName = meta.npmPackage;
  const scriptArg = spec.args.find((arg) => /\.(c|m)?js$/.test(arg));
  const detectedPackage = packageNameFromPath(resolved ?? '') ?? packageNameFromPath(scriptArg ?? '');
  if (kind !== 'claude-code' && detectedPackage) packageName = detectedPackage;

  if (kind === 'claude-code') {
    packageName = '@zed-industries/claude-code-acp';
    version = readPackageVersion(packageName);
    installed = version !== null;
    if (!version) versionError = '未找到 claude-code-acp 适配器';
  } else if (installed) {
    const args = scriptArg ? [scriptArg, '--version'] : ['--version'];
    const { output, error } = await runForOutput(command, args, VERSION_TIMEOUT, os.tmpdir());
    version = parseSemver(output);
    if (error) versionError = firstLine(error);
    else if (!version) versionError = output ? `无法解析版本输出：${firstLine(output)}` : '终端未返回版本号';
  } else {
    versionError = `未找到可执行文件：${spec.command}`;
  }

  const record: DetectRecord = {
    at: Date.now(),
    command,
    installed,
    version,
    versionError,
    packageName,
  };
  detectCache.set(kind, record);
  return record;
}

function applyInitialConfig(
  current: ProbeRecord,
  configOptions: acp.SessionConfigOption[] | null | undefined,
  agentInfo?: acp.Implementation | null,
): ProbeRecord {
  const modelOption = modelConfigOption(configOptions);
  return {
    ...current,
    version: agentInfo?.version ?? current.version,
    models: modelOption && modelOption.type === 'select' ? flattenSelectOptions(modelOption.options) : [],
    configOptions: toTerminalConfigOptions(configOptions),
  };
}

function mergeChoices(primary: TerminalChoice[], extra: TerminalChoice[]): TerminalChoice[] {
  const seen = new Set(primary.map((choice) => choice.value));
  const merged = [...primary];
  for (const choice of extra) {
    if (seen.has(choice.value)) continue;
    seen.add(choice.value);
    merged.push(choice);
  }
  return merged.sort((a, b) => a.value.localeCompare(b.value));
}

async function listCliModels(kind: string): Promise<TerminalChoice[]> {
  // opencode exposes its full configured provider/model catalog via `opencode models`,
  // while ACP session options only advertise a subset.
  if (kind !== 'opencode') return [];
  const spec = getAgentSpec(kind, { dbPath: config.opencodeDb });
  const command = resolveExecutable(spec.command) ?? spec.command;
  const scriptArg = spec.args.find((arg) => /\.(c|m)?js$/.test(arg));
  const args = scriptArg ? [scriptArg, 'models'] : ['models'];
  const { output, error } = await runForOutput(command, args, 10_000, os.tmpdir());
  if (error && !output) return [];
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[\w.-]+\/[\w.:-]+$/.test(line))
    .map((value) => ({ value, name: value, description: null, group: '终端配置' }));
}

async function probeAcp(kind: string, cwd: string): Promise<ProbeRecord> {
  const spec = getAgentSpec(kind, { dbPath: config.opencodeDb });
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of spec.envUnset ?? []) delete env[key];
  Object.assign(env, spec.env);

  let stderr = '';
  const proc: { child: ChildProcess | null } = { child: null };
  const link: { connection: acp.ClientConnection | null } = { connection: null };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const base: ProbeRecord = {
    at: Date.now(),
    version: null,
    models: [],
    configOptions: [],
    authMethods: [],
    probeError: null,
    probedAt: null,
  };

  const work = async (): Promise<ProbeRecord> => {
    proc.child = spawn(spec.command, spec.args, { cwd, env, windowsHide: true, shell: false });
    if (!proc.child.stdin || !proc.child.stdout) throw new Error('agent 进程没有 stdio');
    proc.child.stderr?.on('data', (data: Buffer) => {
      stderr = (stderr + data.toString('utf8')).slice(-4000);
    });
    const stream = acp.ndJsonStream(
      Writable.toWeb(proc.child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(proc.child.stdout) as ReadableStream<Uint8Array>,
    );
    const app = acp.client({ name: 'riccon-scrum' });
    link.connection = app.connect(stream);
    const agent = link.connection.agent;

    const init = await agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      clientInfo: { name: 'riccon-scrum', version: '0.0.1' },
    });
    let result = applyInitialConfig(
      {
        ...base,
        version: init.agentInfo?.version ?? null,
        authMethods: (init.authMethods ?? []).map((method) => method.name),
      },
      null,
      init.agentInfo,
    );
    try {
      const session = await agent.request(acp.methods.agent.session.new, { cwd, mcpServers: [] });
      result = applyInitialConfig(result, session.configOptions, init.agentInfo);
    } catch (err) {
      result = {
        ...result,
        probeError: `session/new 失败：${err instanceof Error ? err.message : String(err)}`,
      };
    }
    result.probedAt = new Date().toISOString();
    return result;
  };

  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`终端探测超时（${PROBE_TIMEOUT}ms）`)), PROBE_TIMEOUT);
    });
    return await Promise.race([work(), deadline]);
  } catch (err) {
    const detail = firstLine(err instanceof Error ? err.message : String(err));
    const diagnostic = stderr.trim() ? `；${firstLine(stderr)}` : '';
    return {
      ...base,
      probeError: `${detail}${diagnostic}`,
      probedAt: new Date().toISOString(),
    };
  } finally {
    if (timer) clearTimeout(timer);
    try {
      link.connection?.close();
    } catch {
      // already closed
    }
    if (proc.child && proc.child.exitCode === null) proc.child.kill();
  }
}

function mergeInfo(kind: string, detect: DetectRecord): TerminalInfo {
  const meta = metaOf(kind);
  const probe = probeCache.get(kind);
  const update = updateCache.get(kind);
  const version = probe?.version ?? detect.version;
  const latestVersion = update?.latestVersion ?? null;
  return {
    kind,
    label: meta.label,
    description: meta.description,
    installed: detect.installed,
    command: detect.command,
    version,
    packageName: detect.packageName,
    homepage: meta.homepage,
    latestVersion,
    updateAvailable: latestVersion && version ? isNewer(latestVersion, version) : null,
    updateError: update?.updateError ?? null,
    versionError: detect.versionError,
    models: probe?.models ?? [],
    configOptions: probe?.configOptions ?? [],
    authMethods: probe?.authMethods ?? [],
    probeError: probe?.probeError ?? null,
    probedAt: probe?.probedAt ?? null,
  };
}

export async function listTerminalInfos(): Promise<TerminalInfo[]> {
  const kinds = [...AGENT_KINDS];
  const detects = await Promise.all(kinds.map((kind) => detectTerminal(kind).catch(() => null)));
  return kinds.map((kind, index) => {
    const detect = detects[index] ?? {
      at: Date.now(),
      command: kind,
      installed: false,
      version: null,
      versionError: '终端检测失败',
      packageName: metaOf(kind).npmPackage,
    };
    return mergeInfo(kind, detect);
  });
}

export async function getTerminalInfo(kind: string): Promise<TerminalInfo> {
  if (!(AGENT_KINDS as readonly string[]).includes(kind)) throw new Error(`未知 agent 终端：${kind}`);
  return mergeInfo(kind, await detectTerminal(kind));
}

export async function probeTerminal(kind: string, cwd?: string): Promise<TerminalInfo> {
  if (!(AGENT_KINDS as readonly string[]).includes(kind)) throw new Error(`未知 agent 终端：${kind}`);
  const target = cwd && fs.existsSync(cwd) ? cwd : os.tmpdir();
  let record: ProbeRecord;
  try {
    record = await probeAcp(kind, target);
  } catch (err) {
    record = {
      at: Date.now(),
      version: null,
      models: [],
      configOptions: [],
      authMethods: [],
      probeError: firstLine(err instanceof Error ? err.message : String(err)),
      probedAt: new Date().toISOString(),
    };
  }
  try {
    const cliModels = await listCliModels(kind);
    record.models = mergeChoices(record.models, cliModels);
  } catch {
    // CLI model listing is best-effort; ACP options remain authoritative.
  }
  probeCache.set(kind, record);
  const detect = await detectTerminal(kind);
  // A successful ACP handshake is stronger evidence than PATH/package heuristics.
  if (record.version && !detect.version) detect.version = record.version;
  if (!record.probeError) detect.installed = true;
  return mergeInfo(kind, detect);
}

async function fetchLatestVersion(pkgName: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPDATE_TIMEOUT);
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkgName)}/latest`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`npm registry 返回 HTTP ${res.status}`);
    const data = (await res.json()) as { version?: string };
    if (!data.version) throw new Error('npm registry 响应缺少 version');
    return data.version;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkTerminalUpdate(kind: string): Promise<TerminalInfo> {
  if (!(AGENT_KINDS as readonly string[]).includes(kind)) throw new Error(`未知 agent 终端：${kind}`);
  const meta = metaOf(kind);
  let latestVersion: string | null = null;
  let updateError: string | null = null;
  if (!meta.npmPackage) {
    updateError = '该终端未配置 npm 包名，无法检查更新';
  } else {
    try {
      latestVersion = await fetchLatestVersion(meta.npmPackage);
    } catch (err) {
      updateError = err instanceof Error ? err.message : String(err);
    }
  }
  updateCache.set(kind, { at: Date.now(), latestVersion, updateError });
  return mergeInfo(kind, await detectTerminal(kind));
}

export function invalidateTerminalCaches(kind?: string): void {
  if (kind) {
    detectCache.delete(kind);
    probeCache.delete(kind);
    updateCache.delete(kind);
    return;
  }
  detectCache.clear();
  probeCache.clear();
  updateCache.clear();
}
