import { Icon } from '../icons';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div className={`toast ${t.kind}`} key={t.id}>
          <Icon
            name={t.kind === 'success' ? 'check' : t.kind === 'error' ? 'alert' : 'sparkles'}
            size={15}
            style={{ color: t.kind === 'success' ? 'var(--green)' : t.kind === 'error' ? 'var(--red)' : 'var(--cyan)' }}
          />
          {t.text}
        </div>
      ))}
    </div>
  );
}