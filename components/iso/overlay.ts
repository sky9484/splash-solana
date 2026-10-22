'use client';

import { useSyncExternalStore } from 'react';

/**
 * What covers the page right now: a Sheet, or the approval moment. The floating Zeke hides while
 * either is open (§3.5), so it never sits over a decision. A count, because sheets can stack.
 */
type Kind = 'sheet' | 'approval';
const open: Record<Kind, number> = { sheet: 0, approval: 0 };
const listeners = new Set<() => void>();
let snapshot = '';

function emit() {
  snapshot = `${open.sheet}:${open.approval}`;
  for (const l of listeners) l();
}

export function holdOverlay(kind: Kind): () => void {
  open[kind] += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    open[kind] = Math.max(0, open[kind] - 1);
    emit();
  };
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** True while any sheet or the approval moment is open. */
export function useOverlayOpen(): boolean {
  const s = useSyncExternalStore(subscribe, () => snapshot, () => '');
  return s !== '' && s !== '0:0';
}
