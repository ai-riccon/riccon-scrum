import type { AgentRole, DodItem, EventRow, StoryStatus, StoryTaskStatus, TeamPhase } from '@riccon-scrum/shared';
import { Icon, type IconName } from './icons';

export const STATUS_META: Record<StoryStatus, { label: string; color: string; icon: IconName }> = {
  draft: { label: 'Draft', color: 'var(--st-draft)', icon: 'file' },
  ready: { label: 'Ready', color: 'var(--st-ready)', icon: 'check' },
  in_dev: { label: 'In Dev', color: 'var(--st-indev)', icon: 'bot' },
  review: { label: 'Review', color: 'var(--st-review)', icon: 'eye' },
  done: { label: 'Done', color: 'var(--st-done)', icon: 'merge' },
  blocked: { label: 'Blocked', color: 'var(--st-blocked)', icon: 'alert' },
};

export const COLUMNS: StoryStatus[] = ['draft', 'ready', 'in_dev', 'review', 'done'];

export const ROLE_META: Record<AgentRole, { label: string; color: string; icon: IconName }> = {
  solo: { label: 'Solo', color: 'var(--cyan)', icon: 'bot' },
  lead: { label: 'Lead', color: 'var(--magenta)', icon: 'sparkles' },
  dev: { label: 'Dev', color: 'var(--cyan)', icon: 'code' },
  qa: { label: 'QA', color: 'var(--amber)', icon: 'shield' },
};

export const PHASE_META: Record<TeamPhase, { label: string; color: string }> = {
  plan: { label: '规划', color: 'var(--magenta)' },
  implement: { label: '实现', color: 'var(--cyan)' },
  verify: { label: '评审', color: 'var(--amber)' },
  gate: { label: '门禁', color: 'var(--green)' },
};

export const PHASE_ORDER: TeamPhase[] = ['plan', 'implement', 'verify', 'gate'];

export const TASK_STATUS_META: Record<StoryTaskStatus, { label: string; color: string; icon: IconName }> = {
  pending: { label: '待执行', color: 'var(--text-low)', icon: 'clock' },
  in_progress: { label: '执行中', color: 'var(--cyan)', icon: 'play' },
  done: { label: '已完成', color: 'var(--green)', icon: 'check' },
  failed: { label: '失败', color: 'var(--red)', icon: 'x' },
  skipped: { label: '跳过', color: 'var(--amber)', icon: 'alert' },
};

export function StatusTag({ status }: { status: StoryStatus }) {
  const m = STATUS_META[status];
  return (
    <span className="status-tag" style={{ color: m.color, background: `color-mix(in srgb, ${m.color} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${m.color} 40%, transparent)` }}>
      <Icon name={m.icon} size={12} />
      {m.label}
    </span>
  );
}

export function DodMini({ items }: { items: DodItem[] }) {
  const cmd = items.filter((i) => i.command);
  if (cmd.length === 0) return null;
  return (
    <span className="dod-mini" title={`DoD ${cmd.filter((i) => i.status === 'pass').length}/${cmd.length}`}>
      {cmd.map((i) => (
        <i key={i.id} className={i.status === 'pass' ? 'pass' : i.status === 'fail' ? 'fail' : ''} />
      ))}
    </span>
  );
}

