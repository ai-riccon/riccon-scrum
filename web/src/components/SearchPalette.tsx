import { useCallback, useEffect, useRef, useState } from 'react';
import type { CodeSearchResult, Project } from '@acp-scrum/shared';
import { api } from '../api';
import { Icon, type IconName } from '../icons';

const KIND_META: Record<CodeSearchResult['kind'], { icon: IconName; color: string; label: string }> = {
  symbol: { icon: 'code', color: 'var(--cyan)', label: '符号' },
  file: { icon: 'file', color: 'var(--indigo-bright)', label: '文件' },
  content: { icon: 'terminal', color: 'var(--text-low)', label: '内容' },
};

export function SearchPalette({ project, onClose }: { project: Project; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CodeSearchResult[]>([]);
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
        return;
      }
      setLoading(true);
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
    setLoading(true);
    try {
      const s = await api.index(project.id);
      setStats({ files: s.files, symbols: s.symbols });
      runSearch(query);
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
            placeholder="搜索符号、文件、代码内容…"
            aria-label="代码搜索"
          />
          {loading && <Icon name="refresh" size={15} className="spin" style={{ color: 'var(--text-low)' }} />}
          <button className="btn sm ghost" onClick={reindex} title="重建索引">
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
          {query.trim() !== '' && results.length === 0 && !loading && <div className="search-hint">无匹配结果</div>}
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