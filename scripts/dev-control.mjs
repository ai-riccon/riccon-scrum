#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'server', 'data');
const PID_FILE = path.join(DATA, 'dev.pid');
const API_PORT = Number(process.env.PORT ?? 8787);
const WEB_PORT = 5399;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const isWin = process.platform === 'win32';

fs.mkdirSync(DATA, { recursive: true });

function log(msg) {
  console.log(`[riccon-scrum] ${msg}`);
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
  if (isWin) {
    const child = spawn('cmd.exe', ['/c', 'start', '', 'cmd', '/k', 'npm run dev'], {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    log('正在独立控制台窗口中启动 dev server（日志见该窗口）…');
  } else {
    const child = spawn('npm', ['run', 'dev'], { cwd: ROOT, detached: true, stdio: 'ignore' });
    child.unref();
    fs.writeFileSync(PID_FILE, String(child.pid));
    log('正在后台启动 dev server…');
  }
  if (!(await waitHealth(90000))) {
    log('启动超时：请查看控制台窗口中的报错。');
    return 1;
  }
  log(`已启动：${WEB_URL}  |  API http://127.0.0.1:${API_PORT}`);
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
  return 0;
}

const action = process.argv[2] ?? 'status';
const code = action === 'start' ? await start() : action === 'stop' ? await stop() : await status();
process.exit(code);
