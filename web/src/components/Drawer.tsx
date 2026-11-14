import { useEffect, useMemo, useState } from 'react';
import type {
  AgentSession,
  Category,
  EventRow,
  Handoff,
  Project,
  Release,
  StoryDependencyInfo,
  Tag,
  TeamRun,
} from '@riccon-scrum/shared';
import { api, type BoardStory } from '../api';
import { Icon } from '../icons';
import { PHASE_META, PHASE_ORDER, ROLE_META, STATUS_META, StatusTag, coalesceEvents, timeOf } from '../ui';
import { CategorySelect } from './CategoryPicker';
import { confirmAction } from './ConfirmDialog';
import { DependencyPeekModal, type DependencyPeekTarget } from './DependencyPeekModal';
import { DependencySuggestModal } from './DependencySuggestModal';
import { TagEditor } from './TagPicker';
import { TaskTab } from './TaskTab';
import { BugReportModal } from './BugReportModal';

type Tab = 'overview' | 'live' | 'tasks' | 'dod' | 'diff' | 'team';

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
            <span className="role-kind">{s.agentKind}{s.model ? ` · ${s.model}` : ''}</span>
            <span className={`badge ${s.status === 'running' ? 'cyan' : s.status === 'error' ? 'red' : ''}`} style={{ marginLeft: 'auto' }}>{s.status}</span>
          </div>
        );
      })}
    </>
  );
}

