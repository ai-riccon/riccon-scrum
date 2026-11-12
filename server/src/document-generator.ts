import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DocumentType, Project } from '@riccon-scrum/shared';
import { config } from './config';
import {
  finishDocumentJob,
  getDocument,
  getDocumentJob,
  getProject,
  getProfileRecord,
  heartbeatDocumentJob,
  requestDocumentCancel,
  startDocumentJob,
} from './db';
import { AcpRunner } from './acp/runner';
import { getAgentSpec } from './acp/agents';
import { readOnlyHost } from './acp/readonly';
import { createDetachedWorktree, currentBranch, removeWorktree } from './git';
import { documentGenerationPrompt, legacyRequirementsBaselinePrompt } from './templates';
import {
  DOCUMENT_META,
  documentTypeLabel,
  ensureDocument,
  headCommit,
  saveDocumentContent,
  summaryOf,
} from './documents';

const DOC_TIMEOUT_MS = Number(process.env.DOC_GENERATION_TIMEOUT_MS ?? 5 * 60_000);
const HEARTBEAT_MS = Number(process.env.DOC_HEARTBEAT_MS ?? 10_000);
const activeRunners = new Map<string, AcpRunner>();

function keyOf(projectId: string, docType: DocumentType, slug: string): string {
  return `${projectId}:${docType}:${slug}`;
}

function raceTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void, message: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error(message));
    }, Math.max(1, ms));
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

function profileSummary(projectId: string): string {
  const record = getProfileRecord(projectId);
  const p = record.profile;
  if (!p) return '';
  return [
    `- 语言：${p.languages.join(', ') || '未知'}`,
    `- 框架/工具：${p.frameworks.join(', ') || '未知'}`,
    `- 包管理：${p.packageManager ?? '未知'}`,
    `- 清单：${p.manifests.join(', ')}`,
    `- 入口：${p.entryPoints.join(', ') || '未知'}`,
    `- 测试命令：${p.testCommands.join(', ') || '未发现'}`,
    `- 构建命令：${p.buildCommands.join(', ') || '未发现'}`,
    `- 顶层结构：${p.structure.join(', ')}`,
  ].join('\n');
}

function redactSecrets(text: string): string {
  return text
    .replace(/((?:api[_-]?key|secret|password|passwd|token|authorization)\s*[:=]\s*)(['"]?)[^\s'"\n,;]{6,}\2/gi, '$1$2<redacted>$2')
    .replace(/Bearer\s+[A-Za-z0-9._\-]{8,}/g, 'Bearer <redacted>')
    .replace(/(postgres(?:ql)?|mysql|mongodb|redis):\/\/[^\s'"`]+/gi, '$1://<redacted>');
}

const EVIDENCE_PATTERNS: Record<DocumentType, string[]> = {
  overview: ['README*', 'package.json', '**/package.json', 'tsconfig*.json', '**/pom.xml', '**/build.gradle*', '**/go.mod', '**/Cargo.toml', '**/pyproject.toml'],
  requirements: ['README*', '**/routes/**', '**/controllers/**', '**/*route*.ts', '**/*.test.*', '**/schema.prisma', '**/migrations/**'],
  architecture: ['README*', 'package.json', '**/package.json', 'tsconfig*.json', '**/src/index.ts', '**/src/main.ts', '**/src/App.tsx', '**/routes.ts', '**/service.ts'],
  'coding-standards': ['.eslintrc*', 'eslint.config.*', '.prettierrc*', 'prettier.config.*', 'tsconfig*.json', '.editorconfig', 'biome.json', 'package.json', 'CONTRIBUTING*'],
  'code-graph': ['package.json', '**/package.json', 'tsconfig*.json', '**/src/index.ts'],
  database: ['**/migrations/**', '**/*.sql', '**/schema.prisma', '**/schema.sql', '**/entities/**', '**/models/**', '**/repository/**'],
  'api-contract': ['**/routes/**', '**/routes.ts', '**/controllers/**', '**/api/**', '**/openapi*', '**/swagger*'],
  'test-strategy': ['vitest.config.*', 'jest.config.*', 'pytest.ini', '**/package.json', '**/*.test.ts', '**/*.spec.ts', '**/tests/**'],
  operations: ['Dockerfile*', 'docker-compose*', '**/k8s/**', '**/deploy/**', '.github/workflows/**', '**/scripts/**', '.env.example', 'README*'],
  security: ['**/auth/**', '**/middleware/**', '**/policy/**', '.env.example', '**/security/**', 'package.json'],
};

function globToRegex(glob: string): RegExp {
  let pattern = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  pattern = pattern
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.');
  pattern = pattern.replace(/\u0000/g, '(?:.*/)?').replace(/\u0001/g, '.*');
  return new RegExp(`^${pattern}$`);
}

function walkFiles(root: string, maxFiles = 4000): string[] {
  const out: string[] = [];
  const stack = [''];
  const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'target', '.venv', 'venv', '__pycache__']);
  while (stack.length && out.length < maxFiles) {
    const rel = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env.example' && !entry.name.startsWith('.eslintrc')) continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) stack.push(child);
      } else if (entry.isFile()) {
        out.push(child);
      }
    }
  }
  return out;
}

function collectEvidence(repoPath: string, docType: DocumentType): string {
  const patterns = EVIDENCE_PATTERNS[docType].map(globToRegex);
  const files = walkFiles(repoPath);
  const selected: string[] = [];
  for (const pattern of patterns) {
    for (const file of files) {
      if (selected.length >= 10) break;
      if (!selected.includes(file) && pattern.test(file)) selected.push(file);
    }
  }
  const chunks: string[] = [];
  for (const file of selected.slice(0, 10)) {
    try {
      const raw = fs.readFileSync(path.join(repoPath, file), 'utf8');
      chunks.push(`### ${file}\n\`\`\`\n${redactSecrets(raw.slice(0, 3500))}\n\`\`\``);
    } catch {
      // ignore unreadable
    }
  }
  return chunks.join('\n\n');
}

function stripFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  return (match ? match[1] : trimmed).trim();
}

