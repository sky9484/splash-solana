// iso-ui
'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The sticky bottom bar on Transfer: ink, the total on the left, Back and the main action on the
 * right. The floating Zeke sits above it: the bar publishes its height (`--iso-actionbar-h` on the
 * root, with `data-iso-actionbar`), so Zeke rises by exactly that, at every width.
 */
export function ActionBar({ summary, children, label = 'This payment' }: { summary: ReactNode; children: ReactNode; label?: string }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty('--iso-actionbar-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    publish();
    root.setAttribute('data-iso-actionbar', '');
    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    watch?.observe(el);
    return () => {
      watch?.disconnect();
      root.removeAttribute('data-iso-actionbar');
      root.style.removeProperty('--iso-actionbar-h');
    };
  }, []);
  return (
    <div ref={bar} className="iso-actionbar" role="region" aria-label={label}>
      <div className="iso-actionbar__in">
        <p className="iso-actionbar__sum" style={{ margin: 0 }}>
          {summary}
        </p>
        <div className="iso-actions">{children}</div>
      </div>
    </div>
  );
}
