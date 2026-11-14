import type { Story } from '@riccon-scrum/shared';
import { Icon } from '../icons';
import { STATUS_META } from '../ui';

export type AppView = 'overview' | 'board';
export type NavKey = 'overview' | 'requirements' | 'board' | 'bugs' | 'docs' | 'settings';

export function TopBar({
  stories,
  connected,
  hasProject,
  activeNav,
  onViewChange,
  onSettings,
  onDocs,
  onSearch,
  onRequirements,
  onBugs,
  onRegister,
}: {
  stories: Story[];
  connected: boolean;
  hasProject: boolean;
  activeNav: NavKey;
  onViewChange: (view: AppView) => void;
  onSettings: () => void;
  onDocs: () => void;
  onSearch: () => void;
  onRequirements: () => void;
  onBugs: () => void;
  onRegister: () => void;
}) {
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
            riccon<em>·</em>scrum
          </div>
          <div className="brand-sub">Agent Mission Control</div>
        </div>
      </div>

      {hasProject && (
        <nav className="main-nav" aria-label="主导航">
          <button
            className={`nav-item ${activeNav === 'overview' ? 'on' : ''}`}
            onClick={() => onViewChange('overview')}
            aria-label="项目概览"
          >
            <Icon name="home" size={14} />
            <span>概览</span>
          </button>
          <button
            className={`nav-item ${activeNav === 'requirements' ? 'on' : ''}`}
            onClick={onRequirements}
            aria-label="需求工作台"
          >
            <Icon name="sparkles" size={14} />
            <span>需求</span>
          </button>
          <button
            className={`nav-item ${activeNav === 'board' ? 'on' : ''}`}
            onClick={() => onViewChange('board')}
            aria-label="故事看板"
          >
            <Icon name="list" size={14} />
            <span>看板</span>
          </button>
          <button className={`nav-item ${activeNav === 'bugs' ? 'on' : ''}`} onClick={onBugs} aria-label="Bug 反馈">
            <Icon name="alert" size={14} />
            <span>Bug 反馈</span>
          </button>
          <button className={`nav-item ${activeNav === 'docs' ? 'on' : ''}`} onClick={onDocs} aria-label="项目文档">
            <Icon name="file" size={14} />
            <span>项目文档</span>
          </button>
          <button
            className="nav-search"
            onClick={onSearch}
            aria-label="搜索"
            data-tip="打开全局搜索（Ctrl+K）：检索需求、故事、符号与代码"
          >
            <Icon name="eye" size={14} />
            <span className="nav-search-text">搜索需求、故事、代码</span>
            <kbd>Ctrl K</kbd>
          </button>
        </nav>
      )}

      {!hasProject ? (
        <>
          <span className="spacer" />
          <button className="btn primary" onClick={onRegister}>
            <Icon name="plus" size={14} />
            新建项目
          </button>
        </>
      ) : (
        <>
          <span className="spacer" />
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

          <button
            className={`btn ghost settings-entry ${activeNav === 'settings' ? 'on' : ''}`}
            onClick={onSettings}
            aria-label="设置"
            data-tip="打开设置：运行参数、终端管理、项目配置、交付门禁与项目归档"
          >
            <Icon name="layers" size={15} />
            设置
          </button>
        </>
      )}
    </header>
  );
}

export function statusColor(s: Story['status']): string {
  return STATUS_META[s].color;
}
