#!/usr/bin/env node
// Dev server 引导器：作为独立后台进程运行 `npm run dev`，并把输出追加写入 server/data/dev.log。
// 由 scripts/dev-control.mjs 以 detached 方式启动，因此关闭启动脚本的终端不会影响服务。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const LOG_FILE = path.join(ROOT, 'server', 'data', 'dev.log');

fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
const out = fs.createWriteStream(LOG_FILE, { flags: 'a' });

function stamp() {
  return new Date().toISOString();
}

out.write(`[riccon-scrum] bootstrap 启动 ${stamp()}\n`);

const child = spawn('npm run dev', {
  cwd: ROOT,
  shell: true,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.pipe(out, { end: false });
child.stderr.pipe(out, { end: false });

child.on('error', (err) => {
  out.write(`[riccon-scrum] 启动失败：${err.message}\n`);
  out.end(() => process.exit(1));
});

child.on('exit', (code, signal) => {
  out.write(`\n[riccon-scrum] dev server 已退出（code=${code ?? '-'} signal=${signal ?? '-'}）${stamp()}\n`);
  out.end(() => process.exit(0));
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try {
      child.kill(sig);
    } catch {
      // child already gone
    }
  });
}