export function eventVisual(e: EventRow): { icon: IconName; color: string; label: string } {
  const p = e.payload;
  switch (p.type) {
    case 'agent.message':
      return p.role === 'thought'
        ? { icon: 'sparkles', color: 'var(--magenta)', label: '思考' }
        : p.role === 'user'
          ? { icon: 'user', color: 'var(--indigo-bright)', label: '指令' }
          : { icon: 'bot', color: 'var(--cyan)', label: 'Agent' };
    case 'agent.tool':
      return { icon: 'terminal', color: 'var(--indigo-bright)', label: '工具' };
    case 'agent.plan':
      return { icon: 'layers', color: 'var(--magenta)', label: '计划' };
    case 'story.status':
      return { icon: 'arrowRight', color: STATUS_META[p.to].color, label: '流转' };
    case 'session.status':
      return { icon: 'activity', color: p.status === 'error' ? 'var(--red)' : p.status === 'running' ? 'var(--cyan)' : 'var(--text-low)', label: '会话' };
    case 'approval.requested':
      return { icon: 'shield', color: 'var(--amber)', label: '待审批' };
    case 'approval.decided':
      return { icon: 'shield', color: p.approval.status === 'approved' ? 'var(--green)' : 'var(--red)', label: '审批' };
    case 'dod.result':
      return { icon: 'clipboard', color: p.status === 'pass' ? 'var(--green)' : 'var(--red)', label: 'DoD' };
    case 'acceptance.result':
      return { icon: p.status === 'pass' ? 'check' : 'x', color: p.status === 'pass' ? 'var(--green)' : 'var(--red)', label: 'AC 证据' };
    case 'release.result':
      return { icon: 'play', color: p.status === 'failed' || p.status === 'rollback_failed' ? 'var(--red)' : p.status === 'running' ? 'var(--cyan)' : 'var(--green)', label: '发布' };
    case 'contract.result':
      return { icon: p.ok ? 'check' : 'x', color: p.ok ? 'var(--green)' : 'var(--red)', label: '契约' };
    case 'team.phase':
      return { icon: 'layers', color: 'var(--indigo-bright)', label: `阶段·${p.role}` };
    case 'team.plan':
      return { icon: 'layers', color: 'var(--magenta)', label: '计划' };
    case 'team.verdict':
      return { icon: 'shield', color: p.verdict.pass ? 'var(--green)' : 'var(--red)', label: 'QA' };
    case 'usage':
      return { icon: 'activity', color: 'var(--text-low)', label: '用量' };
    case 'budget.exceeded':
      return { icon: 'alert', color: 'var(--red)', label: '预算' };
    case 'conflict.detected':
      return { icon: 'alert', color: 'var(--amber)', label: '冲突' };
    case 'requirement.status':
      return { icon: 'sparkles', color: p.to === 'blocked' ? 'var(--red)' : 'var(--cyan)', label: '需求' };
    case 'requirement.draft':
      return { icon: 'sparkles', color: p.issues > 0 ? 'var(--red)' : 'var(--green)', label: '需求草稿' };
    case 'requirement.feedback':
      return { icon: 'user', color: 'var(--amber)', label: '需求反馈' };
    case 'requirement.materialized':
      return { icon: 'check', color: 'var(--green)', label: '物化' };
    case 'requirement.chat':
      return { icon: p.role === 'user' ? 'user' : 'bot', color: 'var(--cyan)', label: '需求澄清' };
    case 'requirement.split':
      return { icon: 'layers', color: 'var(--indigo-bright)', label: '需求拆分' };
    case 'dependency.override':
      return { icon: 'alert', color: 'var(--amber)', label: '依赖越权' };
    case 'task.plan':
      return { icon: 'layers', color: 'var(--magenta)', label: '任务计划' };
    case 'task.status':
      return {
        icon: p.to === 'failed' ? 'x' : p.to === 'done' ? 'check' : p.to === 'skipped' ? 'alert' : 'activity',
        color: p.to === 'failed' ? 'var(--red)' : p.to === 'done' ? 'var(--green)' : 'var(--cyan)',
        label: '任务',
      };
    case 'task.verify':
      return { icon: p.ok ? 'check' : 'x', color: p.ok ? 'var(--green)' : 'var(--red)', label: '任务验证' };
    case 'change.requested':
      return { icon: 'refresh', color: 'var(--magenta)', label: '需求迭代' };
    case 'change.status':
      return { icon: 'refresh', color: p.to === 'rejected' ? 'var(--red)' : p.to === 'materialized' ? 'var(--green)' : 'var(--amber)', label: '变更单' };
    case 'change.materialized':
      return { icon: 'check', color: 'var(--green)', label: '变更物化' };
    case 'bug.reported':
      return { icon: 'alert', color: p.severity === 'blocker' || p.severity === 'critical' ? 'var(--red)' : 'var(--amber)', label: 'Bug' };
    case 'bug.status':
      return {
        icon: p.to === 'closed' ? 'check' : p.to === 'rejected' ? 'x' : 'alert',
        color: p.to === 'closed' ? 'var(--green)' : p.to === 'rejected' ? 'var(--red)' : 'var(--amber)',
        label: 'Bug 状态',
      };
    case 'bug.fix_created':
      return { icon: 'merge', color: 'var(--cyan)', label: 'Bug 修复' };
    case 'document.generated':
      return { icon: 'file', color: p.status === 'error' ? 'var(--red)' : 'var(--green)', label: '项目文档' };
    case 'document.status':
      return { icon: 'file', color: p.to === 'stale' ? 'var(--amber)' : p.to === 'error' ? 'var(--red)' : 'var(--cyan)', label: '文档状态' };
    case 'document.synced':
      return { icon: 'refresh', color: p.conflicts > 0 ? 'var(--amber)' : 'var(--green)', label: '文档同步' };
  }
}

