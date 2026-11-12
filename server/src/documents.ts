import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type {
  DocumentConsistencyIssue,
  DocumentImpact,
  DocumentMetrics,
  DocumentStatus,
  DocumentSyncEntry,
  DocumentSyncPreview,
  DocumentSyncResult,
  DocumentType,
  ProjectDocument,
  Requirement,
  Story,
} from '@riccon-scrum/shared';
import {
  acceptanceForStory,
  addDocumentVersion,
  createDocument,
  getDocument,
  getDocumentBySlug,
  getDocumentSync,
  getDocumentVersion,
  getIndexEntries,
  getProject,
  getProfileRecord,
  getRequirement,
  latestRequirementVersion,
  listDependencies,
  listDocumentSections,
  listDocumentSummaries,
  listDocumentSyncs,
  listDocumentVersions,
  listDocuments,
  listRequirements,
  listRunningDocumentJobs,
  listStories,
  finishDocumentJob,
  replaceDocumentSections,
  saveDocumentSync,
  updateDocument,
} from './db';
import { bus } from './bus';
import { indexProject } from './indexer';

export const DOCUMENT_TYPES: DocumentType[] = [
  'overview',
  'requirements',
  'architecture',
  'coding-standards',
  'code-graph',
  'database',
  'api-contract',
  'test-strategy',
  'operations',
  'security',
];

export interface DocumentTypeMeta {
  label: string;
  mode: 'deterministic' | 'agent';
  autoUpdate: boolean;
  watchedGlobs: string[];
  requiredHeadings: string[];
}

export const DOCUMENT_META: Record<DocumentType, DocumentTypeMeta> = {
  overview: {
    label: '项目概览',
    mode: 'deterministic',
    autoUpdate: true,
    watchedGlobs: ['package.json', '**/package.json', 'tsconfig*.json', '**/pom.xml', '**/go.mod', '**/Cargo.toml', '**/pyproject.toml'],
    requiredHeadings: [],
  },
  requirements: {
    label: '需求文档',
    mode: 'deterministic',
    autoUpdate: true,
    watchedGlobs: [],
    requiredHeadings: [],
  },
  architecture: {
    label: '架构设计',
    mode: 'agent',
    autoUpdate: false,
    watchedGlobs: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.py', '**/*.go', '**/*.java', '**/*.rs', '**/package.json'],
    requiredHeadings: ['架构', '模块', '数据流'],
  },
  'coding-standards': {
    label: '编码规范',
    mode: 'agent',
    autoUpdate: false,
    watchedGlobs: ['.eslintrc*', 'eslint.config.*', '.prettierrc*', 'prettier.config.*', 'tsconfig*.json', '.editorconfig', 'biome.json'],
    requiredHeadings: ['规范', '规则'],
  },
  'code-graph': {
    label: '代码图谱',
    mode: 'deterministic',
    autoUpdate: true,
    watchedGlobs: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.py', '**/*.go', '**/*.java', '**/*.rs'],
    requiredHeadings: [],
  },
  database: {
    label: '数据库设计',
    mode: 'agent',
    autoUpdate: false,
    watchedGlobs: ['**/migrations/**', '**/*.sql', '**/schema.prisma', '**/schema.sql', '**/entities/**', '**/models/**'],
    requiredHeadings: ['数据', '表'],
  },
  'api-contract': {
    label: 'API 契约',
    mode: 'agent',
    autoUpdate: false,
    watchedGlobs: ['**/routes/**', '**/controllers/**', '**/*route*.ts', '**/*api*.ts', '**/openapi*', '**/swagger*'],
    requiredHeadings: ['接口', '路由'],
  },
  'test-strategy': {
    label: '测试策略',
    mode: 'agent',
    autoUpdate: false,
    watchedGlobs: ['**/*.test.*', '**/*.spec.*', '**/tests/**', 'vitest.config.*', 'jest.config.*', 'pytest.ini', '**/package.json'],
    requiredHeadings: ['测试'],
  },
  operations: {
    label: '运维部署',
    mode: 'agent',
    autoUpdate: false,
    watchedGlobs: ['Dockerfile*', 'docker-compose*', '**/k8s/**', '**/deploy/**', '.github/workflows/**', '**/scripts/**', '.env.example'],
    requiredHeadings: ['部署', '回滚'],
  },
  security: {
    label: '安全与合规',
    mode: 'agent',
    autoUpdate: false,
    watchedGlobs: ['**/auth/**', '**/middleware/**', '**/policy/**', '.env.example', '**/security/**'],
    requiredHeadings: ['安全', '密钥'],
  },
};

export function documentTypeLabel(type: DocumentType): string {
  return DOCUMENT_META[type]?.label ?? type;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function checksumOf(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

function clipText(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…（已截断）' : text;
}

export function summaryOf(markdown: string, max = 220): string {
  const body = markdown
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clipText(body, max);
}

export function headCommit(repoPath: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

function anchorOf(text: string, used: Set<string>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'section';
  let anchor = base;
  let n = 2;
  while (used.has(anchor)) anchor = `${base}-${n++}`;
  used.add(anchor);
  return anchor;
}

export interface ParsedSection {
  anchor: string;
  heading: string;
  headingPath: string;
  content: string;
  tokens: number;
}

export function parseSections(markdown: string): ParsedSection[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const headings: { index: number; level: number; title: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,4})\s+(.+?)\s*$/);
    if (m) headings.push({ index: i, level: m[1].length, title: m[2].trim() });
  }
  const used = new Set<string>();
  const out: ParsedSection[] = [];
  const intro = lines.slice(0, headings[0]?.index ?? lines.length).join('\n').trim();
  if (intro) {
    out.push({ anchor: anchorOf('overview', used), heading: '概述', headingPath: '概述', content: intro, tokens: Math.ceil(intro.length / 2) });
  }
  const stack: { level: number; title: string }[] = [];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    stack.push({ level: h.level, title: h.title });
    const end = headings[i + 1]?.index ?? lines.length;
    const content = lines.slice(h.index, end).join('\n').trim();
    out.push({
      anchor: anchorOf(h.title, used),
      heading: h.title,
      headingPath: stack.map((item) => item.title).join(' / '),
      content,
      tokens: Math.ceil(content.length / 2),
    });
  }
  if (out.length === 0 && markdown.trim()) {
    out.push({ anchor: 'content', heading: '正文', headingPath: '正文', content: markdown.trim(), tokens: Math.ceil(markdown.length / 2) });
  }
  return out;
}

