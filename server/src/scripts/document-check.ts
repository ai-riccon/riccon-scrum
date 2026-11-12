import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createDocument,
  createProject,
  db,
  getDocumentBySlug,
  listDocumentSections,
} from '../db';
import {
  checksumOf,
  editDocument,
  ensureDocument,
  parseSections,
  previewDocumentSync,
  applyDocumentSync,
  publishDocument,
  rollbackDocument,
  saveDocumentContent,
  summaryOf,
} from '../documents';
import { getDocumentContext } from '../document-context';
import { documentGenerationPrompt, legacyRequirementsBaselinePrompt } from '../templates';

const markdown = [
  '# 示例文档',
  '',
  '## 1. 概述',
  '登录会话在 30 分钟后过期。',
  '',
  '### 1.1 细节',
  '过期后返回 session_expired。',
  '## 2. 验收',
  '- AC1 登录成功',
].join('\n');
const sections = parseSections(markdown);
assert.equal(sections[0].heading, '示例文档');
assert.equal(sections[1].headingPath, '示例文档 / 1. 概述');
assert.equal(sections[2].headingPath, '示例文档 / 1. 概述 / 1.1 细节');
assert.equal(new Set(sections.map((section) => section.anchor)).size, sections.length);
assert.ok(sections.every((section) => section.tokens > 0));
assert.ok(summaryOf(markdown).includes('登录会话'));
assert.equal(checksumOf('abc'), checksumOf('abc'));
assert.notEqual(checksumOf('abc'), checksumOf('abd'));

const prompt = documentGenerationPrompt({
  docType: 'coding-standards',
  docTitle: '编码规范：demo',
  projectName: 'demo',
  profileSummary: '- 语言：TypeScript',
  requiredHeadings: ['规范', '规则'],
  evidence: '### eslint.config.js\n```\nno-console\n```',
});
assert.ok(prompt.includes('CS-01'));
assert.ok(prompt.includes('规范'));
assert.ok(legacyRequirementsBaselinePrompt({ projectName: 'demo', profileSummary: '', evidence: '' }).includes('代码推断'));

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'riccon-doc-check-'));
fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"doc-check"}\n');
const project = createProject({ name: 'doc-check', repoPath: repo, defaultBranch: 'main', requireMachineDod: false });
try {
  const doc = createDocument({
    projectId: project.id,
    docType: 'overview',
    slug: 'overview',
    title: '项目概览：doc-check',
    status: 'draft',
    autoUpdate: true,
    watchedGlobs: ['**/*.ts'],
  });
  const v1 = saveDocumentContent(doc.id, {
    content: markdown,
    status: 'published',
    source: 'onboard',
    generatedBy: 'deterministic',
    autoUpdate: true,
    watchedGlobs: ['**/*.ts'],
  });
  assert.equal(v1.version, 1);
  assert.equal(listDocumentSections(doc.id).length, sections.length);

  const newPreview = previewDocumentSync(project.id);
  assert.equal(newPreview.summary.new, 1);
  const applied = applyDocumentSync(project.id);
  assert.equal(applied.written, 1);
  assert.ok(fs.existsSync(path.join(repo, 'docs/riccon/overview/overview.md')));
  assert.equal(previewDocumentSync(project.id).summary.unchanged, 1);

  fs.appendFileSync(path.join(repo, 'docs/riccon/overview/overview.md'), '\n<!-- manual -->\n');
  assert.equal(previewDocumentSync(project.id).summary.conflict, 1);
  const skipped = applyDocumentSync(project.id);
  assert.equal(skipped.written, 0);
  assert.equal(skipped.skipped, 1);

  const edited = editDocument(doc.id, `${markdown}\n\n## 人工补充\n\n补充说明。\n`, undefined, 'human');
  assert.equal(edited.version, 2);
  assert.equal(edited.pinned, true);
  publishDocument(doc.id);
  const rolled = rollbackDocument(doc.id, 1);
  assert.equal(rolled.version, 3);
  assert.equal(rolled.status, 'draft');

  const ctx = getDocumentContext(project.id, 'execution', '登录会话 过期', 4000);
  assert.ok(ctx.text.includes('文档地图'));
  assert.ok(ctx.refs.length > 0);
  assert.ok(ctx.text.includes('[doc:overview/overview@v'));

  const ensured = ensureDocument(project.id, 'architecture', 'architecture', '架构设计：doc-check');
  assert.equal(getDocumentBySlug(project.id, 'architecture', 'architecture')?.id, ensured.id);
  console.log('[document-check] sections/prompt/version/sync/context/registry OK');
} finally {
  for (const doc of db.prepare('SELECT id FROM project_documents WHERE project_id = ?').all(project.id) as { id: string }[]) {
    db.prepare('DELETE FROM document_sections WHERE document_id = ?').run(doc.id);
    db.prepare('DELETE FROM document_versions WHERE document_id = ?').run(doc.id);
    db.prepare('DELETE FROM document_sync_state WHERE document_id = ?').run(doc.id);
    db.prepare('DELETE FROM project_documents WHERE id = ?').run(doc.id);
  }
  db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
  fs.rmSync(repo, { recursive: true, force: true });
}
