import { useEffect, useRef } from 'react';
import type { Approval, EventRow } from '@acp-scrum/shared';
import { Icon } from '../icons';
import { eventText, eventVisual, coalesceEvents, timeOf } from '../ui';

function ApprovalCard({ approval, onDecide }: { approval: Approval; onDecide: (id: string, status: 'approved' | 'denied', optionId?: string) => void }) {
  let options: { optionId: string; name: string; kind: string }[] = [];
  try {
    options = (JSON.parse(approval.requestJson) as { options?: typeof options }).options ?? [];
  } catch {
    options = [];
  }
  return (
    <div className="approval">
      <span className="kind">{approval.kind === 'permission' ? '权限请求' : approval.kind === 'accept' ? '人工验收' : approval.kind}</span>
      <div className="title">{approval.title}</div>
      <div className="actions">
        {options.length > 0 ? (
          options.map((o) => (
            <button
              key={o.optionId}
              className={`btn sm ${o.kind.startsWith('allow') ? 'green' : 'danger'}`}
              onClick={() => onDecide(approval.id, o.kind.startsWith('allow') ? 'approved' : 'denied', o.optionId)}
            >
              <Icon name={o.kind.startsWith('allow') ? 'check' : 'x'} size={12} />
              {o.name}
            </button>
          ))
        ) : (
          <>
            <button className="btn sm green" onClick={() => onDecide(approval.id, 'approved')}>
              <Icon name="check" size={12} />
              批准
            </button>
            <button className="btn sm danger" onClick={() => onDecide(approval.id, 'denied')}>
              <Icon name="x" size={12} />
              拒绝
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function Rail({
  approvals,
  events,
  onDecide,
}: {
  approvals: Approval[];
  events: EventRow[];
  onDecide: (id: string, status: 'approved' | 'denied', optionId?: string) => void;
}) {
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  return (
    <aside className="rail">
      <div className="rail-section">
        <div className="rail-head">
          <Icon name="inbox" size={15} style={{ color: 'var(--amber)' }} />
          <h3>人工决策</h3>
          <span className={`badge ${approvals.length ? 'amber' : ''}`}>{approvals.length}</span>
        </div>
        {approvals.length === 0 && <div className="rail-empty">无待办审批 · agent 自主推进中</div>}
        {approvals.map((a) => (
          <ApprovalCard key={a.id} approval={a} onDecide={onDecide} />
        ))}
      </div>
      <div className="rail-head" style={{ padding: '12px 16px 0' }}>
        <Icon name="activity" size={15} style={{ color: 'var(--cyan)' }} />
        <h3>实时活动</h3>
        <span className="badge cyan">{events.length}</span>
      </div>
      <div className="feed" ref={feedRef}>
        {coalesceEvents(events).slice(-150).map((e) => {
          const v = eventVisual(e);
          return (
            <div className="ev" key={e.seq}>
              <span className="ico" style={{ color: v.color, background: `color-mix(in srgb, ${v.color} 14%, transparent)` }}>
                <Icon name={v.icon} size={12} />
              </span>
              <div className="body">
                <span className="t">
                  {timeOf(e.ts)} · {v.label}
                </span>
                <div className="msg">{eventText(e)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}