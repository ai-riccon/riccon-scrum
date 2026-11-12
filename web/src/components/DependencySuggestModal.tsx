import { useEffect, useState } from 'react';
import type { DependencyEntityType, DependencySuggestion } from '@riccon-scrum/shared';
import { api } from '../api';
import { Icon } from '../icons';

export function DependencySuggestModal({
  projectId,
  entityType,
  entityId,
  entityTitle,
  onClose,
  onApplied,
  onToast,
}: {
  projectId: string;
  entityType: DependencyEntityType;
  entityId: string;
  entityTitle: string;
  onClose: () => void;
  onApplied: () => Promise<void>;
  onToast: (kind: 'success' | 'error' | 'info', text: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<DependencySuggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    api
      .suggestDependencies({ projectId, entityType, entityId })
      .then((items) => {
        setSuggestions(items);
        setSelected(new Set(items.map((item) => `${item.predecessorId}|${item.successorId}`)));
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, entityType, entityId]);

  const apply = async () => {
    const chosen = suggestions.filter((item) => selected.has(`${item.predecessorId}|${item.successorId}`));
    if (chosen.length === 0) return;
    setApplying(true);
    let applied = 0;
    const failures: string[] = [];
    for (const item of chosen) {
      try {
        await api.createDependency({
          projectId,
          predecessorType: item.predecessorType,
          predecessorId: item.predecessorId,
          successorType: item.successorType,
          successorId: item.successorId,
          note: `AI 建议：${item.reason}`,
        });
        applied++;
      } catch (err) {
        failures.push(`${item.predecessorTitle} → ${item.successorTitle}：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await onApplied().catch(() => undefined);
    setApplying(false);
    if (failures.length) onToast('error', `已创建 ${applied} 条，失败 ${failures.length} 条：${failures[0]}`);
    else onToast('success', `已创建 ${applied} 条依赖`);
    onClose();
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal modal-wide suggest-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="AI 依赖建议">
        <div className="modal-head">
          <Icon name="sparkles" size={18} style={{ color: 'var(--cyan)', marginRight: 10 }} />
          <h3>AI 依赖建议</h3>
          <span className="badge">{entityTitle}</span>
          <button className="btn icon ghost" onClick={onClose} aria-label="关闭" style={{ marginLeft: 'auto' }}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="modal-body">
          {loading && <div className="rail-empty">AI 正在检索候选并分析前置关系…</div>}
          {error && <div className="req-note warn">{error}</div>}
          {!loading && !error && suggestions.length === 0 && <div className="rail-empty">没有找到足够可靠的依赖建议。</div>}
          {suggestions.length > 0 && (
            <>
              <div className="req-note">AI 只提出建议；勾选后才会创建依赖。已过滤自依赖、重复和循环。</div>
              <div className="suggest-list">
                {suggestions.map((item) => {
                  const key = `${item.predecessorId}|${item.successorId}`;
                  return (
                    <label className="suggest-item" key={key}>
                      <input
                        type="checkbox"
                        checked={selected.has(key)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(key);
                          else next.delete(key);
                          setSelected(next);
                        }}
                      />
                      <div className="suggest-body">
                        <div className="suggest-flow">
                          <span className="suggest-node">{item.predecessorTitle}</span>
                          <span className="suggest-arrow">→</span>
                          <span className="suggest-node">{item.successorTitle}</span>
                          <span className={`badge ${item.confidence >= 0.8 ? 'green' : 'amber'}`}>{Math.round(item.confidence * 100)}%</span>
                        </div>
                        {item.reason && <div className="suggest-reason">{item.reason}</div>}
                      </div>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={load} disabled={loading || applying}>
            <Icon name="refresh" size={12} />
            重新建议
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose} disabled={applying}>取消</button>
          <button className="btn primary" disabled={loading || applying || selected.size === 0} onClick={apply}>
            <Icon name="check" size={14} />
            {applying ? '创建中…' : `创建 ${selected.size} 条依赖`}
          </button>
        </div>
      </div>
    </div>
  );
}
