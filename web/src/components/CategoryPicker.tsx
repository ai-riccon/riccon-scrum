import { useState } from 'react';
import type { Category } from '@riccon-scrum/shared';
import { api } from '../api';
import { Icon } from '../icons';

export function categoryOptions(categories: Category[]): { id: string; label: string }[] {
  return categories
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((category) => ({
      id: category.id,
      label: `${'　'.repeat(Math.max(0, category.depth - 1))}${category.depth > 1 ? '└ ' : ''}${category.name}`,
    }));
}

export function categoryName(categories: Category[], id: string | null): string {
  if (!id) return '未分类';
  return categories.find((category) => category.id === id)?.name ?? '未分类';
}

export function CategorySelect({
  categories,
  value,
  onChange,
  disabled,
}: {
  categories: Category[];
  value: string | null;
  onChange: (categoryId: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <select
      className="req-inline-select"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
      aria-label="分类"
    >
      <option value="">未分类</option>
      {categoryOptions(categories).map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function CategoryFilter({
  categories,
  value,
  onChange,
}: {
  categories: Category[];
  value: string;
  onChange: (categoryId: string) => void;
}) {
  return (
    <select
      className="req-inline-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="按分类筛选"
    >
      <option value="">全部分类</option>
      {categoryOptions(categories).map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function CategoryManagerModal({
  projectId,
  categories,
  onClose,
  onChanged,
  onToast,
}: {
  projectId: string;
  categories: Category[];
  onClose: () => void;
  onChanged: () => Promise<void>;
  onToast: (kind: 'success' | 'error' | 'info', text: string) => void;
}) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const create = async () => {
    if (!name.trim()) return;
    setBusy('create');
    try {
      await api.createCategory({ projectId, name: name.trim(), parentId: parentId || null });
      setName('');
      await onChanged();
      onToast('success', '分类已创建');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const rename = async (id: string) => {
    if (!editingName.trim()) return;
    setBusy(id);
    try {
      await api.renameCategory(id, editingName.trim());
      setEditingId(null);
      await onChanged();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setBusy(id);
    try {
      await api.deleteCategory(id);
      await onChanged();
      onToast('info', '分类已删除');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="分类管理">
        <div className="modal-head">
          <Icon name="layers" size={18} style={{ color: 'var(--indigo-bright)', marginRight: 10 }} />
          <h3>分类管理</h3>
          <span className="badge" style={{ marginLeft: 'auto' }}>最多三级</span>
        </div>
        <div className="modal-body">
          <div className="req-category-create">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="分类名称" />
            <select value={parentId} onChange={(e) => setParentId(e.target.value)} aria-label="父分类">
              <option value="">顶级分类</option>
              {categoryOptions(categories.filter((category) => category.depth < 3)).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <button className="btn small primary" disabled={busy === 'create' || !name.trim()} onClick={create}>
              <Icon name="plus" size={12} />
              添加
            </button>
          </div>
          <div className="req-category-list">
            {categories.length === 0 && <div className="rail-empty">还没有分类，先创建一个。</div>}
            {categoryOptions(categories).map((option) => {
              const category = categories.find((item) => item.id === option.id);
              if (!category) return null;
              return (
                <div className="req-category-row" key={option.id}>
                  <span className="req-category-name">{option.label}</span>
                  {editingId === option.id ? (
                    <>
                      <input value={editingName} onChange={(e) => setEditingName(e.target.value)} />
                      <button className="btn small ghost" onClick={() => setEditingId(null)}>取消</button>
                      <button className="btn small" disabled={busy === option.id || !editingName.trim()} onClick={() => rename(option.id)}>保存</button>
                    </>
                  ) : (
                    <>
                      <button
                        className="btn small ghost"
                        onClick={() => {
                          setEditingId(option.id);
                          setEditingName(category.name);
                        }}
                      >
                        重命名
                      </button>
                      <button className="btn small ghost" disabled={busy === option.id} onClick={() => remove(option.id)}>
                        删除
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
