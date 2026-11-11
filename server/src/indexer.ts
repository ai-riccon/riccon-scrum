import fs from 'node:fs/promises';
import path from 'node:path';
import type { CodeIndexStats, CodeSearchResult, CodeSymbol } from '@acp-scrum/shared';
import { clearIndex, getIndexEntries, upsertIndexEntry, deleteIndexEntry } from './db';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.tmp', '__pycache__', 'target', '.venv', 'venv']);
const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 5000;

const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript',
  '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin',
  '.rb': 'Ruby', '.php': 'PHP', '.cs': 'C#', '.vue': 'Vue', '.svelte': 'Svelte',
};

interface RawFile { rel: string; abs: string; mtime: number; size: number; language: string; }

async function walk(repoPath: string): Promise<RawFile[]> {
  const out: RawFile[] = [];
  const stack = [repoPath];
  while (stack.length && out.length < MAX_FILES) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.env.example') continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(abs);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        const language = LANG_BY_EXT[ext];
        if (!language) continue;
        try {
          const st = await fs.stat(abs);
          if (st.size > MAX_FILE_BYTES) continue;
          out.push({ rel: path.relative(repoPath, abs).split(path.sep).join('/'), abs, mtime: st.mtimeMs, size: st.size, language });
        } catch {
          // ignore
        }
      }
    }
  }
  return out;
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (content[i] === '\n') line++;
  return line;
}

export function extractSymbols(content: string, language: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const push = (re: RegExp, kind: string) => {
    for (const m of content.matchAll(re)) {
      if (m[1]) symbols.push({ name: m[1], kind, line: lineOf(content, m.index ?? 0) });
    }
  };
  switch (language) {
    case 'TypeScript':
    case 'JavaScript':
    case 'Vue':
    case 'Svelte':
      push(/(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g, 'function');
      push(/(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g, 'class');
      push(/(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/g, 'interface');
      push(/(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/g, 'type');
      push(/(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g, 'function');
      break;
    case 'Python':
      push(/^\s*def\s+([A-Za-z_]\w*)/gm, 'function');
      push(/^\s*class\s+([A-Za-z_]\w*)/gm, 'class');
      break;
    case 'Go':
      push(/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/gm, 'function');
      push(/^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/gm, 'type');
      break;
    case 'Rust':
      push(/^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/gm, 'function');
      push(/^(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/gm, 'type');
      break;
    case 'Java':
    case 'Kotlin':
    case 'C#':
      push(/(?:public|private|protected|internal)?\s*(?:static\s+)?(?:abstract\s+)?(?:class|interface|enum|record)\s+([A-Za-z_]\w*)/g, 'class');
      push(/(?:public|private|protected)\s+(?:static\s+)?[\w<>,\[\]]+\s+([A-Za-z_]\w*)\s*\(/g, 'method');
      break;
    case 'Ruby':
      push(/^\s*def\s+([A-Za-z_]\w*)/gm, 'function');
      push(/^\s*class\s+([A-Za-z_]\w*)/gm, 'class');
      break;
    case 'PHP':
      push(/function\s+([A-Za-z_]\w*)/g, 'function');
      push(/class\s+([A-Za-z_]\w*)/g, 'class');
      break;
  }
  const seen = new Set<string>();
  return symbols.filter((s) => {
    const k = `${s.kind}:${s.name}:${s.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function indexProject(projectId: string, repoPath: string): Promise<CodeIndexStats> {
  const files = await walk(repoPath);
  const existing = new Map(getIndexEntries(projectId).map((e) => [e.path, e]));
  const seen = new Set<string>();
  let symbolCount = 0;

  for (const f of files) {
    seen.add(f.rel);
    const prev = existing.get(f.rel);
    if (prev && prev.mtime === f.mtime && prev.size === f.size) {
      symbolCount += prev.symbols.length;
      continue;
    }
    let symbols: CodeSymbol[] = [];
    try {
      const content = await fs.readFile(f.abs, 'utf8');
      symbols = extractSymbols(content, f.language);
    } catch {
      // unreadable
    }
    upsertIndexEntry(projectId, f.rel, f.language, symbols, f.mtime, f.size);
    symbolCount += symbols.length;
  }
  for (const [p] of existing) {
    if (!seen.has(p)) deleteIndexEntry(projectId, p);
  }
  return { files: files.length, symbols: symbolCount, indexedAt: new Date().toISOString() };
}

export async function searchCode(projectId: string, repoPath: string, query: string, limit = 40): Promise<CodeSearchResult[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const entries = getIndexEntries(projectId);
  const results: CodeSearchResult[] = [];

  // symbol + path matches
  for (const e of entries) {
    if (e.path.toLowerCase().includes(q)) {
      results.push({ path: e.path, line: 1, kind: 'file', name: e.path, snippet: `${e.language} · ${e.symbols.length} symbols` });
    }
    for (const s of e.symbols) {
      if (s.name.toLowerCase().includes(q)) {
        results.push({ path: e.path, line: s.line, kind: 'symbol', name: s.name, snippet: `${s.kind} · ${e.language}` });
      }
    }
  }

  // content grep (bounded)
  let scanned = 0;
  for (const e of entries) {
    if (results.length >= limit || scanned >= 400) break;
    scanned++;
    try {
      const content = await fs.readFile(path.join(repoPath, e.path), 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length && results.length < limit; i++) {
        if (lines[i].toLowerCase().includes(q)) {
          results.push({ path: e.path, line: i + 1, kind: 'content', name: lines[i].trim().slice(0, 80), snippet: lines[i].trim().slice(0, 120) });
        }
      }
    } catch {
      // ignore
    }
  }

  // dedupe + prioritize symbols
  const seen = new Set<string>();
  const rank = { symbol: 0, file: 1, content: 2 };
  return results
    .filter((r) => {
      const k = `${r.kind}:${r.path}:${r.line}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => rank[a.kind] - rank[b.kind])
    .slice(0, limit);
}

export { clearIndex };

export function getIndexContext(projectId: string, text: string, max = 8): string {
  const ids = [...new Set((text.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? []))];
  if (ids.length === 0) return '';
  const entries = getIndexEntries(projectId);
  const hits: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const lower = id.toLowerCase();
    for (const e of entries) {
      for (const s of e.symbols) {
        if (s.name.toLowerCase().includes(lower) && !seen.has(`${e.path}:${s.name}`)) {
          seen.add(`${e.path}:${s.name}`);
          hits.push(`- ${s.name} (${s.kind}) @ ${e.path}:${s.line}`);
        }
      }
    }
  }
  if (hits.length === 0) return '';
  return ['## 代码索引提示（相关符号，供快速定位）', ...hits.slice(0, max)].join('\n');
}