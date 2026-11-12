import type { BoardStory } from '../api';
import { Icon } from '../icons';
import { COLUMNS, DodMini, STATUS_META } from '../ui';

function StoryCard({
  story,
  selected,
  live,
  onOpen,
  onAction,
}: {
  story: BoardStory;
  selected: boolean;
  live: boolean;
  onOpen: () => void;
  onAction: (a: 'approve' | 'start' | 'accept') => void;
}) {
  const m = STATUS_META[story.status];
  return (
    <div className={`card ${selected ? 'selected' : ''}`} onClick={onOpen} role="button" tabIndex={0}>
      <span className="accent" style={{ background: m.color, boxShadow: `0 0 8px ${m.color}` }} />
      <p className="card-title">{story.title}</p>
      <div className="card-meta">
        {story.branch && (
          <span className="chip">
            <Icon name="branch" size={11} />
            <span className="truncate">{story.branch}</span>
          </span>
        )}
        {story.tasks && story.tasks.total > 0 && (
          <span className="chip" title={story.tasks.currentTitle ?? ''}>
            <Icon name="list" size={11} />
            {story.tasks.done}/{story.tasks.total} 任务
          </span>
        )}
        {story.status === 'in_dev' && live && (
          <span className="live-dot">
            <i />
            agent 工作中
          </span>
        )}
      </div>
      <div className="card-foot">
        <DodMini items={story.dod} />
        <span style={{ flex: 1 }} />
        {story.status === 'draft' && (
          <button
            className="btn sm"
            onClick={(e) => {
              e.stopPropagation();
              onAction('approve');
            }}
          >
            <Icon name="check" size={12} />
            批准
          </button>
        )}
        {story.status === 'ready' && (
          <button
            className="btn sm cyan"
            onClick={(e) => {
              e.stopPropagation();
              onAction('start');
            }}
          >
            <Icon name="play" size={12} />
            启动
          </button>
        )}
        {story.status === 'review' && (
          <button
            className="btn sm amber"
            onClick={(e) => {
              e.stopPropagation();
              onAction('accept');
            }}
          >
            <Icon name="merge" size={12} />
            验收
          </button>
        )}
      </div>
    </div>
  );
}

export function Board({
  stories,
  selectedId,
  liveStoryIds,
  onOpen,
  onAction,
}: {
  stories: BoardStory[];
  selectedId: string | null;
  liveStoryIds: Set<string>;
  onOpen: (id: string) => void;
  onAction: (id: string, a: 'approve' | 'start' | 'accept') => void;
}) {
  return (
    <div className="board">
      {COLUMNS.map((status) => {
        const m = STATUS_META[status];
        const items = stories.filter((s) => s.status === status);
        return (
          <section className="column" key={status}>
            <div className="column-head">
              <span className="bar" style={{ background: m.color, boxShadow: `0 0 8px ${m.color}` }} />
              <h2>{m.label}</h2>
              <span className="count">{items.length}</span>
            </div>
            <div className="column-body">
              {items.length === 0 && <div className="column-empty">暂无故事</div>}
              {items.map((s) => (
                <StoryCard
                  key={s.id}
                  story={s}
                  selected={selectedId === s.id}
                  live={liveStoryIds.has(s.id)}
                  onOpen={() => onOpen(s.id)}
                  onAction={(a) => onAction(s.id, a)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}