export function eventText(e: EventRow): string {
  const p = e.payload;
  switch (p.type) {
    case 'agent.message':
      return p.text;
    case 'agent.tool':
      return `${p.title || p.toolCallId} · ${p.status}`;
    case 'agent.plan':
      return p.entries.map((x) => x.content).join(' → ');
    case 'story.status':
      return `${STATUS_META[p.from].label} → ${STATUS_META[p.to].label}`;
    case 'session.status':
      return `${p.status}${p.detail ? ` · ${p.detail}` : ''}`;
    case 'approval.requested':
      return p.approval.title;
    case 'approval.decided':
      return `${p.approval.title} · ${p.approval.status === 'approved' ? '已批准' : '已拒绝'}`;
    case 'dod.result':
      return `${p.status === 'pass' ? '通过' : '失败'} · ${p.evidence.split('\n')[0]}`;
    case 'acceptance.result':
      return `${p.acId} · ${p.status === 'pass' ? '通过' : '失败'} · ${p.evidence}`;
    case 'release.result':
      return `${p.status} · ${p.evidence.split('\n')[0]}`;
    case 'contract.result':
      return `${p.ok ? '通过' : '失败'} · ${p.evidence.split('\n')[0]}`;
    case 'team.phase':
      return `${PHASE_META[p.phase].label} · ${ROLE_META[p.role].label}`;
    case 'team.plan':
      return p.tasks.map((t) => t.title).join(' → ') || '（无结构化计划）';
    case 'team.verdict':
      return p.verdict.pass ? 'QA 通过' : `QA 不通过：${p.verdict.issues.join('；')}`;
    case 'usage':
      return `${p.tokens} tokens`;
    case 'budget.exceeded':
      return `预算熔断（${p.kind}）：${p.detail}`;
    case 'conflict.detected':
      return `与「${p.otherTitle}」冲突：${p.files.join(', ')}`;
    case 'requirement.status':
      return `需求流转 ${p.from} → ${p.to}`;
    case 'requirement.draft':
      return `草稿 v${p.version} · ${p.stories} 个故事 · ${p.issues} 个错误`;
    case 'requirement.feedback':
      return `v${p.version} · ${p.storyKey ?? '整体'} · ${p.decision}`;
    case 'requirement.materialized':
      return `v${p.version} → ${p.storyIds.length} 个故事`;
    case 'requirement.chat':
      return p.role === 'user' ? '已发送澄清回答' : p.ready ? '信息已足够，等待确认' : 'AI 追问';
    case 'requirement.split':
      return `拆分为 ${p.children} 个子需求`;
    case 'dependency.override':
      return `跳过前置（${p.predecessors.join('、')}）：${p.reason}`;
    case 'task.plan':
      return `${p.tasks} 个任务${p.criticalPath.length ? ` · 关键路径 ${p.criticalPath.join(' → ')}` : ''}`;
    case 'task.status':
      return `${p.taskKey} ${p.from} → ${p.to}${p.evidence ? ` · ${p.evidence.split('\n')[0]}` : ''}`;
    case 'task.verify':
      return `${p.taskKey} · ${p.ok ? '通过' : '失败'} · ${p.evidence.split('\n')[0]}`;
    case 'change.requested':
      return `${p.changeType} · 影响 ${p.impact} 个故事`;
    case 'change.status':
      return `变更单 ${p.from} → ${p.to}`;
    case 'change.materialized':
      return `派生需求 ${p.derivedRequirementId ?? '—'}`;
    case 'bug.reported':
      return `${p.severity}/${p.priority}`;
    case 'bug.status':
      return `${p.from} → ${p.to}`;
    case 'bug.fix_created':
      return `修复故事 ${p.fixStoryId.slice(0, 8)}`;
    case 'document.generated':
      return `${p.docType}/${p.slug} v${p.version} · ${p.status}`;
    case 'document.status':
      return `${p.docType}/${p.slug} ${p.from} → ${p.to}`;
    case 'document.synced':
      return `写入 ${p.written} 个文件${p.conflicts > 0 ? ` · ${p.conflicts} 个冲突` : ''}`;
  }
}

export function timeOf(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

export function coalesceEvents(events: EventRow[]): EventRow[] {
  const out: EventRow[] = [];
  for (const e of events) {
    const prev = out[out.length - 1];
    if (
      e.payload.type === 'agent.message' &&
      prev?.payload.type === 'agent.message' &&
      prev.payload.role === e.payload.role &&
      prev.payload.sessionId === e.payload.sessionId &&
      prev.storyId === e.storyId
    ) {
      out[out.length - 1] = {
        ...prev,
        seq: e.seq,
        ts: e.ts,
        payload: { ...e.payload, text: prev.payload.text + e.payload.text },
      };
    } else {
      out.push(e);
    }
  }
  return out;
}