export interface SaveDocumentInput {
  content: string;
  title?: string;
  summary?: string;
  status?: DocumentStatus;
  source?: ProjectDocument['source'];
  sourceCommit?: string | null;
  generatedBy?: string | null;
  model?: string | null;
  autoUpdate?: boolean;
  watchedGlobs?: string[];
  pinned?: boolean;
  createdBy?: string;
  force?: boolean;
}

export function saveDocumentContent(documentId: string, input: SaveDocumentInput): ProjectDocument {
  const cur = getDocument(documentId);
  if (cur.pinned && !input.force && input.source !== 'manual') {
    throw new Error('文档已人工锁定，请先解锁或选择覆盖');
  }
  const checksum = checksumOf(input.content);
  const ts = nowIso();
  if (cur.content === input.content && cur.checksum === checksum && cur.version > 0) {
    return updateDocument(documentId, {
      title: input.title ?? cur.title,
      summary: input.summary ?? summaryOf(input.content),
      status: input.status ?? cur.status,
      source: input.source ?? cur.source,
      sourceCommit: input.sourceCommit !== undefined ? input.sourceCommit : cur.sourceCommit,
      generatedBy: input.generatedBy !== undefined ? input.generatedBy : cur.generatedBy,
      model: input.model !== undefined ? input.model : cur.model,
      autoUpdate: input.autoUpdate !== undefined ? input.autoUpdate : cur.autoUpdate,
      watchedGlobs: input.watchedGlobs ?? cur.watchedGlobs,
      pinned: input.pinned,
      checksum,
      error: null,
      lastGeneratedAt: ts,
    });
  }
  const version = cur.version + 1;
  const next = updateDocument(documentId, {
    title: input.title ?? cur.title,
    content: input.content,
    summary: input.summary ?? summaryOf(input.content),
    version,
    status: input.status ?? cur.status,
    source: input.source ?? cur.source,
    sourceCommit: input.sourceCommit !== undefined ? input.sourceCommit : cur.sourceCommit,
    generatedBy: input.generatedBy !== undefined ? input.generatedBy : cur.generatedBy,
    model: input.model !== undefined ? input.model : cur.model,
    autoUpdate: input.autoUpdate !== undefined ? input.autoUpdate : cur.autoUpdate,
    watchedGlobs: input.watchedGlobs ?? cur.watchedGlobs,
    pinned: input.pinned,
    checksum,
    error: null,
    lastGeneratedAt: ts,
  });
  addDocumentVersion({
    documentId,
    version,
    content: input.content,
    summary: next.summary,
    sourceCommit: next.sourceCommit,
    model: next.model,
    createdBy: input.createdBy ?? 'system',
  });
  replaceDocumentSections(documentId, version, parseSections(input.content));
  bus.publish(documentId, {
    type: 'document.generated',
    documentId,
    docType: next.docType,
    slug: next.slug,
    version,
    status: next.status,
  });
  return next;
}

export function setDocumentStatus(documentId: string, status: DocumentStatus, error?: string | null): ProjectDocument {
  const cur = getDocument(documentId);
  const next = updateDocument(documentId, { status, error: error ?? null });
  if (next.status !== cur.status) {
    bus.publish(documentId, {
      type: 'document.status',
      documentId,
      docType: next.docType,
      slug: next.slug,
      from: cur.status,
      to: next.status,
    });
  }
  return next;
}

export function ensureDocument(projectId: string, docType: DocumentType, slug: string, title: string): ProjectDocument {
  const existing = getDocumentBySlug(projectId, docType, slug);
  if (existing) return existing;
  const meta = DOCUMENT_META[docType];
  return createDocument({
    projectId,
    docType,
    slug,
    title,
    status: 'draft',
    source: 'manual',
    autoUpdate: meta.autoUpdate,
    watchedGlobs: meta.watchedGlobs,
  });
}

export function listProjectDocuments(projectId: string) {
  ensureDocumentRegistry(projectId);
  return listDocumentSummaries(projectId);
}

export function ensureDocumentRegistry(projectId: string): void {
  if (listDocuments(projectId).length > 0) return;
  const project = getProject(projectId);
  const record = getProfileRecord(projectId);
  if (record.architecture) {
    const doc = ensureDocument(projectId, 'architecture', 'architecture', `架构设计：${project.name}`);
    saveDocumentContent(doc.id, {
      content: record.architecture,
      status: 'published',
      source: 'onboard',
      generatedBy: 'onboard',
      sourceCommit: headCommit(project.repoPath),
      autoUpdate: false,
      watchedGlobs: DOCUMENT_META.architecture.watchedGlobs,
      summary: summaryOf(record.architecture),
    });
  }
  if (record.profile) generateOverviewDocument(projectId);
  if (getIndexEntries(projectId).length > 0) generateCodeGraphDocument(projectId);
  generateRequirementDocuments(projectId);
}

