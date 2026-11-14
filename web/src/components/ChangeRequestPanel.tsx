import { useEffect, useState } from 'react';
import type { ChangeImpactAction, DocumentImpact, Requirement, RequirementChangeRequest } from '@riccon-scrum/shared';
import { api } from '../api';
import { Icon } from '../icons';
import { confirmAction } from './ConfirmDialog';

const TYPE_LABEL: Record<RequirementChangeRequest['changeType'], string> = {
  corrective: '修正',
  adaptive: '适配',
  perfective: '增强',
};

const SOURCE_LABEL: Record<RequirementChangeRequest['source'], string> = {
  production: '生产反馈',
  review: '评审反馈',
  bug: '缺陷',
  manual: '人工',
  external: '外部',
};

const ACTION_LABEL: Record<ChangeImpactAction, string> = {
  keep: '保持',
  adjust: '调整',
  rework: '返工',
  add_increment: '增量',
  add_regression: '回归',
};

const STATUS_LABEL: Record<RequirementChangeRequest['status'], string> = {
  draft: '草稿',
  analyzing: '分析中',
  in_review: '待决策',
  approved: '已批准',
  rejected: '已拒绝',
  materialized: '已物化',
  archived: '已归档',
};

export function ChangeRequestPanel({
  requirement,
  onChanged,
  onToast,
  onOpenRequirement,
}: {
  requirement: Requirement;
  onChanged: () => Promise<void>;
  onToast: (kind: 'success' | 'error' | 'info', text: string) => void;
  onOpenRequirement: (id: string) => void;
}) {
  const [items, setItems] = useState<RequirementChangeRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  const [changeType, setChangeType] = useState<RequirementChangeRequest['changeType']>('perfective');
  const [source, setSource] = useState<RequirementChangeRequest['source']>('manual');
  const [iteration, setIteration] = useState('');
  const [docImpacts, setDocImpacts] = useState<DocumentImpact[]>([]);

  const load = async () => {
    setItems(await api.requirementChangeRequests(requirement.id));
    setDocImpacts(await api.documentImpact(requirement.projectId, requirement.id).catch(() => []));
  };

  useEffect(() => {
    void load().catch(() => setItems([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requirement.id]);

  const create = async () => {
    if (!title.trim() || !reason.trim()) {
      onToast('error', '请填写变更标题与原因');
      return;
    }
    const ok = await confirmAction({
      title: '创建需求变更单',
      message: '将创建变更单并自动分析受影响的用户故事与文档。',
      detail: title.trim(),
      confirmText: '创建并分析',
    });
    if (!ok) return;
    setBusy('create');
    try {
      const created = await api.createRequirementChangeRequest(requirement.id, {
        title: title.trim(),
        reason: reason.trim(),
        changeType,
        source,
        iteration: iteration.trim() || null,
      });
      await api.analyzeChangeRequest(created.id);
      setTitle('');
      setReason('');
      setIteration('');
      await load();
      await onChanged();
      onToast('success', `变更单已创建，影响分析完成`);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const decide = async (item: RequirementChangeRequest, status: 'approved' | 'rejected', decision?: 'revision' | 'increment') => {
    const ok = await confirmAction({
      title: status === 'approved' ? '批准变更单' : '拒绝变更单',
      message:
        status === 'approved'
          ? decision === 'revision'
            ? '批准为修订后会修改原始需求基线。'
            : '批准为增量后会保留原基线并派生新需求。'
          : '拒绝后该变更不再进入交付。',
      detail: item.title,
      confirmText: status === 'approved' ? '确认批准' : '确认拒绝',
      tone: status === 'approved' ? 'default' : 'warning',
    });
    if (!ok) return;
    setBusy(item.id);
    try {
      await api.decideChangeRequest(item.id, { status, decision });
      await load();
      await onChanged();
      onToast(status === 'approved' ? 'success' : 'info', status === 'approved' ? '变更单已批准' : '变更单已拒绝');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const materialize = async (item: RequirementChangeRequest) => {
    const ok = await confirmAction({
      title: '物化派生需求',
      message: '将根据变更影响分析创建新的派生需求。',
      detail: item.title,
      confirmText: '创建派生需求',
    });
    if (!ok) return;
    setBusy(item.id);
    try {
      const result = await api.materializeChangeRequest(item.id);
      await load();
      await onChanged();
      onToast('success', '已派生新需求，请继续生成草稿与批准');
      onOpenRequirement(result.requirement.id);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const setAction = async (item: RequirementChangeRequest, storyId: string, action: ChangeImpactAction) => {
    setBusy(`${item.id}:${storyId}`);
    try {
      const next = await api.updateChangeImpact(item.id, storyId, action);
      setItems((prev) => prev.map((entry) => (entry.id === next.id ? next : entry)));
      onToast('success', '故事影响处理方式已更新');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="req-change">
      <div className="section-label">需求迭代反馈</div>
      <div className="hint">
        变更单 {items.length} 个 · 已批准/物化 {items.filter((item) => ['approved', 'materialized'].includes(item.status)).length} 个 · 影响故事{' '}
        {items.reduce((sum, item) => sum + item.impact.length, 0)} 个
      </div>
      {docImpacts.length > 0 && (
        <div className="req-note">
          受影响文档：{docImpacts.map((doc) => `${doc.title}（${doc.status}）`).join('、')}
          <span className="hint"> · 请在项目文档中心重新生成/发布</span>
        </div>
      )}
      <div className="change-form">
        <div className="change-form-row">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="变更标题（例如：导出支持 Excel）" />
          <select value={changeType} onChange={(e) => setChangeType(e.target.value as RequirementChangeRequest['changeType'])}>
            <option value="corrective">修正既有需求</option>
            <option value="adaptive">环境/约束适配</option>
            <option value="perfective">功能增强</option>
          </select>
        </div>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="反馈来源、变更原因与期望结果" />
        <div className="change-form-row">
          <select value={source} onChange={(e) => setSource(e.target.value as RequirementChangeRequest['source'])}>
            <option value="manual">人工</option>
            <option value="production">生产反馈</option>
            <option value="review">评审反馈</option>
            <option value="bug">缺陷</option>
            <option value="external">外部来源</option>
          </select>
          <input value={iteration} onChange={(e) => setIteration(e.target.value)} placeholder="迭代标签（可选，如 2026-Q4）" />
          <button className="btn small" disabled={busy === 'create' || !title.trim() || !reason.trim()} onClick={() => void create()}>
            <Icon name="refresh" size={12} />
            {busy === 'create' ? '分析中…' : '创建并分析影响'}
          </button>
        </div>
      </div>

      {items.length === 0 && <div className="req-note">尚无迭代反馈。变更会保留原需求基线，不会直接覆盖已交付内容。</div>}
      {items.map((item) => (
        <div className="change-card" key={item.id}>
          <div className="change-head">
            <span className={`badge ${item.status === 'materialized' ? 'green' : item.status === 'rejected' ? 'red' : item.status === 'in_review' ? 'amber' : 'cyan'}`}>
              {STATUS_LABEL[item.status]}
            </span>
            <strong>{item.title}</strong>
            <span className="hint">{TYPE_LABEL[item.changeType]} · {SOURCE_LABEL[item.source]} · 基线 v{item.baselineVersion}</span>
          </div>
          <div className="req-note">{item.reason}</div>
          {item.iteration && <div className="hint">迭代：{item.iteration}</div>}
          {item.impact.length > 0 && (
            <div className="req-impact">
              <div className="section-label">影响分析（{item.impact.length} 个故事）</div>
              {item.impact.map((impact) => (
                <div className="req-impact-item" key={impact.storyId}>
                  <div className="change-impact-head">
                    <span className="badge">{impact.status}</span>
                    <span>{impact.title}</span>
                    <select
                      value={impact.action ?? 'keep'}
                      disabled={busy === `${item.id}:${impact.storyId}` || ['materialized', 'rejected', 'archived'].includes(item.status)}
                      onChange={(e) => void setAction(item, impact.storyId, e.target.value as ChangeImpactAction)}
                    >
                      {Object.entries(ACTION_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <span className="req-note">{impact.recommendation}</span>
                </div>
              ))}
            </div>
          )}
          <div className="req-actions">
            {item.status === 'in_review' && (
              <>
                <button className="btn small cyan" disabled={busy === item.id} onClick={() => void decide(item, 'approved', 'increment')} data-tip="保留原需求基线，派生新需求承接本次变更">
                  批准为增量
                </button>
                <button className="btn small" disabled={busy === item.id} onClick={() => void decide(item, 'approved', 'revision')} data-tip="直接修改原需求基线，后续以修订版为准">
                  批准为修订
                </button>
                <button className="btn small ghost" disabled={busy === item.id} onClick={() => void decide(item, 'rejected')} data-tip="拒绝该变更单，不进入后续交付">
                  拒绝
                </button>
              </>
            )}
            {item.status === 'approved' && (
              <button className="btn small primary" disabled={busy === item.id} onClick={() => void materialize(item)} data-tip="根据影响分析创建新的派生需求">
                <Icon name="check" size={12} />
                物化派生需求
              </button>
            )}
            {item.derivedRequirementId && (
              <button className="btn small ghost" onClick={() => onOpenRequirement(item.derivedRequirementId as string)}>
                打开派生需求
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
