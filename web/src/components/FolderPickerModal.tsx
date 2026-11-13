import { useCallback, useEffect, useState } from 'react';
import type { DirListing } from '@riccon-scrum/shared';
import { api } from '../api';
import { Icon } from '../icons';

export function FolderPickerModal({
  initialPath,
  onSelect,
  onClose,
}: {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [draft, setDraft] = useState(initialPath ?? '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (target?: string) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.fsDirs(target);
      setListing(data);
      setDraft(data.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(initialPath || undefined);
  }, [initialPath, load]);

  return (
    <div className="modal-scrim picker" onClick={onClose}>
      <div className="modal folder-picker" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="选择项目文件夹">
        <div className="modal-head">
          <Icon name="folder" size={18} style={{ color: 'var(--indigo-bright)', marginRight: 10 }} />
          <h3>选择项目文件夹</h3>
        </div>
        <div className="modal-body">
          <div className="folder-path">
            <button
              className="btn icon ghost"
              disabled={!listing?.parent || loading}
              onClick={() => listing?.parent && void load(listing.parent)}
              title="上一级"
              aria-label="上一级"
            >
              <Icon name="arrowRight" size={14} style={{ transform: 'rotate(180deg)' }} />
            </button>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void load(draft);
              }}
              placeholder="输入文件夹绝对路径"
              spellCheck={false}
            />
            <button className="btn small" disabled={loading || !draft.trim()} onClick={() => void load(draft)}>
              前往
            </button>
            <button className="btn icon ghost" disabled={loading} onClick={() => void load(listing?.path)} title="刷新" aria-label="刷新">
              <Icon name="refresh" size={14} className={loading ? 'spin' : ''} />
            </button>
          </div>
          {listing && listing.roots.length > 1 && (
            <div className="folder-roots">
              {listing.roots.map((root) => (
                <button
                  key={root}
                  className={`folder-root ${listing.path === root ? 'on' : ''}`}
                  onClick={() => void load(root)}
                >
                  {root}
                </button>
              ))}
            </div>
          )}
          <div className="folder-list">
            {loading && !listing ? (
              <div className="folder-empty">正在读取目录…</div>
            ) : error ? (
              <div className="folder-error">{error}</div>
            ) : !listing || listing.entries.length === 0 ? (
              <div className="folder-empty">当前文件夹没有子目录，可直接选择此文件夹。</div>
            ) : (
              listing.entries.map((entry) => (
                <button key={entry.path} className="folder-row" onClick={() => void load(entry.path)} title={entry.path}>
                  <Icon name="folder" size={15} style={{ color: 'var(--indigo-bright)' }} />
                  <span className="folder-name">{entry.name}</span>
                  {entry.isGitRepo && <span className="badge cyan">Git</span>}
                  <Icon name="arrowRight" size={12} style={{ color: 'var(--text-low)' }} />
                </button>
              ))
            )}
            {listing?.truncated && <div className="folder-empty">目录过多，仅显示前 400 个子文件夹。</div>}
          </div>
          {listing?.isGitRepo && <div className="help">当前文件夹已是 Git 仓库，将使用其当前分支作为默认分支。</div>}
        </div>
        <div className="modal-foot">
          <div className="folder-selected" title={listing?.path}>
            <Icon name="folder" size={13} style={{ color: 'var(--indigo-bright)', flex: '0 0 auto' }} />
            <span className="path">{listing?.path ?? draft}</span>
          </div>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={!listing || loading} onClick={() => listing && onSelect(listing.path)}>
            <Icon name="check" size={14} />
            选择此文件夹
          </button>
        </div>
      </div>
    </div>
  );
}