export function generateOverviewDocument(projectId: string): ProjectDocument | null {
  const project = getProject(projectId);
  const record = getProfileRecord(projectId);
  const p = record.profile;
  const lines = [
    `# 项目概览：${project.name}`,
    '',
    `> 仓库：\`${project.repoPath}\` · 默认分支：\`${project.defaultBranch}\` · 生成方式：确定性扫描 · 更新时间：${nowIso()}`,
    '',
  ];
  if (p) {
    lines.push(
      '## 技术栈',
      '',
      `- 语言：${p.languages.join('、') || '未识别'}`,
      `- 框架/工具：${p.frameworks.join('、') || '未识别'}`,
      `- 包管理器：${p.packageManager ?? '未识别'}`,
      `- 清单：${p.manifests.join('、') || '未识别'}`,
      `- 主要依赖：${p.dependencies.slice(0, 15).join('、') || '未识别'}`,
      '',
      '## 目录结构',
      '',
      ...p.structure.slice(0, 60).map((item) => `- \`${item}\``),
      '',
      '## 常用命令',
      '',
      `- 测试：${p.testCommands.map((c) => `\`${c}\``).join('、') || '未发现'}`,
      `- 构建：${p.buildCommands.map((c) => `\`${c}\``).join('、') || '未发现'}`,
      p.scripts && Object.keys(p.scripts).length
        ? `- package scripts：${Object.entries(p.scripts).slice(0, 20).map(([k, v]) => `\`${k}\` → \`${v}\``).join('；')}`
        : '',
      '',
      '## 入口与关键文件',
      '',
      ...(p.entryPoints.length ? p.entryPoints.map((item) => `- \`${item}\``) : ['- 未自动识别入口，请查看目录结构与清单文件。']),
    );
  } else {
    lines.push('## 项目状态', '', '- 尚未完成入驻扫描，技术栈与命令信息缺失。');
  }
  if (record.baseline.length > 0) {
    lines.push('', '## 回归基线', '', ...record.baseline.map((b) => `- ${b.ok ? 'PASS' : 'FAIL'} \`${b.command}\`：${clipText(b.output.replace(/\n/g, ' '), 180)}`));
  }
  lines.push(
    '',
    '## 维护提示',
    '',
    '- 本文件由平台确定性生成，技术栈或命令变化后可重新生成。',
    '- 架构、编码规范、数据库等规范型文档请以文档中心的人工发布版本为准。',
  );
  const content = lines.filter((line) => line !== undefined).join('\n');
  const doc = ensureDocument(projectId, 'overview', 'overview', `项目概览：${project.name}`);
  return saveDocumentContent(doc.id, {
    content,
    status: 'published',
    source: 'onboard',
    generatedBy: 'deterministic',
    sourceCommit: headCommit(project.repoPath),
    autoUpdate: true,
    watchedGlobs: DOCUMENT_META.overview.watchedGlobs,
    summary: summaryOf(content),
  });
}

