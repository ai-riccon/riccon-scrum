import { useEffect, useState } from 'react';

type Tip = { text: string; x: number; y: number; below: boolean };

const TIP_SELECTOR = 'button, [role="button"], [data-tip]';

/**
 * 全局按钮帮助提示：悬停或键盘聚焦时显示按钮的功能作用。
 * - 有可见文字的按钮只在显式提供 data-tip 时显示，避免复述按钮名称；
 * - 图标按钮回退 title / aria-label；
 * - 弹窗在静止指针下出现时不触发提示。
 */
export function HelpTips() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let current: HTMLElement | null = null;
    let candidate: HTMLElement | null = null;
    let timer: number | undefined;
    let lastX = -1;
    let lastY = -1;

    const clearTimer = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };

    const resolveText = (el: HTMLElement): string => {
      const visible = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const tip = (el.dataset.tip || '').trim();
      if (tip) return tip.length > 90 ? `${tip.slice(0, 90)}…` : tip;
      // 有可见文字的按钮必须显式提供 data-tip 才显示，避免重复按钮名称
      if (visible) return '';
      const fallback = (el.getAttribute('title') || el.getAttribute('aria-label') || '').trim();
      return fallback.length > 90 ? `${fallback.slice(0, 90)}…` : fallback;
    };

    const show = (el: HTMLElement) => {
      clearTimer();
      candidate = null;
      const text = resolveText(el);
      if (!text) {
        hide();
        return;
      }
      // 避免原生 title 与自定义提示重复出现
      if (el.hasAttribute('title')) {
        el.dataset.tip = el.dataset.tip || (el.getAttribute('title') as string);
        el.removeAttribute('title');
      }
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const below = rect.top < 52;
      const x = Math.min(Math.max(rect.left + rect.width / 2, 96), window.innerWidth - 96);
      current = el;
      setTip({ text, x, y: below ? rect.bottom + 10 : rect.top - 8, below });
    };

    const hide = () => {
      clearTimer();
      candidate = null;
      current = null;
      setTip(null);
    };

    const find = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof Element)) return null;
      const el = target.closest<HTMLElement>(TIP_SELECTOR);
      if (!el) return null;
      if (el.getAttribute('aria-disabled') === 'true') return null;
      return el;
    };

    const onOver = (event: PointerEvent) => {
      const el = find(event.target);
      const moved = Math.abs(event.clientX - lastX) + Math.abs(event.clientY - lastY) > 2;
      lastX = event.clientX;
      lastY = event.clientY;
      if (!el) {
        hide();
        return;
      }
      if (el === current || el === candidate) return;
      // 弹窗或页面变化可能让元素“瞬移”到指针下方，此时没有真实的悬停动作
      if (!moved) return;
      clearTimer();
      candidate = el;
      // 轻微延迟，避免弹窗在指针下方弹出时立刻出现提示
      timer = window.setTimeout(() => {
        if (candidate === el) show(el);
      }, 420);
    };

    const onMove = (event: PointerEvent) => {
      lastX = event.clientX;
      lastY = event.clientY;
    };

    const onOut = (event: PointerEvent) => {
      const el = find(event.target);
      if (!el) return;
      const next = event.relatedTarget instanceof Element ? event.relatedTarget.closest(TIP_SELECTOR) : null;
      if (next === el) return;
      if (el === candidate || el === current) hide();
    };

    const onFocusIn = (event: FocusEvent) => {
      const el = find(event.target);
      if (!el) return;
      // 仅键盘导航触发的焦点显示提示，避免弹窗自动聚焦时出现多余气泡
      if (!el.matches(':focus-visible')) return;
      show(el);
    };

    const onFocusOut = (event: FocusEvent) => {
      const el = find(event.target);
      if (el && el === current) hide();
    };

    const onScroll = () => hide();

    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);

    return () => {
      clearTimer();
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerout', onOut, true);
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  if (!tip) return null;

  return (
    <div
      className={`help-tip ${tip.below ? 'below' : 'above'}`}
      role="tooltip"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.text}
    </div>
  );
}
