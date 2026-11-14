import { useState } from 'react';
import type { Category } from '@riccon-scrum/shared';
import { api } from '../api';
import { Icon } from '../icons';
import { confirmAction } from './ConfirmDialog';

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
    const ok = await confirmAction({
      title: '创建分类',
      message: '新分类会保存到项目分类树，并可用于故事与需求归类。',
      detail: name.trim(),
      confirmText: '创建分类',
    });
    if (!ok) return;
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
    const ok = await confirmAction({
      title: '重命名分类',
      message: '分类名会立即更新到所有关联故事。',
      detail: `新名称：${editingName.trim()}`,
      confirmText: '确认重命名',
    });
    if (!ok) return;
    setBusy(id);
    try {
      await api.renameCategory(id, editingName.trim());
      setEditingId(null);
      await onChanged();
      onToast('success', '分类已重命名');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    const target = categories.find((item) => item.id === id);
    const ok = await confirmAction({
      title: '删除分类',
      message: '删除后该分类下的故事会变为未分类，子分类会一并移除。',
      detail: target?.path ?? id,
      confirmText: '删除分类',
      tone: 'danger',
    });
    if (!ok) return;
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
            <button className="btn small primary" disabled={busy === 'create' || !name.trim()} onClick={create} data-tip="把新分类保存到项目分类树，可继续创建子分类">
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
                        data-tip="修改分类名称，所有关联故事与需求同步更新"
                      >
                        重命名
                      </button>
                      <button className="btn small ghost" disabled={busy === option.id} onClick={() => remove(option.id)} data-tip="删除该分类；其下故事会变为未分类，子分类一并移除">
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