export function requirementDocSlug(requirementId: string): string {
  return `req-${requirementId.slice(0, 8)}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false });
}

function uniqueList(items: (string | null | undefined)[]): string[] {
  return [...new Set(items.map((item) => (item ?? '').trim()).filter(Boolean))];
}

function buildRequirementMarkdown(requirement: Requirement, version: ReturnType<typeof latestRequirementVersion>, stories: Story[]) {
  const project = getProject(requirement.projectId);
  const draft = version?.draft ?? null;
  const allRequirements = listRequirements(requirement.projectId);
  const requirementTitle = new Map(allRequirements.map((item) => [item.id, item.title]));
  const allStories = listStories(requirement.projectId);
  const storyTitle = new Map(allStories.map((item) => [item.id, item.title]));
  const children = allRequirements.filter((item) => item.parentRequirementId === requirement.id);
  const goals = draft?.goals.length ? draft.goals : requirement.intake?.goal ? [requirement.intake.goal] : [];
  const nonGoals = draft?.nonGoals.length ? draft.nonGoals : requirement.intake?.nonGoals ? [requirement.intake.nonGoals] : [];
  const personas = draft?.personas.length ? draft.personas : requirement.intake?.users ? [requirement.intake.users] : [];
  const assumptions = draft?.assumptions ?? [];
  const openQuestions = draft?.openQuestions ?? [];
  const storiesWithClauses = draft?.stories ?? [];
  const clauses = uniqueList([
    ...storiesWithClauses.flatMap((story) => story.clauses),
    ...stories.map((story) => story.sourceClause),
  ]);
  const effectiveClauses = clauses.length > 0 ? clauses : goals.map((_, index) => `R1.${index + 1}`);

  const reqDeps = listDependencies(requirement.projectId, 'requirement').filter(
    (dep) => dep.predecessorId === requirement.id || dep.successorId === requirement.id,
  );
  const reqDepLines = reqDeps.map((dep) => {
    const own = requirement.id === dep.successorId;
    const otherId = own ? dep.predecessorId : dep.successorId;
    return `- ${own ? '前置' : '后续'}需求：${requirementTitle.get(otherId) ?? otherId.slice(0, 8)}`;
  });
  const storyIds = new Set(stories.map((story) => story.id));
  const storyDeps = listDependencies(requirement.projectId, 'story').filter(
    (dep) => storyIds.has(dep.predecessorId) || storyIds.has(dep.successorId),
  );
  const storyDepLines = storyDeps.map((dep) => {
    const own = storyIds.has(dep.successorId);
    const otherId = own ? dep.predecessorId : dep.successorId;
    return `- ${own ? '前置' : '后续'}故事：${storyTitle.get(otherId) ?? otherId.slice(0, 8)}`;
  });

  const lines = [
    `# 需求文档：${requirement.title}`,
    '',
    `> 需求 ID：\`${requirement.id}\` · 状态：**${requirement.status}** · 版本：v${version?.version ?? requirement.approvedVersion ?? 0} · 来源：${requirement.source}`,
    `> 项目：${project.name} · 文档生成：${fmtDate(nowIso())} · 数据来源：需求工作台已批准版本`,
    requirement.derivedFromRequirementId
      ? `> 派生自：${requirementTitle.get(requirement.derivedFromRequirementId) ?? requirement.derivedFromRequirementId}`
      : '',
    requirement.changeRequestId ? `> 变更单：\`${requirement.changeRequestId}\`` : '',
    '',
    '## 1. 背景与目标',
    '',
    requirement.intake?.goal ? `- 业务目标：${requirement.intake.goal}` : '',
    ...(goals.length ? goals.map((goal) => `- 目标：${goal}`) : ['- 目标：待补充']),
    requirement.intake?.successMetrics ? `- 成功指标：${requirement.intake.successMetrics}` : '',
    '',
    '## 2. 用户与场景',
    '',
    ...(personas.length ? personas.map((persona) => `- 目标用户：${persona}`) : ['- 目标用户：待补充']),
    requirement.intake?.examples ? `- 典型场景：${requirement.intake.examples}` : '',
    '',
    '## 3. 范围与非目标',
    '',
    ...(nonGoals.length ? nonGoals.map((item) => `- 非目标：${item}`) : ['- 非目标：未显式声明']),
    '',
    '## 4. 约束与假设',
    '',
    requirement.intake?.constraints ? `- 约束：${requirement.intake.constraints}` : '',
    ...(assumptions.length ? assumptions.map((item) => `- 假设：${item}`) : ['- 假设：无额外假设']),
    ...(openQuestions.length ? openQuestions.map((item) => `- 开放问题：${item}`) : []),
    '',
    '## 5. 需求条款',
    '',
    ...effectiveClauses.map((clause, index) => {
      const matched = storiesWithClauses.find((story) => story.clauses.includes(clause));
      return `- **${clause}**：${matched?.title ?? goals[index] ?? '见用户故事与验收标准'}`;
    }),
    '',
    '## 6. 用户故事与验收标准',
    '',
  ];

  for (const story of stories) {
    const acs = acceptanceForStory(story.id);
    lines.push(
      `### ${story.sourceStoryKey ?? story.id.slice(0, 8)} ${story.title}`,
      '',
      `- 状态：${story.status}`,
      story.sourceClause ? `- 来源条款：${story.sourceClause}` : '',
      `- 分类：${story.categoryId ? '已分类' : '未分类'}`,
      '',
      '#### 验收标准',
      '',
    );
    if (acs.length > 0) {
      for (const ac of acs) {
        lines.push(
          `- **${ac.acId}**（${ac.status}）`,
          `  - Given：${ac.given}`,
          `  - When：${ac.when}`,
          `  - Then：${ac.then}`,
          `  - Test：${ac.test ?? '未配置'}`,
        );
      }
    } else {
      lines.push(story.acceptanceCriteria ? story.acceptanceCriteria : '（未提供结构化验收标准）');
    }
    lines.push('');
  }
  if (stories.length === 0) lines.push('（该需求尚未物化用户故事）', '');

  if (children.length > 0) {
    lines.push('## 7. 子需求', '', ...children.map((child) => `- ${child.title}（${child.status}）`), '');
  } else {
    lines.push('## 7. 子需求', '', '- 无（本需求未拆分）', '');
  }

  lines.push(
    '## 8. 依赖与风险',
    '',
    ...(reqDepLines.length || storyDepLines.length ? [...reqDepLines, ...storyDepLines] : ['- 未声明依赖']),
    ...(openQuestions.length ? openQuestions.map((item) => `- 风险/待确认：${item}`) : []),
    '',
    '## 9. 变更历史',
    '',
    `- v${version?.version ?? 0}：当前批准版本，状态 ${requirement.status}，最近更新 ${fmtDate(requirement.updatedAt)}。`,
    requirement.source === 'change_request' ? '- 来源：需求变更单派生。' : '',
    requirement.source === 'decomposition' ? '- 来源：需求拆分。' : '',
    '',
    '## 10. 追溯矩阵',
    '',
    '| 条款 | 用户故事 | AC | 测试映射 | AC 状态 |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const story of stories) {
    const acs = acceptanceForStory(story.id);
    if (acs.length === 0) {
      lines.push(`| ${story.sourceClause || '—'} | ${story.title} | — | — | — |`);
      continue;
    }
    for (const ac of acs) {
      lines.push(`| ${story.sourceClause || '—'} | ${story.title} | ${ac.acId} | ${ac.test ?? '—'} | ${ac.status} |`);
    }
  }
  lines.push('', '> 本文档由需求工作台数据确定性生成；修改需求请回到需求工作台，不要直接编辑后反向修改平台数据。');

  const content = lines.filter((line) => line !== undefined).join('\n');
  return { content, summary: summaryOf(content) };
}

export function generateRequirementDocument(requirementId: string): ProjectDocument | null {
  const requirement = getRequirement(requirementId);
  if (!['approved', 'decomposed', 'split'].includes(requirement.status)) return null;
  const version = latestRequirementVersion(requirementId);
  if (!version) return null;
  const stories = listStories(requirement.projectId).filter((story) => story.requirementId === requirementId);
  const { content, summary } = buildRequirementMarkdown(requirement, version, stories);
  const doc = ensureDocument(
    requirement.projectId,
    'requirements',
    requirementDocSlug(requirement.id),
    `需求文档：${requirement.title}`,
  );
  return saveDocumentContent(doc.id, {
    content,
    title: `需求文档：${requirement.title}`,
    status: 'published',
    source: 'requirement',
    generatedBy: 'deterministic',
    sourceCommit: null,
    autoUpdate: true,
    watchedGlobs: [],
    summary,
    createdBy: 'requirement',
    force: true,
  });
}

