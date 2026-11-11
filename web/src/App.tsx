import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EventRow } from '@acp-scrum/shared';
import { api, useLiveData } from './api';
import { Board } from './components/Board';
import { CreateModal } from './components/CreateModal';
import { Drawer } from './components/Drawer';
import { MetricsModal } from './components/MetricsModal';
import { ProfileModal } from './components/ProfileModal';
import { Rail } from './components/Rail';
import { RegisterModal, type RegisterInput } from './components/RegisterModal';
import { SearchPalette } from './components/SearchPalette';
import { SettingsModal } from './components/SettingsModal';
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
    },
    [pushToast],
  );

  const { projects, stories, approvals, events, connected, refresh } = useLiveData(onEvent);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);

  useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(projects[0].id);
  }, [projects, projectId]);

  const switchProject = useCallback((id: string) => {
    setProjectId(id);
    setSelectedId(null);
  }, []);

  const register = useCallback(
    async (input: RegisterInput) => {
      setBusy(true);
      try {
        const p = await api.createProject(input);
        pushToast('success', `项目「${p.name}」已注册`);
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
  const projectStories = useMemo(() => (project ? stories.filter((s) => s.projectId === project.id) : []), [stories, project]);
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

  const saveSettings = useCallback(
    async (patch: { agentKind: string; teamMode: boolean }) => {
      if (!project) return;
      setBusy(true);
      try {
        await api.updateSettings(project.id, patch);
        pushToast('success', '项目设置已保存');
        setSettingsOpen(false);
        await refresh();
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
      <TopBar project={project} projects={projects} stories={projectStories} connected={connected} onNewStory={() => setCreateOpen(true)} onSettings={() => setSettingsOpen(true)} onProfile={() => setProfileOpen(true)} onSearch={() => setSearchOpen(true)} onMetrics={() => setMetricsOpen(true)} onSwitchProject={switchProject} onRegister={() => setRegisterOpen(true)} />
      <div className="main">
        {projects.length === 0 ? (
          <div className="empty-state">
            <span className="empty-mark"><Icon name="logo" size={34} style={{ color: '#fff' }} /></span>
            <h2>欢迎使用 acp·scrum</h2>
            <p>注册一个 git 仓库作为项目，用智能体团队驱动用户故事，按 DoD 门禁交付。</p>
            <button className="btn primary" onClick={() => setRegisterOpen(true)}>
              <Icon name="plus" size={15} />
              注册第一个项目
            </button>
          </div>
        ) : (
          <>
            <div className="board-wrap">
              <div className="board-toolbar">
                <span className="board-title">用户故事看板</span>
                <span className="badge">{projectStories.length} 个故事</span>
                <span className="spacer" />
                <span className="badge cyan">ACP · {project?.agentKind ?? 'opencode'}</span>
              </div>
              <Board stories={projectStories} selectedId={selectedId} liveStoryIds={liveStoryIds} onOpen={setSelectedId} onAction={runAction} />
            </div>
            <Rail approvals={approvals} events={events} onDecide={decide} />
          </>
        )}
      </div>

      {selected && <Drawer story={selected} events={events} busy={busy} onClose={() => setSelectedId(null)} onAction={(a) => runAction(selected.id, a)} onResume={(msg) => resume(selected.id, msg)} />}
      {createOpen && project && <CreateModal projectName={project.name} busy={busy} onClose={() => setCreateOpen(false)} onCreate={create} />}
      {settingsOpen && project && <SettingsModal project={project} busy={busy} onClose={() => setSettingsOpen(false)} onSave={saveSettings} />}
      {profileOpen && project && <ProfileModal project={project} onClose={() => setProfileOpen(false)} />}
      {searchOpen && project && <SearchPalette project={project} onClose={() => setSearchOpen(false)} />}
      {metricsOpen && project && <MetricsModal project={project} onClose={() => setMetricsOpen(false)} />}
      {registerOpen && <RegisterModal busy={busy} onClose={() => setRegisterOpen(false)} onRegister={register} />}
      <Toasts toasts={toasts} />
    </div>
  );
}