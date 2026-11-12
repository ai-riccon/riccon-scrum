import { useState } from 'react';
import type { BugPriority, BugReproducibility, BugSeverity } from '@riccon-scrum/shared';
import { api, type BoardStory } from '../api';
import { Icon } from '../icons';

export function BugReportModal({
  story,
  onClose,
  onCreated,
  onToast,
}: {
  story: BoardStory;
  onClose: () => void;
  onCreated: () => Promise<void>;
  onToast: (kind: 'success' | 'error' | 'info', text: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [expected, setExpected] = useState('');
  const [actual, setActual] = useState('');
  const [environment, setEnvironment] = useState('');
  const [evidence, setEvidence] = useState('');
  const [severity, setSeverity] = useState<BugSeverity>('major');
  const [priority, setPriority] = useState<BugPriority>('P2');
  const [reproducibility, setReproducibility] = useState<BugReproducibility>('always');
  const [acIds, setAcIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim() || !steps.trim() || !expected.trim() || !actual.trim()) {
      onToast('error', '请填写标题、复现步骤、期望结果与实际结果');
      return;
    }
    setBusy(true);
    try {
      await api.createBug(story.id, {
        title: title.trim(),
        description: description.trim(),
        steps: steps.trim(),
        expected: expected.trim(),
        actual: actual.trim(),
        environment: environment.trim(),
        evidence: evidence.split('\n').map((line) => line.trim()).filter(Boolean),
        severity,
        priority,
        reproducibility,
        acIds,
        reporter: 'human',
      });
      await onCreated();
      onToast('success', 'Bug 已上报，进入分诊队列');
      onClose();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal bug-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="反馈 Bug">
        <div className="modal-head">
          <h3>反馈 Bug</h3>
          <span className="badge">{story.title}</span>
          <button className="btn icon ghost" onClick={onClose} aria-label="关闭">
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="modal-body bug-form">
          <label>缺陷标题 *</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：CSV 导出未转义逗号" />
          <label>现象描述</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="补充影响范围、触发条件等" />
          <label>复现步骤 *</label>
          <textarea value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={'1. 打开导出页\n2. 输入含逗号的数据\n3. 点击导出'} />
          <div className="bug-form-grid">
            <div>
              <label>期望结果 *</label>
              <textarea value={expected} onChange={(e) => setExpected(e.target.value)} />
            </div>
            <div>
              <label>实际结果 *</label>
              <textarea value={actual} onChange={(e) => setActual(e.target.value)} />
            </div>
          </div>
          <label>环境（版本/分支/终端/浏览器）</label>
          <input value={environment} onChange={(e) => setEnvironment(e.target.value)} placeholder="例如 main@abc123 · Chrome 131" />
          <label>证据（每行一条：日志、命令输出、截图路径）</label>
          <textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          <div className="bug-form-grid three">
            <div>
              <label>严重度</label>
              <select value={severity} onChange={(e) => setSeverity(e.target.value as BugSeverity)}>
                <option value="blocker">blocker</option>
                <option value="critical">critical</option>
                <option value="major">major</option>
                <option value="minor">minor</option>
              </select>
            </div>
            <div>
              <label>优先级</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as BugPriority)}>
                <option value="P0">P0</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
              </select>
            </div>
            <div>
              <label>可复现性</label>
              <select value={reproducibility} onChange={(e) => setReproducibility(e.target.value as BugReproducibility)}>
                <option value="always">必现</option>
                <option value="often">经常</option>
                <option value="sometimes">偶现</option>
                <option value="once">仅一次</option>
              </select>
            </div>
          </div>
          {story.acceptance.length > 0 && (
            <div className="bug-ac-list">
              <label>违反的验收标准</label>
              {story.acceptance.map((ac) => (
                <label key={ac.id} className="bug-ac-item">
                  <input
                    type="checkbox"
                    checked={acIds.includes(ac.acId)}
                    onChange={(e) =>
                      setAcIds(e.target.checked ? [...acIds, ac.acId] : acIds.filter((id) => id !== ac.acId))
                    }
                  />
                  {ac.acId} · {ac.then}
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn small ghost" onClick={onClose}>取消</button>
          <button className="btn small primary" disabled={busy} onClick={() => void submit()}>
            <Icon name="alert" size={12} />
            {busy ? '提交中…' : '提交 Bug'}
          </button>
        </div>
      </div>
    </div>
  );
}
