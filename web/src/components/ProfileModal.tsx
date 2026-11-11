import { useCallback, useEffect, useState } from 'react';
import type { Project, ProjectProfileRecord } from '@acp-scrum/shared';
import { api } from '../api';
import { Icon } from '../icons';
import { Markdown } from './Markdown';

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  idle: { label: '未入驻', cls: '' },
  scanning: { label: '扫描中', cls: 'cyan' },
  analyzing: { label: '生成架构', cls: 'cyan' },
  baselining: { label: '建立基线', cls: 'cyan' },
  done: { label: '已入驻', cls: 'green' },
  error: { label: '失败', cls: 'red' },
};

export function ProfileModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const [record, setRecord] = useState<ProjectProfileRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.profile(project.id).then(setRecord).catch(() => undefined), [project.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!record || !['scanning', 'analyzing', 'baselining'].includes(record.status)) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [record?.status, load]);

  const startOnboard = async () => {
    setBusy(true);
    try {
      await api.onboard(project.id);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const running = record && ['scanning', 'analyzing', 'baselining'].includes(record.status);
  const st = STATUS_LABEL[record?.status ?? 'idle'];
  const p = record?.profile;

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="项目档案">
        <div className="modal-head">
          <Icon name="file" size={18} style={{ color: 'var(--indigo-bright)', marginRight: 10 }} />
          <h3>项目档案 · {project.name}</h3>
          <span className={`badge ${st.cls}`} style={{ marginLeft: 'auto' }}>{st.label}</span>
          <button className="btn icon ghost" onClick={onClose} aria-label="关闭" style={{ marginLeft: 8 }}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="modal-body profile-body">
          {!record && <div className="rail-empty">加载中…</div>}

          {record && record.status === 'idle' && (
            <div className="profile-empty">
              <Icon name="sparkles" size={28} style={{ color: 'var(--cyan)' }} />
              <p>尚未入驻分析。启动后系统将扫描技术栈、生成架构文档并建立回归基线。</p>
            </div>
          )}

          {record?.error && <div className="profile-error">入驻失败：{record.error}</div>}

          {running && (
            <div className="profile-running">
              <Icon name="refresh" size={16} className="spin" style={{ color: 'var(--cyan)' }} />
              {st.label}… agent 正在隔离 worktree 中分析仓库
            </div>
          )}

          {p && (
            <>
              <div className="section-label">技术栈</div>
              <div className="profile-chips">
                {p.languages.map((l) => <span className="chip" key={l}>{l}</span>)}
                {p.frameworks.map((f) => <span className="chip" key={f} style={{ color: 'var(--cyan)' }}>{f}</span>)}
                {p.packageManager && <span className="chip">{p.packageManager}</span>}
              </div>
              <div className="profile-cols">
                <div>
                  <div className="section-label">测试命令</div>
                  {p.testCommands.length ? p.testCommands.map((c) => <div className="cmd-line" key={c}>$ {c}</div>) : <div className="rail-empty">未发现</div>}
                </div>
                <div>
                  <div className="section-label">构建命令</div>
                  {p.buildCommands.length ? p.buildCommands.map((c) => <div className="cmd-line" key={c}>$ {c}</div>) : <div className="rail-empty">未发现</div>}
                </div>
              </div>
            </>
          )}

          {record && record.baseline.length > 0 && (
            <>
              <div className="section-label" style={{ marginTop: 16 }}>回归基线</div>
              {record.baseline.map((b) => (
                <div className="dod-item" key={b.command}>
                  <span className={`mark ${b.ok ? 'pass' : 'fail'}`}><Icon name={b.ok ? 'check' : 'x'} size={14} /></span>
                  <div className="info">
                    <div className="label">{b.command}</div>
                    <pre>{b.output}</pre>
                  </div>
                  <span className={`badge ${b.ok ? 'green' : 'red'}`}>{b.ok ? 'PASS' : 'FAIL'}</span>
                </div>
              ))}
            </>
          )}

          {record?.architecture && (
            <>
              <div className="section-label" style={{ marginTop: 16 }}>架构文档（活文档）</div>
              <div className="arch-doc"><Markdown text={record.architecture} /></div>
            </>
          )}
        </div>
        <div className="modal-foot">
          <span className="hint" style={{ marginRight: 'auto', fontSize: 11.5, color: 'var(--text-low)' }}>
            分析在隔离 worktree 进行，不改动主仓库
          </span>
          <button className="btn ghost" onClick={onClose}>关闭</button>
          <button className="btn primary" disabled={busy || !!running} onClick={startOnboard}>
            <Icon name="sparkles" size={14} />
            {record?.status === 'done' ? '重新分析' : '启动入驻分析'}
          </button>
        </div>
      </div>
    </div>
  );
}