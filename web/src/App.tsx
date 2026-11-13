import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Category, EventRow, Tag } from '@riccon-scrum/shared';
import { api, useLiveData } from './api';
import { Board } from './components/Board';
import { CategoryFilter } from './components/CategoryPicker';
import { CreateModal } from './components/CreateModal';
import { DependencyGraphModal } from './components/DependencyGraphModal';
import { TagFilter } from './components/TagPicker';
import { Drawer } from './components/Drawer';
import { MetricsModal } from './components/MetricsModal';
import { DocsPage } from './components/DocsPage';
import { Rail } from './components/Rail';
import { RegisterModal, type RegisterInput } from './components/RegisterModal';
import { RequirementsPage } from './components/RequirementsPage';
import { SearchPalette } from './components/SearchPalette';
import { SettingsPage, type SettingsTab } from './components/SettingsPage';
import { BugInbox } from './components/BugInbox';
import { Toasts, type Toast } from './components/Toasts';
import { TopBar } from './components/TopBar';
import { Icon } from './icons';

export default function App() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const pushToast = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3600);
  }, []);

  const onEvent = useCallback(
    (e: EventRow) => {
      const p = e.payload;
      if (p.type === 'dod.result') pushToast(p.status === 'pass' ? 'success' : 'error', `DoD ${p.status === 'pass' ? '通过' : '失败'}`);
      if (p.type === 'story.status' && p.to === 'review') pushToast('info', 'DoD 全过，进入人工验收');
      if (p.type === 'story.status' && p.to === 'done') pushToast('success', '故事已合并到主分支');
      if (p.type === 'approval.requested') pushToast('info', '需要你的决策：' + p.approval.title);
      if (p.type === 'requirement.draft') pushToast(p.issues > 0 ? 'error' : 'success', p.issues > 0 ? `需求草稿已生成，${p.issues} 个错误待修复` : `需求草稿已生成：${p.stories} 个故事`);
      if (p.type === 'requirement.materialized') pushToast('success', `需求已物化：生成 ${p.storyIds.length} 个用户故事`);
      if (p.type === 'requirement.split') pushToast('success', `需求已拆分为 ${p.children} 个子需求`);
      if (p.type === 'dependency.override') pushToast('info', `已跳过前置：${p.predecessors.join('、')}`);
      if (p.type === 'contract.result' && !p.ok) pushToast('error', '契约检查未通过，合并被阻止');
      if (p.type === 'task.plan') pushToast('info', `任务计划已生成：${p.tasks} 项`);
      if (p.type === 'task.status' && p.to === 'failed') pushToast('error', `任务 ${p.taskKey} 失败`);
      if (p.type === 'task.verify' && !p.ok) pushToast('error', `任务 ${p.taskKey} 验证未通过`);
      if (p.type === 'change.requested') pushToast('info', `需求变更已创建：影响 ${p.impact} 个故事`);
      if (p.type === 'change.materialized') pushToast('success', '需求变更已派生新需求');
      if (p.type === 'bug.reported') pushToast(p.severity === 'blocker' || p.severity === 'critical' ? 'error' : 'info', `Bug 已上报：${p.severity}/${p.priority}`);
      if (p.type === 'bug.fix_created') pushToast('info', '已创建 Bug 修复故事');
      if (p.type === 'bug.status' && p.to === 'fixed') pushToast('info', 'Bug 已修复，等待人工验证');
      if (p.type === 'document.generated') pushToast('success', `文档已生成：${p.docType}/${p.slug} v${p.version}`);
      if (p.type === 'document.synced') pushToast(p.conflicts > 0 ? 'info' : 'success', `文档同步完成：写入 ${p.written} 个文件`);
    },
    [pushToast],
  );

  const { projects, stories, requirements, approvals, events, connected, refresh } = useLiveData(onEvent);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('project');
  const [docsOpen, setDocsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [requirementsOpen, setRequirementsOpen] = useState(false);
  const [bugsOpen, setBugsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagFilter, setTagFilter] = useState('');
  const [graphOpen, setGraphOpen] = useState(false);
  const [requirementsFocusId, setRequirementsFocusId] = useState<string | null>(null);

  useEffect(() => {
    if (projects.length === 0) {
      if (projectId) setProjectId(null);
      return;
    }
    if (!projectId || !projects.some((p) => p.id === projectId)) setProjectId(projects[0].id);
  }, [projects, projectId]);

  const switchProject = useCallback((id: string) => {
    setProjectId(id);
    setSelectedId(null);
  }, []);

  const openSettings = useCallback((tab: SettingsTab) => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  const register = useCallback(
    async (input: RegisterInput) => {
      setBusy(true);
      try {
        const p = await api.createProject(input);
        pushToast('success', `项目「${p.name}」已创建`);
        setRegisterOpen(false);
        await refresh();
        setProjectId(p.id);
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [pushToast, refresh],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const project = projects.find((p) => p.id === projectId) ?? projects[0];

  const refreshCategories = useCallback(async () => {
    if (!project) return;
    setCategories(await api.categories(project.id));
  }, [project?.id]);

  const refreshTags = useCallback(async () => {
    if (!project) return;
    setTags(await api.tags(project.id));
  }, [project?.id]);

  useEffect(() => {
    if (!project) return;
    setCategoryFilter('');
    setTagFilter('');
    void refreshCategories().catch(() => setCategories([]));
    void refreshTags().catch(() => setTags([]));
  }, [project?.id, refreshCategories, refreshTags]);

  const projectStories = useMemo(() => (project ? stories.filter((s) => s.projectId === project.id) : []), [stories, project]);
  const boardStories = useMemo(() => {
    let list = projectStories;
    if (categoryFilter) {
      const selected = categories.find((category) => category.id === categoryFilter);
      if (selected) {
        const scope = new Set(
          categories.filter((category) => category.path.startsWith(selected.path)).map((category) => category.id),
        );
        list = list.filter((story) => story.categoryId && scope.has(story.categoryId));
      }
    }
    if (tagFilter) list = list.filter((story) => story.tags?.some((tag) => tag.id === tagFilter));
    return list;
  }, [projectStories, categoryFilter, categories, tagFilter]);
  const projectRequirements = useMemo(() => (project ? requirements.filter((r) => r.projectId === project.id) : []), [requirements, project]);
  const selected = useMemo(() => stories.find((s) => s.id === selectedId) ?? null, [stories, selectedId]);
  const liveStoryIds = useMemo(() => {
    const latest = new Map<string, string>();
    for (const e of events) {
      if (e.payload.type === 'session.status') latest.set(e.storyId, e.payload.status);
    }
    return new Set(stories.filter((s) => s.status === 'in_dev' && latest.get(s.id) === 'running').map((s) => s.id));
  }, [stories, events]);

  const runAction = useCallback(
    async (id: string, action: 'approve' | 'start' | 'rework' | 'accept') => {
      setBusy(true);
      try {
        await api.action(id, action);
        const msg = { approve: '故事已批准就绪', start: 'agent 已启动开发', rework: '已退回修改', accept: '验收通过，正在合并' }[action];
        pushToast('success', msg);
        await refresh();
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [pushToast, refresh],
  );

  const create = useCallback(
    async (b: { title: string; description: string; acceptanceCriteria: string }) => {
      if (!project) return;
      setBusy(true);
      try {
        const story = await api.createStory({ projectId: project.id, ...b });
        pushToast('success', '故事已创建');
        setCreateOpen(false);
        await refresh();
        setSelectedId(story.id);
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [project, pushToast, refresh],
  );

  const decide = useCallback(
    async (id: string, status: 'approved' | 'denied', optionId?: string) => {
      try {
        await api.decide(id, status, optionId);
        pushToast(status === 'approved' ? 'success' : 'info', status === 'approved' ? '已批准' : '已拒绝');
        await refresh();
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : String(err));
      }
    },
    [pushToast, refresh],
  );

  const resume = useCallback(
    async (id: string, message: string) => {
      setBusy(true);
      try {
        await api.resume(id, message);
        pushToast('success', '已恢复会话，继续开发');
        await refresh();
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [pushToast, refresh],
  );

  return (
    <div className="app">
      <TopBar project={project} projects={projects} stories={projectStories} connected={connected} onNewStory={() => setCreateOpen(true)} onSettings={() => openSettings('project')} onDocs={() => setDocsOpen(true)} onSearch={() => setSearchOpen(true)} onMetrics={() => setMetricsOpen(true)} onRequirements={() => setRequirementsOpen(true)} onBugs={() => setBugsOpen(true)} onSwitchProject={switchProject} onRegister={() => setRegisterOpen(true)} onManageProjects={() => openSettings('projects')} onChanged={refresh} onToast={pushToast} />
      <div className="main">
        {projects.length === 0 ? (
          <div className="empty-state">
            <span className="empty-mark"><Icon name="logo" size={34} style={{ color: '#fff' }} /></span>
            <h2>欢迎使用 riccon·scrum</h2>
            <p>新建一个项目，选择代码文件夹，用智能体团队驱动用户故事，按 DoD 门禁交付。</p>
            <button className="btn primary" onClick={() => setRegisterOpen(true)}>
              <Icon name="plus" size={15} />
              新建第一个项目
            </button>
          </div>
        ) : (
          <>
            <div className="board-wrap">
              <div className="board-toolbar">
                <span className="board-title">用户故事看板</span>
                <span className="badge">{boardStories.length} 个故事</span>
                <CategoryFilter categories={categories} value={categoryFilter} onChange={setCategoryFilter} />
                <TagFilter tags={tags} value={tagFilter} onChange={setTagFilter} />
                <button className="btn small ghost" onClick={() => setGraphOpen(true)}>
                  <Icon name="layers" size={12} />
                  依赖图
                </button>
                <span className="spacer" />
                <span className="badge cyan">ACP · {project?.agentKind ?? 'opencode'}</span>
              </div>
              <Board stories={boardStories} selectedId={selectedId} liveStoryIds={liveStoryIds} onOpen={setSelectedId} onAction={runAction} />
            </div>
            <Rail approvals={approvals} events={events} onDecide={decide} />
          </>
        )}
      </div>

      {selected && (
        <Drawer
          story={selected}
          project={project}
          events={events}
          busy={busy}
          categories={categories}
          tags={tags}
          onTagsChanged={refreshTags}
          allStories={projectStories}
          onClose={() => setSelectedId(null)}
          onAction={(a) => runAction(selected.id, a)}
          onRework={(reason) => resume(selected.id, reason)}
          onResume={(msg) => resume(selected.id, msg)}
          onToast={pushToast}
          onChanged={refresh}
          onOpenStory={(id) => setSelectedId(id)}
        />
      )}
      {graphOpen && project && (
        <DependencyGraphModal
          projectId={project.id}
          kind="story"
          onClose={() => setGraphOpen(false)}
          onSelect={(node) => {
            setSelectedId(node.id);
            setGraphOpen(false);
          }}
        />
      )}
      {createOpen && project && <CreateModal projectName={project.name} busy={busy} onClose={() => setCreateOpen(false)} onCreate={create} />}
      {settingsOpen && project && <SettingsPage key={project.id} project={project} initialTab={settingsTab} onClose={() => setSettingsOpen(false)} onToast={pushToast} onChanged={refresh} />}
      {requirementsOpen && project && (
        <RequirementsPage
          project={project}
          requirements={projectRequirements}
          events={events}
          onClose={() => {
            setRequirementsOpen(false);
            setRequirementsFocusId(null);
          }}
          onToast={pushToast}
          onChanged={refresh}
          onCategoriesChanged={refreshCategories}
          tags={tags}
          onTagsChanged={refreshTags}
          focusId={requirementsFocusId}
        />
      )}
      {docsOpen && project && <DocsPage project={project} onClose={() => setDocsOpen(false)} onToast={pushToast} />}
      {searchOpen && project && (
        <SearchPalette
          project={project}
          onClose={() => setSearchOpen(false)}
          onOpenStory={(id) => {
            setSelectedId(id);
            setSearchOpen(false);
          }}
          onOpenRequirement={(id) => {
            setRequirementsFocusId(id);
            setRequirementsOpen(true);
            setSearchOpen(false);
          }}
        />
      )}
      {metricsOpen && project && <MetricsModal project={project} onClose={() => setMetricsOpen(false)} />}
      {bugsOpen && project && (
        <BugInbox
          project={project}
          stories={projectStories}
          onClose={() => setBugsOpen(false)}
          onChanged={refresh}
          onToast={pushToast}
          onOpenStory={(id) => {
            setBugsOpen(false);
            setSelectedId(id);
          }}
        />
      )}
      {registerOpen && <RegisterModal busy={busy} onClose={() => setRegisterOpen(false)} onRegister={register} />}
      <Toasts toasts={toasts} />
    </div>
  );
}