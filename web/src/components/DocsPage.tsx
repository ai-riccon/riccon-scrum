import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  DocumentConsistencyIssue,
  DocumentStatus,
  DocumentSyncPreview,
  DocumentType,
  Project,
  ProjectDocumentSummary,
} from '@riccon-scrum/shared';
import { api, type DocumentLive } from '../api';
import { Icon } from '../icons';
import { Markdown } from './Markdown';

const DOC_TYPES: { type: DocumentType; label: string }[] = [
  { type: 'overview', label: '项目概览' },
  { type: 'requirements', label: '需求文档' },
  { type: 'architecture', label: '架构设计' },
  { type: 'coding-standards', label: '编码规范' },
  { type: 'code-graph', label: '代码图谱' },
  { type: 'database', label: '数据库设计' },
  { type: 'api-contract', label: 'API 契约' },
  { type: 'test-strategy', label: '测试策略' },
  { type: 'operations', label: '运维部署' },
  { type: 'security', label: '安全与合规' },
];

const STATUS_META: Record<DocumentStatus, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'amber' },
  published: { label: '已发布', cls: 'green' },
  stale: { label: '已过期', cls: 'amber' },
  error: { label: '失败', cls: 'red' },
  archived: { label: '已归档', cls: '' },
};

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false });
}

function typeLabel(type: DocumentType): string {
  return DOC_TYPES.find((item) => item.type === type)?.label ?? type;
}

