// iso-ui
'use client';

import Link from 'next/link';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Check } from 'lucide-react';

import { IsoSurface } from '@/components/iso';

export interface SoFarRow {
  label: string;
  /** null until it is known: a dash, and no tick. */
  value: ReactNode | null;
  sub?: ReactNode;
}

/** Below this width the main action is pinned to the bottom of the screen (prompt 11 §2.2). */
export const PIN_BELOW = '(max-width: 859px)';

/**
 * While the main action is pinned to the bottom of a phone's screen, publish its height the way the
 * old action bar did (`--iso-actionbar-h`, `data-iso-actionbar` on the root): the floating Zeke rises
 * above it by exactly that, with its own styles untouched, and an open list never opens under it.
 */
function usePinnedBar(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(PIN_BELOW);
    const root = document.documentElement;
    const main = el.closest('main');
    const clear = () => {
      root.removeAttribute('data-iso-actionbar');
      root.style.removeProperty('--iso-actionbar-h');
      root.style.removeProperty('--iso-pin-left');
    };
    const publish = () => {
      if (!mq.matches) return clear();
      root.style.setProperty('--iso-actionbar-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
      // From 768 px the sidebar is beside the page: the bar starts where the page does.
      root.style.setProperty('--iso-pin-left', `${Math.max(0, Math.round(main?.getBoundingClientRect().left ?? 0))}px`);
      root.setAttribute('data-iso-actionbar', '');
    };
    publish();
    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    watch?.observe(el);
    if (main) watch?.observe(main);
    mq.addEventListener('change', publish);
    window.addEventListener('resize', publish);
    main?.addEventListener('transitionend', publish);
    return () => {
      watch?.disconnect();
      mq.removeEventListener('change', publish);
      window.removeEventListener('resize', publish);
      main?.removeEventListener('transitionend', publish);
      clear();
    };
  }, [ref]);
}

/**
 * "So far" (prompt 11 §2.2): what this payment has settled, a row each with a tick once it is known,
 * an optional block for the step (the limits on step 2), then the step's one main action and a text
 * link back. Sticky beside the step on a wide screen; after it on a narrow one, with the action
 * pinned to the bottom of the screen on a phone.
 */
export function SoFar({ rows, extra, action, back }: { rows: SoFarRow[]; extra?: ReactNode; action: ReactNode; back?: { label: string; href?: string; onClick?: () => void } | null }) {
  const bar = useRef<HTMLDivElement>(null);
  usePinnedBar(bar);
  return (
    // Sticky beside the step: it stays put on hover (prompt 11 §1.2), --still.
    <IsoSurface as="aside" className="iso-sofar iso-surface--still" aria-labelledby="tx-sofar">
      <h2 id="tx-sofar" className="iso-h3">
        So far
      </h2>
      <ul className="iso-sofar__rows">
        {rows.map((r) => {
          const known = r.value !== null;
          return (
            <li key={r.label} data-known={known ? 'true' : undefined}>
              <span className="iso-sofar__tick" aria-hidden="true">
                {known ? <Check size={12} strokeWidth={3} /> : null}
              </span>
              <span className="iso-sofar__what">
                <span className="iso-sofar__label">{r.label}</span>
                <span className="iso-sofar__value">{known ? r.value : '—'}</span>
                {known && r.sub ? <span className="iso-sofar__sub">{r.sub}</span> : null}
                <span className="iso-sr">{known ? '' : ': not yet'}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {extra}
      <div ref={bar} className="iso-sofar__cta">
        {action}
        {back ? (
          back.href ? (
            <Link className="iso-sofar__back" href={back.href}>
              {back.label}
            </Link>
          ) : (
            <button type="button" className="iso-sofar__back" onClick={back.onClick}>
              {back.label}
            </button>
          )
        ) : null}
      </div>
    </IsoSurface>
  );
}

/**
 * A step's page under the intent header (prompt 11 §2.2): the step on the left and its rail on the
 * right (320 px, sticky) from 1080 px; one column below that, the rail after the step. The step
 * enters with a 260 ms fade and a 6 px rise (none with reduced motion).
 */
export function TxGrid({ main, rail, wide = false }: { main: ReactNode; rail?: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'iso-tx iso-tx--wide' : 'iso-tx'}>
      <div className="iso-tx__step">{main}</div>
      {rail ? <div className="iso-tx__rail">{rail}</div> : null}
    </div>
  );
}
