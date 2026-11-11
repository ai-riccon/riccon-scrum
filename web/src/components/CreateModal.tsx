import { useState } from 'react';
import { Icon } from '../icons';

export function CreateModal({
  projectName,
  busy,
  onClose,
  onCreate,
}: {
  projectName: string;
  busy: boolean;
  onClose: () => void;
  onCreate: (b: { title: string; description: string; acceptanceCriteria: string }) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const valid = title.trim().length > 0;

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="新建用户故事">
        <div className="modal-head">
          <Icon name="sparkles" size={18} style={{ color: 'var(--cyan)', marginRight: 10 }} />
          <h3>新建用户故事</h3>
          <span className="badge" style={{ marginLeft: 'auto' }}>{projectName}</span>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>故事标题 *</label>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：添加问候文件" />
          </div>
          <div className="field">
            <label>描述</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="作为…我希望…以便…" />
          </div>
          <div className="field">
            <label>验收标准（BDD）</label>
            <textarea
              value={acceptanceCriteria}
              onChange={(e) => setAcceptanceCriteria(e.target.value)}
              placeholder={'Given …\nWhen …\nThen …'}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
            />
            <div className="help">机器可验证的验收标准将作为 DoD 门禁依据。</div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>取消</button>
          <button className="btn primary" disabled={!valid || busy} onClick={() => onCreate({ title, description, acceptanceCriteria })}>
            <Icon name="plus" size={14} />
            创建故事
          </button>
        </div>
      </div>
    </div>
  );
}