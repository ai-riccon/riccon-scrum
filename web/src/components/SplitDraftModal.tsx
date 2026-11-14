import { useMemo, useState } from 'react';
import type { RequirementSplitChild, RequirementSplitDraft } from '@riccon-scrum/shared';
import { Icon } from '../icons';
import { confirmAction } from './ConfirmDialog';

interface EditableChild extends RequirementSplitChild {
  selected: boolean;
}

export function SplitDraftModal({
  draft,
  parentTitle,
  busy,
  onClose,
  onConfirm,
}: {
  draft: RequirementSplitDraft;
  parentTitle: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (children: RequirementSplitChild[]) => void;
}) {
  const [children, setChildren] = useState<EditableChild[]>(
    draft.children.map((child) => ({ ...child, selected: true })),
  );
  const selectedKeys = useMemo(
    () => new Set(children.filter((child) => child.selected).map((child) => child.key)),
    [children],
  );
  const selectedCount = selectedKeys.size;

  const update = (key: string, patch: Partial<EditableChild>) => {
    setChildren((prev) => prev.map((child) => (child.key === key ? { ...child, ...patch } : child)));
  };

  const confirm = async () => {
    const payload = children
      .filter((child) => child.selected)
      .map(({ selected: _selected, ...child }) => ({
        ...child,
        dependsOn: child.dependsOn.filter((key) => selectedKeys.has(key)),
      }));
    const ok = await confirmAction({
      title: '确认拆分需求',
      message: '将创建所选子需求，并写入依赖关系。',
      detail: payload.map((child) => child.title).join('\n'),
      confirmText: `创建 ${payload.length} 个子需求`,
    });
    if (!ok) return;
    onConfirm(payload);
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal modal-wide split-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="拆分草案">
        <div className="modal-head">
          <Icon name="layers" size={18} style={{ color: 'var(--indigo-bright)', marginRight: 10 }} />
          <h3>拆分草案</h3>
          <span className="badge">{parentTitle}</span>
          <span className="badge cyan">已选 {selectedCount}/{children.length}</span>
          <button className="btn icon ghost" onClick={onClose} aria-label="关闭" data-tip="关闭拆分草案，不创建子需求" style={{ marginLeft: 'auto' }}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="modal-body">
          {draft.summary && <div className="req-note">拆分策略：{draft.summary}</div>}
          <div className="req-note warn">确认前可以取消勾选或修改标题；未选中的子需求及其依赖不会被创建。</div>
          <div className="split-list">
            {children.map((child) => {
              const missing = child.dependsOn.filter((key) => !selectedKeys.has(key));
              return (
                <div className={`split-item ${child.selected ? '' : 'off'}`} key={child.key}>
                  <label className="split-check">
                    <input
                      type="checkbox"
                      checked={child.selected}
                      onChange={(e) => update(child.key, { selected: e.target.checked })}
                    />
                    <span className="split-key">{child.key}</span>
                  </label>
                  <div className="split-body">
                    <input
                      className="split-title-input"
                      value={child.title}
                      disabled={!child.selected}
                      onChange={(e) => update(child.key, { title: e.target.value })}
                      aria-label={`${child.key} 标题`}
                    />
                    <div className="split-goal">{child.goal}</div>
                    {child.scope && <div className="split-scope">范围：{child.scope}</div>}
                    {child.acceptance.length > 0 && (
                      <ul className="split-ac">
                        {child.acceptance.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    )}
                    <div className="split-meta">
                      <span className="badge">{child.size}</span>
                      {child.dependsOn.map((key) => (
                        <span className={`badge ${missing.includes(key) ? 'red' : 'cyan'}`} key={key}>
                          前置 {key}
                        </span>
                      ))}
                      {missing.length > 0 && child.selected && (
                        <span className="hint">前置未选中，确认时会自动移除此依赖。</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="modal-foot">
          <span className="hint" style={{ marginRight: 'auto', fontSize: 11.5, color: 'var(--text-low)' }}>
            至少保留 2 个子需求；确认后父需求转为“已拆分”。
          </span>
          <button className="btn ghost" onClick={onClose} disabled={busy}>取消</button>
          <button className="btn primary" disabled={busy || selectedCount < 2} onClick={confirm}>
            <Icon name="check" size={14} />
            {busy ? '创建中…' : `确认创建 ${selectedCount} 个子需求`}
          </button>
        </div>
      </div>
    </div>
  );
}
