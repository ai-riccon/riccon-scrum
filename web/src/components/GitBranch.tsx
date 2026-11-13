import { useCallback, useEffect, useState } from 'react';
import type { GitRepoState, Project } from '@riccon-scrum/shared';
import { api } from '../api';
import { Icon } from '../icons';

export function GitBranchChip({
  project,
  onChanged,
  onToast,
}: {
  project: Project;
  onChanged: () => void | Promise<void>;
  onToast: (kind: 'success' | 'error' | 'info', text: string) => void;
}) {
  const [state, setState] = useState<GitRepoState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api.projectGit(project.id);
      setState(next);
    } catch (err) {
      setState(null);
      onToast('error', err instanceof Error ? err.message : String(err));
    }
  }, [project.id, onToast]);

  useEffect(() => {
    setMenuOpen(false);
    setState(null);
    void load();
  }, [load]);

  const initRepo = useCallback(async () => {
    setBusy(true);
    try {
      const next = await api.initProjectRepo(project.id);
      setState(next);
      setMenuOpen(false);
      onToast('success', `本地仓库已就绪：${next.branch ?? 'main'}`);
      await onChanged();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [project.id, onChanged, onToast]);

  const checkout = useCallback(
    async (branch: string) => {
      setBusy(true);
      try {
        const next = await api.checkoutBranch(project.id, branch);
        setState(next);
        setMenuOpen(false);
        onToast('success', `已切换到分支 ${branch}`);
        await onChanged();
      } catch (err) {
        onToast('error', err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [project.id, onChanged, onToast],
  );

  if (!state) {
    return (
      <span className="project-chip branch-chip muted" title={project.repoPath}>
        <Icon name="branch" size={13} />
        <span className="branch-name">检测仓库…</span>
      </span>
    );
  }

  if (!state.isRepo) {
    return (
      <button
        className="btn small git-init"
        onClick={() => void initRepo()}
        disabled={busy}
        title={state.error ?? `在 ${project.repoPath} 初始化 Git 仓库`}
      >
        <Icon name="branch" size={13} className={busy ? 'spin' : ''} />
        {busy ? '创建中…' : '创建本地仓库'}
      </button>
    );
  }

  if (!state.hasCommits) {
    return (
      <button className="btn small git-init" onClick={() => void initRepo()} disabled={busy} title="创建初始提交">
        <Icon name="branch" size={13} className={busy ? 'spin' : ''} />
        {busy ? '创建中…' : '创建初始提交'}
      </button>
    );
  }

  const branches = state.branches.filter(
    (branch) => (!branch.startsWith('story/') && !branch.startsWith('task/')) || branch === state.branch,
  );
  return (
    <div className="branch-switcher">
      <button
        className="project-chip branch-chip"
        onClick={() => {
          setMenuOpen((v) => {
            if (!v) void load();
            return !v;
          });
        }}
        title={state.dirty ? '工作区有未提交的更改' : `当前分支：${state.branch ?? 'HEAD'}`}
        aria-label="切换分支"
      >
        <Icon name="branch" size={13} style={{ color: 'var(--cyan)' }} />
        <span className="branch-name">{state.detached ? 'HEAD 分离' : state.branch}</span>
        {state.dirty && <i className="branch-dirty" />}
        <Icon name="chevronDown" size={12} style={{ color: 'var(--text-low)' }} />
      </button>
      {menuOpen && (
        <>
          <div className="menu-scrim" onClick={() => setMenuOpen(false)} />
          <div className="project-menu branch-menu">
            <div className="pm-head">切换分支</div>
            {branches.map((branch) => (
              <button
                key={branch}
                className={`pm-item ${branch === state.branch ? 'active' : ''}`}
                disabled={busy}
                onClick={() => {
                  if (branch !== state.branch) void checkout(branch);
                  else setMenuOpen(false);
                }}
              >
                <Icon name={branch === state.branch ? 'check' : 'branch'} size={13} />
                <span className="pm-name">{branch}</span>
                {branch === state.branch && <span className="pm-meta">当前</span>}
              </button>
            ))}
            {branches.length === 0 && <div className="branch-hint">没有可切换的本地分支。</div>}
            {state.dirty && <div className="branch-hint warn">工作区有未提交的更改，切换分支前请先提交或还原。</div>}
          </div>
        </>
      )}
    </div>
  );
}
