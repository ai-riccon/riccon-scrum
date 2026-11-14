import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';

export type ConfirmTone = 'default' | 'danger' | 'warning';

export type ConfirmOptions = {
  /** 弹窗标题，说明要执行的操作 */
  title: string;
  /** 一句话说明影响范围 */
  message?: string;
  /** 补充细节（等宽小字） */
  detail?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: ConfirmTone;
};

type Pending = ConfirmOptions & { id: number; resolve: (ok: boolean) => void };

type Enqueue = (options: ConfirmOptions) => Promise<boolean>;

declare global {
  interface Window {
    __ricconConfirm?: Enqueue;
  }
}

/**
 * 统一二次确认入口。任意组件可直接 `await confirmAction({...})`。
 * 宿主通过 window 暴露，避免 HMR 或重复模块实例导致状态不同步。
 * 未挂载确认宿主时回退到原生 confirm，保证不会静默执行。
 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  const host = typeof window === 'undefined' ? undefined : window.__ricconConfirm;
  if (host) return host(options);
  const text = [options.title, options.message, options.detail].filter(Boolean).join('\n\n');
  return Promise.resolve(typeof window === 'undefined' ? true : window.confirm(text));
}

export function ConfirmHost() {
  const [queue, setQueue] = useState<Pending[]>([]);
  const queueRef = useRef<Pending[]>([]);
  const seq = useRef(0);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  const settle = useCallback((ok: boolean) => {
    const [head, ...rest] = queueRef.current;
    if (!head) return;
    queueRef.current = rest;
    setQueue(rest);
    head.resolve(ok);
  }, []);

  useEffect(() => {
    const handler: Enqueue = (options) =>
      new Promise<boolean>((resolve) => {
        seq.current += 1;
        const next = [...queueRef.current, { ...options, id: seq.current, resolve }];
        queueRef.current = next;
        setQueue(next);
      });
    window.__ricconConfirm = handler;
    return () => {
      if (window.__ricconConfirm === handler) delete window.__ricconConfirm;
    };
  }, []);

  const current = queue[0] ?? null;

  useEffect(() => {
    if (!current) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        settle(false);
      }
    };
    window.addEventListener('keydown', onKey);
    const timer = window.setTimeout(() => confirmRef.current?.focus(), 30);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(timer);
    };
  }, [current, settle]);

  if (!current) return null;

  const tone = current.tone ?? 'default';
  const icon = tone === 'danger' ? 'alert' : tone === 'warning' ? 'shield' : 'layers';

  return (
    <div className="confirm-scrim" onClick={() => settle(false)}>
      <div
        className={`confirm-dialog tone-${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={current.message ? 'confirm-message' : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="confirm-head">
          <span className="confirm-ico">
            <Icon name={icon} size={18} />
          </span>
          <div>
            <h3 id="confirm-title">{current.title}</h3>
            {current.message && (
              <p id="confirm-message" className="confirm-message">
                {current.message}
              </p>
            )}
          </div>
        </div>
        {current.detail && <pre className="confirm-detail">{current.detail}</pre>}
        <div className="confirm-foot">
          <button type="button" className="btn ghost" onClick={() => settle(false)}>
            取消
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`btn ${tone === 'danger' ? 'danger' : 'primary'}`}
            onClick={() => settle(true)}
          >
            {current.confirmText ?? '确认执行'}
          </button>
        </div>
      </div>
    </div>
  );
}
