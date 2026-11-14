import { useCallback, useEffect, useRef, useState } from 'react';
import type { CodeSearchResult, EntitySearchResult, Project } from '@riccon-scrum/shared';
import { api } from '../api';
import { Icon, type IconName } from '../icons';
import { confirmAction } from './ConfirmDialog';

const KIND_META: Record<CodeSearchResult['kind'], { icon: IconName; color: string; label: string }> = {
  symbol: { icon: 'code', color: 'var(--cyan)', label: '符号' },
  file: { icon: 'file', color: 'var(--indigo-bright)', label: '文件' },
  content: { icon: 'terminal', color: 'var(--text-low)', label: '内容' },
};

export function SearchPalette({
  project,
  onClose,
  onOpenStory,
  onOpenRequirement,
  onToast,
}: {
  project: Project;
  onClose: () => void;
  onOpenStory?: (id: string) => void;
  onOpenRequirement?: (id: string) => void;
  onToast?: (kind: 'success' | 'error' | 'info', text: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CodeSearchResult[]>([]);
  const [entities, setEntities] = useState<EntitySearchResult>({ mode: 'lexical', hits: [] });
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<{ files: number; symbols: number } | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    api.indexStats(project.id).then(setStats).catch(() => undefined);
  }, [project.id]);

  const runSearch = useCallback(
    (q: string) => {
      if (!q.trim()) {
        setResults([]);
        setEntities({ mode: 'lexical', hits: [] });
        return;
      }
      setLoading(true);
      api
        .searchEntities(project.id, q)
        .then(setEntities)
        .catch(() => setEntities({ mode: 'lexical', hits: [] }));
      api
        .search(project.id, q)
        .then((r) => {
          setResults(r);
          setActive(0);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    },
    [project.id],
  );

  useEffect(() => {
    const t = setTimeout(() => runSearch(query), 280);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  const reindex = async () => {
    const ok = await confirmAction({
      title: '重建代码索引',
      message: '将重新扫描项目文件并重建符号索引，大项目可能需要几十秒。',
      detail: project.name,
      confirmText: '重建索引',
    });
    if (!ok) return;
    setLoading(true);
    try {
      const s = await api.index(project.id);
      setStats({ files: s.files, symbols: s.symbols });
      onToast?.('success', `索引已重建：${s.files} 个文件 · ${s.symbols} 个符号`);
      runSearch(query);
    } catch (err) {
      onToast?.('error', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    }
  };

  return (
    <div className="modal-scrim search-scrim" onClick={onClose}>
      <div className="search-palette" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="search-input-row">
          <Icon name="eye" size={17} style={{ color: 'var(--cyan)' }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索需求、故事、符号、代码…"
            aria-label="代码搜索"
          />
          {loading && <Icon name="refresh" size={15} className="spin" style={{ color: 'var(--text-low)' }} />}
          <button className="btn sm ghost" onClick={reindex} title="重建索引" data-tip="重建代码索引：重新扫描项目文件与符号">
            <Icon name="refresh" size={13} />
            索引
          </button>
          <kbd className="search-kbd">Esc</kbd>
        </div>
        <div className="search-results">
          {query.trim() === '' && (
            <div className="search-hint">
              {stats ? `已索引 ${stats.files} 文件 · ${stats.symbols} 符号。输入关键词开始搜索。` : '输入关键词搜索代码库。'}
            </div>
          )}
          {query.trim() !== '' && entities.hits.length > 0 && (
            <div className="search-section-label">
              需求 / 故事 · {entities.mode === 'hybrid' ? '语义检索' : '关键词检索'}
            </div>
          )}
          {entities.hits.map((hit) => (
            <button
              className="search-result entity-hit"
              key={`${hit.type}-${hit.id}`}
              onClick={() => {
                if (hit.type === 'story') onOpenStory?.(hit.id);
                else onOpenRequirement?.(hit.id);
              }}
            >
              <span className="sr-ico" style={{ color: hit.type === 'story' ? 'var(--indigo-bright)' : 'var(--cyan)', background: 'var(--surface-1)' }}>
                <Icon name={hit.type === 'story' ? 'file' : 'sparkles'} size={13} />
              </span>
              <div className="sr-body">
                <div className="sr-name">
                  {hit.title}
                  <span className="badge" style={{ marginLeft: 6 }}>{hit.status}</span>
                  {hit.tags.slice(0, 2).map((tag) => (
                    <span className="badge cyan" style={{ marginLeft: 4 }} key={tag}>{tag}</span>
                  ))}
                </div>
                <div className="sr-path">{hit.snippet}</div>
              </div>
              <span className="sr-kind">{hit.type === 'story' ? '故事' : '需求'} · {Math.round(hit.score * 100)}</span>
            </button>
          ))}
          {query.trim() !== '' && results.length === 0 && entities.hits.length === 0 && !loading && (
            <div className="search-hint">无匹配结果</div>
          )}
          {results.length > 0 && <div className="search-section-label">代码</div>}
          {results.map((r, i) => {
            const m = KIND_META[r.kind];
            return (
              <div className={`search-result ${i === active ? 'active' : ''}`} key={`${r.kind}-${r.path}-${r.line}-${i}`} onMouseEnter={() => setActive(i)}>
                <span className="sr-ico" style={{ color: m.color, background: `color-mix(in srgb, ${m.color} 14%, transparent)` }}>
                  <Icon name={m.icon} size={13} />
                </span>
                <div className="sr-body">
                  <div className="sr-name">{r.name}</div>
                  <div className="sr-path">{r.path}:{r.line}</div>
                </div>
                <span className="sr-kind" style={{ color: m.color }}>{m.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}