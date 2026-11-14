import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Category,
  EventRow,
  Project,
  Requirement,
  RequirementMetrics,
  RequirementSplitChild,
  RequirementSplitDraft,
  RequirementStatus,
  Tag,
} from '@riccon-scrum/shared';
import { api, type RequirementLive } from '../api';
import { Icon } from '../icons';
import { CategoryFilter, CategoryManagerModal, CategorySelect } from './CategoryPicker';
import { confirmAction } from './ConfirmDialog';
import { DependencyGraphModal } from './DependencyGraphModal';
import { DependencyPeekModal, type DependencyPeekTarget } from './DependencyPeekModal';
import { DependencySuggestModal } from './DependencySuggestModal';
import { SplitDraftModal } from './SplitDraftModal';
import { ScopeDiagramModal } from './ScopeDiagramModal';
import { TaxonomyModal } from './TaxonomyModal';
import { TagEditor, TagFilter } from './TagPicker';
import { ChangeRequestPanel } from './ChangeRequestPanel';

type ToastKind = 'success' | 'error' | 'info';

const STATUS_LABEL: Record<RequirementStatus, string> = {
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

const STATUS_COLOR: Record<RequirementStatus, string> = {
  intake: 'var(--text-low)',
  clarifying: 'var(--amber)',
  drafting: 'var(--cyan)',
  in_review: 'var(--amber)',
  revising: 'var(--cyan)',
  approved: 'var(--green)',
  decomposed: 'var(--green)',
  split: 'var(--indigo-bright)',
  blocked: 'var(--red)',
  archived: 'var(--text-low)',
};

function StoryDecisions({
  storyKey,
  value,
  onChange,
}: {
  storyKey: string;
  value: { decision: 'approve' | 'reject'; comment: string } | undefined;
  onChange: (next: { decision: 'approve' | 'reject'; comment: string } | undefined) => void;
}) {
  return (
    <div className="req-decision">
      <button
        className={`btn small ${value?.decision === 'approve' ? 'cyan' : ''}`}
        onClick={() => onChange(value?.decision === 'approve' ? undefined : { decision: 'approve', comment: value?.comment ?? '' })}
      >
        <Icon name="check" size={12} />
        通过
      </button>
      <button
        className={`btn small ${value?.decision === 'reject' ? 'amber' : ''}`}
        onClick={() => onChange(value?.decision === 'reject' ? undefined : { decision: 'reject', comment: value?.comment ?? '' })}
      >
        <Icon name="x" size={12} />
        驳回
      </button>
      {value?.decision === 'reject' && (
        <input
          className="req-inline-input"
          value={value.comment}
          onChange={(e) => onChange({ decision: 'reject', comment: e.target.value })}
          placeholder={`${storyKey} 的驳回原因`}
        />
      )}
    </div>
  );
}

export function RequirementsPage({
  project,
  requirements,
  events,
  onClose,
  onToast,
  onChanged,
  onCategoriesChanged,
  tags,
  onTagsChanged,
  focusId,
}: {
  project: Project;
  requirements: Requirement[];
  events: EventRow[];
  onClose: () => void;
  onToast: (kind: ToastKind, text: string) => void;
  onChanged: () => Promise<void>;
  onCategoriesChanged?: () => Promise<void>;
  tags: Tag[];
  onTagsChanged?: () => Promise<void>;
  focusId?: string | null;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [splitDraft, setSplitDraft] = useState<RequirementSplitDraft | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [peek, setPeek] = useState<DependencyPeekTarget | null>(null);
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const loadCategories = useCallback(async () => {
    setCategories(await api.categories(project.id));
  }, [project.id]);

  useEffect(() => {
    void loadCategories().catch(() => undefined);
  }, [loadCategories]);

  useEffect(() => {
    if (focusId) setSelectedId(focusId);
  }, [focusId]);

  const depthById = useMemo(() => {
    const byId = new Map(requirements.map((r) => [r.id, r]));
    const depth = (id: string, seen = new Set<string>()): number => {
      if (seen.has(id)) return 1;
      const item = byId.get(id);
      if (!item?.parentRequirementId || !byId.has(item.parentRequirementId)) return 1;
      seen.add(id);
      return Math.min(3, depth(item.parentRequirementId, seen) + 1);
    };
    return new Map(requirements.map((r) => [r.id, depth(r.id)]));
  }, [requirements]);

  const orderedRequirements = useMemo(() => {
    const list = requirements.filter((r) => r.status !== 'archived');
    const ids = new Set(list.map((r) => r.id));
    const children = new Map<string, Requirement[]>();
    const roots: Requirement[] = [];
    for (const item of list) {
      if (item.parentRequirementId && ids.has(item.parentRequirementId)) {
        const bucket = children.get(item.parentRequirementId) ?? [];
        bucket.push(item);
        children.set(item.parentRequirementId, bucket);
      } else {
        roots.push(item);
      }
    }
    const out: Requirement[] = [];
    const visit = (item: Requirement) => {
      out.push(item);
      for (const child of children.get(item.id) ?? []) visit(child);
    };
    for (const root of roots) visit(root);
    return out;
  }, [requirements]);

  const visibleRequirements = useMemo(() => {
    let list = orderedRequirements;
    if (categoryFilter) {
      const selected = categories.find((category) => category.id === categoryFilter);
      if (selected) {
        const scope = new Set(
          categories.filter((category) => category.path.startsWith(selected.path)).map((category) => category.id),
        );
        list = list.filter((r) => r.categoryId && scope.has(r.categoryId));
      }
    }
    if (tagFilter) list = list.filter((r) => r.tags?.some((tag) => tag.id === tagFilter));
    return list;
  }, [orderedRequirements, categoryFilter, categories, tagFilter]);
  const lastEventSeq = events[events.length - 1]?.seq ?? 0;
  const [selectedId, setSelectedId] = useState<string | null>(visibleRequirements[0]?.id ?? null);
  const [detail, setDetail] = useState<RequirementLive | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [decisions, setDecisions] = useState<Record<string, { decision: 'approve' | 'reject'; comment: string }>>({});
  const [newOpen, setNewOpen] = useState(false);
  const [newMode, setNewMode] = useState<'chat' | 'form'>('chat');
  const [newMessage, setNewMessage] = useState('');
  const [intakeMsg, setIntakeMsg] = useState('');
  const [title, setTitle] = useState('');
  const [rawInput, setRawInput] = useState('');
  const [intake, setIntake] = useState({
    goal: '',
    users: '',
    constraints: '',
    nonGoals: '',
    successMetrics: '',
    examples: '',
  });
  const [metrics, setMetrics] = useState<RequirementMetrics | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackTitle, setFeedbackTitle] = useState('');
  const [feedbackDesc, setFeedbackDesc] = useState('');
  const [changeOpen, setChangeOpen] = useState(false);

  useEffect(() => {
    if (selectedId && visibleRequirements.some((r) => r.id === selectedId)) return;
    setSelectedId(visibleRequirements[0]?.id ?? null);
    setDetail(null);
    setVersion(null);
  }, [visibleRequirements, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setLoading(true);
    api
      .requirement(selectedId)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setVersion(d.requirement.currentVersion || null);
      })
      .catch((err) => {
        if (!cancelled) onToast('error', err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, lastEventSeq, onToast]);

  useEffect(() => {
    let cancelled = false;
    api
      .requirementMetrics(project.id)
      .then((m) => {
        if (!cancelled) setMetrics(m);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [project.id, lastEventSeq]);

  const selectedVersion = useMemo(() => {
    if (!detail) return null;
    return detail.versions.find((v) => v.version === version) ?? detail.versions[detail.versions.length - 1] ?? null;
  }, [detail, version]);

  const latestVersion = detail?.versions[detail.versions.length - 1] ?? null;
  const isLatest = !!selectedVersion && selectedVersion.version === latestVersion?.version;
  const errorCount = selectedVersion?.issues.filter((i) => i.severity === 'error').length ?? 0;
  const canReview = detail?.requirement.status === 'in_review' && isLatest;
  const canClarify = detail?.requirement.status === 'clarifying' && isLatest;
  const feedbackLocked = (detail?.requirement.currentVersion ?? 0) > 2;
  const generating = detail?.generating || ['drafting', 'revising'].includes(detail?.requirement.status ?? '');

  const previousVersion = useMemo(() => {
    if (!detail || !selectedVersion) return null;
    return detail.versions.find((v) => v.version === selectedVersion.version - 1) ?? null;
  }, [detail, selectedVersion]);

  const versionDiff = useMemo(() => {
    const before = previousVersion?.draft;
    const after = selectedVersion?.draft;
    if (!before || !after) return null;
    const beforeMap = new Map(before.stories.map((s) => [s.key, s]));
    const afterMap = new Map(after.stories.map((s) => [s.key, s]));
    const added = after.stories.filter((s) => !beforeMap.has(s.key)).map((s) => s.key);
    const removed = before.stories.filter((s) => !afterMap.has(s.key)).map((s) => s.key);
    const modified = after.stories
      .filter((s) => {
        const old = beforeMap.get(s.key);
        return old && JSON.stringify(old) !== JSON.stringify(s);
      })
      .map((s) => s.key);
    return { added, removed, modified, unchanged: after.stories.length - added.length - modified.length };
  }, [previousVersion, selectedVersion]);

  const modifiedKeys = new Set(versionDiff?.modified ?? []);
  const addedKeys = new Set(versionDiff?.added ?? []);

  const dorItems = useMemo(() => {
    const d = selectedVersion?.draft;
    if (!d) return [];
    const badCodes = new Set(selectedVersion?.issues.map((i) => i.code));
    return [
      { label: '目标明确', ok: d.goals.length > 0 },
      { label: '故事数 3–8', ok: d.stories.length >= 3 && d.stories.length <= 8 },
      { label: '角色与价值', ok: d.stories.every((s) => s.persona.trim() && s.value.trim()) },
      {
        label: 'GWT 完整',
        ok: d.stories.every(
          (s) => s.acceptance.length > 0 && s.acceptance.every((a) => a.given.trim() && a.when.trim() && a.then.trim()),
        ),
      },
      { label: 'AC 测试映射', ok: d.stories.every((s) => s.acceptance.length > 0 && s.acceptance.every((a) => (a.test ?? '').trim())) },
      { label: 'DoD 映射', ok: d.stories.every((s) => s.dod.length > 0) },
      { label: '来源条款', ok: d.stories.every((s) => s.clauses.length > 0) },
      { label: '无重复标题', ok: !badCodes.has('story-title-dup') && !badCodes.has('story-title-existing') },
      { label: '规模可交付', ok: d.stories.every((s) => ['S', 'M'].includes(s.size.toUpperCase())) },
    ];
  }, [selectedVersion]);

  const dorBlocked = dorItems.some((item) => !item.ok);
  const clauseCount = useMemo(
    () => new Set((selectedVersion?.draft?.stories ?? []).flatMap((s) => s.clauses)).size,
    [selectedVersion],
  );

  const fmtDuration = (ms: number | null): string => {
    if (ms === null) return '—';
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
    return `${(ms / 3_600_000).toFixed(1)}h`;
  };

  const transcript = useMemo(
    () =>
      events
        .filter((e) => e.storyId === selectedId && ['agent.message', 'agent.tool'].includes(e.type))
        .slice(-8),
    [events, selectedId],
  );

  const create = async () => {
    if (!title.trim() || !rawInput.trim()) {
      onToast('error', '请填写需求标题与原始需求');
      return;
    }
    const ok = await confirmAction({
      title: '创建需求',
      message: '需求创建后可以生成 AI 草稿并进入评审流程。',
      detail: `${project.name}\n${title.trim()}`,
      confirmText: '创建需求',
    });
    if (!ok) return;
    setBusy('create');
    try {
      const hasIntake = Object.values(intake).some((value) => value.trim());
      const r = await api.createRequirement({
        projectId: project.id,
        title: title.trim(),
        rawInput: rawInput.trim(),
        intake: hasIntake ? intake : undefined,
      });
      setTitle('');
      setRawInput('');
      setIntake({ goal: '', users: '', constraints: '', nonGoals: '', successMetrics: '', examples: '' });
      setNewOpen(false);
      await onChanged();
      setSelectedId(r.id);
      onToast('success', '需求已创建，可开始生成草稿');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const startChat = async () => {
    if (!newMessage.trim()) {
      onToast('error', '请用一句话描述需求');
      return;
    }
    const ok = await confirmAction({
      title: '开始需求澄清',
      message: '将创建需求并启动 AI 澄清会话，最多追问 3 轮。',
      detail: newMessage.trim(),
      confirmText: '开始澄清',
    });
    if (!ok) return;
    setBusy('intake-start');
    try {
      const requirement = await api.startIntake({ projectId: project.id, message: newMessage.trim() });
      setNewMessage('');
      setNewOpen(false);
      await onChanged();
      setSelectedId(requirement.id);
      onToast('info', '已开始澄清，AI 正在阅读你的需求');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const sendIntake = async () => {
    if (!detail || !intakeMsg.trim()) return;
    setBusy('intake-send');
    try {
      await api.intakeMessage(detail.requirement.id, intakeMsg.trim());
      setIntakeMsg('');
      await onChanged();
      onToast('success', '已发送，等待 AI 继续澄清');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const confirmChat = async () => {
    if (!detail) return;
    const ok = await confirmAction({
      title: '确认需求澄清结果',
      message: '确认后 AI 将生成用户故事，并在校验通过后自动物化。',
      detail: detail.requirement.title,
      confirmText: '确认并生成',
    });
    if (!ok) return;
    setBusy('intake-confirm');
    try {
      await api.confirmIntake(detail.requirement.id);
      onToast('info', '已确认，AI 正在生成故事并在校验通过后自动物化');
      await onChanged();
      setDetail(await api.requirement(detail.requirement.id));
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const generate = async () => {
    if (!detail) return;
    const ok = await confirmAction({
      title: '生成需求草稿',
      message: 'AI 将根据需求描述生成用户故事草稿，完成后需要人工评审。',
      detail: detail.requirement.title,
      confirmText: '开始生成',
    });
    if (!ok) return;
    setBusy('generate');
    try {
      await api.generateRequirement(detail.requirement.id);
      onToast('info', '已启动 AI 生成，完成后会通知');
      await onChanged();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const cancelGeneration = async () => {
    if (!detail) return;
    const ok = await confirmAction({
      title: '取消需求生成',
      message: '将请求停止当前生成任务，已生成的内容会保留。',
      detail: detail.requirement.title,
      confirmText: '取消生成',
      tone: 'warning',
    });
    if (!ok) return;
    setBusy('cancel');
    try {
      await api.cancelRequirement(detail.requirement.id);
      onToast('info', '已请求取消生成');
      await onChanged();
      setDetail(await api.requirement(detail.requirement.id));
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const submitProductionFeedback = async () => {
    if (!feedbackTitle.trim() || !feedbackDesc.trim()) {
      onToast('error', '请填写反馈标题与描述');
      return;
    }
    const ok = await confirmAction({
      title: '生产反馈转需求',
      message: '将创建一条新需求，并保留生产反馈来源。',
      detail: feedbackTitle.trim(),
      confirmText: '创建需求',
    });
    if (!ok) return;
    setBusy('feedback-create');
    try {
      const requirement = await api.createFeedback({
        projectId: project.id,
        title: feedbackTitle.trim(),
        description: feedbackDesc.trim(),
      });
      setFeedbackOpen(false);
      setFeedbackTitle('');
      setFeedbackDesc('');
      await onChanged();
      setSelectedId(requirement.id);
      onToast('success', '生产反馈已转为需求');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const submitFeedback = async () => {
    if (!detail) return;
    const rows = Object.entries(decisions)
      .filter(([, d]) => d.decision === 'reject' || d.comment.trim())
      .map(([storyKey, d]) => ({ storyKey, decision: d.decision, comment: d.comment.trim() }));
    if (!comment.trim() && rows.length === 0) {
      onToast('error', '请填写整体意见，或对具体故事批/驳');
      return;
    }
    const ok = await confirmAction({
      title: '提交需求评审反馈',
      message: '提交后 AI 将按反馈修订故事草稿，需要重新评审。',
      detail: `${detail.requirement.title}\n整体意见：${comment.trim() || '（无）'}\n逐条决定：${rows.length} 条`,
      confirmText: '提交反馈',
    });
    if (!ok) return;
    setBusy('feedback');
    try {
      await api.requirementFeedback(detail.requirement.id, { comment: comment.trim(), decisions: rows });
      setComment('');
      setDecisions({});
      onToast('success', '反馈已提交，AI 正在修订');
      await onChanged();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (!detail) return;
    if (errorCount > 0 || dorBlocked) {
      onToast('error', '存在校验错误或 DoR 未通过项，不能批准');
      return;
    }
    const ok = await confirmAction({
      title: '批准需求并生成故事',
      message: '批准后会生成用户故事草稿并直接进入 Ready 列。',
      detail: detail.requirement.title,
      confirmText: '批准并生成',
    });
    if (!ok) return;
    setBusy('approve');
    try {
      const result = await api.approveRequirement(detail.requirement.id);
      onToast('success', `已生成 ${result.stories.length} 个用户故事并进入 Ready`);
      await onChanged();
      const next = await api.requirement(detail.requirement.id);
      setDetail(next);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const changeCategory = async (categoryId: string | null) => {
    if (!detail) return;
    setBusy('category');
    try {
      await api.setRequirementCategory(detail.requirement.id, categoryId);
      await onChanged();
      setDetail(await api.requirement(detail.requirement.id));
      onToast('success', '需求分类已更新');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const [depCandidate, setDepCandidate] = useState('');
  const [depBusy, setDepBusy] = useState<string | null>(null);

  const refreshDetail = async () => {
    if (!detail) return;
    await onChanged();
    setDetail(await api.requirement(detail.requirement.id));
  };

  const addRequirementDependency = async () => {
    if (!detail || !depCandidate) return;
    const target = requirements.find((item) => item.id === depCandidate);
    const ok = await confirmAction({
      title: '添加前置需求',
      message: '该需求必须等前置需求完成后才能进入交付。',
      detail: `前置：${target?.title ?? depCandidate}\n当前：${detail.requirement.title}`,
      confirmText: '添加依赖',
    });
    if (!ok) return;
    setDepBusy('add');
    try {
      await api.createDependency({
        projectId: project.id,
        predecessorType: 'requirement',
        predecessorId: depCandidate,
        successorType: 'requirement',
        successorId: detail.requirement.id,
      });
      setDepCandidate('');
      await refreshDetail();
      onToast('success', '前置需求已添加');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setDepBusy(null);
    }
  };

  const removeRequirementDependency = async (id: string) => {
    const ok = await confirmAction({
      title: '移除前置需求',
      message: '移除后当前需求不再受该前置需求阻塞。',
      detail: requirements.find((item) => item.id === id)?.title ?? id,
      confirmText: '移除依赖',
      tone: 'warning',
    });
    if (!ok) return;
    setDepBusy(id);
    try {
      await api.deleteDependency(id);
      await refreshDetail();
      onToast('info', '依赖已移除');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setDepBusy(null);
    }
  };

  const loadSplitDraft = async () => {
    if (!detail) return;
    setBusy('split');
    try {
      const draft = await api.generateSplitDraft(detail.requirement.id);
      setSplitDraft(draft);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const confirmSplitDraft = async (children: RequirementSplitChild[]) => {
    if (!detail) return;
    setBusy('split-confirm');
    try {
      const result = await api.confirmSplit(detail.requirement.id, children);
      setSplitDraft(null);
      onToast('success', `已创建 ${result.children.length} 个子需求`);
      await onChanged();
      setDetail(await api.requirement(detail.requirement.id));
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const updateRequirementTags = async (next: Tag[]) => {
    if (!detail) return;
    setBusy('tags');
    try {
      await api.setRequirementTags(detail.requirement.id, next.map((tag) => tag.id));
      await onChanged();
      setDetail(await api.requirement(detail.requirement.id));
      onToast('success', '需求标签已更新');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
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

  const archive = async () => {
    if (!detail) return;
    const ok = await confirmAction({
      title: '归档需求',
      message: '归档后需求不再出现在默认列表，可在需要时恢复。',
      detail: detail.requirement.title,
      confirmText: '归档需求',
      tone: 'warning',
    });
    if (!ok) return;
    setBusy('archive');
    try {
      await api.archiveRequirement(detail.requirement.id);
      onToast('info', '需求已归档');
      await onChanged();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const requirement = detail?.requirement;
  const draft = selectedVersion?.draft ?? null;
  const requirementDeps = detail?.dependencies ?? [];
  const predecessorDeps = requirement ? requirementDeps.filter((dep) => dep.successorId === requirement.id) : [];
  const successorDeps = requirement ? requirementDeps.filter((dep) => dep.predecessorId === requirement.id) : [];
  const dependencyCandidates = requirement
    ? requirements.filter(
        (item) =>
          item.id !== requirement.id &&
          item.status !== 'archived' &&
          !predecessorDeps.some((dep) => dep.predecessorId === item.id),
      )
    : [];
  const blockedRequirements = predecessorDeps
    .map((dep) => requirements.find((item) => item.id === dep.predecessorId))
    .filter((item): item is Requirement => Boolean(item) && !['approved', 'decomposed', 'split'].includes(item!.status));
  const conversation = detail?.conversation ?? null;
  const canChat = !!requirement && ['intake', 'clarifying', 'blocked'].includes(requirement.status) && requirement.currentVersion === 0;
  const chatRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversation?.messages.length, conversation?.running]);

  return (
    <div className="settings-page req-page">
      <div className="settings-inner req-inner">
        <div className="settings-head">
          <Icon name="sparkles" size={18} style={{ color: 'var(--cyan)' }} />
          <h2>需求工作台</h2>
          <span className="badge">{project.name}</span>
          <span className="spacer" />
          <button
            className="btn ghost"
            onClick={() => {
              setNewMode('chat');
              setNewOpen(true);
            }}
            data-tip="创建需求：可先对话澄清，也可直接填写原始需求"
          >
            <Icon name="plus" size={14} />
            新建需求
          </button>
          <button className="btn ghost" onClick={() => setGraphOpen(true)} data-tip="查看需求之间的 Finish-to-Start 依赖图与关键路径">
            <Icon name="layers" size={14} />
            依赖图
          </button>
          <button className="btn ghost" onClick={() => setCategoryManagerOpen(true)} data-tip="管理三级分类树，用于需求和故事归类">
            <Icon name="layers" size={14} />
            分类
          </button>
          <button className="btn ghost" onClick={() => setTaxonomyOpen(true)} data-tip="让 AI 生成分类与标签建议，确认后批量应用">
            <Icon name="sparkles" size={14} />
            AI 分类/标签
          </button>
          <button className="btn ghost" onClick={() => setFeedbackOpen(true)} data-tip="把生产环境问题转为新需求，并保留反馈来源">
            <Icon name="inbox" size={14} />
            生产反馈
          </button>
        </div>

        {metrics && (
          <div className="req-stats">
            <div><span>需求总数</span><b>{metrics.total}</b></div>
            <div><span>待评审</span><b>{metrics.inReview}</b></div>
            <div><span>已物化</span><b>{metrics.decomposed}</b></div>
            <div><span>平均版本</span><b>{metrics.avgVersions.toFixed(1)}</b></div>
            <div><span>首版通过率</span><b>{metrics.firstPassRate === null ? '—' : Math.round(metrics.firstPassRate * 100) + '%'}</b></div>
            <div><span>条款覆盖</span><b>{metrics.coverage === null ? '—' : Math.round(metrics.coverage * 100) + '%'}</b></div>
            <div><span>平均周期</span><b>{fmtDuration(metrics.avgCycleMs)}</b></div>
            <div><span>生成故事</span><b>{metrics.materializedStories}</b></div>
          </div>
        )}

        <div className="req-layout">
          <aside className="req-list">
            <div className="section-label">需求（{visibleRequirements.length}）</div>
            <CategoryFilter categories={categories} value={categoryFilter} onChange={setCategoryFilter} />
            <TagFilter tags={tags} value={tagFilter} onChange={setTagFilter} />
            {visibleRequirements.length === 0 && <div className="rail-empty">还没有需求。新建一个，让 AI 起草故事。</div>}
            {visibleRequirements.map((r) => {
              const depth = depthById.get(r.id) ?? 1;
              return (
                <button
                  key={r.id}
                  className={`req-list-item ${r.id === selectedId ? 'active' : ''}`}
                  style={{ paddingLeft: 10 + (depth - 1) * 14 }}
                  onClick={() => {
                    setSelectedId(r.id);
                    setVersion(null);
                    setDecisions({});
                    setComment('');
                  }}
                >
                  <span className="req-list-title">
                    {depth > 1 && <span className="req-child-mark">└ </span>}
                    {r.title}
                  </span>
                  <span className="req-list-meta">
                    <span style={{ color: STATUS_COLOR[r.status] }}>{STATUS_LABEL[r.status]}</span>
                    <span className="req-list-tags">
                      {r.tags?.slice(0, 2).map((tag) => (
                        <i key={tag.id} style={{ background: tag.color }} title={tag.name} />
                      ))}
                    </span>
                    {r.currentVersion > 0 && <span>v{r.currentVersion}</span>}
                  </span>
                </button>
              );
            })}
          </aside>

          <section className="req-detail">
            {loading && !detail && <div className="hint">加载中…</div>}
            {!selectedId && <div className="rail-empty">选择或新建一个需求开始。</div>}
            {detail && requirement && (
              <>
                <div className="req-head">
                  <div>
                    <h3>{requirement.title}</h3>
                    <div className="req-head-meta">
                      <span className="badge" style={{ color: STATUS_COLOR[requirement.status] }}>
                        {STATUS_LABEL[requirement.status]}
                      </span>
                      {requirement.source !== 'manual' && (
                        <span className="badge">
                          {requirement.source === 'production'
                            ? '生产反馈'
                            : requirement.source === 'change_request'
                              ? '变更请求'
                              : requirement.source === 'chat'
                                ? '会话创建'
                                : requirement.source === 'decomposition'
                                  ? '需求拆分'
                                  : requirement.source}
                        </span>
                      )}
                      {requirement.approvedVersion && <span className="badge green">已批准 v{requirement.approvedVersion}</span>}
                      {generating && <span className="badge cyan">AI 工作中…</span>}
                      <CategorySelect
                        categories={categories}
                        value={requirement.categoryId}
                        onChange={changeCategory}
                        disabled={busy === 'category'}
                      />
                    </div>
                  </div>
                  <span className="spacer" />
                  <button
                    className="btn small"
                    disabled={!!busy || generating || !!conversation?.running || ['approved', 'decomposed', 'split', 'archived'].includes(requirement.status)}
                    onClick={generate}
                    data-tip={requirement.currentVersion ? '按当前需求描述重新生成故事草稿' : '按需求描述生成第一版故事草稿'}
                  >
                    <Icon name="refresh" size={12} />
                    {requirement.currentVersion ? '重新生成' : '生成草稿'}
                  </button>
                  {['in_review', 'clarifying'].includes(requirement.status) &&
                    requirement.currentVersion > 0 &&
                    (depthById.get(requirement.id) ?? 1) < 3 && (
                    <button className="btn small ghost" disabled={!!busy || generating} onClick={loadSplitDraft} data-tip="生成可勾选的子需求草案，确认后才创建">
                      <Icon name="layers" size={12} />
                      {busy === 'split' ? 'AI 生成草案中…' : 'AI 拆分为子需求'}
                    </button>
                  )}
                  {generating && (
                    <button className="btn small ghost" disabled={busy === 'cancel'} onClick={cancelGeneration} data-tip="停止当前需求生成任务，已生成内容会保留">
                      <Icon name="x" size={12} />
                      {busy === 'cancel' ? '取消中…' : '取消生成'}
                    </button>
                  )}
                  {['approved', 'decomposed'].includes(requirement.status) && (
                    <button className="btn small ghost" onClick={() => setChangeOpen((v) => !v)} data-tip="创建需求变更单并分析受影响故事与文档">
                      <Icon name="refresh" size={12} />
                      发起变更
                    </button>
                  )}
                  <button className="btn small ghost" onClick={() => setScopeOpen(true)} data-tip="查看该需求的范围用例图">
                    <Icon name="user" size={12} />
                    用例图
                  </button>
                  {requirement.status !== 'archived' && requirement.status !== 'decomposed' && (
                    <button className="btn small ghost" disabled={!!busy} onClick={archive} data-tip="归档需求，默认列表不再显示，可恢复">
                      <Icon name="inbox" size={12} />
                      归档
                    </button>
                  )}
                </div>

                {canChat && conversation && (
                  <>
                    <div className="section-label">需求澄清会话</div>
                    <div className="req-chat" ref={chatRef}>
                      {conversation.messages.map((m) => (
                        <div className={`req-chat-row ${m.role}`} key={m.id}>
                          <span className="req-chat-avatar">
                            <Icon name={m.role === 'user' ? 'user' : 'bot'} size={12} />
                          </span>
                          <div className={`req-chat-bubble ${m.role}`}>{m.content}</div>
                        </div>
                      ))}
                      {conversation.running && (
                        <div className="req-chat-row agent">
                          <span className="req-chat-avatar">
                            <Icon name="bot" size={12} />
                          </span>
                          <div className="req-chat-bubble agent typing">AI 正在思考…</div>
                        </div>
                      )}
                      {conversation.messages.length === 0 && !conversation.running && (
                        <div className="rail-empty">等待第一轮澄清…</div>
                      )}
                    </div>
                    {conversation.ready && <div className="req-note ok">AI 认为信息已足够，可以确认生成。</div>}
                    <div className="req-chat-compose">
                      <textarea
                        value={intakeMsg}
                        onChange={(e) => setIntakeMsg(e.target.value)}
                        placeholder="回答 AI 的问题。信息足够后点击确认，AI 会生成故事并在校验通过后自动物化。"
                        disabled={conversation.running}
                      />
                      <div className="req-actions">
                        <button
                          className="btn small"
                          disabled={conversation.running || !!busy || !intakeMsg.trim()}
                          onClick={sendIntake}
                          data-tip="把补充信息发送给 AI，继续澄清需求"
                        >
                          <Icon name="arrowRight" size={12} />
                          {busy === 'intake-send' ? '发送中…' : '发送回答'}
                        </button>
                        <button
                          className={`btn small ${conversation.ready ? 'primary' : 'ghost'}`}
                          disabled={conversation.running || !!busy || conversation.messages.length === 0}
                          onClick={confirmChat}
                          data-tip="结束澄清并生成故事；信息未收敛时可能停留在评审页"
                        >
                          <Icon name="check" size={12} />
                          {busy === 'intake-confirm'
                            ? '确认中…'
                            : conversation.ready
                              ? '确认并生成故事'
                              : '跳过追问，直接生成'}
                        </button>
                      </div>
                      {!conversation.ready && conversation.messages.some((m) => m.role === 'agent') && (
                        <div className="help">信息尚未收敛；直接生成时若 DoR 不通过，会停留在评审页供你修改。</div>
                      )}
                    </div>
                  </>
                )}

                <div className="section-label">原始需求</div>
                <pre className="req-raw">{requirement.rawInput}</pre>
                <div className="section-label">标签</div>
                <TagEditor
                  allTags={tags}
                  selected={requirement.tags ?? []}
                  disabled={busy === 'tags'}
                  onChange={(next) => void updateRequirementTags(next)}
                  onCreate={createTag}
                />

                {requirement.intake && (
                  <>
                    <div className="section-label">结构化 intake</div>
                    <div className="req-intake-view">
                      {requirement.intake.goal && <div><b>目标</b>{requirement.intake.goal}</div>}
                      {requirement.intake.users && <div><b>用户</b>{requirement.intake.users}</div>}
                      {requirement.intake.constraints && <div><b>约束</b>{requirement.intake.constraints}</div>}
                      {requirement.intake.nonGoals && <div><b>非目标</b>{requirement.intake.nonGoals}</div>}
                      {requirement.intake.successMetrics && <div><b>成功指标</b>{requirement.intake.successMetrics}</div>}
                      {requirement.intake.examples && <div><b>示例</b>{requirement.intake.examples}</div>}
                    </div>
                  </>
                )}
                {(detail.children ?? []).length > 0 && (
                  <>
                    <div className="section-label">子需求（{detail.children?.length}）</div>
                    <div className="req-children">
                      {detail.children?.map((child) => (
                        <button
                          className="req-child-item"
                          key={child.id}
                          onClick={() => {
                            setSelectedId(child.id);
                            setVersion(null);
                          }}
                        >
                          <span>{child.title}</span>
                          <span style={{ color: STATUS_COLOR[child.status] }}>{STATUS_LABEL[child.status]}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <div className="section-label">需求依赖</div>
                {blockedRequirements.length > 0 && (
                  <div className="req-note warn">
                    前置需求未完成：{blockedRequirements.map((item) => item.title).join('；')}
                  </div>
                )}
                <div className="dep-editor">
                  <div className="dep-group">
                    <span className="dep-label">前置需求</span>
                    {predecessorDeps.length === 0 && <span className="hint">暂无</span>}
                    {predecessorDeps.map((dep) => {
                      const item = requirements.find((r) => r.id === dep.predecessorId);
                      const satisfied = item && ['approved', 'decomposed', 'split'].includes(item.status);
                      return (
                        <span
                          className={`dep-chip clickable ${satisfied ? 'done' : ''}`}
                          key={dep.id}
                          role="button"
                          tabIndex={0}
                          onClick={() =>
                            setPeek({
                              type: 'requirement',
                              id: dep.predecessorId,
                              title: item?.title ?? dep.predecessorId,
                              status: item?.status ?? 'unknown',
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              setPeek({
                                type: 'requirement',
                                id: dep.predecessorId,
                                title: item?.title ?? dep.predecessorId,
                                status: item?.status ?? 'unknown',
                              });
                            }
                          }}
                        >
                          <Icon name={satisfied ? 'check' : 'clock'} size={11} />
                          {item?.title ?? dep.predecessorId}
                          <button
                            className="dep-remove"
                            aria-label="移除前置需求"
                            data-tip={`移除前置需求：${item?.title ?? dep.predecessorId}`}
                            disabled={depBusy === dep.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              void removeRequirementDependency(dep.id);
                            }}
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                  <div className="dep-group">
                    <span className="dep-label">后续需求</span>
                    {successorDeps.length === 0 && <span className="hint">暂无</span>}
                    {successorDeps.map((dep) => {
                      const item = requirements.find((r) => r.id === dep.successorId);
                      return (
                        <span
                          className="dep-chip clickable"
                          key={dep.id}
                          role="button"
                          tabIndex={0}
                          onClick={() =>
                            setPeek({
                              type: 'requirement',
                              id: dep.successorId,
                              title: item?.title ?? dep.successorId,
                              status: item?.status ?? 'unknown',
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              setPeek({
                                type: 'requirement',
                                id: dep.successorId,
                                title: item?.title ?? dep.successorId,
                                status: item?.status ?? 'unknown',
                              });
                            }
                          }}
                        >
                          {item?.title ?? dep.successorId}
                        </span>
                      );
                    })}
                  </div>
                  <div className="dep-add">
                    <select value={depCandidate} onChange={(e) => setDepCandidate(e.target.value)} aria-label="添加前置需求">
                      <option value="">添加前置需求…</option>
                      {dependencyCandidates.map((item) => (
                        <option key={item.id} value={item.id}>
                          [{STATUS_LABEL[item.status]}] {item.title}
                        </option>
                      ))}
                    </select>
                    <button className="btn small" disabled={!depCandidate || depBusy === 'add'} onClick={addRequirementDependency} data-tip="把选中的需求设为当前需求的前置依赖">
                      <Icon name="plus" size={12} />
                      添加
                    </button>
                    <button className="btn small ghost" disabled={depBusy !== null} onClick={() => setSuggestOpen(true)} data-tip="让 AI 推荐可添加的需求依赖，确认后才创建">
                      <Icon name="sparkles" size={12} />
                      AI 建议依赖
                    </button>
                  </div>
                  <div className="hint">前置需求的故事全部完成（拆分需求需所有子需求完成）后，后续故事才能启动；前置摘要与交付物会进入生成上下文。</div>
                </div>

                {detail.job?.status === 'failed' && detail.job.error && (
                  <div className="req-note warn">上次生成失败：{detail.job.error}</div>
                )}
                {changeOpen && ['approved', 'decomposed'].includes(requirement.status) && (
                  <ChangeRequestPanel
                    requirement={requirement}
                    onChanged={onChanged}
                    onToast={onToast}
                    onOpenRequirement={(id) => {
                      setChangeOpen(false);
                      setSelectedId(id);
                    }}
                  />
                )}

                {generating && transcript.length > 0 && (
                  <>
                    <div className="section-label">AI 实时活动</div>
                    <div className="req-transcript">
                      {transcript.map((e) => {
                        const p = e.payload;
                        if (p.type === 'agent.message') {
                          return (
                            <div className={`req-line ${p.role}`} key={e.seq}>
                              <span>{p.role === 'agent' ? 'AI' : p.role === 'thought' ? '思考' : '指令'}</span>
                              {p.text.slice(0, 240)}
                            </div>
                          );
                        }
                        if (p.type === 'agent.tool') {
                          return (
                            <div className="req-line tool" key={e.seq}>
                              <Icon name="terminal" size={11} />
                              {p.title || p.toolCallId}
                              <em>{p.status}</em>
                            </div>
                          );
                        }
                        return null;
                      })}
                    </div>
                  </>
                )}

                {detail.versions.length > 0 && (
                  <div className="req-version-bar">
                    <span className="section-label" style={{ margin: 0 }}>版本</span>
                    <select value={selectedVersion?.version ?? ''} onChange={(e) => setVersion(Number(e.target.value))}>
                      {detail.versions
                        .slice()
                        .reverse()
                        .map((v) => (
                          <option key={v.version} value={v.version}>
                            v{v.version} · {v.draft?.stories.length ?? 0} 个故事 · {v.issues.filter((i) => i.severity === 'error').length} 错误
                          </option>
                        ))}
                    </select>
                    {!isLatest && <span className="badge amber">历史版本（只读）</span>}
                  </div>
                )}

                {selectedVersion && selectedVersion.issues.length > 0 && (
                  <>
                    <div className="section-label">校验问题</div>
                    <div className="req-issues">
                      {selectedVersion.issues.map((issue, i) => (
                        <div className={`req-issue ${issue.severity}`} key={`${issue.code}-${i}`}>
                          <Icon name={issue.severity === 'error' ? 'alert' : 'dot'} size={12} />
                          <span>{issue.storyKey ? `${issue.storyKey}：` : ''}{issue.message}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {draft && dorItems.length > 0 && (
                  <>
                    <div className="section-label">Definition of Ready</div>
                    <div className="req-dor">
                      {dorItems.map((item) => (
                        <span className={`req-dor-item ${item.ok ? 'ok' : 'miss'}`} key={item.label}>
                          <Icon name={item.ok ? 'check' : 'x'} size={11} />
                          {item.label}
                        </span>
                      ))}
                    </div>
                  </>
                )}

                {versionDiff && previousVersion && (
                  <div className="req-diff">
                    <span className="section-label" style={{ margin: 0 }}>与 v{previousVersion.version} 对比</span>
                    <span className="badge cyan">新增 {versionDiff.added.length}</span>
                    <span className="badge amber">修改 {versionDiff.modified.length}</span>
                    <span className="badge red">删除 {versionDiff.removed.length}</span>
                    <span className="badge">未变 {versionDiff.unchanged}</span>
                    {versionDiff.added.length > 0 && <span className="req-note">新增：{versionDiff.added.join(', ')}</span>}
                    {versionDiff.modified.length > 0 && <span className="req-note">修改：{versionDiff.modified.join(', ')}</span>}
                    {versionDiff.removed.length > 0 && <span className="req-note">删除：{versionDiff.removed.join(', ')}</span>}
                  </div>
                )}

                {draft && isLatest && (
                  <div className="req-rationale">
                    <div className="section-label">批准依据</div>
                    <ul>
                      <li>
                        覆盖 {draft.goals.length} 个目标、{clauseCount} 个来源条款；{draft.stories.length} 个故事均需具备 GWT 与 DoD 映射。
                      </li>
                      <li>
                        DoR：{dorItems.filter((item) => item.ok).length}/{dorItems.length} 通过
                        {dorBlocked ? '（存在未通过项，批准被阻断）' : '，可以批准'}。
                      </li>
                      <li>非目标：{draft.nonGoals.join('；') || '未声明'}；待确认：{draft.openQuestions.join('；') || '无'}。</li>
                    </ul>
                  </div>
                )}

                {draft && (
                  <>
                    <div className="section-label">需求理解</div>
                    <p className="prose">{draft.summary || '（无摘要）'}</p>
                    {draft.goals.length > 0 && <div className="req-tags">{draft.goals.map((g) => <span className="chip" key={g}>{g}</span>)}</div>}
                    {draft.nonGoals.length > 0 && (
                      <div className="req-note"><b>非目标：</b>{draft.nonGoals.join('；')}</div>
                    )}
                    {(draft.categoryPath || (draft.tags?.length ?? 0) > 0) && (
                      <div className="req-note">
                        <b>AI 建议分类/标签：</b>
                        {draft.categoryPath || '未分类'}
                        {draft.tags?.length ? ` · ${draft.tags.join('、')}` : ''}
                        <span className="hint">（批准时自动应用；新分类请通过“AI 分类/标签”确认）</span>
                      </div>
                    )}
                    {draft.assumptions.length > 0 && (
                      <div className="req-note"><b>假设：</b>{draft.assumptions.join('；')}</div>
                    )}
                    {draft.openQuestions.length > 0 && (
                      <div className="req-note warn"><b>待确认：</b>{draft.openQuestions.join('；')}</div>
                    )}

                    {canClarify && (
                      <div className="req-clarify">
                        <div className="section-label">AI 澄清问题</div>
                        <ol className="req-questions">
                          {draft.openQuestions.map((question) => (
                            <li key={question}>{question}</li>
                          ))}
                        </ol>
                        <textarea
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          placeholder="逐条回答上述问题；回答会进入下一轮生成上下文。"
                        />
                        <div className="req-actions">
                          <button className="btn primary" disabled={!!busy || !comment.trim()} onClick={submitFeedback}>
                            <Icon name="refresh" size={13} />
                            {busy === 'feedback' ? '提交中…' : '提交澄清并重新生成'}
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="section-label">用户故事（{draft.stories.length}）</div>
                    {draft.stories.map((story) => (
                      <div className="req-story" key={story.key}>
                        <div className="req-story-head">
                          <span className="req-story-key">{story.key}</span>
                          <b>{story.title}</b>
                          <span className="badge">{story.size}</span>
                          {addedKeys.has(story.key) && <span className="badge cyan">新增</span>}
                          {modifiedKeys.has(story.key) && <span className="badge amber">有改动</span>}
                          <span className="spacer" />
                          {story.clauses.length > 0 && <span className="req-clause">来源 {story.clauses.join(', ')}</span>}
                        </div>
                        <div className="req-story-body">
                          {(story.persona || story.value) && (
                            <p className="prose">作为{story.persona || '用户'}，我希望{story.value || story.title}。</p>
                          )}
                          {story.description && <p className="prose muted">{story.description}</p>}
                          <div className="req-ac">
                            {story.acceptance.map((ac, i) => (
                              <div className="req-ac-item" key={`${story.key}-${ac.id}-${i}`}>
                                <span className="req-ac-id">{ac.id || `AC${i + 1}`}</span>
                                <div>
                                  <div><b>Given</b> {ac.given || '—'}</div>
                                  <div><b>When</b> {ac.when || '—'}</div>
                                  <div><b>Then</b> {ac.then || '—'}</div>
                                  <div><b>Test</b> {ac.test || '未映射'}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                          {story.dod.length > 0 && (
                            <div className="req-tags">{story.dod.map((d) => <span className="chip" key={d}>{d}</span>)}</div>
                          )}
                          {story.dependsOn.length > 0 && <div className="req-note">依赖：{story.dependsOn.join(', ')}</div>}
                          {story.outOfScope.length > 0 && <div className="req-note">不在范围：{story.outOfScope.join('；')}</div>}
                        </div>
                        {canReview && (
                          <StoryDecisions
                            storyKey={story.key}
                            value={decisions[story.key]}
                            onChange={(next) =>
                              setDecisions((prev) => {
                                const copy = { ...prev };
                                if (next) copy[story.key] = next;
                                else delete copy[story.key];
                                return copy;
                              })
                            }
                          />
                        )}
                      </div>
                    ))}

                    {canReview && (
                      <div className="req-feedback">
                        <div className="section-label">反馈与决策</div>
                        {feedbackLocked && (
                          <div className="req-note warn">已达到 2 轮人工反馈上限，请直接批准、归档或手工调整。</div>
                        )}
                        <textarea
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          disabled={feedbackLocked}
                          placeholder="整体修改意见：AI 会按此修订；未驳回的故事应尽量保持不变。"
                        />
                        <div className="req-actions">
                          <button className="btn" disabled={!!busy || feedbackLocked} onClick={submitFeedback} data-tip="按评审意见让 AI 修订故事草稿">
                            <Icon name="refresh" size={13} />
                            {busy === 'feedback' ? '提交中…' : '提交反馈并修订'}
                          </button>
                          <button className="btn primary" disabled={!!busy || errorCount > 0 || dorBlocked} onClick={approve} data-tip="校验通过后批准需求，并生成 Ready 状态的用户故事">
                            <Icon name="check" size={13} />
                            {busy === 'approve' ? '生成中…' : '批准并生成故事'}
                          </button>
                          {(errorCount > 0 || dorBlocked) && (
                            <span className="hint" style={{ color: 'var(--red)' }}>
                              {errorCount > 0 ? `存在 ${errorCount} 个错误` : 'DoR 未全部通过'}，批准被阻断
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {detail.feedback.length > 0 && (
                  <>
                    <div className="section-label">历史反馈</div>
                    <div className="req-feedback-list">
                      {detail.feedback.slice(-8).reverse().map((f) => (
                        <div className="req-feedback-row" key={f.id}>
                          <span className={`badge ${f.decision === 'reject' ? 'red' : f.decision === 'approve' ? 'green' : ''}`}>
                            v{f.version} · {f.storyKey ?? '整体'} · {f.decision}
                          </span>
                          <span>{f.comment || '（无说明）'}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      {taxonomyOpen && (
        <TaxonomyModal
          projectId={project.id}
          categories={categories}
          tags={tags}
          onClose={() => setTaxonomyOpen(false)}
          onToast={onToast}
          onApplied={async () => {
            await loadCategories();
            await onCategoriesChanged?.();
            await onTagsChanged?.();
            await onChanged();
          }}
        />
      )}

      {suggestOpen && requirement && (
        <DependencySuggestModal
          projectId={project.id}
          entityType="requirement"
          entityId={requirement.id}
          entityTitle={requirement.title}
          onClose={() => setSuggestOpen(false)}
          onApplied={() => refreshDetail()}
          onToast={onToast}
        />
      )}

      {peek && (
        <DependencyPeekModal
          projectId={project.id}
          target={peek}
          onClose={() => setPeek(null)}
          onOpenFull={(item) => {
            setPeek(null);
            setSelectedId(item.id);
            setVersion(null);
          }}
        />
      )}

      {scopeOpen && requirement && (
        <ScopeDiagramModal
          requirement={requirement}
          draft={detail?.versions.at(-1)?.draft ?? null}
          children={detail?.children ?? []}
          onClose={() => setScopeOpen(false)}
        />
      )}

      {splitDraft && requirement && (
        <SplitDraftModal
          draft={splitDraft}
          parentTitle={requirement.title}
          busy={busy === 'split-confirm'}
          onClose={() => setSplitDraft(null)}
          onConfirm={confirmSplitDraft}
        />
      )}

      {graphOpen && (
        <DependencyGraphModal
          projectId={project.id}
          kind="requirement"
          onClose={() => setGraphOpen(false)}
          onSelect={(node) => {
            setSelectedId(node.id);
            setGraphOpen(false);
          }}
        />
      )}

      {categoryManagerOpen && (
        <CategoryManagerModal
          projectId={project.id}
          categories={categories}
          onClose={() => setCategoryManagerOpen(false)}
          onToast={onToast}
          onChanged={async () => {
            await loadCategories();
            await onCategoriesChanged?.();
            await onChanged();
          }}
        />
      )}

      {feedbackOpen && (
        <div className="modal-scrim" onClick={() => setFeedbackOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="生产反馈">
            <div className="modal-head">
              <Icon name="inbox" size={18} style={{ color: 'var(--indigo-bright)', marginRight: 10 }} />
              <h3>生产反馈转需求</h3>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>反馈标题 *</label>
                <input autoFocus value={feedbackTitle} onChange={(e) => setFeedbackTitle(e.target.value)} placeholder="例如：导出偶发超时" />
              </div>
              <div className="field">
                <label>反馈描述 *</label>
                <textarea
                  value={feedbackDesc}
                  onChange={(e) => setFeedbackDesc(e.target.value)}
                  placeholder="现象、影响范围、复现步骤、期望结果。"
                  style={{ minHeight: 150 }}
                />
                <div className="help">创建后进入发现轨道 intake，可继续澄清、生成故事；来源标记为生产反馈。</div>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setFeedbackOpen(false)}>取消</button>
              <button className="btn primary" disabled={busy === 'feedback-create' || !feedbackTitle.trim() || !feedbackDesc.trim()} onClick={submitProductionFeedback}>
                <Icon name="plus" size={14} />
                {busy === 'feedback-create' ? '创建中…' : '转为需求'}
              </button>
            </div>
          </div>
        </div>
      )}

      {newOpen && (
        <div className="modal-scrim" onClick={() => setNewOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="新建需求">
            <div className="modal-head">
              <Icon name="sparkles" size={18} style={{ color: 'var(--cyan)', marginRight: 10 }} />
              <h3>新建需求</h3>
              <span className="badge" style={{ marginLeft: 'auto' }}>{project.name}</span>
            </div>
            <div className="modal-body">
              <div className="req-mode-tabs">
                <button className={`btn small ${newMode === 'chat' ? 'primary' : 'ghost'}`} onClick={() => setNewMode('chat')}>
                  <Icon name="sparkles" size={12} />
                  对话创建
                </button>
                <button className={`btn small ${newMode === 'form' ? 'primary' : 'ghost'}`} onClick={() => setNewMode('form')}>
                  <Icon name="layers" size={12} />
                  表单创建
                </button>
              </div>
              {newMode === 'chat' ? (
                <>
                  <div className="field">
                    <label>用一句话描述你的需求 *</label>
                    <textarea
                      autoFocus
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      placeholder="例如：给团队成员加一个邀请链接，管理员可以设置角色和有效期。"
                      style={{ minHeight: 140 }}
                    />
                    <div className="help">AI 会逐轮追问，直到目标、用户与成功指标足够清晰；你确认后自动生成并物化用户故事。</div>
                  </div>
                  <div className="req-chat-examples">
                    {[
                      '给成员加邀请链接，管理员可设置角色和有效期',
                      '导出偶发超时，希望能看到失败原因并重试',
                      '做一个项目健康度看板，按周展示阻塞与返工',
                    ].map((example) => (
                      <button className="chip" key={example} onClick={() => setNewMessage(example)}>
                        {example}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="field">
                    <label>需求标题 *</label>
                    <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：成员邀请与权限管理" />
                  </div>
                  <div className="field">
                    <label>原始需求 *</label>
                    <textarea
                      value={rawInput}
                      onChange={(e) => setRawInput(e.target.value)}
                      placeholder="把原始需求、用户反馈、约束、非目标原样贴进来。信息越完整，生成的故事越可用。"
                      style={{ minHeight: 180 }}
                    />
                    <div className="help">AI 会先给出需求理解与待确认问题，再拆成带 Given/When/Then 的用户故事。</div>
                  </div>
                  <div className="section-label" style={{ marginTop: 6 }}>结构化 intake（可选，填写后减少 AI 追问）</div>
                  <div className="req-intake-grid">
                    <div className="field">
                      <label>目标</label>
                      <input value={intake.goal} onChange={(e) => setIntake({ ...intake, goal: e.target.value })} placeholder="要达成的业务结果" />
                    </div>
                    <div className="field">
                      <label>用户</label>
                      <input value={intake.users} onChange={(e) => setIntake({ ...intake, users: e.target.value })} placeholder="目标用户/角色" />
                    </div>
                    <div className="field">
                      <label>约束</label>
                      <textarea value={intake.constraints} onChange={(e) => setIntake({ ...intake, constraints: e.target.value })} placeholder="技术、时间、合规等约束" />
                    </div>
                    <div className="field">
                      <label>非目标</label>
                      <textarea value={intake.nonGoals} onChange={(e) => setIntake({ ...intake, nonGoals: e.target.value })} placeholder="本迭代明确不做的事" />
                    </div>
                    <div className="field">
                      <label>成功指标</label>
                      <input value={intake.successMetrics} onChange={(e) => setIntake({ ...intake, successMetrics: e.target.value })} placeholder="可衡量的验收指标" />
                    </div>
                    <div className="field">
                      <label>示例</label>
                      <textarea value={intake.examples} onChange={(e) => setIntake({ ...intake, examples: e.target.value })} placeholder="输入/输出示例、用户场景" />
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setNewOpen(false)}>取消</button>
              {newMode === 'chat' ? (
                <button className="btn primary" disabled={busy === 'intake-start' || !newMessage.trim()} onClick={startChat}>
                  <Icon name="sparkles" size={14} />
                  {busy === 'intake-start' ? '开始中…' : '开始澄清'}
                </button>
              ) : (
                <button className="btn primary" disabled={busy === 'create' || !title.trim() || !rawInput.trim()} onClick={create}>
                  <Icon name="plus" size={14} />
                  {busy === 'create' ? '创建中…' : '创建需求'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
