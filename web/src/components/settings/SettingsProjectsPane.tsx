import { useCallback, useEffect, useState } from 'react';
import type { Project } from '@riccon-scrum/shared';
import { api } from '../../api';
import { Icon } from '../../icons';
import type { ProjectPaneProps } from './types';
import { Help } from './SettingsUi';

function archivedTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { hour12: false });
}

function ProjectRow({
  item,
  current,
  archived,
  busy,
  canArchive,
  onArchive,
  onRestore,
  onDelete,
}: {
  item: Project;
  current: boolean;
  archived: boolean;
  busy: boolean;
  canArchive: boolean;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`project-admin-row ${current ? 'current' : ''}`}>
      <span className="project-admin-icon">
        <Icon name={archived ? 'archive' : 'branch'} size={15} />
      </span>
      <div className="project-admin-main">
        <div className="project-admin-name">
          {item.name}
          {current && <span className="badge cyan">当前</span>}
          <span className="badge">{item.teamMode ? '团队' : 'Solo'}</span>
        </div>
        <div className="project-admin-path" title={item.repoPath}>
          {item.repoPath}
        </div>
        <div className="project-admin-meta">
          {item.agentKind} · {item.defaultBranch}
          {archived && item.archivedAt ? ` · 归档于 ${archivedTime(item.archivedAt)}` : ''}
        </div>
      </div>
      <div className="project-admin-actions">
        {archived ? (
          <>
            <button className="btn sm" disabled={busy} onClick={onRestore}>
              <Icon name="refresh" size={12} className={busy ? 'spin' : ''} />
              恢复
            </button>
            <button className="btn sm danger" disabled={busy} onClick={onDelete}>
              <Icon name="x" size={12} />
              删除
            </button>
          </>
        ) : (
          <button
            className="btn sm ghost"
            disabled={busy || !canArchive}
            onClick={onArchive}
            title={canArchive ? '归档项目' : '至少保留一个未归档项目'}
          >
            <Icon name={busy ? 'refresh' : 'archive'} size={12} className={busy ? 'spin' : ''} />
            归档
          </button>
        )}
      </div>
    </div>
  );
}

export function ProjectsPane({ project, onToast, onChanged }: ProjectPaneProps) {
  const [all, setAll] = useState<Project[]>([]);
  const [busyId, setBusyId] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setAll(await api.projects(true));
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (id: string, action: () => Promise<unknown>, message: string) => {
    setBusyId(id);
    try {
      await action();
      onToast('success', message);
      await load();
      await onChanged();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId('');
    }
  };

  const archive = (item: Project) => {
    if (!window.confirm(`归档项目「${item.name}」？\n归档后会从项目切换器隐藏，可在「设置 → 项目归档」中恢复。`)) return;
    void run(item.id, () => api.archiveProject(item.id), `项目「${item.name}」已归档`);
  };

  const restore = (item: Project) => {
    void run(item.id, () => api.unarchiveProject(item.id), `项目「${item.name}」已恢复`);
  };

  const remove = (item: Project) => {
    if (
      !window.confirm(
        `永久删除项目「${item.name}」？\n将删除平台内的故事、需求、文档与配置数据，本地代码文件夹和 Git 分支不受影响。`,
      )
    ) {
      return;
    }
    void run(item.id, () => api.deleteProject(item.id), `项目「${item.name}」已删除`);
  };

  const active = all.filter((item) => !item.archived);
  const archived = all
    .filter((item) => item.archived)
    .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''));

  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <h3>未归档项目</h3>
        <Help>归档只会从工作台和项目切换器中隐藏项目，不会删除代码、Git 仓库或分支。至少保留一个未归档项目。</Help>
      </div>
      <div className="project-admin-list">
        {loading && <div className="project-admin-empty">加载中…</div>}
        {!loading && active.length === 0 && <div className="project-admin-empty">暂无未归档项目。</div>}
        {active.map((item) => (
          <ProjectRow
            key={item.id}
            item={item}
            current={item.id === project.id}
            archived={false}
            busy={busyId === item.id}
            canArchive={active.length > 1}
            onArchive={() => archive(item)}
            onRestore={() => undefined}
            onDelete={() => undefined}
          />
        ))}
      </div>

      <div className="settings-subhead">
        已归档项目
        <span className="badge">{archived.length}</span>
      </div>
      <Help>可随时恢复已归档项目；删除为永久操作，仅移除平台数据，不会改动磁盘上的代码文件夹。</Help>
      <div className="project-admin-list">
        {!loading && archived.length === 0 && <div className="project-admin-empty">暂无已归档项目。</div>}
        {archived.map((item) => (
          <ProjectRow
            key={item.id}
            item={item}
            current={false}
            archived
            busy={busyId === item.id}
            canArchive={false}
            onArchive={() => undefined}
            onRestore={() => restore(item)}
            onDelete={() => remove(item)}
          />
        ))}
      </div>
    </section>
  );
}