function generateRequirementIndex(projectId: string): ProjectDocument | null {
  const project = getProject(projectId);
  const requirements = listRequirements(projectId).filter((item) => item.status !== 'archived');
  const docs = listDocuments(projectId).filter(
    (doc) => doc.docType === 'requirements' && doc.slug !== 'index' && doc.slug !== 'legacy-baseline' && doc.status !== 'archived',
  );
  const docBySlug = new Map(docs.map((doc) => [doc.slug, doc]));
  const lines = [
    '# 需求文档索引',
    '',
    `> 项目：${project.name} · 生成方式：确定性编译 · 更新时间：${fmtDate(nowIso())}`,
    '',
    '## 已批准需求',
    '',
    '| 需求 | 状态 | 版本 | 故事数 | 文档 |',
    '| --- | --- | --- | --- | --- |',
  ];
  const relevant = requirements.filter((item) => ['approved', 'decomposed', 'split'].includes(item.status));
  for (const requirement of relevant) {
    const slug = requirementDocSlug(requirement.id);
    const doc = docBySlug.get(slug);
    const storyCount = listStories(projectId).filter((story) => story.requirementId === requirement.id).length;
    lines.push(
      `| ${requirement.title} | ${requirement.status} | v${requirement.approvedVersion ?? requirement.currentVersion} | ${storyCount} | ${doc ? `[${slug}](./${slug}.md)` : '—'} |`,
    );
  }
  if (relevant.length === 0) lines.push('| 尚无已批准需求 | — | — | — | — |');
  const baseline = docBySlug.get('legacy-baseline') ?? getDocumentBySlug(projectId, 'requirements', 'legacy-baseline');
  if (baseline) {
    lines.push('', '## 现状需求基线', '', '- [legacy-baseline](./legacy-baseline.md)：老项目代码推断基线，待人工确认。');
  }
  lines.push(
    '',
    '## 追溯约定',
    '',
    '- 需求条款 `R1.x` 由需求工作台批准版本生成，用户故事带 `sourceClause`。',
    '- 每条 AC 必须带测试映射，DoD 输出命中测试名后记录逐条证据。',
    '- 需求变更请通过变更单/修订流程，不直接编辑本文档。',
  );
  const content = lines.join('\n');
  const doc = ensureDocument(projectId, 'requirements', 'index', `需求文档索引：${project.name}`);
  return saveDocumentContent(doc.id, {
    content,
    status: 'published',
    source: 'requirement',
    generatedBy: 'deterministic',
    sourceCommit: null,
    autoUpdate: true,
    watchedGlobs: [],
    summary: summaryOf(content),
    createdBy: 'requirement',
    force: true,
  });
}

export function generateRequirementDocuments(projectId: string): number {
  const requirements = listRequirements(projectId).filter(
    (item) => ['approved', 'decomposed', 'split'].includes(item.status) && item.currentVersion > 0,
  );
  let count = 0;
  for (const requirement of requirements) {
    try {
      if (generateRequirementDocument(requirement.id)) count++;
    } catch (err) {
      console.error('[documents] requirement doc failed', requirement.id, err);
    }
  }
  generateRequirementIndex(projectId);
  return count;
}

function moduleOf(filePath: string): string {
  const parts = filePath.split('/');
  if (parts.length === 1) return '(root)';
  if (['server', 'web', 'shared', 'packages', 'apps'].includes(parts[0]) && parts.length > 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0];
}

function resolveLocalImport(fromPath: string, spec: string, files: Set<string>): string | null {
  if (spec.startsWith('@riccon-scrum/')) {
    return files.has('shared/src/index.ts') ? 'shared/src/index.ts' : null;
  }
  if (!spec.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), spec));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.py`,
    `${base}.go`,
    `${base}.java`,
    `${base}.rs`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
  ];
  const stripped = base.replace(/\.(js|jsx|mjs)$/, '');
  candidates.push(`${stripped}.ts`, `${stripped}.tsx`);
  return candidates.find((candidate) => files.has(candidate)) ?? null;
}

export function generateCodeGraphDocument(projectId: string): ProjectDocument | null {
  const project = getProject(projectId);
  const entries = getIndexEntries(projectId);
  const profile = getProfileRecord(projectId).profile;
  if (entries.length === 0) return null;
  const files = new Set(entries.map((entry) => entry.path));
  const modules = new Map<string, { files: number; symbols: number }>();
  const edgeMap = new Map<string, number>();
  const importDetails: string[] = [];
  for (const entry of entries) {
    const fromModule = moduleOf(entry.path);
    const stat = modules.get(fromModule) ?? { files: 0, symbols: 0 };
    stat.files++;
    stat.symbols += entry.symbols.length;
    modules.set(fromModule, stat);
    for (const spec of entry.imports ?? []) {
      const target = resolveLocalImport(entry.path, spec, files);
      if (!target) continue;
      const toModule = moduleOf(target);
      if (toModule === fromModule) {
        importDetails.push(`- \`${entry.path}\` → \`${target}\`（模块内）`);
        continue;
      }
      const key = `${fromModule}→${toModule}`;
      edgeMap.set(key, (edgeMap.get(key) ?? 0) + 1);
      importDetails.push(`- \`${entry.path}\` → \`${target}\``);
    }
  }
  const sortedModules = [...modules.entries()].sort((a, b) => b[1].files - a[1].files);
  const topModules = sortedModules.slice(0, 30);
  const ids = new Map(topModules.map(([name], index) => [name, `m${index}`]));
  const edgeLines: string[] = [];
  for (const [key, count] of [...edgeMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)) {
    const [from, to] = key.split('→');
    const fromId = ids.get(from);
    const toId = ids.get(to);
    if (!fromId || !toId) continue;
    edgeLines.push(`  ${fromId} -->|${count}| ${toId}`);
  }
  const graphLines = [
    '```mermaid',
    'flowchart LR',
    ...topModules.map(([name, stat], index) => `  m${index}["${name}<br/>${stat.files} files · ${stat.symbols} symbols"]`),
    ...edgeLines,
    '```',
  ];
  const languageCounts = new Map<string, number>();
  for (const entry of entries) languageCounts.set(entry.language, (languageCounts.get(entry.language) ?? 0) + 1);
  const lines = [
    `# 代码图谱：${project.name}`,
    '',
    `> 生成方式：确定性代码索引 · 文件 ${entries.length} 个 · 模块 ${modules.size} 个 · 更新时间：${fmtDate(nowIso())}`,
    '',
    '## 索引概览',
    '',
    ...sortedModules.slice(0, 20).map(([name, stat]) => `- \`${name}\`：${stat.files} 个文件，${stat.symbols} 个符号`),
    '',
    '## 语言分布',
    '',
    ...[...languageCounts.entries()].sort((a, b) => b[1] - a[1]).map(([language, count]) => `- ${language}：${count} 个文件`),
    '',
    '## 模块依赖图',
    '',
    ...(edgeLines.length ? graphLines : ['（未识别到跨模块本地依赖；可能使用了路径别名或动态加载。）']),
    '',
    '## 关键入口',
    '',
    ...(profile?.entryPoints.length ? profile.entryPoints.map((entry) => `- \`${entry}\``) : ['- 未自动识别入口。']),
    '',
    '## 依赖明细（节选）',
    '',
    ...(importDetails.length ? importDetails.slice(0, 40) : ['- 无本地导入边。']),
    '',
    '## 维护建议',
    '',
    '- 本文件由代码索引确定性生成，不包含语义推断；导入解析仅覆盖相对路径与 `@riccon-scrum/*` 内部别名。',
    '- 修改模块边界或入口后请重新建立索引并刷新文档。',
  ];
  const content = lines.join('\n');
  const doc = ensureDocument(projectId, 'code-graph', 'code-graph', `代码图谱：${project.name}`);
  return saveDocumentContent(doc.id, {
    content,
    status: 'published',
    source: 'onboard',
    generatedBy: 'deterministic',
    sourceCommit: headCommit(project.repoPath),
    autoUpdate: true,
    watchedGlobs: DOCUMENT_META['code-graph'].watchedGlobs,
    summary: summaryOf(content),
  });
}

