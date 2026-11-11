import { useState } from 'react';
import type { Project, Story } from '@acp-scrum/shared';
import { Icon } from '../icons';
import { STATUS_META } from '../ui';

export function TopBar({
  project,
  projects,
  stories,
  connected,
  onNewStory,
  onSettings,
  onProfile,
  onSearch,
  onMetrics,
  onSwitchProject,
  onRegister,
}: {
  project?: Project;
  projects: Project[];
  stories: Story[];
  connected: boolean;
  onNewStory: () => void;
  onSettings: () => void;
  onProfile: () => void;
  onSearch: () => void;
  onMetrics: () => void;
  onSwitchProject: (id: string) => void;
  onRegister: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const active = stories.filter((s) => s.status === 'in_dev').length;
  const review = stories.filter((s) => s.status === 'review').length;
  const done = stories.filter((s) => s.status === 'done').length;
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">
          <Icon name="logo" size={20} style={{ color: '#fff' }} />
        </span>
        <div>
          <div className="brand-name">
            acp<em>·</em>scrum
          </div>
          <div className="brand-sub">Agent Mission Control</div>
        </div>
      </div>

      {project && (
        <div className="project-switcher">
          <button className="project-chip" onClick={() => setMenuOpen((v) => !v)} title={project.repoPath} aria-label="切换项目">
            <Icon name="branch" size={13} style={{ color: 'var(--indigo-bright)' }} />
            <span>{project.name}</span>
            <span className="repo">{project.repoPath}</span>
            <Icon name="arrowRight" size={12} style={{ transform: 'rotate(90deg)', color: 'var(--text-low)' }} />
          </button>
          {menuOpen && (
            <>
              <div className="menu-scrim" onClick={() => setMenuOpen(false)} />
              <div className="project-menu">
                <div className="pm-head">切换项目</div>
                {projects.map((p) => (
                  <button
                    key={p.id}
                    className={`pm-item ${p.id === project.id ? 'active' : ''}`}
                    onClick={() => {
                      onSwitchProject(p.id);
                      setMenuOpen(false);
                    }}
                  >
                    <Icon name={p.id === project.id ? 'check' : 'branch'} size={13} />
                    <span className="pm-name">{p.name}</span>
                    <span className="pm-meta">{p.teamMode ? '团队' : 'Solo'} · {p.agentKind}</span>
                  </button>
                ))}
                <button
                  className="pm-item pm-register"
                  onClick={() => {
                    onRegister();
                    setMenuOpen(false);
                  }}
                >
                  <Icon name="plus" size={13} />
                  <span className="pm-name">注册新项目</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {!project && (
        <button className="btn primary" onClick={onRegister}>
          <Icon name="plus" size={14} />
          注册项目
        </button>
      )}

      <div className="topbar-stats">
        <span className="stat-pill">
          <i className="stat-dot" style={{ background: 'var(--st-indev)', boxShadow: '0 0 8px var(--st-indev)' }} />
          开发中 <b>{active}</b>
        </span>
        <span className="stat-pill">
          <i className="stat-dot" style={{ background: 'var(--st-review)' }} />
          待验收 <b>{review}</b>
        </span>
        <span className="stat-pill">
          <i className="stat-dot" style={{ background: 'var(--st-done)' }} />
          已完成 <b>{done}</b>
        </span>
      </div>

      <div className={`conn ${connected ? '' : 'off'}`}>
        <i className="dot" />
        {connected ? '实时连接' : '重连中…'}
      </div>

      <button className="btn icon ghost" onClick={onMetrics} aria-label="流动度量" title="流动度量">
        <Icon name="activity" size={16} />
      </button>
      <button className="btn icon ghost" onClick={onSearch} aria-label="代码搜索" title="代码搜索 (Ctrl+K)">
        <Icon name="eye" size={16} />
      </button>
      <button className="btn icon ghost" onClick={onProfile} aria-label="项目档案" title="项目档案">
        <Icon name="file" size={16} />
      </button>
      <button className="btn icon ghost" onClick={onSettings} aria-label="项目设置" title="项目设置">
        <Icon name="layers" size={16} />
      </button>
      <button className="btn primary" onClick={onNewStory}>
        <Icon name="plus" size={15} />
        新建故事
      </button>
    </header>
  );
}

export function statusColor(s: Story['status']): string {
  return STATUS_META[s].color;
}