export function DocsPage({
  project,
  onClose,
  onToast,
}: {
  project: Project;
  onClose: () => void;
  onToast: (kind: 'success' | 'error' | 'info', text: string) => void;
}) {
  const [docs, setDocs] = useState<ProjectDocumentSummary[]>([]);
  const [metrics, setMetrics] = useState<Awaited<ReturnType<typeof api.documentMetrics>> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentLive | null>(null);
  const [activeType, setActiveType] = useState<DocumentType | 'all'>('all');
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [syncDir, setSyncDir] = useState('docs/riccon');
  const [syncPreview, setSyncPreview] = useState<DocumentSyncPreview | null>(null);
  const [issues, setIssues] = useState<DocumentConsistencyIssue[] | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [generatingType, setGeneratingType] = useState<DocumentType | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [profileStatus, setProfileStatus] = useState<string>('idle');

  const refreshList = useCallback(async () => {
    const [list, m] = await Promise.all([api.documents(project.id), api.documentMetrics(project.id)]);
    setDocs(list);
    setMetrics(m);
    setSelectedId((current) => current ?? list[0]?.id ?? null);
  }, [project.id]);

  const refreshDetail = useCallback(async (id: string) => {
    const live = await api.document(id);
    setDetail(live);
    return live;
  }, []);

  useEffect(() => {
    refreshList().catch((err) => onToast('error', err instanceof Error ? err.message : String(err)));
    api.profile(project.id).then((record) => setProfileStatus(record.status)).catch(() => undefined);
  }, [refreshList, onToast, project.id]);

  useEffect(() => {
    const active = onboarding || ['scanning', 'analyzing', 'baselining'].includes(profileStatus);
    if (!active) return;
    const timer = setInterval(async () => {
      try {
        const record = await api.profile(project.id);
        setProfileStatus(record.status);
        await refreshList();
        if (record.status === 'done' || record.status === 'error') {
          setOnboarding(false);
          onToast(record.status === 'done' ? 'success' : 'error', record.status === 'done' ? '入驻分析完成' : `入驻失败：${record.error ?? '未知错误'}`);
        }
      } catch {
        // next poll retries
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [onboarding, profileStatus, project.id, refreshList, onToast]);

  const startOnboard = async () => {
    setOnboarding(true);
    setBusy('onboard');
    try {
      await api.onboard(project.id);
      onToast('info', '已启动入驻：扫描技术栈、索引代码并生成概览/架构/代码图谱/需求基线');
    } catch (err) {
      setOnboarding(false);
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  const profileRunning = ['scanning', 'analyzing', 'baselining'].includes(profileStatus);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setEditing(false);
    refreshDetail(selectedId).catch((err) => onToast('error', err instanceof Error ? err.message : String(err)));
  }, [selectedId, refreshDetail, onToast]);

  useEffect(() => {
    if (!detail || detail.job?.status !== 'running') return;
    const timer = setInterval(() => {
      refreshDetail(detail.document.id).catch(() => undefined);
      refreshList().catch(() => undefined);
    }, 2500);
    return () => clearInterval(timer);
  }, [detail?.job?.status, detail?.document.id, refreshDetail, refreshList]);

  const filtered = useMemo(
    () => (activeType === 'all' ? docs : docs.filter((doc) => doc.docType === activeType)),
    [docs, activeType],
  );

  useEffect(() => {
    if (activeType === 'all') return;
    const first = docs.find((doc) => doc.docType === activeType);
    setSelectedId(first?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeType]);

  useEffect(() => {
    if (!generatingType) return;
    const timer = setInterval(() => {
      void refreshList();
    }, 3000);
    return () => clearInterval(timer);
  }, [generatingType, refreshList]);

  useEffect(() => {
    if (!generatingType) return;
    const found = docs.find((doc) => doc.docType === generatingType);
    if (found) {
      setGeneratingType(null);
      setSelectedId(found.id);
      setActiveType(generatingType);
    }
  }, [docs, generatingType]);

  const generateType = async () => {
    if (activeType === 'all') return;
    setGeneratingType(activeType);
    setBusy(`generate-${activeType}`);
    try {
      await api.generateDocumentType(project.id, activeType);
      onToast('info', `已开始生成${DOC_TYPES.find((item) => item.type === activeType)?.label ?? activeType}，完成后自动刷新`);
    } catch (err) {
      setGeneratingType(null);
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const counts = useMemo(() => {
    const map = new Map<DocumentType, number>();
    for (const doc of docs) map.set(doc.docType, (map.get(doc.docType) ?? 0) + 1);
    return map;
  }, [docs]);

  const run = useCallback(
    async (name: string, fn: () => Promise<unknown>, success?: string) => {
      setBusy(name);
      try {
        await fn();
        if (success) onToast('success', success);
        await refreshList();
        if (selectedId) await refreshDetail(selectedId);
      } catch (err) {
        onToast('error', err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [onToast, refreshDetail, refreshList, selectedId],
  );

  const startEdit = () => {
    if (!detail) return;
    setEditContent(detail.document.content);
    setEditTitle(detail.document.title);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!detail) return;
    await run(
      'save',
      () => api.updateDocument(detail.document.id, { content: editContent, title: editTitle }),
      '文档已保存为草稿（人工锁定）',
    );
    setEditing(false);
  };

  const regenerate = async () => {
    if (!detail) return;
    await run('regen', () => api.regenerateDocument(detail.document.id), '已开始重新生成');
    if (detail.document.docType === 'architecture' || detail.document.docType === 'database' || detail.document.docType === 'api-contract' || detail.document.docType === 'coding-standards' || detail.document.docType === 'test-strategy' || detail.document.docType === 'operations' || detail.document.docType === 'security' || (detail.document.docType === 'requirements' && detail.document.slug === 'legacy-baseline')) {
      setTimeout(() => {
        refreshDetail(detail.document.id).catch(() => undefined);
        refreshList().catch(() => undefined);
      }, 800);
    }
  };

  const previewSync = async () => {
    setBusy('sync-preview');
    try {
      const preview = await api.previewDocumentSync(project.id, syncDir);
      setSyncPreview(preview);
      onToast('info', `待同步：新增 ${preview.summary.new} · 修改 ${preview.summary.modified} · 冲突 ${preview.summary.conflict}`);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const applySync = async (force: boolean) => {
    setBusy('sync-apply');
    try {
      const result = await api.applyDocumentSync(project.id, { dir: syncDir, force });
      onToast(result.skipped > 0 ? 'info' : 'success', `已写入 ${result.written} 个文件${result.skipped ? `，跳过 ${result.skipped} 个冲突` : ''}`);
      setSyncPreview(result);
      await refreshList();
      if (selectedId) await refreshDetail(selectedId);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const checkConsistency = async () => {
    setBusy('consistency');
    try {
      const result = await api.documentConsistency(project.id);
      setIssues(result);
      onToast(result.some((item) => item.severity === 'error') ? 'error' : 'info', `发现 ${result.length} 个文档一致性问题`);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const doc = detail?.document;
  const running = detail?.job?.status === 'running';

  return (
    <div className="settings-page docs-page">
      <div className="settings-inner docs-inner">
        <div className="settings-head">
          <Icon name="file" size={18} style={{ color: 'var(--cyan)' }} />
          <h2>项目文档</h2>
          <span className="badge">{project.name}</span>
          <span className="spacer" />
          {profileRunning || onboarding ? (
            <span className="badge cyan">入驻分析中…</span>
          ) : (
            <button className="btn ghost" disabled={busy === 'onboard'} onClick={() => void startOnboard()}>
              <Icon name="sparkles" size={14} />
              {profileStatus === 'done' ? '重新入驻' : '入驻分析'}
            </button>
          )}
          <button className="btn ghost" disabled={busy === 'refresh'} onClick={() => void run('refresh', () => api.refreshDocuments(project.id), '文档与索引已刷新')}>
            <Icon name="refresh" size={14} />
            刷新文档
          </button>
          <button className="btn ghost" onClick={() => void previewSync()} disabled={busy === 'sync-preview'}>
            <Icon name="file" size={14} />
            同步 docs
          </button>
          <button className="btn ghost" onClick={() => void checkConsistency()} disabled={busy === 'consistency'}>
            <Icon name="shield" size={14} />
            一致性检查
          </button>
          <button className="btn ghost" onClick={onClose}>
            <Icon name="x" size={14} />
            返回
          </button>
        </div>

        {metrics && (
          <div className="req-stats docs-stats">
            <div><span>文档总数</span><b>{metrics.total}</b></div>
            <div><span>已发布</span><b>{metrics.published}</b></div>
            <div><span>草稿</span><b>{metrics.draft}</b></div>
            <div><span>已过期</span><b>{metrics.stale}</b></div>
            <div><span>已同步</span><b>{metrics.synced}</b></div>
            <div><span>自动更新</span><b>{metrics.autoUpdate}</b></div>
            <div><span>人工锁定</span><b>{metrics.pinned}</b></div>
          </div>
        )}

        {syncPreview && (
          <div className="docs-panel">
            <div className="docs-panel-head">
              <b>同步预览 · {syncPreview.targetDir}</b>
              <span className="spacer" />
              <span className="badge green">新增 {syncPreview.summary.new}</span>
              <span className="badge amber">修改 {syncPreview.summary.modified}</span>
              <span className={`badge ${syncPreview.summary.conflict ? 'red' : ''}`}>冲突 {syncPreview.summary.conflict}</span>
              <button className="btn small ghost" onClick={() => setSyncPreview(null)}>收起</button>
            </div>
            <div className="docs-sync-row docs-sync-row-head">
              <span>目标文件</span><span>状态</span><span>版本</span>
            </div>
            {syncPreview.entries.slice(0, 80).map((entry) => (
              <div className="docs-sync-row" key={entry.documentId}>
                <code>{entry.targetPath}</code>
                <span className={`badge ${entry.status === 'conflict' ? 'red' : entry.status === 'modified' ? 'amber' : entry.status === 'new' ? 'cyan' : ''}`}>
                  {entry.status}
                </span>
                <span>v{entry.version}</span>
              </div>
            ))}
            <div className="docs-panel-actions">
              <input value={syncDir} onChange={(e) => setSyncDir(e.target.value)} aria-label="同步目录" />
              <button className="btn small ghost" onClick={() => void previewSync()} disabled={busy === 'sync-preview'}>重新预览</button>
              <button className="btn small primary" onClick={() => void applySync(false)} disabled={busy === 'sync-apply'}>应用（跳过冲突）</button>
              {syncPreview.summary.conflict > 0 && (
                <button className="btn small ghost" onClick={() => void applySync(true)} disabled={busy === 'sync-apply'}>强制覆盖冲突</button>
              )}
            </div>
          </div>
        )}

        {issues && (
          <div className="docs-panel">
            <div className="docs-panel-head">
              <b>一致性检查（{issues.length}）</b>
              <span className="spacer" />
              <button className="btn small ghost" onClick={() => setIssues(null)}>收起</button>
            </div>
            {issues.length === 0 && <div className="rail-empty">未发现明显不一致。</div>}
            {issues.map((issue, index) => (
              <button
                key={`${issue.code}-${index}`}
                className={`docs-issue ${issue.severity}`}
                onClick={() => issue.documentId && setSelectedId(issue.documentId)}
              >
                <span className={`badge ${issue.severity === 'error' ? 'red' : 'amber'}`}>{issue.severity}</span>
                <span>{issue.message}</span>
                {issue.ref && <code>{issue.ref}</code>}
              </button>
            ))}
          </div>
        )}

        <div className="docs-layout">
          <aside className="docs-side">
            <div className="section-label">文档类型</div>
            <button className={`docs-type ${activeType === 'all' ? 'active' : ''}`} onClick={() => setActiveType('all')}>
              <span>全部文档</span><b>{docs.length}</b>
            </button>
            {DOC_TYPES.map((item) => (
              <button key={item.type} className={`docs-type ${activeType === item.type ? 'active' : ''}`} onClick={() => setActiveType(item.type)}>
                <span>{item.label}</span><b>{counts.get(item.type) ?? 0}</b>
              </button>
            ))}
            <div className="section-label" style={{ marginTop: 14 }}>文档（{filtered.length}）</div>
            {filtered.length === 0 && <div className="rail-empty">暂无文档。完成入驻或点击“刷新文档”。</div>}
            {filtered.map((item) => (
              <button key={item.id} className={`docs-list-item ${selectedId === item.id ? 'active' : ''}`} onClick={() => setSelectedId(item.id)}>
                <span className="docs-list-title">{item.title}</span>
                <span className="docs-list-meta">
                  <span>{typeLabel(item.docType)} · v{item.version}</span>
                  <span className={`badge ${STATUS_META[item.status].cls}`}>{STATUS_META[item.status].label}</span>
                </span>
                <span className="docs-list-summary">{item.summary || '（无摘要）'}</span>
              </button>
            ))}
          </aside>

          <section className="docs-detail">
            {activeType !== 'all' && filtered.length === 0 && (
              <div className="docs-empty-generate">
                <Icon name="sparkles" size={24} style={{ color: 'var(--cyan)' }} />
                <p>当前项目还没有「{DOC_TYPES.find((item) => item.type === activeType)?.label}」文档。</p>
                <button className="btn primary" onClick={() => void generateType()} disabled={!!busy || !!generatingType}>
                  <Icon name="sparkles" size={14} />
                  {generatingType === activeType ? '生成中…' : '生成该类文档'}
                </button>
                <span className="hint">确定性类型会立即生成；AI 类型会在只读 worktree 中生成草稿。</span>
              </div>
            )}
            {!(activeType !== 'all' && filtered.length === 0) && !detail && <div className="rail-empty">选择左侧文档查看详情。</div>}
            {detail && doc && (activeType === 'all' || filtered.length > 0) && (
              <>
                <div className="docs-detail-head">
                  <div>
                    <h3>{doc.title}</h3>
                    <div className="docs-meta">
                      <span className={`badge ${STATUS_META[doc.status].cls}`}>{STATUS_META[doc.status].label}</span>
                      <span className="badge">v{doc.version}</span>
                      <span className="badge cyan">{typeLabel(doc.docType)}</span>
                      {doc.autoUpdate && <span className="badge green">自动更新</span>}
                      {doc.pinned && <span className="badge amber">人工锁定</span>}
                      {doc.lastSyncedAt && <span className="badge">已同步 {fmtTime(doc.lastSyncedAt)}</span>}
                    </div>
                  </div>
                  <div className="docs-actions">
                    <button className="btn small primary" onClick={() => void regenerate()} disabled={running || !!busy}>
                      <Icon name="sparkles" size={13} />
                      {running ? '生成中…' : '重新生成'}
                    </button>
                    {running && (
                      <button className="btn small ghost" onClick={() => void run('cancel', () => api.cancelDocument(doc.id), '已请求取消')}>
                        取消
                      </button>
                    )}
                    {!editing && <button className="btn small ghost" onClick={startEdit}>编辑</button>}
                    {editing && (
                      <>
                        <button className="btn small primary" onClick={() => void saveEdit()} disabled={busy === 'save'}>保存</button>
                        <button className="btn small ghost" onClick={() => setEditing(false)}>取消编辑</button>
                      </>
                    )}
                    {doc.status !== 'published' && (
                      <button className="btn small ghost" onClick={() => void run('publish', () => api.publishDocument(doc.id), '文档已发布')}>发布</button>
                    )}
                    <button className="btn small ghost" onClick={() => void run('pin', () => api.pinDocument(doc.id, !doc.pinned), doc.pinned ? '已解锁' : '已锁定')}>
                      {doc.pinned ? '解锁' : '锁定'}
                    </button>
                    <button className="btn small ghost" onClick={() => setShowVersions((v) => !v)}>版本历史</button>
                  </div>
                </div>

                <div className="docs-source">
                  <span>来源：{doc.source}</span>
                  <span>生成：{doc.generatedBy ?? '—'}{doc.model ? ` · ${doc.model}` : ''}</span>
                  <span>源提交：<code>{doc.sourceCommit ? doc.sourceCommit.slice(0, 10) : '—'}</code></span>
                  <span>最近生成：{fmtTime(doc.lastGeneratedAt)}</span>
                  {detail.sync && <span>同步路径：<code>{detail.sync.targetPath}</code></span>}
                </div>

                {detail.job?.status === 'running' && (
                  <div className="docs-running">
                    <Icon name="refresh" size={14} className="spin" />
                    正在生成，心跳 {fmtTime(detail.job.heartbeatAt)}
                  </div>
                )}
                {doc.error && <div className="profile-error">{doc.error}</div>}

                {editing ? (
                  <div className="docs-editor">
                    <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} aria-label="文档标题" />
                    <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} spellCheck={false} />
                  </div>
                ) : (
                  <div className="arch-doc docs-content">
                    <Markdown text={doc.content || '（尚无内容，点击重新生成）'} />
                  </div>
                )}

                {showVersions && (
                  <div className="docs-versions">
                    <div className="section-label">版本历史（{detail.versions.length}）</div>
                    {detail.versions.map((version) => (
                      <div className="docs-version-row" key={version.id}>
                        <span>v{version.version}</span>
                        <span>{version.createdBy}</span>
                        <span>{fmtTime(version.createdAt)}</span>
                        <span className="spacer" />
                        <button
                          className="btn small ghost"
                          disabled={version.version === doc.version || !!busy}
                          onClick={() =>
                            void run(
                              `rollback-${version.version}`,
                              () => api.rollbackDocument(doc.id, version.version),
                              `已回滚到 v${version.version}（新草稿）`,
                            )
                          }
                        >
                          回滚到此版
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
