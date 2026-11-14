import { Icon } from '../../icons';
import { confirmAction } from '../ConfirmDialog';

export function Help({ children }: { children: string }) {
  return <div className="help">{children}</div>;
}

export function SaveBar({
  label,
  busy,
  onClick,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  const save = async () => {
    const ok = await confirmAction({
      title: '保存设置',
      message: '确认保存当前修改？保存后立即生效。',
      detail: label,
      confirmText: '保存并生效',
    });
    if (!ok) return;
    onClick();
  };

  return (
    <div className="settings-actions">
      <button className="btn primary" disabled={busy} onClick={() => void save()}>
        <Icon name="check" size={14} />
        {busy ? '保存中…' : label}
      </button>
    </div>
  );
}
