import { Icon } from '../../icons';

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
  return (
    <div className="settings-actions">
      <button className="btn primary" disabled={busy} onClick={onClick}>
        <Icon name="check" size={14} />
        {busy ? '保存中…' : label}
      </button>
    </div>
  );
}
