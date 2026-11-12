import { useEffect, useState } from 'react';
import type { Category, Tag, TaxonomyCategoryNode, TaxonomyProposal } from '@riccon-scrum/shared';
import { api } from '../api';
import { Icon } from '../icons';

function existingTree(categories: Category[]): TaxonomyCategoryNode[] {
  const nodes = new Map(categories.map((category) => [category.id, { name: category.name, children: [] as TaxonomyCategoryNode[] }]));
  const roots: TaxonomyCategoryNode[] = [];
  for (const category of categories) {
    const node = nodes.get(category.id);
    if (!node) continue;
    const parent = category.parentId ? nodes.get(category.parentId) : null;
    if (parent) parent.children?.push(node);
    else roots.push(node);
  }
  const strip = (nodesList: TaxonomyCategoryNode[]): TaxonomyCategoryNode[] =>
    nodesList.map((node) => ({
      name: node.name,
      children: node.children && node.children.length > 0 ? strip(node.children) : undefined,
    }));
  return strip(roots);
}

function CategoryTree({ nodes, depth = 0 }: { nodes: TaxonomyCategoryNode[]; depth?: number }) {
  return (
    <>
      {nodes.map((node) => (
        <div key={`${depth}-${node.name}`}>
          <div className="taxonomy-category" style={{ paddingLeft: depth * 16 }}>
            <Icon name="layers" size={11} />
            {node.name}
          </div>
          {node.children && <CategoryTree nodes={node.children} depth={depth + 1} />}
        </div>
      ))}
    </>
  );
}

export function TaxonomyModal({
  projectId,
  categories,
  tags,
  onClose,
  onApplied,
  onToast,
}: {
  projectId: string;
  categories: Category[];
  tags: Tag[];
  onClose: () => void;
  onApplied: () => Promise<void>;
  onToast: (kind: 'success' | 'error' | 'info', text: string) => void;
}) {
  const [proposal, setProposal] = useState<TaxonomyProposal | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  const generate = () => {
    setLoading(true);
    setError('');
    api
      .taxonomyPreview(projectId)
      .then(setProposal)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setProposal(null);
    setLoading(false);
    setError('');
  }, [projectId]);

  const apply = async () => {
    if (!proposal) return;
    setApplying(true);
    try {
      const result = await api.taxonomyApply(projectId, proposal);
      await onApplied();
      onToast(
        'success',
        `分类/标签已应用：新增 ${result.categoriesCreated} 个分类、${result.tagsCreated} 个标签，归类 ${result.assignmentsApplied} 项`,
      );
      onClose();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal modal-wide taxonomy-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="AI 分类与标签">
        <div className="modal-head">
          <Icon name="sparkles" size={18} style={{ color: 'var(--cyan)', marginRight: 10 }} />
          <h3>分类与标签</h3>
          <span className="badge">{proposal ? 'AI 新提议' : '当前词表'}</span>
          <button className="btn icon ghost" onClick={onClose} aria-label="关闭" style={{ marginLeft: 'auto' }}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div className="section-label" style={{ marginTop: 0 }}>当前分类树（{categories.length}）</div>
          <div className="taxonomy-tree">
            {categories.length === 0 ? <span className="hint">暂无分类</span> : <CategoryTree nodes={existingTree(categories)} />}
          </div>
          <div className="section-label">当前标签（{tags.length}）</div>
          <div className="taxonomy-tags">
            {tags.map((tag) => (
              <span className="tag-chip" key={tag.id} style={{ borderColor: tag.color, color: tag.color }}>
                {tag.name}
              </span>
            ))}
            {tags.length === 0 && <span className="hint">暂无标签</span>}
          </div>
          <div className="req-note">当前词表不会自动变化。点击“AI 重新生成”后先展示建议，确认才会应用。</div>
          {loading && <div className="rail-empty">AI 正在阅读项目需求/故事并生成受控词表…</div>}
          {error && <div className="req-note warn">{error}</div>}
          {!loading && proposal && (
            <>
              <div className="section-label" style={{ marginTop: 8 }}>AI 提议</div>
              {proposal.summary && <div className="req-note">策略：{proposal.summary}</div>}
              <div className="section-label">建议分类树（最多三级）</div>
              <div className="taxonomy-tree">
                <CategoryTree nodes={proposal.categories} />
              </div>
              <div className="section-label">建议标签词表</div>
              <div className="taxonomy-tags">
                {proposal.tags.map((tag) => (
                  <span className="tag-chip" key={tag.name} style={{ borderColor: tag.color, color: tag.color }}>
                    {tag.name}
                  </span>
                ))}
                {proposal.tags.length === 0 && <span className="hint">未生成标签</span>}
              </div>
              <div className="section-label">归类建议（AI 只建议，确认后应用）</div>
              <div className="taxonomy-assignments">
                {proposal.assignments.length === 0 && <div className="rail-empty">没有归类建议。</div>}
                {proposal.assignments.map((item) => (
                  <div className="taxonomy-assignment" key={`${item.entityType}-${item.entityId}`}>
                    <span className="badge">{item.entityType === 'story' ? '故事' : '需求'}</span>
                    <span className="ta-title">{item.entityTitle || item.entityId}</span>
                    <span className="ta-meta">
                      {item.categoryPath || '保持未分类'}
                      {item.tags?.length ? ` · ${item.tags.join('、')}` : ''}
                      {typeof item.confidence === 'number' ? ` · ${Math.round(item.confidence * 100)}%` : ''}
                    </span>
                    {item.reason && <span className="ta-reason">{item.reason}</span>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={generate} disabled={loading || applying}>
            <Icon name={proposal ? 'refresh' : 'sparkles'} size={12} />
            {proposal ? '重新生成' : 'AI 重新生成'}
          </button>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose} disabled={applying}>关闭</button>
          <button className="btn primary" disabled={loading || applying || !proposal} onClick={apply}>
            <Icon name="check" size={14} />
            {applying ? '应用中…' : '确认并应用'}
          </button>
        </div>
      </div>
    </div>
  );
}
