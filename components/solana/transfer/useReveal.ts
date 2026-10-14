'use client';

import { useEffect, useMemo, useState } from 'react';

import { createReveal, revealSecondsLeft, type RevealClock, type Revealed } from './reveal';

/** The browser's clock, for the reveal (a test passes a fake one). */
export const BROWSER_CLOCK: RevealClock = { now: () => Date.now(), setTimeout: (f, ms) => window.setTimeout(f, ms), clearTimeout: (h) => window.clearTimeout(h as number) };

/**
 * A full account number on screen (prompt 10 §S.1.5), wired to the page: real timers, masked again when
 * the 30 seconds end, when the tab is hidden, when `open` goes false, and when the page goes away.
 * Used by a recipient's sheet (Transfer) and by Check the invoice.
 */
export function useReveal(open: boolean) {
  const [shown, setShown] = useState<Revealed | null>(null);
  const [now, setNow] = useState(() => BROWSER_CLOCK.now());
  const ctl = useMemo(() => createReveal(BROWSER_CLOCK, (s) => setShown(s)), []);
  useEffect(() => {
    const onVisibility = () => ctl.visibility(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      ctl.close();
    };
  }, [ctl]);
  useEffect(() => {
    if (!open) ctl.close();
  }, [open, ctl]);
  useEffect(() => {
    if (!shown) return;
    const t = window.setInterval(() => setNow(BROWSER_CLOCK.now()), 250);
    return () => window.clearInterval(t);
  }, [shown]);
  return { shown, left: revealSecondsLeft(shown, now), ctl };
}
