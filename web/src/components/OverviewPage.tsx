import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  Approval,
  BugMetrics,
  BugReport,
  BugSeverity,
  ChangeMetrics,
  CodeIndexStats,
  DocumentConsistencyIssue,
  DocumentMetrics,
  EventRow,
  FlowMetrics,
  GlobalSettings,
  KnowledgeEntry,
  Project,
  ProjectProfileRecord,
  QualityMetrics,
  Requirement,
  RequirementMetrics,
  RequirementStatus,
  Story,
  StoryTaskMetrics,
} from '@riccon-scrum/shared';
import { api } from '../api';
import { Icon, type IconName } from '../icons';
import { STATUS_META, eventText, eventVisual, timeOf } from '../ui';
import { GitBranchChip } from './GitBranch';
import { ProjectSwitcher } from './ProjectSwitcher';

const REQ_STATUS: Record<RequirementStatus, string> = {
  intake: '待生成',
  clarifying: '待澄清',
  drafting: '生成中',
  in_review: '待评审',
  revising: '修订中',
  approved: '已批准',
  decomposed: '已生成故事',
  split: '已拆分',
  blocked: '已阻塞',
  archived: '已归档',
};

const SEVERITY: Record<BugSeverity, { label: string; color: string }> = {
  blocker: { label: '阻断', color: 'var(--red)' },
  critical: { label: '严重', color: '#f97316' },
  major: { label: '主要', color: 'var(--amber)' },
  minor: { label: '次要', color: 'var(--text-low)' },
};

const SEVERITY_ORDER: BugSeverity[] = ['blocker', 'critical', 'major', 'minor'];

const ONBOARD_LABEL: Record<string, string> = {
  idle: '未入驻',
  scanning: '扫描中',
  analyzing: '分析中',
  baselining: '基线中',
  done: '已完成',
  error: '失败',
};

interface OverviewData {
  flow: FlowMetrics | null;
  quality: QualityMetrics | null;
  requirementMetrics: RequirementMetrics | null;
  taskMetrics: StoryTaskMetrics | null;
  bugMetrics: BugMetrics | null;
  documentMetrics: DocumentMetrics | null;
  consistency: DocumentConsistencyIssue[];
  profile: ProjectProfileRecord | null;
  index: CodeIndexStats | null;
  changeMetrics: ChangeMetrics | null;
  settings: GlobalSettings | null;
  knowledge: KnowledgeEntry[];
  bugs: BugReport[];
}

const EMPTY_DATA: OverviewData = {
  flow: null,
  quality: null,
  requirementMetrics: null,
  taskMetrics: null,
  bugMetrics: null,
  documentMetrics: null,
  consistency: [],
  profile: null,
  index: null,
  changeMetrics: null,
  settings: null,
  knowledge: [],
  bugs: [],
};

function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} 秒`;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时 ${minutes % 60} 分`;
  return `${Math.floor(hours / 24)} 天`;
}

