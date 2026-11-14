import { useState } from 'react';
import type { Tag } from '@riccon-scrum/shared';
import { Icon } from '../icons';
import { confirmAction } from './ConfirmDialog';

export function TagFilter({
  tags,
  value,
  onChange,
}: {
  tags: Tag[];
  value: string;
  onChange: (tagId: string) => void;
}) {
  return (
    <select className="req-inline-select" value={value} onChange={(e) => onChange(e.target.value)} aria-label="按标签筛选">
      <option value="">全部标签</option>
      {tags.map((tag) => (
        <option key={tag.id} value={tag.id}>
          {tag.name}
        </option>
      ))}
    </select>
  );
}

export function TagEditor({
  allTags,
  selected,
  disabled,
  onChange,
  onCreate,
}: {
  allTags: Tag[];
  selected: Tag[];
  disabled?: boolean;
  onChange: (tags: Tag[]) => void;
  onCreate?: (name: string) => Promise<Tag | null>;
}) {
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const selectedIds = new Set(selected.map((tag) => tag.id));
  const available = allTags.filter((tag) => !selectedIds.has(tag.id));

  const add = (id: string) => {
    const tag = allTags.find((item) => item.id === id);
    if (tag) onChange([...selected, tag]);
  };

  const create = async () => {
    const name = newName.trim();
    if (!name || !onCreate || busy) return;
    const ok = await confirmAction({
      title: '新建标签',
      message: '标签会保存到项目标签库，并立即应用到当前对象。',
      detail: name,
      confirmText: '创建标签',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const tag = await onCreate(name);
      if (tag && !selectedIds.has(tag.id)) onChange([...selected, tag]);
      setNewName('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tag-editor">
      {selected.map((tag) => (
        <span
          className="tag-chip"
          key={tag.id}
          style={{ borderColor: tag.color, color: tag.color, background: `color-mix(in srgb, ${tag.color} 10%, transparent)` }}
        >
          {tag.name}
          <button
            className="tag-remove"
            aria-label={`移除标签 ${tag.name}`}
            data-tip={`从当前对象移除标签「${tag.name}」`}
            disabled={disabled}
            onClick={async () => {
              const ok = await confirmAction({
                title: '移除标签',
                message: '该标签会从当前对象移除，标签本身仍保留在项目标签库。',
                detail: tag.name,
                confirmText: '移除',
                tone: 'warning',
              });
              if (!ok) return;
              onChange(selected.filter((item) => item.id !== tag.id));
            }}
          >
            ×
          </button>
        </span>
      ))}
      <select
        className="tag-add-select"
        value=""
        disabled={disabled || available.length === 0}
        onChange={(e) => {
          add(e.target.value);
          e.target.value = '';
        }}
        aria-label="添加标签"
      >
        <option value="">+ 标签</option>
        {available.map((tag) => (
          <option key={tag.id} value={tag.id}>
            {tag.name}
          </option>
        ))}
      </select>
      {onCreate && (
        <span className="tag-create">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create();
            }}
            placeholder="新建标签"
            disabled={disabled || busy}
            aria-label="新建标签"
          />
          <button className="btn small ghost" disabled={disabled || busy || !newName.trim()} onClick={() => void create()} aria-label="新建标签" data-tip="创建新标签并立即应用到当前对象">
            <Icon name="plus" size={11} />
          </button>
        </span>
      )}
    </div>
  );
}
