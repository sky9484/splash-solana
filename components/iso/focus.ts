'use client';

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keep keyboard focus inside `ref` while `active`: focus moves in on open (to `initial`, or the
 * first control), Tab and Shift+Tab wrap, Esc calls `onEscape`, and focus goes back to whatever
 * had it before, on close.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, onEscape: () => void, initial?: RefObject<HTMLElement | null>) {
  const escape = useRef(onEscape);
  useEffect(() => {
    escape.current = onEscape;
  });
  useEffect(() => {
    if (!active) return;
    const box = ref.current;
    if (!box) return;
    const before = document.activeElement as HTMLElement | null;
    const first = initial?.current ?? box.querySelector<HTMLElement>(FOCUSABLE) ?? box;
    first.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // An open list (a Combobox) closes first; the next Esc closes the sheet or card.
        const at = e.target as HTMLElement | null;
        if (at?.getAttribute?.('role') === 'combobox' && at.getAttribute('aria-expanded') === 'true') return;
        e.stopPropagation();
        escape.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const head = items[0];
      const tail = items[items.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === head || !box.contains(at))) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && (at === tail || !box.contains(at))) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, [active, ref, initial]);
}
