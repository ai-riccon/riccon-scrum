import { useState } from 'react';
import type { Project } from '@riccon-scrum/shared';
import { Icon } from '../icons';

export function ProjectSwitcher({
  project,
  projects,
  onSwitchProject,
  onManageProjects,
  onRegister,
}: {
  project: Project;
  projects: Project[];
  onSwitchProject: (id: string) => void;
  onManageProjects: () => void;
  onRegister: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="project-switcher">
      <button
        className="project-chip"
        onClick={() => setMenuOpen((v) => !v)}
        title={project.repoPath}
        aria-label="切换项目"
        data-tip="切换项目，或进入项目归档 / 新建项目"
      >
        <Icon name="folder" size={13} style={{ color: 'var(--indigo-bright)' }} />
        <span className="name">{project.name}</span>
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
                <Icon name={p.id === project.id ? 'check' : 'folder'} size={13} />
                <span className="pm-name">{p.name}</span>
                <span className="pm-meta">{p.teamMode ? '团队' : 'Solo'} · {p.agentKind}</span>
              </button>
            ))}
            <button
              className="pm-item pm-manage"
              onClick={() => {
                onManageProjects();
                setMenuOpen(false);
              }}
              data-tip="管理项目归档：恢复或永久删除已归档项目"
            >
              <Icon name="archive" size={13} />
              <span className="pm-name">项目归档</span>
            </button>
            <button
              className="pm-item pm-register"
              onClick={() => {
                onRegister();
                setMenuOpen(false);
              }}
              data-tip="注册新项目：选择代码文件夹并初始化平台数据"
            >
              <Icon name="plus" size={13} />
              <span className="pm-name">新建项目</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
