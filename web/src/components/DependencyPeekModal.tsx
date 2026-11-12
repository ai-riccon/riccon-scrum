import { useEffect, useState } from 'react';
import type { Category, Handoff, Requirement, RequirementDraft, Story, StoryDependencyInfo } from '@riccon-scrum/shared';
import { api } from '../api';
import { Icon } from '../icons';
import { categoryName } from './CategoryPicker';

export interface DependencyPeekTarget {
  type: 'requirement' | 'story';
  id: string;
  title: string;
  status: string;
}

export function DependencyPeekModal({
  projectId,
  target,
  onClose,
  onOpenFull,
}: {
  projectId: string;
  target: DependencyPeekTarget;
  onClose: () => void;
  onOpenFull?: (target: DependencyPeekTarget) => void;
}) {
  const [categoryList, setCategoryList] = useState<Category[]>([]);
  const [story, setStory] = useState<Story | null>(null);
  const [storyDeps, setStoryDeps] = useState<StoryDependencyInfo | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [draft, setDraft] = useState<RequirementDraft | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .categories(projectId)
      .then((list) => {
        if (!cancelled) setCategoryList(list);
      })
      .catch(() => undefined);

    const load =
      target.type === 'story'
        ? Promise.all([
            api.storyDetail(target.id),
            api.storyDependencies(target.id),
            api.storyHandoff(target.id).catch(() => null),
          ]).then(([detail, deps, saved]) => {
            if (cancelled) return;
            setStory(detail.story);
            setStoryDeps(deps);
            setHandoff(saved);
          })
        : api.requirement(target.id).then((detail) => {
            if (cancelled) return;
            setRequirement(detail.requirement);
            setDraft(detail.versions.at(-1)?.draft ?? null);
          });

    load.catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, target.id, target.type]);

  const entity = story ?? requirement;
  const categoryId = entity?.categoryId ?? null;

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal peek-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="依赖事项详情">
        <div className="modal-head">
          <Icon name={target.type === 'story' ? 'file' : 'sparkles'} size={18} style={{ color: 'var(--cyan)', marginRight: 10 }} />
          <h3>{target.title}</h3>
          <span className="badge">{target.type === 'story' ? '故事' : '需求'}</span>
          <span className="badge cyan">{target.status}</span>
          <button className="btn icon ghost" onClick={onClose} aria-label="关闭" style={{ marginLeft: 'auto' }}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="modal-body">
          {loading && <div className="rail-empty">加载中…</div>}
          {error && <div className="req-note warn">{error}</div>}
          {!loading && entity && (
            <>
              <div className="peek-meta">
                <span>分类：{categoryName(categoryList, categoryId)}</span>
                <span>标签：{(entity.tags ?? []).map((tag) => tag.name).join('、') || '未设置'}</span>
              </div>
              {target.type === 'story' && story && (
                <>
                  <div className="section-label">故事描述</div>
                  <p className="prose">{story.description || '（无描述）'}</p>
                  <div className="section-label">验收标准</div>
                  <div className="bdd">{story.acceptanceCriteria || '（未提供）'}</div>
                  {storyDeps && (
                    <div className="peek-deps">
                      <span className="badge">前置 {storyDeps.predecessors.length}</span>
                      <span className="badge">后续 {storyDeps.successors.length}</span>
                      {storyDeps.blockedBy.length > 0 && <span className="badge red">等待 {storyDeps.blockedBy.length} 项前置</span>}
                    </div>
                  )}
                  {handoff && (
                    <>
                      <div className="section-label">交付物 Handoff</div>
                      <div className="req-note">{handoff.summary}</div>
                      {handoff.contracts && <div className="req-note">契约：{handoff.contracts}</div>}
                      {handoff.decisions.length > 0 && <div className="req-note">决策：{handoff.decisions.join('；')}</div>}
                    </>
                  )}
                </>
              )}
              {target.type === 'requirement' && requirement && (
                <>
                  <div className="section-label">原始需求</div>
                  <pre className="req-raw">{requirement.rawInput}</pre>
                  {draft && (
                    <>
                      <div className="section-label">需求理解</div>
                      <p className="prose">{draft.summary || '（无摘要）'}</p>
                      {draft.goals.length > 0 && <div className="req-note">目标：{draft.goals.join('；')}</div>}
                      {draft.nonGoals.length > 0 && <div className="req-note">非目标：{draft.nonGoals.join('；')}</div>}
                      <div className="peek-deps">
                        <span className="badge">{draft.stories.length} 个故事</span>
                        {draft.openQuestions.length > 0 && <span className="badge amber">{draft.openQuestions.length} 个待确认</span>}
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>关闭</button>
          {onOpenFull && (
            <button className="btn primary" onClick={() => onOpenFull(target)}>
              打开完整详情
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