export function Drawer({
  story,
  project,
  events,
  busy,
  categories,
  tags,
  allStories,
  onClose,
  onAction,
  onRework,
  onResume,
  onToast,
  onChanged,
  onTagsChanged,
  onOpenStory,
}: {
  story: BoardStory;
  project: Project;
  events: EventRow[];
  busy: boolean;
  categories: Category[];
  tags: Tag[];
  allStories: BoardStory[];
  onClose: () => void;
  onAction: (a: 'approve' | 'start' | 'rework' | 'accept') => void;
  onRework: (reason: string) => Promise<void>;
  onResume: (message: string) => void;
  onToast: (kind: 'success' | 'error' | 'info', text: string) => void;
  onChanged: () => Promise<void>;
  onTagsChanged?: () => Promise<void>;
  onOpenStory?: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const [diff, setDiff] = useState<{ diff: string; files: { path: string; added: number; removed: number; risk: 'high' | 'medium' | 'low' }[]; risk: 'high' | 'medium' | 'low' }>({
    diff: '',
    files: [],
    risk: 'low',
  });
  const [resumeMsg, setResumeMsg] = useState('');
  const [reworkReason, setReworkReason] = useState('');
  const [acFeedback, setAcFeedback] = useState('');
  const [team, setTeam] = useState<{ run: TeamRun | null; sessions: AgentSession[] }>({ run: null, sessions: [] });
  const [release, setRelease] = useState<Release | null>(null);
  const [releasing, setReleasing] = useState<'release' | 'rollback' | null>(null);
  const [deps, setDeps] = useState<StoryDependencyInfo | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [depCandidate, setDepCandidate] = useState('');
  const [depBusy, setDepBusy] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [peek, setPeek] = useState<DependencyPeekTarget | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [bugOpen, setBugOpen] = useState(false);
  const storyEvents = useMemo(() => events.filter((e) => e.storyId === story.id), [events, story.id]);
  const lastEventSeq = events[events.length - 1]?.seq ?? 0;

  useEffect(() => {
    if (tab === 'diff') api.storyDiff(story.id).then(setDiff).catch(() => undefined);
  }, [tab, story.id, story.status]);

  useEffect(() => {
    if (tab === 'team') api.team(story.id).then(setTeam).catch(() => undefined);
  }, [tab, story.id, story.status, lastEventSeq]);

  useEffect(() => {
    if (story.status !== 'done') {
      setRelease(null);
      setHandoff(null);
      return;
    }
    api.releaseStatus(story.id).then(setRelease).catch(() => undefined);
    api.storyHandoff(story.id).then(setHandoff).catch(() => undefined);
  }, [story.id, story.status, lastEventSeq]);

  const refreshDeps = () => api.storyDependencies(story.id).then(setDeps).catch(() => undefined);

  useEffect(() => {
    void refreshDeps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.id, story.status, lastEventSeq]);

  const addPredecessor = async () => {
    if (!depCandidate) return;
    const ok = await confirmAction({
      title: '添加前置依赖',
      message: '该故事必须等前置故事完成后才能启动。',
      detail: `前置：${depName(depCandidate)}\n当前：${story.title}`,
      confirmText: '添加依赖',
    });
    if (!ok) return;
    setDepBusy('add');
    try {
      await api.createDependency({
        projectId: story.projectId,
        predecessorType: 'story',
        predecessorId: depCandidate,
        successorType: 'story',
        successorId: story.id,
      });
      setDepCandidate('');
      await refreshDeps();
      onToast('success', '前置故事已添加');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setDepBusy(null);
    }
  };

  const removeDependency = async (id: string) => {
    const ok = await confirmAction({
      title: '移除前置依赖',
      message: '移除后该故事不再被该前置故事阻塞。',
      detail: depName(id),
      confirmText: '移除依赖',
      tone: 'warning',
    });
    if (!ok) return;
    setDepBusy(id);
    try {
      await api.deleteDependency(id);
      await refreshDeps();
      onToast('info', '依赖已移除');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setDepBusy(null);
    }
  };

  const forceStart = async () => {
    if (!overrideReason.trim()) {
      onToast('error', '请填写强制开始原因');
      return;
    }
    const ok = await confirmAction({
      title: '强制跳过前置依赖',
      message: '跳过前置会记录越权原因，可能引入集成风险。',
      detail: `故事：${story.title}\n原因：${overrideReason.trim()}`,
      confirmText: '强制启动',
      tone: 'danger',
    });
    if (!ok) return;
    setDepBusy('override');
    try {
      await api.forceStartStory(story.id, overrideReason.trim());
      setOverrideReason('');
      onToast('success', '已强制启动，已记录越权原因');
      await onChanged();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setDepBusy(null);
    }
  };

  const changeCategory = async (categoryId: string | null) => {
    setCategoryBusy(true);
    try {
      await api.setStoryCategory(story.id, categoryId);
      await onChanged();
      onToast('success', '故事分类已更新');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setCategoryBusy(false);
    }
  };

  const changeTags = async (next: Tag[]) => {
    try {
      await api.setStoryTags(story.id, next.map((tag) => tag.id));
      await onChanged();
      onToast('success', '故事标签已更新');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    }
  };

  const createTag = async (name: string): Promise<Tag | null> => {
    try {
      const tag = await api.createTag({ projectId: project.id, name });
      await onTagsChanged?.();
      return tag;
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
      return null;
    }
  };

  const dependencyTargets = useMemo(() => {
    const existing = new Set((deps?.predecessors ?? []).map((item) => item.id));
    return allStories.filter((item) => item.id !== story.id && !existing.has(item.id));
  }, [allStories, story.id, deps]);

  const depName = (id: string) => allStories.find((item) => item.id === id)?.title ?? id;

  const doRelease = async () => {
    const ok = await confirmAction({
      title: '发布故事',
      message: '将执行项目配置的发布命令，可能影响线上环境。',
      detail: story.title,
      confirmText: '执行发布',
      tone: 'warning',
    });
    if (!ok) return;
    setReleasing('release');
    try {
      const result = await api.release(story.id);
      setRelease(result);
      onToast(result.status === 'succeeded' ? 'success' : 'error', result.status === 'succeeded' ? '发布成功' : '发布失败，查看输出');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setReleasing(null);
    }
  };

  const doRollback = async () => {
    const ok = await confirmAction({
      title: '回滚发布',
      message: '将执行项目配置的回滚命令，线上版本会回退到上一个版本。',
      detail: story.title,
      confirmText: '执行回滚',
      tone: 'danger',
    });
    if (!ok) return;
    setReleasing('rollback');
    try {
      const result = await api.rollback(story.id);
      setRelease(result);
      onToast(result.status === 'rolled_back' ? 'success' : 'error', result.status === 'rolled_back' ? '回滚成功' : '回滚失败，查看输出');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setReleasing(null);
    }
  };

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
            <button className="btn icon ghost" onClick={onClose} aria-label="关闭" data-tip="关闭故事详情，返回看板">
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
            <CategorySelect
              categories={categories}
              value={story.categoryId}
              onChange={changeCategory}
              disabled={categoryBusy}
            />
            <button className="btn small ghost" onClick={() => setBugOpen(true)} data-tip="上报该故事的缺陷，提交后进入 Bug 分诊队列">
              <Icon name="alert" size={12} />
              反馈 Bug
            </button>
          </div>
        </div>

        <div className="drawer-tabs">
          {([
            ['overview', '概览', 'file'],
            ['live', '实时', 'activity'],
            ['tasks', '任务', 'list'],
            ['team', '团队', 'layers'],
            ['dod', 'DoD', 'clipboard'],
            ['diff', 'Diff', 'code'],
          ] as [Tab, string, 'file' | 'activity' | 'list' | 'layers' | 'clipboard' | 'code'][]).map(([id, label, icon]) => (
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
              <div className="section-label">标签</div>
              <TagEditor
                allTags={tags}
                selected={story.tags ?? []}
                onChange={(next) => void changeTags(next)}
                onCreate={createTag}
              />
              <div className="section-label" style={{ marginTop: 20 }}>故事描述</div>
              <p className="prose">{story.description || '（无描述）'}</p>
              <div className="section-label" style={{ marginTop: 20 }}>验收标准 · BDD</div>
              <div className="bdd">{story.acceptanceCriteria || '（未提供）'}</div>

              <div className="section-label" style={{ marginTop: 20 }}>依赖关系</div>
              {deps?.blockedBy.length ? (
                <div className="req-note warn">
                  等待前置：{deps.blockedBy.map((item) => item.title).join('；')}
                </div>
              ) : (
                <div className="req-note ok">前置已满足或未设置前置。</div>
              )}
              <div className="dep-editor">
                <div className="dep-group">
                  <span className="dep-label">前置故事</span>
                  {deps?.predecessors.length === 0 && <span className="hint">暂无</span>}
                  {deps?.predecessors.map((item) => (
                    <span
                      className={`dep-chip clickable ${item.status === 'done' ? 'done' : ''}`}
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setPeek({ type: 'story', id: item.id, title: item.title, status: item.status })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setPeek({ type: 'story', id: item.id, title: item.title, status: item.status });
                      }}
                    >
                      <Icon name={item.status === 'done' ? 'check' : 'clock'} size={11} />
                      {depName(item.id)}
                      <button
                        className="dep-remove"
                        aria-label={`移除前置 ${depName(item.id)}`}
                        data-tip={`移除前置依赖：${depName(item.id)}`}
                        disabled={depBusy === item.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeDependency(item.id);
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className="dep-group">
                  <span className="dep-label">后续故事</span>
                  {deps?.successors.length === 0 && <span className="hint">暂无</span>}
                  {deps?.successors.map((item) => (
                    <span
                      className="dep-chip clickable"
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setPeek({ type: 'story', id: item.id, title: item.title, status: item.status })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setPeek({ type: 'story', id: item.id, title: item.title, status: item.status });
                      }}
                    >
                      {item.title}
                    </span>
                  ))}
                </div>
                <div className="dep-add">
                  <select value={depCandidate} onChange={(e) => setDepCandidate(e.target.value)} aria-label="添加上游故事">
                    <option value="">添加上游故事…</option>
                    {dependencyTargets.map((item) => (
                      <option key={item.id} value={item.id}>
                        [{item.status}] {item.title}
                      </option>
                    ))}
                  </select>
                  <button className="btn small" disabled={!depCandidate || depBusy === 'add'} onClick={addPredecessor} data-tip="把选中的上游故事设为当前故事的前置依赖">
                    <Icon name="plus" size={12} />
                    添加
                  </button>
                  <button className="btn small ghost" disabled={depBusy !== null} onClick={() => setSuggestOpen(true)} data-tip="让 AI 推荐可添加的前置依赖，确认后才创建">
                    <Icon name="sparkles" size={12} />
                    AI 建议依赖
                  </button>
                </div>
              </div>

              {story.status === 'ready' && deps?.blockedBy.length ? (
                <div className="dep-override">
                  <div className="req-note warn">前置未完成，直接启动会被门禁拦截。</div>
                  <input
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="强制开始原因（必填，会记录审计事件）"
                  />
                  <button className="btn small amber" disabled={depBusy === 'override' || !overrideReason.trim()} onClick={forceStart} data-tip="跳过未完成的前置依赖强制启动，会记录越权原因">
                    <Icon name="play" size={12} />
                    强制开始
                  </button>
                </div>
              ) : null}
              {story.status === 'done' && handoff && (
                <div className="handoff-box">
                  <div className="section-label">交付物 Handoff</div>
                  <div className="req-note">{handoff.summary}</div>
                  {handoff.files.length > 0 && (
                    <div className="handoff-files">
                      {handoff.files.slice(0, 10).map((file) => (
                        <span className="chip" key={file.path}>
                          {file.path} <em>+{file.added}/-{file.removed}</em>
                        </span>
                      ))}
                    </div>
                  )}
                  {handoff.contracts && <div className="req-note">契约：{handoff.contracts}</div>}
                  {handoff.migrations.length > 0 && <div className="req-note">迁移：{handoff.migrations.join('、')}</div>}
                  {handoff.dod.length > 0 && <div className="req-note">测试/门禁：{handoff.dod.join('；')}</div>}
                  {handoff.decisions.length > 0 && <div className="req-note">决策：{handoff.decisions.join('；')}</div>}
                </div>
              )}
              {story.status === 'done' && (
                <div className="release-box">
                  <div className="section-label">发布</div>
                  <div className="release-status">
                    状态：<b>{release?.status ?? '未发布'}</b>
                    {release && <span className="hint"> · {timeOf(release.updatedAt)}</span>}
                  </div>
                  {release?.output && <pre className="release-output">{release.output}</pre>}
                  <div className="req-actions">
                    <button className="btn small cyan" disabled={!project.releaseCommand || releasing !== null || release?.status === 'succeeded'} onClick={doRelease} data-tip={project.releaseCommand ? '执行项目发布命令，将已完成故事部署到目标环境' : '项目未配置发布命令，请先到交付与门禁设置'}>
                      <Icon name="play" size={12} />
                      {releasing === 'release' ? '发布中…' : '发布'}
                    </button>
                    <button className="btn small" disabled={!project.rollbackCommand || releasing !== null || release?.status !== 'succeeded'} onClick={doRollback} data-tip={project.rollbackCommand ? '执行回滚命令，将目标环境恢复到上一个发布版本' : '项目未配置回滚命令，请先到交付与门禁设置'}>
                      <Icon name="refresh" size={12} />
                      {releasing === 'rollback' ? '回滚中…' : '回滚'}
                    </button>
                  </div>
                  {!project.releaseCommand && <div className="hint">未配置发布命令，请在设置页填写。</div>}
                  {!project.rollbackCommand && <div className="hint">未配置回滚命令，请在设置页填写。</div>}
                </div>
              )}
            </>
          )}
          {tab === 'live' && <LiveTab events={storyEvents} />}
          {tab === 'tasks' && (
            <TaskTab
              storyId={story.id}
              projectId={story.projectId}
              storyStatus={story.status}
              acIds={story.acceptance.map((ac) => ac.acId)}
              lastEventSeq={lastEventSeq}
              onToast={onToast}
              onChanged={onChanged}
            />
          )}
          {tab === 'dod' && (
            <>
              {story.acceptance.length > 0 && (
                <>
                  <div className="section-label">验收标准证据（{story.acceptance.filter((a) => a.status === 'pass').length}/{story.acceptance.length}）</div>
                  {story.acceptance.map((ac) => (
                    <div className="dod-item" key={ac.id}>
                      <span className={`mark ${ac.status === 'pass' ? 'pass' : ac.status === 'fail' ? 'fail' : 'pending'}`}>
                        <Icon name={ac.status === 'pass' ? 'check' : ac.status === 'fail' ? 'x' : 'clock'} size={14} />
                      </span>
                      <div className="info">
                        <div className="label">{ac.acId}</div>
                        <div className="cmd">Given {ac.given} · When {ac.when} · Then {ac.then}</div>
                        {ac.test && <div className="cmd">test: {ac.test}</div>}
                        {ac.evidence && <pre>{ac.evidence}</pre>}
                      </div>
                      <span className={`badge ${ac.status === 'pass' ? 'green' : ac.status === 'fail' ? 'red' : ''}`}>{ac.status}</span>
                    </div>
                  ))}
                  <div className="section-label" style={{ marginTop: 18 }}>DoD 门禁</div>
                </>
              )}
              {story.acceptance.length > 0 && story.status === 'review' && (
                <div className="ac-feedback">
                  <textarea
                    value={acFeedback}
                    onChange={(e) => setAcFeedback(e.target.value)}
                    placeholder="针对具体验收标准的退回意见（例如 AC2 的断言不充分）"
                  />
                  <button
                    className="btn small amber"
                    disabled={!acFeedback.trim()}
                    onClick={() => {
                      const message = `请按以下验收标准反馈修改：${acFeedback.trim()}`;
                      setAcFeedback('');
                      void onRework(message);
                    }}
                  >
                    <Icon name="refresh" size={12} />
                    带反馈退回
                  </button>
                </div>
              )}
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
          {tab === 'diff' && (
            <>
              {diff.files.length > 0 && (
                <div className="diff-summary">
                  <div className="diff-summary-head">
                    风险
                    <span className={`badge ${diff.risk === 'high' ? 'red' : diff.risk === 'medium' ? 'amber' : 'green'}`}>{diff.risk}</span>
                  </div>
                  {diff.files.map((file) => (
                    <div className="diff-file" key={file.path}>
                      <span className="df-path">{file.path}</span>
                      <span className="df-add">+{file.added}</span>
                      <span className="df-del">-{file.removed}</span>
                      {file.risk !== 'low' && (
                        <span className={`badge ${file.risk === 'high' ? 'red' : 'amber'}`}>{file.risk}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <DiffView diff={diff.diff} />
            </>
          )}
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
                placeholder="继续/返工指令（必填）：说明本轮要完成或修改什么"
                aria-label="继续指令"
              />
              <button
                className="btn cyan"
                disabled={busy || !resumeMsg.trim()}
                onClick={() => {
                  onResume(resumeMsg.trim());
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
              <input
                className="resume-input"
                value={reworkReason}
                onChange={(e) => setReworkReason(e.target.value)}
                placeholder="退回原因（必填，将作为修改要求发给 agent）"
                aria-label="退回原因"
              />
              <button
                className="btn"
                disabled={busy || !reworkReason.trim()}
                onClick={async () => {
                  const reason = reworkReason.trim();
                  await onRework(reason);
                  setResumeMsg(`请按以下意见修改：${reason}`);
                  setReworkReason('');
                }}
              >
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
      {peek && (
        <DependencyPeekModal
          projectId={project.id}
          target={peek}
          onClose={() => setPeek(null)}
          onOpenFull={(item) => {
            setPeek(null);
            onOpenStory?.(item.id);
          }}
        />
      )}
      {suggestOpen && (
        <DependencySuggestModal
          projectId={project.id}
          entityType="story"
          entityId={story.id}
          entityTitle={story.title}
          onClose={() => setSuggestOpen(false)}
          onApplied={async () => {
            await refreshDeps();
            await onChanged();
          }}
          onToast={onToast}
        />
      )}
      {bugOpen && (
        <BugReportModal
          story={story}
          onClose={() => setBugOpen(false)}
          onCreated={onChanged}
          onToast={onToast}
        />
      )}
    </>
  );
}