function normalizeGeneratedText(text: string): string {
  let out = stripFence(text)
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
  if ((out.match(/\\n/g) ?? []).length >= 3) {
    out = out.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  }
  const heading = out.search(/^#\s+/m);
  if (heading > 0) {
    out = out.slice(heading);
  } else if (heading !== 0) {
    const inline = out.indexOf('# ');
    if (inline > 0 && inline < 400) out = out.slice(inline);
  }
  return out.trim();
}

function missingHeadings(content: string, required: string[]): string[] {
  const lower = content.toLowerCase();
  return required.filter((heading) => !lower.includes(heading.toLowerCase()));
}

async function runAgent(
  runner: AcpRunner,
  prompt: string,
  deadline: number,
  maxMs: number,
  projectId: string,
  docType: DocumentType,
  slug: string,
): Promise<string> {
  if (getDocumentJob(projectId, docType, slug)?.cancelRequested) throw new Error('文档生成已取消');
  const remaining = Math.min(deadline - Date.now(), maxMs);
  if (remaining <= 0) throw new Error('文档生成超时');
  await raceTimeout(
    runner.prompt(prompt),
    remaining,
    () => {
      void runner.stop().catch(() => undefined);
    },
    '文档生成超时',
  );
  if (getDocumentJob(projectId, docType, slug)?.cancelRequested) throw new Error('文档生成已取消');
  return runner.responseText;
}

async function generateWithAgent(
  project: Project,
  docType: DocumentType,
  slug: string,
  title: string,
  prompt: (evidence: string) => string,
): Promise<ReturnType<typeof getDocument>> {
  const job = startDocumentJob(project.id, docType, slug);
  if (job.cancelRequested) throw new Error('文档生成已取消');
  const heartbeat = setInterval(() => heartbeatDocumentJob(project.id, docType, slug), HEARTBEAT_MS);
  heartbeat.unref();
  const doc = ensureDocument(project.id, docType, slug, title);
  const key = keyOf(project.id, docType, slug);
  const deadline = Date.now() + DOC_TIMEOUT_MS;
  const worktree = path.join(os.tmpdir(), `riccon-doc-${doc.id.slice(0, 8)}-${Date.now()}`);
  let runner: AcpRunner | null = null;
  try {
    const base = project.defaultBranch || (await currentBranch(project.repoPath));
    await createDetachedWorktree(project.repoPath, worktree, base);
    const evidence = collectEvidence(worktree, docType);
    const model = project.model || config.agentModel;
    const spec = getAgentSpec(project.agentKind, { model: model || config.agentModel, dbPath: config.opencodeDb });
    runner = new AcpRunner({
      storyId: doc.id,
      sessionId: `doc-${doc.id.slice(0, 8)}-${Date.now()}`,
      cwd: worktree,
      spec,
      host: readOnlyHost(doc.id),
      allowedRoots: [worktree],
      model: model || undefined,
    });
    activeRunners.set(key, runner);
    await raceTimeout(
      runner.start(),
      Math.min(60_000, Math.max(1, deadline - Date.now())),
      () => {
        void runner?.stop().catch(() => undefined);
      },
      'agent 启动超时',
    );
    let content = normalizeGeneratedText(await runAgent(runner, prompt(evidence), deadline, DOC_TIMEOUT_MS, project.id, docType, slug));
    let missing = missingHeadings(content, DOCUMENT_META[docType].requiredHeadings);
    if (missing.length > 0) {
      const repair = [
        '上一次输出缺少必需章节：' + missing.join('、') + '。',
        '请重新输出完整文档，必须包含这些章节，并保留已有事实证据。不要输出解释。',
      ].join('\n');
      content = normalizeGeneratedText(
        await runAgent(runner, repair, deadline, Math.max(30_000, Math.min(90_000, deadline - Date.now())), project.id, docType, slug),
      );
      missing = missingHeadings(content, DOCUMENT_META[docType].requiredHeadings);
    }
    if (missing.length > 0) throw new Error(`生成结果缺少必需章节：${missing.join('、')}`);
    if (content.trim().length < 200) throw new Error('生成结果过短，未保存');
    return saveDocumentContent(doc.id, {
      content,
      title,
      status: 'draft',
      source: 'regenerate',
      sourceCommit: headCommit(project.repoPath),
      generatedBy: 'agent',
      model,
      autoUpdate: false,
      watchedGlobs: DOCUMENT_META[docType].watchedGlobs,
      summary: summaryOf(content),
      createdBy: 'agent',
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const cancelled = Boolean(getDocumentJob(project.id, docType, slug)?.cancelRequested);
    finishDocumentJob(project.id, docType, slug, cancelled ? 'cancelled' : 'failed', cancelled ? '用户取消' : detail);
    if (!cancelled) {
      try {
        const current = getDocument(doc.id);
        saveDocumentContent(doc.id, {
          content: current.content || `# ${title}\n\n> 生成失败：${detail}\n`,
          status: 'error',
          source: current.source,
          summary: current.summary,
          createdBy: 'agent',
        });
      } catch (saveErr) {
        console.error('[documents] failed to persist error status', saveErr);
      }
    }
    throw err;
  } finally {
    clearInterval(heartbeat);
    activeRunners.delete(key);
    if (runner) await runner.stop().catch(() => undefined);
    await removeWorktree(project.repoPath, worktree).catch(() => undefined);
    try {
      fs.rmSync(worktree, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // startup sweep retries
    }
  }
}

export async function generateAgentDocument(projectId: string, docType: DocumentType) {
  if (DOCUMENT_META[docType].mode !== 'agent') throw new Error(`文档类型 ${docType} 不支持 AI 生成`);
  const project = getProject(projectId);
  const title = `${documentTypeLabel(docType)}：${project.name}`;
  const result = await generateWithAgent(project, docType, docType, title, (evidence) =>
    documentGenerationPrompt({
      docType,
      docTitle: title,
      projectName: project.name,
      profileSummary: profileSummary(projectId),
      requiredHeadings: DOCUMENT_META[docType].requiredHeadings,
      evidence,
    }),
  );
  finishDocumentJob(project.id, docType, docType, 'completed');
  return result;
}

export async function generateLegacyRequirementsBaseline(projectId: string) {
  const project = getProject(projectId);
  const title = `现状需求基线（代码推断）：${project.name}`;
  const result = await generateWithAgent(project, 'requirements', 'legacy-baseline', title, (evidence) =>
    legacyRequirementsBaselinePrompt({
      projectName: project.name,
      profileSummary: profileSummary(projectId),
      evidence,
    }),
  );
  finishDocumentJob(project.id, 'requirements', 'legacy-baseline', 'completed');
  return result;
}

export async function cancelDocumentGeneration(projectId: string, docType: DocumentType, slug: string) {
  const job = requestDocumentCancel(projectId, docType, slug);
  await activeRunners.get(keyOf(projectId, docType, slug))?.stop().catch(() => undefined);
  return job;
}

export async function onboardDocuments(projectId: string): Promise<void> {
  await generateAgentDocument(projectId, 'architecture');
  try {
    await generateLegacyRequirementsBaseline(projectId);
  } catch (err) {
    console.error('[documents] legacy requirements baseline failed', err);
  }
}