export function normalizeSyncDir(targetDir?: string): string {
  const dir = (targetDir ?? 'docs/riccon').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!dir || dir.includes('..') || path.isAbsolute(dir)) throw new Error('同步目录必须是仓库内的相对路径');
  return dir;
}

function syncTargetPath(doc: ProjectDocument, targetDir: string): string {
  return `${targetDir}/${doc.docType}/${doc.slug}.md`;
}

function renderSyncFile(doc: ProjectDocument): string {
  return [
    '---',
    `docId: ${doc.id}`,
    `docType: ${doc.docType}`,
    `slug: ${doc.slug}`,
    `title: ${JSON.stringify(doc.title)}`,
    `version: ${doc.version}`,
    `sourceCommit: ${doc.sourceCommit ?? ''}`,
    `generatedAt: ${doc.lastGeneratedAt ?? doc.updatedAt}`,
    'managedBy: riccon-scrum',
    '---',
    '',
    doc.content.endsWith('\n') ? doc.content : doc.content + '\n',
  ].join('\n');
}

function buildSyncEntries(projectId: string, targetDir: string): DocumentSyncEntry[] {
  const project = getProject(projectId);
  const docs = listDocuments(projectId);
  const syncs = new Map(listDocumentSyncs(projectId).map((item) => [item.documentId, item]));
  return docs.map((doc) => {
    const targetPath = syncTargetPath(doc, targetDir);
    const fileContent = renderSyncFile(doc);
    const contentChecksum = checksumOf(fileContent);
    const abs = path.join(project.repoPath, targetPath);
    let fileChecksum: string | null = null;
    let status: DocumentSyncEntry['status'] = 'new';
    try {
      const raw = fs.readFileSync(abs, 'utf8');
      fileChecksum = checksumOf(raw);
      if (raw === fileContent) {
        status = 'unchanged';
      } else {
        const state = syncs.get(doc.id);
        const managed = raw.includes('managedBy: riccon-scrum') && raw.includes(`docId: ${doc.id}`);
        if (state) status = state.checksum === fileChecksum ? 'modified' : 'conflict';
        else if (managed) status = 'modified';
        else status = 'conflict';
      }
    } catch {
      status = 'new';
    }
    return {
      documentId: doc.id,
      docType: doc.docType,
      slug: doc.slug,
      title: doc.title,
      version: doc.version,
      targetPath,
      status,
      contentChecksum,
      fileChecksum,
    };
  });
}

function syncSummary(entries: DocumentSyncEntry[]) {
  return {
    new: entries.filter((entry) => entry.status === 'new').length,
    modified: entries.filter((entry) => entry.status === 'modified').length,
    unchanged: entries.filter((entry) => entry.status === 'unchanged').length,
    conflict: entries.filter((entry) => entry.status === 'conflict').length,
  };
}

export function previewDocumentSync(projectId: string, targetDir?: string): DocumentSyncPreview {
  const dir = normalizeSyncDir(targetDir);
  const entries = buildSyncEntries(projectId, dir);
  return { projectId, targetDir: dir, entries, summary: syncSummary(entries) };
}