function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(value > 0 && value < 0.1 ? 1 : 0)}%`;
}

function fmtTokens(value: number | null | undefined): string {
  if (value == null) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function fmtDate(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function isOverdue(bug: BugReport): boolean {
  if (!bug.slaDueAt) return false;
  if (['closed', 'rejected', 'duplicate'].includes(bug.status)) return false;
  return new Date(bug.slaDueAt).getTime() < Date.now();
}

function Card({
  title,
  icon,
  aside,
  children,
  className,
}: {
  title: string;
  icon: IconName;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`ov-card ${className ?? ''}`}>
      <header className="ov-card-head">
        <Icon name={icon} size={15} style={{ color: 'var(--indigo-bright)' }} />
        <h3>{title}</h3>
        <span className="spacer" />
        {aside}
      </header>
      <div className="ov-card-body">{children}</div>
    </section>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
  icon,
  progress,
}: {
  label: string;
  value: number | string;
  hint: string;
  tone: 'indigo' | 'amber' | 'green' | 'red';
  icon: IconName;
  progress?: number;
}) {
  return (
    <div className={`ov-kpi ${tone}`}>
      <div className="ov-kpi-top">
        <span className="ov-kpi-icon">
          <Icon name={icon} size={15} />
        </span>
        <span className="ov-kpi-label">{label}</span>
      </div>
      <div className="ov-kpi-value">{value}</div>
      <div className="ov-kpi-hint">{hint}</div>
      {progress !== undefined && (
        <div className="ov-progress">
          <i style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, hint, tone }: { label: string; value: ReactNode; hint: string; tone?: 'danger' | 'warn' }) {
  return (
    <div className={`ov-mini ${tone ?? ''}`}>
      <span>{label}</span>
      <b>{value}</b>
      <small>{hint}</small>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="ov-metric">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function DoraCard({
  icon,
  label,
  value,
  color,
  sub,
}: {
  icon: IconName;
  label: string;
  value: string;
  color: string;
  sub: string;
}) {
  return (
    <div className="metric-card ov-dora-card">
      <span className="mc-ico" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
        <Icon name={icon} size={15} />
      </span>
      <div className="mc-value" style={{ color }}>
        {value}
      </div>
      <div className="mc-label">{label}</div>
      <div className="mc-sub">{sub}</div>
    </div>
  );
}

export function OverviewPage({
  project,
  projects,
  stories,
  requirements,
  approvals,
  events,
  liveStoryIds,
  onSwitchProject,
  onManageProjects,
  onRegister,
  onOpenBoard,
  onOpenStory,
  onOpenRequirement,
  onOpenRequirements,
  onOpenBugs,
  onOpenDocs,
  onOpenMetrics,
  onOpenSettings,
  onDecide,
  onChanged,
  onToast,
}: {
  project: Project;
  projects: Project[];
  stories: Story[];
  requirements: Requirement[];
  approvals: Approval[];
  events: EventRow[];
  liveStoryIds: Set<string>;
  onSwitchProject: (id: string) => void;
  onManageProjects: () => void;
  onRegister: () => void;
  onOpenBoard: () => void;
  onOpenStory: (id: string) => void;
  onOpenRequirement: (id: string) => void;
  onOpenRequirements: () => void;
  onOpenBugs: () => void;
  onOpenDocs: () => void;
  onOpenMetrics: () => void;
  onOpenSettings: () => void;
  onDecide: (id: string, status: 'approved' | 'denied', optionId?: string) => void;
  onChanged: () => Promise<void>;
  onToast: (kind: 'success' | 'error' | 'info', text: string) => void;
}) {
  const [data, setData] = useState<OverviewData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true);
    const results = await Promise.allSettled([
      api.metrics(project.id),
      api.qualityMetrics(project.id),
      api.requirementMetrics(project.id),
      api.taskMetrics(project.id),
      api.bugMetrics(project.id),
      api.documentMetrics(project.id),
      api.documentConsistency(project.id),
      api.profile(project.id),
      api.indexStats(project.id),
      api.changeMetrics(project.id),
      api.settings(),
      api.knowledge(project.id),
      api.bugs(project.id),
    ]);
    const pick = <T,>(index: number, fallback: T): T =>
      results[index].status === 'fulfilled' ? ((results[index] as PromiseFulfilledResult<T>).value ?? fallback) : fallback;
    if (request !== requestId.current) return;
    setData({
      flow: pick<FlowMetrics | null>(0, null),
      quality: pick<QualityMetrics | null>(1, null),
      requirementMetrics: pick<RequirementMetrics | null>(2, null),
      taskMetrics: pick<StoryTaskMetrics | null>(3, null),
      bugMetrics: pick<BugMetrics | null>(4, null),
      documentMetrics: pick<DocumentMetrics | null>(5, null),
      consistency: pick<DocumentConsistencyIssue[]>(6, []),
      profile: pick<ProjectProfileRecord | null>(7, null),
      index: pick<CodeIndexStats | null>(8, null),
      changeMetrics: pick<ChangeMetrics | null>(9, null),
      settings: pick<{ global: GlobalSettings } | null>(10, null)?.global ?? null,
      knowledge: pick<KnowledgeEntry[]>(11, []),
      bugs: pick<BugReport[]>(12, []),
    });
    if (request === requestId.current) setLoading(false);
  }, [project.id]);

  const signature = useMemo(
    () =>
      [
        stories.map((story) => story.status).sort().join('|'),
        requirements.map((requirement) => requirement.status).sort().join('|'),
        approvals.length,
      ].join('~'),
    [stories, requirements, approvals.length],
  );

  useEffect(() => {
    void load();
  }, [load, signature]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const story of stories) counts[story.status] = (counts[story.status] ?? 0) + 1;
    return counts;
  }, [stories]);

  const inDev = statusCounts.in_dev ?? 0;
  const review = statusCounts.review ?? 0;
  const done = statusCounts.done ?? 0;
  const blocked = statusCounts.blocked ?? 0;
  const wipLimit = data.settings?.wipLimit ?? 3;
  const wipPct = wipLimit > 0 ? Math.round((inDev / wipLimit) * 100) : 0;

  const blockedStories = useMemo(() => stories.filter((story) => story.status === 'blocked'), [stories]);
  const overdueBugs = useMemo(
    () =>
      data.bugs
        .filter(isOverdue)
        .sort((a, b) => {
          const rank: Record<BugSeverity, number> = { blocker: 0, critical: 1, major: 2, minor: 3 };
          return rank[a.severity] - rank[b.severity];
        }),
    [data.bugs],
  );
  const consistencyErrors = data.consistency.filter((issue) => issue.severity === 'error');
  const consistencyWarnings = data.consistency.filter((issue) => issue.severity === 'warn');
  const storyTitle = useMemo(() => new Map(stories.map((story) => [story.id, story.title])), [stories]);

  const recentEvents = useMemo(() => {
    const storyIds = new Set(stories.map((story) => story.id));
    const requirementIds = new Set(requirements.map((requirement) => requirement.id));
    return events
      .filter((event) => storyIds.has(event.storyId) || requirementIds.has(event.storyId))
      .slice(-10)
      .reverse();
  }, [events, stories, requirements]);

  const recentRequirements = useMemo(
    () =>
      [...requirements]
        .filter((requirement) => requirement.status !== 'archived')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 4),
    [requirements],
  );

  const attentionCount =
    approvals.length + blockedStories.length + overdueBugs.length + consistencyErrors.length + (data.documentMetrics?.stale ?? 0);

  return (
    <div className="overview">
      <section className="ov-hero">
        <div className="ov-hero-bar">
          <ProjectSwitcher
            project={project}
            projects={projects}
            onSwitchProject={onSwitchProject}
            onManageProjects={onManageProjects}
            onRegister={onRegister}
          />
          <GitBranchChip project={project} onChanged={onChanged} onToast={onToast} />
          <span className="spacer" />
          <button className="btn sm ghost" onClick={() => void load()} disabled={loading} data-tip="重新加载概览的全部指标、审批与最近活动">
            <Icon name="refresh" size={13} className={loading ? 'spin' : ''} />
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>

        <div className="ov-identity">
          <div className="ov-mark">
            <Icon name="logo" size={28} style={{ color: '#fff' }} />
          </div>
          <div className="ov-identity-main">
            <h1>{project.name}</h1>
            <div className="ov-tags">
              <code title={project.repoPath}>{project.repoPath}</code>
              <span className={`badge ${project.teamMode ? 'cyan' : ''}`}>{project.teamMode ? '团队模式' : 'Solo 模式'}</span>
              <span className="badge">ACP · {project.agentKind}</span>
              <span className="badge">{project.model || '终端默认模型'}</span>
              {project.thinking && <span className="badge">思考强度 {project.thinking}</span>}
            </div>
          </div>
          <div className="ov-identity-side">
            <div>
              <span>默认分支</span>
              <code>{project.defaultBranch}</code>
            </div>
            <div>
              <span>创建于</span>
              <b>{fmtDate(project.createdAt)}</b>
            </div>
            <div>
              <span>DoD 命令</span>
              <b>{project.dodCommands.length}</b>
            </div>
          </div>
        </div>
      </section>

      <section className="ov-kpis">
        <Kpi
          label="开发中"
          value={inDev}
          hint={`WIP 上限 ${wipLimit} · 当前占用 ${Math.max(0, wipPct)}%`}
          tone="indigo"
          icon="bot"
          progress={wipPct}
        />
        <Kpi
          label="待验收"
          value={review}
          hint={`平均评审 ${fmtDuration(data.quality?.avgReviewMs)}`}
          tone="amber"
          icon="shield"
        />
        <Kpi
          label="已完成"
          value={done}
          hint={`吞吐 ${data.flow?.throughput ?? done} · 一次通过 ${fmtPct(data.quality?.firstPassAcceptanceRate)}`}
          tone="green"
          icon="check"
        />
        <Kpi
          label="阻塞"
          value={blocked}
          hint={`逾期 Bug ${data.bugMetrics?.overdue ?? 0} · 未决审批 ${approvals.length}`}
          tone="red"
          icon="alert"
        />
      </section>

      <section className="ov-strip">
        <MiniStat
          label="需求"
          value={requirements.length}
          hint={`待评审 ${data.requirementMetrics?.inReview ?? 0} · 已物化 ${data.requirementMetrics?.materializedStories ?? 0} 故事`}
        />
        <MiniStat
          label="未关闭 Bug"
          value={data.bugMetrics?.open ?? 0}
          hint={`逾期 ${data.bugMetrics?.overdue ?? 0} · 平均修复 ${fmtDuration(data.bugMetrics?.mttrMs)}`}
          tone={(data.bugMetrics?.overdue ?? 0) > 0 ? 'danger' : undefined}
        />
        <MiniStat
          label="一次验收通过"
          value={fmtPct(data.quality?.firstPassAcceptanceRate)}
          hint={`返工 ${data.flow?.reworkCount ?? data.quality?.reworkCount ?? 0} 次`}
        />
        <MiniStat
          label="文档"
          value={data.documentMetrics?.total ?? 0}
          hint={`过期 ${data.documentMetrics?.stale ?? 0} · 错误 ${data.documentMetrics?.error ?? 0}`}
          tone={(data.documentMetrics?.stale ?? 0) + (data.documentMetrics?.error ?? 0) > 0 ? 'warn' : undefined}
        />
        <MiniStat
          label="一致性"
          value={consistencyErrors.length}
          hint={`错误 · 警告 ${consistencyWarnings.length}`}
          tone={consistencyErrors.length > 0 ? 'danger' : undefined}
        />
        <MiniStat
          label="代码索引"
          value={data.index?.files ?? 0}
          hint={`${data.index?.symbols ?? 0} 个符号`}
        />
      </section>

      <div className="ov-grid ov-grid-2">
        <Card
          title="交付流水线"
          icon="activity"
          aside={
            <button className="ov-link" onClick={onOpenBoard}>
              进入看板
            </button>
          }
        >
          <div className="ov-pipeline">
            {(['draft', 'ready', 'in_dev', 'review', 'done', 'blocked'] as const).map((status) => (
              <div className="ov-stage" key={status}>
                <span className="ov-stage-dot" style={{ background: STATUS_META[status].color }} />
                <span className="ov-stage-label">{STATUS_META[status].label}</span>
                <b>{statusCounts[status] ?? 0}</b>
              </div>
            ))}
          </div>
          <div className="ov-bar">
            {(['draft', 'ready', 'in_dev', 'review', 'done', 'blocked'] as const).map((status) => {
              const count = statusCounts[status] ?? 0;
              return count > 0 ? (
                <i
                  key={status}
                  style={{
                    width: `${(count / Math.max(1, stories.length)) * 100}%`,
                    background: STATUS_META[status].color,
                  }}
                  title={`${STATUS_META[status].label} ${count}`}
                />
              ) : null;
            })}
          </div>
          <div className="ov-metrics">
            <Metric label="任务完成" value={`${data.taskMetrics?.done ?? 0}/${data.taskMetrics?.total ?? 0}`} />
            <Metric label="任务一次通过" value={fmtPct(data.taskMetrics?.firstPassRate)} />
            <Metric label="失败任务" value={data.taskMetrics?.failed ?? 0} />
            <Metric label="任务 Token" value={fmtTokens(data.taskMetrics?.tokens)} />
          </div>
          <div className="ov-divider" />
          <div className="ov-metrics">
            <Metric label="需求变更" value={data.changeMetrics?.total ?? 0} />
            <Metric label="已批准" value={data.changeMetrics?.approved ?? 0} />
            <Metric label="影响故事" value={data.changeMetrics?.impactStories ?? 0} />
            <Metric label="已物化" value={data.changeMetrics?.materialized ?? 0} />
          </div>
        </Card>

        <Card
          title="需要处理"
          icon="inbox"
          aside={<span className={`badge ${attentionCount > 0 ? 'amber' : 'green'}`}>{attentionCount}</span>}
        >
          <div className="ov-attention">
            {approvals.slice(0, 3).map((approval) => {
              let options: { optionId: string; name: string; kind: string }[] = [];
              try {
                options = (JSON.parse(approval.requestJson) as { options?: typeof options }).options ?? [];
              } catch {
                options = [];
              }
              return (
                <div className="ov-item" key={approval.id}>
                  <span className="ov-dot amber" />
                  <div className="ov-item-main">
                    <div className="ov-item-title">{approval.title}</div>
                    <div className="ov-item-sub">
                      人工决策 · {storyTitle.get(approval.storyId) ?? '关联故事'}
                    </div>
                  </div>
                  <div className="ov-item-actions">
                    {options.length > 0 ? (
                      options.slice(0, 3).map((option) => (
                        <button
                          key={option.optionId}
                          className={`btn sm ${option.kind.startsWith('allow') ? 'green' : 'danger'}`}
                          data-tip={option.kind.startsWith('allow') ? '批准该审批请求，流程继续执行' : '拒绝该审批请求，流程将停止或返工'}
                          onClick={() =>
                            onDecide(approval.id, option.kind.startsWith('allow') ? 'approved' : 'denied', option.optionId)
                          }
                        >
                          {option.name}
                        </button>
                      ))
                    ) : (
                      <>
                        <button className="btn sm green" onClick={() => onDecide(approval.id, 'approved')} data-tip="批准该审批请求，流程继续执行">
                          批准
                        </button>
                        <button className="btn sm danger" onClick={() => onDecide(approval.id, 'denied')} data-tip="拒绝该审批请求，流程将停止或返工">
                          拒绝
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            {blockedStories.slice(0, 3).map((story) => (
              <button className="ov-item as-button" key={story.id} onClick={() => onOpenStory(story.id)}>
                <span className="ov-dot red" />
                <div className="ov-item-main">
                  <div className="ov-item-title">{story.title}</div>
                  <div className="ov-item-sub">故事阻塞 · 需要人工恢复或清理门禁</div>
                </div>
                <Icon name="arrowRight" size={13} />
              </button>
            ))}

            {overdueBugs.slice(0, 3).map((bug) => (
              <button className="ov-item as-button" key={bug.id} onClick={onOpenBugs}>
                <span className="ov-dot red" />
                <div className="ov-item-main">
                  <div className="ov-item-title">{bug.title}</div>
                  <div className="ov-item-sub">
                    Bug 逾期 · {SEVERITY[bug.severity].label}/{bug.priority}
                  </div>
                </div>
                <Icon name="arrowRight" size={13} />
              </button>
            ))}

            {consistencyErrors.slice(0, 2).map((issue, index) => (
              <button className="ov-item as-button" key={`${issue.code}-${index}`} onClick={onOpenDocs}>
                <span className="ov-dot red" />
                <div className="ov-item-main">
                  <div className="ov-item-title">{issue.message}</div>
                  <div className="ov-item-sub">文档一致性错误 · {issue.docType ?? '项目文档'}</div>
                </div>
                <Icon name="arrowRight" size={13} />
              </button>
            ))}

            {(data.documentMetrics?.stale ?? 0) > 0 && (
              <button className="ov-item as-button" onClick={onOpenDocs}>
                <span className="ov-dot amber" />
                <div className="ov-item-main">
                  <div className="ov-item-title">{data.documentMetrics?.stale} 篇文档已过期</div>
                  <div className="ov-item-sub">源提交或需求变化后需要重新生成/确认</div>
                </div>
                <Icon name="arrowRight" size={13} />
              </button>
            )}

            {attentionCount === 0 && (
              <div className="ov-empty">
                <Icon name="check" size={15} style={{ color: 'var(--green)' }} />
                当前没有需要处理的阻塞项，agent 可以继续推进。
              </div>
            )}
          </div>

          {liveStoryIds.size > 0 && (
            <div className="ov-live">
              <span className="live-dot" />
              {liveStoryIds.size} 个 agent 会话正在运行
            </div>
          )}
        </Card>
      </div>

      <div className="ov-grid ov-grid-3">
        <Card
          title="需求与变更"
          icon="sparkles"
          aside={
            <button className="ov-link" onClick={onOpenRequirements}>
              需求工作台
            </button>
          }
        >
          <div className="ov-metrics">
            <Metric label="需求总数" value={data.requirementMetrics?.total ?? requirements.length} />
            <Metric label="待评审" value={data.requirementMetrics?.inReview ?? 0} />
            <Metric label="已拆解" value={data.requirementMetrics?.decomposed ?? 0} />
            <Metric label="AC 覆盖率" value={fmtPct(data.requirementMetrics?.coverage)} />
            <Metric label="平均版本" value={data.requirementMetrics?.avgVersions?.toFixed(1) ?? '—'} />
            <Metric label="反馈轮次" value={data.requirementMetrics?.feedbackRounds ?? 0} />
          </div>
          <div className="ov-divider" />
          <div className="ov-list">
            {recentRequirements.length === 0 && <div className="ov-empty">还没有需求，从需求工作台开始澄清。</div>}
            {recentRequirements.map((requirement) => (
              <button className="ov-row" key={requirement.id} onClick={() => onOpenRequirement(requirement.id)}>
                <div className="ov-row-main">
                  <div className="ov-row-title">{requirement.title}</div>
                  <div className="ov-row-sub">
                    {REQ_STATUS[requirement.status]} · v{requirement.currentVersion}
                  </div>
                </div>
                <Icon name="arrowRight" size={12} />
              </button>
            ))}
          </div>
        </Card>

        <Card
          title="质量与 Bug"
          icon="shield"
          aside={
            <button className="ov-link" onClick={onOpenBugs}>
              Bug 反馈
            </button>
          }
        >
          <div className="ov-metrics">
            <Metric label="首次验收通过" value={fmtPct(data.quality?.firstPassAcceptanceRate)} />
            <Metric label="已验收" value={data.quality?.accepted ?? 0} />
            <Metric label="返工" value={data.quality?.reworkCount ?? 0} />
            <Metric label="平均评审" value={fmtDuration(data.quality?.avgReviewMs)} />
            <Metric label="累计 Token" value={fmtTokens(data.quality?.totalTokens)} />
            <Metric label="MTTR" value={fmtDuration(data.bugMetrics?.mttrMs)} />
          </div>
          <div className="ov-divider" />
          <div className="ov-severities">
            {SEVERITY_ORDER.map((severity) => {
              const count = data.bugMetrics?.bySeverity[severity] ?? 0;
              const total = Math.max(1, data.bugMetrics?.total ?? 0);
              return (
                <div className="ov-severity" key={severity}>
                  <span>{SEVERITY[severity].label}</span>
                  <div className="ov-severity-bar">
                    <i style={{ width: `${(count / total) * 100}%`, background: SEVERITY[severity].color }} />
                  </div>
                  <b>{count}</b>
                </div>
              );
            })}
          </div>
          <div className="ov-footnote">
            未关闭 {data.bugMetrics?.open ?? 0} · 逾期 {data.bugMetrics?.overdue ?? 0} · 重开率{' '}
            {fmtPct(data.bugMetrics?.reopenRate)}
          </div>
        </Card>

        <Card
          title="文档与知识"
          icon="file"
          aside={
            <button className="ov-link" onClick={onOpenDocs}>
              文档中心
            </button>
          }
        >
          <div className="ov-metrics">
            <Metric label="文档总数" value={data.documentMetrics?.total ?? 0} />
            <Metric label="已发布" value={data.documentMetrics?.published ?? 0} />
            <Metric label="草稿" value={data.documentMetrics?.draft ?? 0} />
            <Metric label="过期" value={data.documentMetrics?.stale ?? 0} />
            <Metric label="错误" value={data.documentMetrics?.error ?? 0} />
            <Metric label="已同步" value={data.documentMetrics?.synced ?? 0} />
          </div>
          <div className="ov-divider" />
          <div className="ov-metrics">
            <Metric label="一致性错误" value={consistencyErrors.length} />
            <Metric label="一致性警告" value={consistencyWarnings.length} />
            <Metric label="知识条目" value={data.knowledge.length} />
            <Metric label="自动更新" value={data.documentMetrics?.autoUpdate ?? 0} />
          </div>
          <div className="ov-footnote">草稿 {data.documentMetrics?.draft ?? 0} 篇 · 锁定 {data.documentMetrics?.pinned ?? 0} 篇</div>
        </Card>
      </div>

      <Card
        title="流动与 DORA 度量"
        icon="activity"
        aside={
          <button className="ov-link" onClick={onOpenMetrics} data-tip="查看流动效率与 DORA 指标明细">
            完整度量
          </button>
        }
      >
        <div className="ov-dora-grid">
          <DoraCard
            icon="merge"
            label="吞吐量（已完成）"
            value={String(data.flow?.throughput ?? done)}
            color="var(--green)"
            sub="已完成故事数"
          />
          <DoraCard
            icon="bot"
            label="进行中 WIP"
            value={String(data.flow?.inProgress ?? inDev)}
            color="var(--cyan)"
            sub={`WIP 上限 ${wipLimit}`}
          />
          <DoraCard
            icon="alert"
            label="阻塞"
            value={String(data.flow?.blocked ?? blocked)}
            color="var(--red)"
            sub="当前阻塞故事"
          />
          <DoraCard
            icon="refresh"
            label="返工次数"
            value={String(data.flow?.reworkCount ?? 0)}
            color="var(--amber)"
            sub="退回修改次数"
          />
          <DoraCard
            icon="clock"
            label="平均 Lead Time"
            value={fmtDuration(data.flow?.avgLeadTimeMs)}
            color="var(--indigo-bright)"
            sub="创建 → 完成"
          />
          <DoraCard
            icon="clock"
            label="平均 Cycle Time"
            value={fmtDuration(data.flow?.avgCycleTimeMs)}
            color="var(--magenta)"
            sub="就绪 → 完成"
          />
          <DoraCard
            icon="shield"
            label="变更失败率"
            value={fmtPct(data.flow?.changeFailRate)}
            color="var(--amber)"
            sub="曾阻塞 / 已结束"
          />
        </div>
        <div className="ov-footnote">基于故事状态机与事件流实时计算；DORA 指标随故事流转自动更新。</div>
      </Card>

      <div className="ov-grid ov-grid-2">
        <Card
          title="项目接入与配置"
          icon="terminal"
          aside={
            <button className="ov-link" onClick={onOpenSettings} data-tip="进入项目设置：终端、模型、交付命令与门禁">
              项目设置
            </button>
          }
        >
          <div className="ov-profile">
            <span className={`badge ${data.profile?.status === 'done' ? 'green' : data.profile?.status === 'error' ? 'red' : 'amber'}`}>
              入驻 {ONBOARD_LABEL[data.profile?.status ?? 'idle'] ?? data.profile?.status ?? '未入驻'}
            </span>
            {(data.profile?.profile?.languages ?? []).slice(0, 5).map((language) => (
              <span className="chip" key={language}>
                {language}
              </span>
            ))}
            {(data.profile?.profile?.frameworks ?? []).slice(0, 3).map((framework) => (
              <span className="chip" key={framework}>
                {framework}
              </span>
            ))}
          </div>
          <div className="ov-metrics">
            <Metric label="包管理器" value={data.profile?.profile?.packageManager ?? '—'} />
            <Metric label="入口点" value={data.profile?.profile?.entryPoints.length ?? 0} />
            <Metric label="测试命令" value={data.profile?.profile?.testCommands.length ?? 0} />
            <Metric label="构建命令" value={data.profile?.profile?.buildCommands.length ?? 0} />
            <Metric label="索引文件" value={data.index?.files ?? 0} />
            <Metric label="索引符号" value={data.index?.symbols ?? 0} />
          </div>
          <div className="ov-divider" />
          <div className="ov-config">
            <div>
              <span>Agent 终端</span>
              <code>{project.agentKind}</code>
            </div>
            <div>
              <span>交付模型</span>
              <code>{project.model || '终端默认'}</code>
            </div>
            <div>
              <span>思考强度</span>
              <code>{project.thinking || '终端默认'}</code>
            </div>
            <div>
              <span>团队模式</span>
              <code>{project.teamMode ? 'Lead + Dev + QA' : 'Solo'}</code>
            </div>
          </div>
        </Card>

        <Card
          title="最近活动"
          icon="activity"
          aside={<span className="badge">{recentEvents.length}</span>}
        >
          <div className="ov-events">
            {recentEvents.length === 0 && <div className="ov-empty">还没有项目事件。</div>}
            {recentEvents.map((event) => {
              const visual = eventVisual(event);
              const storyId = stories.some((story) => story.id === event.storyId) ? event.storyId : null;
              return (
                <button
                  className={`ov-event ${storyId ? 'clickable' : ''}`}
                  key={event.seq}
                  onClick={() => storyId && onOpenStory(storyId)}
                  disabled={!storyId}
                >
                  <span className="ov-event-icon" style={{ color: visual.color, background: `color-mix(in srgb, ${visual.color} 14%, transparent)` }}>
                    <Icon name={visual.icon} size={12} />
                  </span>
                  <div className="ov-event-main">
                    <div className="ov-event-meta">
                      {timeOf(event.ts)} · {visual.label}
                    </div>
                    <div className="ov-event-text">{eventText(event)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
