import type { KnowledgeEntry } from '@riccon-scrum/shared';
import { addKnowledge, listKnowledge, searchKnowledge } from './db';

function line(entry: KnowledgeEntry): string {
  const body = entry.content.length > 320 ? entry.content.slice(0, 320) + '…' : entry.content;
  return `- [${entry.kind}] ${entry.title}：${body}`;
}

export function getKnowledgeContext(projectId: string, query: string, limit = 6): string {
  const entries = searchKnowledge(projectId, query, limit);
  if (entries.length === 0) return '';
  return ['## 项目知识（ADR/规范/历史失败，必须遵守或参考）', ...entries.map(line)].join('\n');
}

export function rememberFailure(projectId: string, title: string, issues: string[]): void {
  if (issues.length === 0) return;
  const content = issues.join('\n');
  const exists = listKnowledge(projectId).some(
    (entry) => entry.kind === 'failure' && entry.title === title && entry.content === content,
  );
  if (exists) return;
  addKnowledge({ projectId, kind: 'failure', title, content, tags: 'failure,qa' });
}