export function applyDocumentSync(
  projectId: string,
  opts: { targetDir?: string; force?: boolean } = {},
): DocumentSyncResult {
  const dir = normalizeSyncDir(opts.targetDir);
  const project = getProject(projectId);
  const entries = buildSyncEntries(projectId, dir);
  let written = 0;
  let skipped = 0;
  for (const entry of entries) {
    if (entry.status === 'unchanged') continue;
    if (entry.status === 'conflict' && !opts.force) {
      skipped++;
      continue;
    }
    const doc = getDocument(entry.documentId);
    const abs = path.join(project.repoPath, entry.targetPath);
    const relative = path.relative(project.repoPath, abs);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('同步路径越界');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const temp = `${abs}.${process.pid}.tmp`;
    const content = renderSyncFile(doc);
    fs.writeFileSync(temp, content, 'utf8');
    fs.renameSync(temp, abs);
    saveDocumentSync(doc.id, projectId, entry.targetPath, checksumOf(content));
    written++;
  }
  bus.publish(projectId, {
    type: 'document.synced',
    projectId,
    written,
    conflicts: entries.filter((entry) => entry.status === 'conflict').length,
  });
  const nextEntries = buildSyncEntries(projectId, dir);
  return {
    projectId,
    targetDir: dir,
    entries: nextEntries,
    summary: syncSummary(nextEntries),
    written,
    skipped,
  };
}

export function publishDocument(documentId: string): ProjectDocument {
  return setDocumentStatus(documentId, 'published', null);
}

export function editDocument(documentId: string, content: string, title?: string, createdBy = 'human'): ProjectDocument {
  if (!content.trim()) throw new Error('文档内容不能为空');
  return saveDocumentContent(documentId, {
    content,
    title,
    status: 'draft',
    source: 'manual',
    generatedBy: createdBy,
    pinned: true,
    force: true,
    createdBy,
  });
}

export function setDocumentPinned(documentId: string, pinned: boolean): ProjectDocument {
  const doc = getDocument(documentId);
  return updateDocument(doc.id, { pinned });
}

export function rollbackDocument(documentId: string, version: number): ProjectDocument {
  const target = getDocumentVersion(documentId, version);
  return saveDocumentContent(documentId, {
    content: target.content,
    summary: target.summary,
    status: 'draft',
    source: 'manual',
    sourceCommit: target.sourceCommit,
    model: target.model,
    pinned: true,
    force: true,
    createdBy: 'human',
  });
}

export function documentVersions(documentId: string) {
  return listDocumentVersions(documentId);
}

export function documentMetrics(projectId: string): DocumentMetrics {
  ensureDocumentRegistry(projectId);
  const docs = listDocuments(projectId);
  const syncs = new Set(listDocumentSyncs(projectId).map((item) => item.documentId));
  const byType = Object.fromEntries(DOCUMENT_TYPES.map((type) => [type, 0])) as Record<DocumentType, number>;
  for (const doc of docs) byType[doc.docType] = (byType[doc.docType] ?? 0) + 1;
  return {
    total: docs.length,
    published: docs.filter((doc) => doc.status === 'published').length,
    draft: docs.filter((doc) => doc.status === 'draft').length,
    stale: docs.filter((doc) => doc.status === 'stale').length,
    error: docs.filter((doc) => doc.status === 'error').length,
    synced: docs.filter((doc) => syncs.has(doc.id)).length,
    autoUpdate: docs.filter((doc) => doc.autoUpdate).length,
    pinned: docs.filter((doc) => doc.pinned).length,
    byType,
  };
}

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

function matchesGlobs(file: string, globs: string[]): boolean {
  return globs.some((glob) => globToRegex(glob).test(file));
}

