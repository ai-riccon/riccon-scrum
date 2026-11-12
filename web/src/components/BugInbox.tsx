import { useEffect, useMemo, useState } from 'react';
import type {
  BugPriority,
  BugReport,
  BugReproducibility,
  BugSeverity,
  BugTriageSuggestion,
  Project,
} from '@riccon-scrum/shared';
import { api, type BoardStory } from '../api';
import { Icon } from '../icons';

const STATUS_LABEL: Record<BugReport['status'], string> = {
  new: '待分诊',
  triaged: '已分诊',
  accepted: '已接受',
  rejected: '已拒绝',
  duplicate: '重复',
  fixing: '修复中',
  fixed: '待验证',
  verified: '已验证',
  closed: '已关闭',
  reopened: '已重开',
};

const SEVERITY_LABEL: Record<BugSeverity, string> = {
  blocker: '阻断',
  critical: '严重',
  major: '主要',
  minor: '次要',
};

const STATUS_COLOR: Record<BugReport['status'], string> = {
  new: 'amber',
  triaged: 'cyan',
  accepted: 'cyan',
  rejected: 'red',
  duplicate: '',
  fixing: 'cyan',
  fixed: 'amber',
  verified: 'green',
  closed: 'green',
  reopened: 'red',
};

export function BugInbox({
  project,
  stories,
  onClose,
  onChanged,
  onToast,
  onOpenStory,
}: {
  project: Project;
  stories: BoardStory[];
  onClose: () => void;
  onChanged: () => Promise<void>;
  onToast: (kind: 'success' | 'error' | 'info', text: string) => void;
  onOpenStory: (id: string) => void;
}) {
  const [bugs, setBugs] = useState<BugReport[]>([]);
  const [metrics, setMetrics] = useState<Awaited<ReturnType<typeof api.bugMetrics>> | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<BugTriageSuggestion | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [severity, setSeverity] = useState<BugSeverity>('major');
  const [priority, setPriority] = useState<BugPriority>('P2');
  const [reproducibility, setReproducibility] = useState<BugReproducibility>('always');
  const [duplicateOf, setDuplicateOf] = useState('');
  const [triageNote, setTriageNote] = useState('');
  const [regressionTest, setRegressionTest] = useState('');
  const [resolution, setResolution] = useState('');
  const [reason, setReason] = useState('');

  const storyTitle = useMemo(() => new Map(stories.map((story) => [story.id, story.title])), [stories]);
  const selected = bugs.find((bug) => bug.id === selectedId) ?? null;

  const load = async () => {
    const [rows, stats] = await Promise.all([api.bugs(project.id, statusFilter || undefined), api.bugMetrics(project.id)]);
    setBugs(rows);
    setMetrics(stats);
    if (selectedId && !rows.some((bug) => bug.id === selectedId)) {
      setSelectedId(rows[0]?.id ?? null);
    } else if (!selectedId && rows.length > 0) {
      setSelectedId(rows[0].id);
    }
  };

  useEffect(() => {
    void load().catch((err) => onToast('error', err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, statusFilter]);

  useEffect(() => {
    if (!selected) return;
    setSeverity(selected.severity);
    setPriority(selected.priority);
    setReproducibility(selected.reproducibility);
    setDuplicateOf(selected.duplicateOf ?? '');
    setTriageNote(selected.triageNote ?? '');
    setRegressionTest(selected.regressionTest ?? '');
    setResolution(selected.resolution ?? '');
    setReason('');
    setSuggestion(null);
  }, [selected?.id]);

  const run = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await fn();
      await load();
      await onChanged();
      onToast('success', success);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const suggest = async () => {
    if (!selected) return;
    setBusy('suggest');
    try {
      const next = await api.suggestBug(selected.id);
      setSuggestion(next);
      setSeverity(next.severity);
      setPriority(next.priority);
      setReproducibility(next.reproducibility);
      onToast('info', '已生成规则/相似 Bug 建议，请人工确认');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const saveTriage = async () => {
    if (!selected) return;
    await run(
      'triage',
      () =>
        api.triageBug(selected.id, {
          severity,
          priority,
          reproducibility,
          duplicateOf: duplicateOf || null,
          triageNote: triageNote.trim() || null,
        }),
      duplicateOf ? '已标记为重复 Bug' : 'Bug 分诊已保存',
    );
  };

  const accept = async (strategy?: 'rework' | 'fix_story') => {
    if (!selected) return;
    setBusy('accept');
    try {
      const result = await api.acceptBug(selected.id, { regressionTest: regressionTest.trim() || undefined, strategy });
      await load();
      await onChanged();
      if (result.mode === 'rework') {
        onToast('info', '已关联当前故事返工，请打开故事执行继续/退回');
      } else {
        onToast('success', '已创建关联修复故事（草稿），请批准后执行');
        onOpenStory(result.story.id);
      }
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const statusOptions: BugReport['status'][] = ['new', 'triaged', 'accepted', 'fixing', 'fixed', 'verified', 'closed', 'rejected', 'duplicate', 'reopened'];

  return (
    <div className="settings-page bug-inbox-page">
      <div className="settings-inner">
        <div className="settings-head">
          <Icon name="alert" size={18} style={{ color: 'var(--amber)' }} />
          <h2>Bug 反馈</h2>
          <span className="badge">{project.name}</span>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            <Icon name="x" size={14} />
            返回
          </button>
        </div>
        <div className="settings-body">
          <div className="bug-metrics">
            <div className="team-stat"><span className="ts-label">总数</span><span className="ts-value">{metrics?.total ?? 0}</span></div>
            <div className="team-stat"><span className="ts-label">未关闭</span><span className="ts-value">{metrics?.open ?? 0}</span></div>
            <div className="team-stat"><span className="ts-label">待验证</span><span className="ts-value">{metrics?.fixed ?? 0}</span></div>
            <div className="team-stat"><span className="ts-label">逾期</span><span className="ts-value" style={{ color: (metrics?.overdue ?? 0) > 0 ? 'var(--red)' : undefined }}>{metrics?.overdue ?? 0}</span></div>
            <div className="team-stat"><span className="ts-label">重开率</span><span className="ts-value">{metrics?.reopenRate == null ? '—' : `${Math.round(metrics.reopenRate * 100)}%`}</span></div>
          </div>
          <div className="bug-toolbar">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Bug 状态筛选">
              <option value="">全部状态</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>{STATUS_LABEL[status]}</option>
              ))}
            </select>
            <span className="hint">Bug 来自具体用户故事；修复故事仍走 Task/DoD/AC 与人工验收。</span>
          </div>
          <div className="bug-layout">
            <div className="bug-list">
              {bugs.length === 0 && <div className="rail-empty">当前筛选下没有 Bug。</div>}
              {bugs.map((bug) => (
                <button
                  key={bug.id}
                  className={`bug-list-item ${selectedId === bug.id ? 'active' : ''}`}
                  onClick={() => setSelectedId(bug.id)}
                >
                  <span className={`badge ${STATUS_COLOR[bug.status]}`}>{STATUS_LABEL[bug.status]}</span>
                  <span className="bug-list-title">{bug.title}</span>
                  <span className="hint">{SEVERITY_LABEL[bug.severity]} · {bug.priority}</span>
                  <span className="hint">{storyTitle.get(bug.storyId) ?? bug.storyId.slice(0, 8)}</span>
                  {bug.slaDueAt && <span className="hint">{new Date(bug.slaDueAt).toLocaleDateString('zh-CN')}</span>}
                </button>
              ))}
            </div>
            <div className="bug-detail">
              {!selected && <div className="rail-empty">选择一条 Bug 查看详情。</div>}
              {selected && (
                <>
                  <div className="bug-detail-head">
                    <h3>{selected.title}</h3>
                    <span className={`badge ${STATUS_COLOR[selected.status]}`}>{STATUS_LABEL[selected.status]}</span>
                    <span className="badge">{selected.severity}</span>
                    <span className="badge">{selected.priority}</span>
                    {selected.duplicateOf && <span className="badge red">重复</span>}
                  </div>
                  <div className="req-note">原故事：{storyTitle.get(selected.storyId) ?? selected.storyId}</div>
                  {selected.fixStoryId && (
                    <button className="btn small ghost" onClick={() => onOpenStory(selected.fixStoryId as string)}>
                      打开修复故事：{storyTitle.get(selected.fixStoryId) ?? selected.fixStoryId.slice(0, 8)}
                    </button>
                  )}
                  {selected.acIds.length > 0 && <div className="req-note">违反 AC：{selected.acIds.join('、')}</div>}
                  <pre className="bug-block">复现步骤：{selected.steps}\n\n期望：{selected.expected}\n\n实际：{selected.actual}{selected.environment ? `\n\n环境：${selected.environment}` : ''}</pre>
                  {selected.evidence.length > 0 && <pre className="bug-block">{selected.evidence.join('\n')}</pre>}
                  {selected.regressionTest && <div className="req-note">回归测试：{selected.regressionTest}</div>}
                  {selected.triageNote && <div className="req-note">分诊备注：{selected.triageNote}</div>}
                  {selected.resolution && <div className="req-note">处理结论：{selected.resolution}</div>}

                  {['new', 'triaged', 'reopened'].includes(selected.status) && (
                    <div className="bug-section">
                      <div className="section-label">分诊</div>
                      <div className="bug-form-grid three">
                        <select value={severity} onChange={(e) => setSeverity(e.target.value as BugSeverity)} aria-label="严重度">
                          {(Object.keys(SEVERITY_LABEL) as BugSeverity[]).map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                        <select value={priority} onChange={(e) => setPriority(e.target.value as BugPriority)} aria-label="优先级">
                          {(['P0', 'P1', 'P2', 'P3'] as BugPriority[]).map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                        <select value={reproducibility} onChange={(e) => setReproducibility(e.target.value as BugReproducibility)} aria-label="可复现性">
                          <option value="always">必现</option>
                          <option value="often">经常</option>
                          <option value="sometimes">偶现</option>
                          <option value="once">仅一次</option>
                        </select>
                      </div>
                      <input value={duplicateOf} onChange={(e) => setDuplicateOf(e.target.value)} placeholder="重复 Bug ID（可选，填写后标记为 duplicate）" />
                      <textarea value={triageNote} onChange={(e) => setTriageNote(e.target.value)} placeholder="分诊备注" />
                      <div className="req-actions">
                        <button className="btn small" disabled={busy === 'suggest'} onClick={() => void suggest()}>
                          <Icon name="sparkles" size={12} />
                          {busy === 'suggest' ? '分析中…' : '生成规则/重复建议'}
                        </button>
                        <button className="btn small cyan" disabled={busy === 'triage'} onClick={() => void saveTriage()}>
                          保存分诊
                        </button>
                      </div>
                      {suggestion && (
                        <div className="bug-suggestion">
                          <div>建议：{suggestion.severity} / {suggestion.priority} / {suggestion.reproducibility}（{suggestion.source}）</div>
                          <div className="req-note">{suggestion.summary}</div>
                          {suggestion.duplicateCandidates.map((candidate) => (
                            <button
                              key={candidate.bugId}
                              className="btn small ghost"
                              onClick={() => setDuplicateOf(candidate.bugId)}
                            >
                              重复候选：{candidate.title}（{(candidate.score * 100).toFixed(0)}%）
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {['triaged', 'accepted', 'reopened'].includes(selected.status) && (
                    <div className="bug-section">
                      <div className="section-label">接受与修复</div>
                      <input value={regressionTest} onChange={(e) => setRegressionTest(e.target.value)} placeholder="回归测试名（修复故事 AC 必填）" />
                      <div className="req-actions">
                        <button className="btn small cyan" disabled={busy === 'accept'} onClick={() => void accept()}>
                          <Icon name="play" size={12} />
                          接受并创建修复工作项
                        </button>
                        <button className="btn small ghost" disabled={busy === 'accept'} onClick={() => void accept('rework')}>
                          关联当前故事返工
                        </button>
                        <button className="btn small ghost" disabled={busy === 'accept'} onClick={() => void accept('fix_story')}>
                          创建修复故事
                        </button>
                      </div>
                    </div>
                  )}

                  {selected.status === 'fixed' && (
                    <div className="bug-section">
                      <input value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="验证结论" />
                      <button className="btn small green" disabled={busy === 'verify'} onClick={() => void run('verify', () => api.verifyBug(selected.id, resolution), 'Bug 已验证')}>
                        人工验证通过
                      </button>
                    </div>
                  )}
                  {selected.status === 'verified' && (
                    <div className="bug-section">
                      <input value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="关闭结论" />
                      <button className="btn small green" disabled={busy === 'close'} onClick={() => void run('close', () => api.closeBug(selected.id, resolution), 'Bug 已关闭')}>
                        关闭 Bug
                      </button>
                    </div>
                  )}
                  {['fixed', 'verified', 'closed'].includes(selected.status) && (
                    <div className="bug-section">
                      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="重开原因（可选）" />
                      <button className="btn small ghost" disabled={!reason.trim() || busy === 'reopen'} onClick={() => void run('reopen', () => api.reopenBug(selected.id, reason), 'Bug 已重开')}>
                        重开 Bug
                      </button>
                    </div>
                  )}
                  {!['closed', 'rejected'].includes(selected.status) && (
                    <div className="bug-section">
                      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="拒绝原因（可选）" />
                      <button className="btn small ghost" disabled={!reason.trim() || busy === 'reject'} onClick={() => void run('reject', () => api.rejectBug(selected.id, reason), 'Bug 已拒绝')}>
                        拒绝 Bug
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
