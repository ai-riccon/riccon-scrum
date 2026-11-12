import { useMemo } from 'react';
import type { Requirement, RequirementDraft } from '@riccon-scrum/shared';
import { Icon } from '../icons';

const ACTOR_COLORS = ['var(--cyan)', 'var(--indigo-bright)', 'var(--magenta)', 'var(--amber)'];

function splitActors(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split(/[;；,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function shorten(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

export function ScopeDiagramModal({
  requirement,
  draft,
  children,
  onClose,
}: {
  requirement: Requirement;
  draft: RequirementDraft | null;
  children: Requirement[];
  onClose: () => void;
}) {
  const useCases = useMemo(() => {
    if (children.length > 0) return children.slice(0, 12).map((child) => ({ title: child.title, persona: '' }));
    if (draft?.stories.length) return draft.stories.slice(0, 12).map((story) => ({ title: story.title, persona: story.persona }));
    return [{ title: requirement.title, persona: '' }];
  }, [children, draft, requirement.title]);

  const actors = useMemo(() => {
    const fromStories = useCases.map((item) => item.persona).filter(Boolean);
    const fromIntake = splitActors(requirement.intake?.users);
    const list = [...new Set([...fromStories, ...fromIntake])];
    return list.length > 0 ? list.slice(0, 4) : ['用户'];
  }, [useCases, requirement.intake?.users]);

  const width = 980;
  const actorGap = 120;
  const useCaseGap = Math.max(64, Math.min(88, 520 / Math.max(1, useCases.length)));
  const height = Math.max(460, 120 + useCases.length * useCaseGap + 60);
  const actorStartY = 130;
  const useCaseStartY = 110;
  const actorX = 90;
  const systemLeft = 220;
  const systemRight = width - 40;
  const ellipseCx = (systemLeft + systemRight) / 2;
  const ellipseRx = 190;

  const actorIndex = (persona: string): number => {
    if (!persona) return 0;
    const found = actors.findIndex((actor) => persona.includes(actor) || actor.includes(persona));
    return found >= 0 ? found : 0;
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal modal-wide scope-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="用例图">
        <div className="modal-head">
          <Icon name="user" size={18} style={{ color: 'var(--cyan)', marginRight: 10 }} />
          <h3>用例图 · 需求范围</h3>
          <span className="badge">{requirement.title}</span>
          <button className="btn icon ghost" onClick={onClose} aria-label="关闭" style={{ marginLeft: 'auto' }}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div className="req-note">
            展示 actor 与需求范围；依赖顺序请查看依赖图。当前范围：{children.length > 0 ? `${children.length} 个子需求` : `${useCases.length} 个用例`}。
          </div>
          <div className="graph-scroll">
            <svg width={width} height={height} role="img" aria-label="用例图">
              <rect
                x={systemLeft}
                y={50}
                width={systemRight - systemLeft}
                height={height - 90}
                rx={16}
                className="usecase-boundary"
              />
              <text x={systemLeft + 20} y={78} className="usecase-system-title">
                {requirement.title} · 系统边界
              </text>
              {actors.map((actor, index) => {
                const y = actorStartY + index * actorGap;
                return (
                  <g key={actor} transform={`translate(${actorX}, ${y})`}>
                    <circle cx={0} cy={-22} r={12} fill="none" stroke={ACTOR_COLORS[index % ACTOR_COLORS.length]} strokeWidth={2} />
                    <line x1={0} y1={-10} x2={0} y2={24} stroke={ACTOR_COLORS[index % ACTOR_COLORS.length]} strokeWidth={2} />
                    <line x1={-18} y1={2} x2={18} y2={2} stroke={ACTOR_COLORS[index % ACTOR_COLORS.length]} strokeWidth={2} />
                    <line x1={0} y1={24} x2={-13} y2={46} stroke={ACTOR_COLORS[index % ACTOR_COLORS.length]} strokeWidth={2} />
                    <line x1={0} y1={24} x2={13} y2={46} stroke={ACTOR_COLORS[index % ACTOR_COLORS.length]} strokeWidth={2} />
                    <text x={0} y={64} textAnchor="middle" className="usecase-actor-label">
                      {shorten(actor, 16)}
                    </text>
                  </g>
                );
              })}
              {useCases.map((item, index) => {
                const cy = useCaseStartY + index * useCaseGap;
                const actor = actors[actorIndex(item.persona)];
                const actorY = actorStartY + actors.indexOf(actor) * actorGap + 4;
                return (
                  <g key={`${item.title}-${index}`}>
                    <line
                      x1={actorX + 22}
                      y1={actorY}
                      x2={ellipseCx - ellipseRx}
                      y2={cy}
                      className="usecase-link"
                    />
                    <ellipse cx={ellipseCx} cy={cy} rx={ellipseRx} ry={28} className="usecase-ellipse" />
                    <text x={ellipseCx} y={cy + 4} textAnchor="middle" className="usecase-label">
                      {shorten(item.title, 30)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="graph-legend">
            <span><i style={{ background: 'var(--cyan)' }} />Actor</span>
            <span><i style={{ background: 'var(--indigo-bright)' }} />用例</span>
            <span>虚线边界表示需求范围</span>
          </div>
        </div>
        <div className="modal-foot">
          <span className="hint" style={{ marginRight: 'auto', fontSize: 11.5, color: 'var(--text-low)' }}>
            用例图用于确认范围与角色；活动顺序见依赖图/活动图。
          </span>
          <button className="btn ghost" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
