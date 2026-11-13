import { useEffect, useState } from 'react';
import type { KnowledgeEntry, KnowledgeKind } from '@riccon-scrum/shared';
import { api } from '../../api';
import { Icon } from '../../icons';
import type { ProjectPaneProps } from './types';
import { Help } from './SettingsUi';

export function KnowledgePane({ project, onToast }: ProjectPaneProps) {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [kind, setKind] = useState<KnowledgeKind>('standard');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');

  useEffect(() => {
    api.knowledge(project.id).then(setEntries).catch(() => undefined);
  }, [project.id]);

  const add = async () => {
    if (!title.trim() || !content.trim()) {
      onToast('error', '请填写知识标题与内容');
      return;
    }
    try {
      await api.addKnowledge(project.id, {
        kind,
        title: title.trim(),
        content: content.trim(),
        tags: tags.trim(),
      });
      setTitle('');
      setContent('');
      setTags('');
      setEntries(await api.knowledge(project.id));
      onToast('success', '知识条目已添加');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteKnowledge(id);
      setEntries(await api.knowledge(project.id));
      onToast('success', '知识条目已删除');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <h3>知识条目</h3>
        <Help>知识条目会按需求/故事文本做轻量语义检索，注入发现与交付提示词；QA 失败会自动写入失败记忆。</Help>
      </div>
      <div className="settings-grid">
        <div className="field">
          <label>类型</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as KnowledgeKind)}>
            <option value="adr">ADR 架构决策</option>
            <option value="standard">编码/团队规范</option>
            <option value="failure">历史失败</option>
          </select>
        </div>
        <div className="field">
          <label>标签（逗号分隔）</label>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="例如 api,contract" />
        </div>
      </div>
      <div className="field">
        <label>标题</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如 API 变更必须保持向后兼容" />
      </div>
      <div className="field">
        <label>内容</label>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="决策、约束、失败原因与修复方式" style={{ minHeight: 100 }} />
      </div>
      <div className="settings-actions">
        <button className="btn" onClick={add}>
          <Icon name="plus" size={13} />
          添加知识
        </button>
      </div>
      <div className="settings-subhead">已有知识</div>
      <div className="req-feedback-list">
        {entries.length === 0 && <div className="hint">暂无知识条目。</div>}
        {entries.map((entry) => (
          <div className="req-feedback-row" key={entry.id}>
            <span className="badge">{entry.kind}</span>
            <span style={{ flex: 1 }}>{entry.title}</span>
            {entry.tags && <span className="req-note">{entry.tags}</span>}
            <button className="btn sm ghost" onClick={() => remove(entry.id)} aria-label="删除知识">
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