function changedFilesSince(repoPath: string, commit: string): string[] | null {
  try {
    const output = execFileSync('git', ['diff', '--name-only', `${commit}..HEAD`], {
      cwd: repoPath,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    return output.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

export function refreshDocumentFreshness(projectId: string, auto = true): number {
  const project = getProject(projectId);
  const head = headCommit(project.repoPath);
  if (!head) return 0;
  const docs = listDocuments(projectId);
  let changed = 0;
  for (const doc of docs) {
    if (!doc.sourceCommit || doc.sourceCommit === head || doc.watchedGlobs.length === 0) continue;
    const files = changedFilesSince(project.repoPath, doc.sourceCommit);
    if (!files) continue;
    const hits = files.filter((file) => matchesGlobs(file, doc.watchedGlobs));
    if (hits.length === 0) continue;
    if (auto && doc.autoUpdate && (doc.docType === 'overview' || doc.docType === 'code-graph')) {
      try {
        if (doc.docType === 'overview') generateOverviewDocument(projectId);
        else generateCodeGraphDocument(projectId);
        changed++;
      } catch (err) {
        console.error('[documents] auto refresh failed', doc.docType, err);
      }
      continue;
    }
    if (doc.status === 'published' || doc.status === 'draft') {
      setDocumentStatus(doc.id, 'stale');
      changed++;
    }
  }
  return changed;
}

export async function refreshProjectDocuments(projectId: string, auto = true) {
  const project = getProject(projectId);
  if (auto) {
    try {
      await indexProject(projectId, project.repoPath);
    } catch (err) {
      console.error('[documents] index refresh failed', err);
    }
  }
  generateOverviewDocument(projectId);
  generateCodeGraphDocument(projectId);
  generateRequirementDocuments(projectId);
  refreshDocumentFreshness(projectId, auto);
  return documentMetrics(projectId);
}

export function documentConsistency(projectId: string): DocumentConsistencyIssue[] {
  ensureDocumentRegistry(projectId);
  const project = getProject(projectId);
  const docs = listDocuments(projectId);
  const issues: DocumentConsistencyIssue[] = [];
  const reqDocs = new Map(
    docs.filter((doc) => doc.docType === 'requirements').map((doc) => [doc.slug, doc]),
  );
  for (const requirement of listRequirements(projectId)) {
    if (!['approved', 'decomposed', 'split'].includes(requirement.status)) continue;
    const slug = requirementDocSlug(requirement.id);
    const doc = reqDocs.get(slug);
    if (!doc) {
      issues.push({
        severity: 'error',
        code: 'requirement-doc-missing',
        message: `需求「${requirement.title}」缺少规范需求文档`,
        documentId: null,
        docType: 'requirements',
        slug,
        ref: requirement.id,
      });
      continue;
    }
    const stories = listStories(projectId).filter((story) => story.requirementId === requirement.id);
    for (const story of stories) {
      const marker = story.sourceStoryKey ?? story.title;
      if (!doc.content.includes(marker)) {
        issues.push({
          severity: 'error',
          code: 'requirement-story-missing',
          message: `需求文档未包含故事「${story.title}」`,
          documentId: doc.id,
          docType: 'requirements',
          slug,
          ref: story.id,
        });
      }
    }
  }

  const architecture = docs.find((doc) => doc.docType === 'architecture');
  const codeGraph = docs.find((doc) => doc.docType === 'code-graph');
  if (architecture && codeGraph) {
    for (const entry of getProfileRecord(projectId).profile?.entryPoints ?? []) {
      if (!codeGraph.content.includes(entry)) {
        issues.push({
          severity: 'warn',
          code: 'code-graph-entry-missing',
          message: `代码图谱未包含入口文件 ${entry}`,
          documentId: codeGraph.id,
          docType: 'code-graph',
          slug: codeGraph.slug,
          ref: entry,
        });
      }
    }
  }

  const apiDoc = docs.find((doc) => doc.docType === 'api-contract');
  if (apiDoc) {
    const routeFiles = getIndexEntries(projectId)
      .filter((entry) => /(^|\/)(routes?|controllers?|api)(\/|\.|$)/i.test(entry.path))
      .slice(0, 8);
    const routes = new Set<string>();
    for (const file of routeFiles) {
      try {
        const content = fs.readFileSync(path.join(project.repoPath, file.path), 'utf8');
        for (const match of content.matchAll(/['"`](\/api\/[A-Za-z0-9_\-/:{}]+)['"`]/g)) routes.add(match[1]);
      } catch {
        // ignore unreadable
      }
    }
    for (const route of [...routes].slice(0, 30)) {
      if (!apiDoc.content.includes(route)) {
        issues.push({
          severity: 'warn',
          code: 'api-route-missing',
          message: `API 契约文档未覆盖路由 ${route}`,
          documentId: apiDoc.id,
          docType: 'api-contract',
          slug: apiDoc.slug,
          ref: route,
        });
      }
    }
  }

  const databaseDoc = docs.find((doc) => doc.docType === 'database');
  if (databaseDoc) {
    const schemaFiles = getIndexEntries(projectId)
      .filter((entry) => /migrations?\/|\.sql$|schema\.prisma|schema\.sql/i.test(entry.path))
      .slice(0, 8);
    const tables = new Set<string>();
    for (const file of schemaFiles) {
      try {
        const content = fs.readFileSync(path.join(project.repoPath, file.path), 'utf8');
        for (const match of content.matchAll(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+[`"[]?([A-Za-z_][\w.]*)/gi)) tables.add(match[1]);
        for (const match of content.matchAll(/model\s+([A-Za-z_]\w*)\s*\{/g)) tables.add(match[1]);
      } catch {
        // ignore unreadable
      }
    }
    for (const table of [...tables].slice(0, 30)) {
      if (!databaseDoc.content.includes(table)) {
        issues.push({
          severity: 'warn',
          code: 'database-table-missing',
          message: `数据库文档未覆盖表/模型 ${table}`,
          documentId: databaseDoc.id,
          docType: 'database',
          slug: databaseDoc.slug,
          ref: table,
        });
      }
    }
  }
  return issues.slice(0, 40);
}

export function documentImpact(projectId: string, requirementId: string): DocumentImpact[] {
  ensureDocumentRegistry(projectId);
  const requirement = getRequirement(requirementId);
  const docs = listDocuments(projectId);
  const out: DocumentImpact[] = [];
  const slug = requirementDocSlug(requirement.id);
  const reqDoc = docs.find((doc) => doc.docType === 'requirements' && doc.slug === slug);
  if (reqDoc) {
    out.push({
      documentId: reqDoc.id,
      docType: reqDoc.docType,
      slug: reqDoc.slug,
      title: reqDoc.title,
      version: reqDoc.version,
      status: reqDoc.status,
      reason: '需求主文档需要随变更重新编译',
    });
  }
  const indexDoc = docs.find((doc) => doc.docType === 'requirements' && doc.slug === 'index');
  if (indexDoc) {
    out.push({
      documentId: indexDoc.id,
      docType: indexDoc.docType,
      slug: indexDoc.slug,
      title: indexDoc.title,
      version: indexDoc.version,
      status: indexDoc.status,
      reason: '需求索引与追溯矩阵需要更新',
    });
  }
  const affectedTypes: DocumentType[] = ['architecture', 'coding-standards', 'database', 'api-contract', 'test-strategy', 'operations'];
  for (const type of affectedTypes) {
    for (const doc of docs.filter((item) => item.docType === type)) {
      out.push({
        documentId: doc.id,
        docType: doc.docType,
        slug: doc.slug,
        title: doc.title,
        version: doc.version,
        status: doc.status,
        reason: `需求「${requirement.title}」变更可能影响该文档，请评估并重新生成`,
      });
    }
  }
  return out.slice(0, 12);
}

export function cleanupDocumentState(): void {
  for (const job of listRunningDocumentJobs()) {
    finishDocumentJob(job.projectId, job.docType, job.slug, 'failed', '服务重启，文档生成任务已中断');
  }
  const tmp = os.tmpdir();
  for (const name of fs.readdirSync(tmp)) {
    if (!name.startsWith('riccon-doc-')) continue;
    try {
      fs.rmSync(path.join(tmp, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // next sweep retries
    }
  }
}
