import { useEffect, useMemo, useState } from 'react';
import type { AgentSession, EventRow, TeamRun } from '@acp-scrum/shared';
import { api, type BoardStory } from '../api';
import { Icon } from '../icons';
import { PHASE_META, PHASE_ORDER, ROLE_META, STATUS_META, StatusTag, coalesceEvents, timeOf } from '../ui';

type Tab = 'overview' | 'live' | 'dod' | 'diff' | 'team';

function DiffView({ diff }: { diff: string }) {
  if (!diff.trim()) return <div className="rail-empty">暂无差异（agent 尚未产生改动）</div>;
  return (
    <div className="diff-view">
      {diff.split('\n').map((line, i) => {
        let cls = '';
        if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git') || line.startsWith('new file')) cls = 'file';
        else if (line.startsWith('@@')) cls = 'hunk';
        else if (line.startsWith('+')) cls = 'add';
        else if (line.startsWith('-')) cls = 'del';
        return (
          <div key={i} className={cls}>
            {line || ' '}
          </div>
        );
      })}
    </div>
  );
}

function LiveTab({ events }: { events: EventRow[] }) {
  const items = coalesceEvents(events).filter((e) => ['agent.message', 'agent.tool', 'agent.plan'].includes(e.type));
  if (items.length === 0) return <div className="rail-empty">等待 agent 开始工作…</div>;
  return (
    <div className="transcript">
      {items.map((e) => {
        const p = e.payload;
        if (p.type === 'agent.message') {
          return (
            <div className={`bubble ${p.role}`} key={e.seq}>
              <span className="who">{p.role === 'agent' ? 'Agent' : p.role === 'thought' ? '思考' : '指令'} · {timeOf(e.ts)}</span>
              {p.text}
            </div>
          );
        }
        if (p.type === 'agent.tool') {
          const color = p.status === 'completed' ? 'var(--green)' : p.status === 'failed' ? 'var(--red)' : 'var(--cyan)';
          return (
            <div className="tool-line" key={e.seq}>
              <Icon name="terminal" size={13} style={{ color }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title || p.toolCallId}</span>
              <span className="st" style={{ color }}>{p.status}</span>
            </div>
          );
        }
        if (p.type === 'agent.plan') {
          return (
            <div className="plan-box" key={e.seq}>
              <div className="section-label" style={{ color: 'var(--magenta)' }}>执行计划</div>
              {p.entries.map((x, i) => (
                <div className="plan-entry" key={i}>
                  <span className="pi" style={{ color: x.status === 'completed' ? 'var(--green)' : x.status === 'in_progress' ? 'var(--cyan)' : 'var(--text-low)' }}>
                    <Icon name={x.status === 'completed' ? 'check' : x.status === 'in_progress' ? 'play' : 'dot'} size={12} />
                  </span>
                  <span style={{ textDecoration: x.status === 'completed' ? 'line-through' : 'none', opacity: x.status === 'completed' ? 0.6 : 1 }}>{x.content}</span>
                </div>
              ))}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

function TeamTab({ run, sessions }: { run: TeamRun | null; sessions: AgentSession[] }) {
  if (!run) return <div className="rail-empty">该故事尚未启动团队编排（solo 模式或无团队运行记录）。</div>;
  const currentIdx = PHASE_ORDER.indexOf(run.phase);
  const teamSessions = sessions.filter((s) => s.role !== 'solo');
  return (
    <>
      <div className="section-label">编排阶段</div>
      <div className="phase-track">
        {PHASE_ORDER.map((p, i) => {
          const m = PHASE_META[p];
          const state = i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'todo';
          return (
            <div className={`phase-node ${state}`} key={p} style={{ ['--pc' as string]: m.color }}>
              <span className="phase-dot">{state === 'done' ? <Icon name="check" size={12} /> : i + 1}</span>
              <span className="phase-label">{m.label}</span>
            </div>
          );
        })}
      </div>

      <div className="team-grid">
        <div className="team-stat">
          <span className="ts-label">循环</span>
          <span className="ts-value">{run.turns}</span>
        </div>
        <div className="team-stat">
          <span className="ts-label">Token 峰值</span>
          <span className="ts-value">{run.tokens.toLocaleString()}</span>
        </div>
        <div className="team-stat">
          <span className="ts-label">QA 结论</span>
          <span className="ts-value" style={{ color: run.verdict ? (run.verdict.pass ? 'var(--green)' : 'var(--red)') : 'var(--text-low)' }}>
            {run.verdict ? (run.verdict.pass ? '通过' : '不通过') : '—'}
          </span>
        </div>
      </div>

      {run.verdict && !run.verdict.pass && run.verdict.issues.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 18 }}>QA 问题</div>
          <div className="bdd" style={{ borderLeftColor: 'var(--red)' }}>{run.verdict.issues.map((i) => `• ${i}`).join('\n')}</div>
        </>
      )}

      <div className="section-label" style={{ marginTop: 18 }}>实现计划（Lead）</div>
      {run.plan.length === 0 && <div className="rail-empty">无结构化计划</div>}
      {run.plan.map((t) => (
        <div className="plan-task" key={t.id}>
          <span className="pt-id">{t.id}</span>
          <div className="pt-body">
            <div className="pt-title">{t.title}</div>
            {t.files.length > 0 && <div className="pt-files">{t.files.join(' · ')}</div>}
          </div>
        </div>
      ))}

      <div className="section-label" style={{ marginTop: 18 }}>角色会话</div>
      {teamSessions.map((s) => {
        const m = ROLE_META[s.role];
        return (
          <div className="role-row" key={s.id}>
            <span className="role-badge" style={{ color: m.color, background: `color-mix(in srgb, ${m.color} 14%, transparent)` }}>
              <Icon name={m.icon} size={12} />
              {m.label}
            </span>
            <span className="role-kind">{s.agentKind}</span>
            <span className={`badge ${s.status === 'running' ? 'cyan' : s.status === 'error' ? 'red' : ''}`} style={{ marginLeft: 'auto' }}>{s.status}</span>
          </div>
        );
      })}
    </>
  );
}

export function Drawer({
  story,
  events,
  busy,
  onClose,
  onAction,
  onResume,
}: {
  story: BoardStory;
  events: EventRow[];
  busy: boolean;
  onClose: () => void;
  onAction: (a: 'approve' | 'start' | 'rework' | 'accept') => void;
  onResume: (message: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const [diff, setDiff] = useState<string>('');
  const [resumeMsg, setResumeMsg] = useState('');
  const [team, setTeam] = useState<{ run: TeamRun | null; sessions: AgentSession[] }>({ run: null, sessions: [] });
  const storyEvents = useMemo(() => events.filter((e) => e.storyId === story.id), [events, story.id]);

  useEffect(() => {
    if (tab === 'diff') api.storyDiff(story.id).then((r) => setDiff(r.diff)).catch(() => setDiff(''));
  }, [tab, story.id, story.status]);

  useEffect(() => {
    if (tab === 'team') api.team(story.id).then(setTeam).catch(() => undefined);
  }, [tab, story.id, story.status, events.length]);

  const m = STATUS_META[story.status];
  const passCount = story.dod.filter((d) => d.command && d.status === 'pass').length;
  const cmdCount = story.dod.filter((d) => d.command).length;

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label={story.title}>
        <div className="drawer-head">
          <div className="row">
            <h2 className="drawer-title">{story.title}</h2>
            <StatusTag status={story.status} />
            <button className="btn icon ghost" onClick={onClose} aria-label="关闭">
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className="drawer-meta">
            {story.branch && (
              <span className="chip">
                <Icon name="branch" size={11} />
                {story.branch}
              </span>
            )}
            <span className="chip">
              <Icon name="clipboard" size={11} />
              DoD {passCount}/{cmdCount}
            </span>
            <span className="chip">
              <Icon name="clock" size={11} />
              {timeOf(story.createdAt)}
            </span>
          </div>
        </div>

        <div className="drawer-tabs">
          {([
            ['overview', '概览', 'file'],
            ['live', '实时', 'activity'],
            ['team', '团队', 'layers'],
            ['dod', 'DoD', 'clipboard'],
            ['diff', 'Diff', 'code'],
          ] as [Tab, string, 'file' | 'activity' | 'layers' | 'clipboard' | 'code'][]).map(([id, label, icon]) => (
            <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name={icon} size={13} />
                {label}
                {id === 'live' && storyEvents.length > 0 && <span className="badge cyan" style={{ marginLeft: 2 }}>{storyEvents.length}</span>}
              </span>
            </button>
          ))}
        </div>

        <div className="drawer-body">
          {tab === 'overview' && (
            <>
              <div className="section-label">故事描述</div>
              <p className="prose">{story.description || '（无描述）'}</p>
              <div className="section-label" style={{ marginTop: 20 }}>验收标准 · BDD</div>
              <div className="bdd">{story.acceptanceCriteria || '（未提供）'}</div>
            </>
          )}
          {tab === 'live' && <LiveTab events={storyEvents} />}
          {tab === 'dod' && (
            <>
              {story.dod.map((d) => (
                <div className="dod-item" key={d.id}>
                  <span className={`mark ${d.status === 'pass' ? 'pass' : d.status === 'fail' ? 'fail' : 'pending'}`}>
                    <Icon name={d.status === 'pass' ? 'check' : d.status === 'fail' ? 'x' : d.kind === 'human' ? 'user' : 'clock'} size={14} />
                  </span>
                  <div className="info">
                    <div className="label">{d.label}</div>
                    {d.command && <div className="cmd">$ {d.command}</div>}
                    {d.evidence && <pre>{d.evidence}</pre>}
                  </div>
                  <span className={`badge ${d.status === 'pass' ? 'green' : d.status === 'fail' ? 'red' : ''}`}>{d.status}</span>
                </div>
              ))}
            </>
          )}
          {tab === 'diff' && <DiffView diff={diff} />}
          {tab === 'team' && <TeamTab run={team.run} sessions={team.sessions} />}
        </div>

        <div className="drawer-foot">
          <span className="hint" style={{ color: m.color }}>
            {story.status === 'draft' && '等待人工批准进入 Ready'}
            {story.status === 'ready' && '已就绪，可启动 agent 开发'}
            {story.status === 'in_dev' && 'agent 正在隔离 worktree 中开发'}
            {story.status === 'review' && 'DoD 已通过，等待人工验收合并'}
            {story.status === 'done' && '已合并到主分支'}
            {story.status === 'blocked' && '已阻塞，需人工介入'}
          </span>
          {story.status === 'draft' && (
            <button className="btn primary" disabled={busy} onClick={() => onAction('approve')}>
              <Icon name="check" size={14} />
              批准就绪
            </button>
          )}
          {story.status === 'ready' && (
            <button className="btn cyan" disabled={busy} onClick={() => onAction('start')}>
              <Icon name="play" size={14} />
              启动开发
            </button>
          )}
          {(story.status === 'in_dev' || story.status === 'blocked') && (
            <>
              <input
                className="resume-input"
                value={resumeMsg}
                onChange={(e) => setResumeMsg(e.target.value)}
                placeholder="给 agent 的继续指令（留空用默认）"
                aria-label="继续指令"
              />
              <button
                className="btn cyan"
                disabled={busy}
                onClick={() => {
                  onResume(resumeMsg.trim() || '请继续完成该故事，确保满足验收标准与 DoD。');
                  setResumeMsg('');
                }}
              >
                <Icon name="play" size={14} />
                继续
              </button>
              <button className="btn" disabled={busy} onClick={() => setTab('live')}>
                <Icon name="activity" size={14} />
                实时
              </button>
            </>
          )}
          {story.status === 'review' && (
            <>
              <button className="btn" disabled={busy} onClick={() => onAction('rework')}>
                <Icon name="refresh" size={14} />
                退回修改
              </button>
              <button className="btn amber" disabled={busy} onClick={() => onAction('accept')}>
                <Icon name="merge" size={14} />
                验收并合并
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}