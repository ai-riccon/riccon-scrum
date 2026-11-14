#!/usr/bin/env node
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'server', 'data');
const PID_FILE = path.join(DATA, 'dev.pid');
const LOG_FILE = path.join(DATA, 'dev.log');
const API_PORT = Number(process.env.PORT ?? 8787);
const WEB_PORT = 5399;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const isWin = process.platform === 'win32';
const REQUIRED_DEPS = ['concurrently', 'tsx', 'vite'];

fs.mkdirSync(DATA, { recursive: true });

function log(msg) {
  console.log(`[riccon-scrum] ${msg}`);
}

function readLogTail(lines = 30) {
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf8').replace(/\x1b\[[0-9;]*m/g, '');
    const rows = content.split(/\r?\n/).filter((line) => line.trim() !== '');
    return rows.slice(-lines);
  } catch {
    return [];
  }
}

function depsInstalled() {
  return REQUIRED_DEPS.every((name) => fs.existsSync(path.join(ROOT, 'node_modules', name)));
}

function ensureDeps() {
  if (depsInstalled()) return true;
  log('未检测到完整依赖（node_modules），正在执行 npm install …');
  const res = spawnSync('npm install --no-audit --no-fund', {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
  if (res.status !== 0) {
    log('依赖安装失败：请检查网络或 npm registry 配置后重试。');
    return false;
  }
  if (!depsInstalled()) {
    log('依赖仍不完整：请删除 node_modules 目录后重新运行 start.cmd。');
    return false;
  }
  log('依赖安装完成。');
  return true;
}

async function healthOk() {
  try {
    const res = await fetch(`http://127.0.0.1:${API_PORT}/api/health`, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.ok === true;
  } catch {
    return false;
  }
}

function portBusy(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', (err) => resolve(err.code === 'EADDRINUSE'));
    srv.once('listening', () => srv.close(() => resolve(false)));
    srv.listen(port, '127.0.0.1');
  });
}

function openBrowser(url) {
  try {
    const child = isWin
      ? spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true })
      : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    // browser launch is best-effort
  }
}

async function waitHealth(timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await healthOk()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killTree(pid) {
  try {
    if (isWin) execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

function listeningPids(port) {
  try {
    if (isWin) {
      const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;
        const [, local, , state, pid] = parts;
        if (state !== 'LISTENING' || !local.endsWith(`:${port}`)) continue;
        pids.add(Number(pid));
      }
      return [...pids].filter((n) => Number.isFinite(n) && n > 0);
    }
    const out = execFileSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' });
    return out.split(/\s+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

function reportFailure(reason) {
  log(reason);
  log(`完整日志：${LOG_FILE}`);
  const tail = readLogTail(20);
  if (tail.length) {
    log('—— 日志末尾 ——');
    for (const line of tail) console.log(`  ${line}`);
  } else {
    log('日志为空：dev server 可能未能启动。');
  }
}

async function start() {
  if (await healthOk()) {
    log(`已在运行：${WEB_URL}`);
    openBrowser(WEB_URL);
    return 0;
  }
  if ((await portBusy(API_PORT)) || (await portBusy(WEB_PORT))) {
    log(`启动失败：端口 ${API_PORT} 或 ${WEB_PORT} 被其他程序占用，请先释放端口。`);
    return 1;
  }
  if (!ensureDeps()) return 1;

  try {
    fs.writeFileSync(
      LOG_FILE,
      `[riccon-scrum] dev server 启动于 ${new Date().toISOString()}\n[root] ${ROOT}\n\n`,
    );
  } catch {
    // log file is best-effort
  }

  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'dev-run.mjs')], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', (err) => log(`启动子进程失败：${err.message}`));
  child.unref();
  try {
    fs.writeFileSync(PID_FILE, String(child.pid));
  } catch {
    // pid file is best-effort
  }
  log(`正在后台启动 dev server（日志：${LOG_FILE}）…`);

  if (!(await waitHealth(90000))) {
    reportFailure('启动超时：dev server 未在 90 秒内就绪。');
    return 1;
  }
  log(`已启动：${WEB_URL}  |  API http://127.0.0.1:${API_PORT}`);
  log(`日志：${LOG_FILE}（查看：node scripts/dev-control.mjs logs）`);
  openBrowser(WEB_URL);
  return 0;
}

async function stop() {
  let killed = false;
  let pid = null;
  try {
    pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim()) || null;
  } catch {
    pid = null;
  }
  if (pid && pidAlive(pid)) killed = killTree(pid) || killed;
  if (pid) {
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      // stale pid file
    }
  }
  for (const port of [API_PORT, WEB_PORT]) {
    for (const p of listeningPids(port)) {
      if (p === process.pid) continue;
      if (killTree(p)) {
        killed = true;
        log(`已结束占用端口 ${port} 的进程 PID ${p}`);
      }
    }
  }
  if (!killed) {
    if (await healthOk()) {
      log('停止失败：服务仍在响应，请检查进程权限。');
      return 1;
    }
    log('未发现运行中的服务（无需停止）。');
    return 0;
  }
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (!(await healthOk()) && !(await portBusy(API_PORT)) && !(await portBusy(WEB_PORT))) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (await healthOk()) {
    log('停止后 API 仍在响应，请手动检查。');
    return 1;
  }
  log('已停止 dev server（API 与 Web 均已关闭）。');
  return 0;
}

async function status() {
  const running = await healthOk();
  log(`状态：${running ? '运行中' : '未运行'}`);
  log(`  Web ${WEB_URL}  |  API http://127.0.0.1:${API_PORT}`);
  log(`  日志：${LOG_FILE}`);
  if (isWin) {
    const pids = [...listeningPids(API_PORT), ...listeningPids(WEB_PORT)];
    if (pids.length) log(`  监听进程 PID：${[...new Set(pids)].join(', ')}`);
  } else {
    try {
      const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
      if (pid) log(`  记录 PID：${pid}（${pidAlive(pid) ? '存活' : '已退出'}）`);
    } catch {
      // no pid file
    }
  }
  if (!running) {
    const tail = readLogTail(5);
    if (tail.length) {
      log('  最近日志：');
      for (const line of tail) console.log(`    ${line}`);
    }
  }
  return 0;
}

function logs() {
  const arg = process.argv[3];
  const lines = Number(arg) > 0 ? Number(arg) : 60;
  const tail = readLogTail(lines);
  if (!tail.length) {
    log(`日志为空或不存在：${LOG_FILE}`);
    return 0;
  }
  log(`日志末尾 ${tail.length} 行（${LOG_FILE}）：`);
  for (const line of tail) console.log(line);
  return 0;
}

const action = process.argv[2] ?? 'status';
const code =
  action === 'start'
    ? await start()
    : action === 'stop'
      ? await stop()
      : action === 'logs'
        ? logs()
        : await status();
process.exit(code);
