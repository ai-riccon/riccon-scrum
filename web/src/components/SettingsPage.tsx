import { useEffect, useState } from 'react';
import type { GlobalSettings, Project } from '@riccon-scrum/shared';
import { api } from '../api';
import { Icon, type IconName } from '../icons';
import { EmbeddingPane, RuntimePane, TasksPane } from './settings/SettingsGlobalPanes';
import { KnowledgePane } from './settings/SettingsKnowledgePane';
import { DeliveryPane, ProjectConfigPane } from './settings/SettingsProjectPanes';
import { ProjectsPane } from './settings/SettingsProjectsPane';
import type { SettingsTab } from './settings/types';

export type { SettingsTab } from './settings/types';

const NAV: {
  group: string;
  items: { id: SettingsTab; label: string; icon: IconName; title: string; desc: string }[];
}[] = [
  {
    group: '全局',
    items: [
      {
        id: 'runtime',
        label: '运行参数',
        icon: 'activity',
        title: '运行参数',
        desc: 'WIP、预算、会话回收与新项目默认值，对所有项目生效。',
      },
      {
        id: 'embedding',
        label: '向量检索',
        icon: 'eye',
        title: '向量检索',
        desc: '配置 OpenAI 兼容的 Embedding 服务，用于需求与故事语义搜索。',
      },
      {
        id: 'tasks',
        label: '任务执行',
        icon: 'list',
        title: '任务执行',
        desc: 'Story Task 规划、并行执行、上下文预算与 Bug SLA。',
      },
    ],
  },
  {
    group: '项目',
    items: [
      {
        id: 'project',
        label: '项目配置',
        icon: 'bot',
        title: '项目配置',
        desc: '当前项目的 Agent、模型、术语表与开发模式。',
      },
      {
        id: 'delivery',
        label: '交付与门禁',
        icon: 'shield',
        title: '交付与门禁',
        desc: '发布/回滚、契约检查、自动审批与 DoD 命令。',
      },
      {
        id: 'knowledge',
        label: '知识库',
        icon: 'clipboard',
        title: '知识库',
        desc: 'ADR、团队规范与历史失败记忆，会注入需求与交付提示词。',
      },
      {
        id: 'projects',
        label: '项目归档',
        icon: 'archive',
        title: '项目归档',
        desc: '管理未归档与已归档项目，支持恢复或永久删除。',
      },
    ],
  },
];

export function SettingsPage({
  project,
  initialTab,
  onClose,
  onToast,
  onChanged,
}: {
  project: Project;
  initialTab?: SettingsTab;
  onClose: () => void;
  onToast: (kind: 'success' | 'error', text: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? 'project');
  const [agentKinds, setAgentKinds] = useState<string[]>(['opencode', 'claude-code', 'qoder-cli']);
  const [globalForm, setGlobalForm] = useState<GlobalSettings | null>(null);
  const [savingGlobal, setSavingGlobal] = useState(false);

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    api
      .settings()
      .then((d) => {
        setGlobalForm(d.global);
        setAgentKinds(d.agentKinds);
      })
      .catch((err) => onToast('error', err instanceof Error ? err.message : String(err)));
  }, [onToast]);

  const changeGlobal = (patch: Partial<GlobalSettings>) =>
    setGlobalForm((prev) => (prev ? { ...prev, ...patch } : prev));

  const saveGlobal = async () => {
    if (!globalForm) return;
    setSavingGlobal(true);
    try {
      await api.updateGlobalSettings(globalForm);
      onToast('success', '全局设置已保存（立即生效）');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setSavingGlobal(false);
    }
  };

  const current = NAV.flatMap((group) => group.items).find((item) => item.id === tab) ?? NAV[0].items[0];

  return (
    <div className="settings-page">
      <div className="settings-shell">
        <aside className="settings-nav">
          <div className="settings-brand">
            <Icon name="layers" size={18} style={{ color: 'var(--indigo-bright)' }} />
            <span>设置</span>
          </div>
          <div className="settings-nav-scroll">
            {NAV.map((group) => (
              <div key={group.group}>
                <div className="settings-nav-group">{group.group}</div>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    className={`settings-nav-item ${tab === item.id ? 'active' : ''}`}
                    onClick={() => setTab(item.id)}
                  >
                    <Icon name={item.icon} size={15} />
                    <span className="nav-label">{item.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="settings-nav-foot">
            <button className="btn ghost block" onClick={onClose}>
              <Icon name="arrowRight" size={14} style={{ transform: 'rotate(180deg)' }} />
              返回工作台
            </button>
          </div>
        </aside>

        <main className="settings-main">
          <header className="settings-topbar">
            <div className="settings-topbar-inner">
              <div className="settings-title">
                <h2>{current.title}</h2>
                <p>{current.desc}</p>
              </div>
              <span className="spacer" />
              <span className="badge">{project.name}</span>
              <button className="btn ghost" onClick={onClose}>
                <Icon name="x" size={14} />
                关闭
              </button>
            </div>
          </header>
          <div className="settings-content">
            {tab === 'runtime' &&
              (globalForm ? (
                <RuntimePane g={globalForm} onChange={changeGlobal} agentKinds={agentKinds} saving={savingGlobal} onSave={saveGlobal} />
              ) : (
                <div className="settings-loading">加载中…</div>
              ))}
            {tab === 'embedding' &&
              (globalForm ? (
                <EmbeddingPane g={globalForm} onChange={changeGlobal} agentKinds={agentKinds} saving={savingGlobal} onSave={saveGlobal} />
              ) : (
                <div className="settings-loading">加载中…</div>
              ))}
            {tab === 'tasks' &&
              (globalForm ? (
                <TasksPane g={globalForm} onChange={changeGlobal} agentKinds={agentKinds} saving={savingGlobal} onSave={saveGlobal} />
              ) : (
                <div className="settings-loading">加载中…</div>
              ))}
            {tab === 'project' && (
              <ProjectConfigPane key={project.id} project={project} agentKinds={agentKinds} onToast={onToast} onChanged={onChanged} />
            )}
            {tab === 'delivery' && <DeliveryPane key={project.id} project={project} onToast={onToast} onChanged={onChanged} />}
            {tab === 'knowledge' && <KnowledgePane key={project.id} project={project} onToast={onToast} onChanged={onChanged} />}
            {tab === 'projects' && (
              <ProjectsPane key={project.id} project={project} onToast={onToast} onChanged={onChanged} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
