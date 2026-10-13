// iso-ui
'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import clsx from 'clsx';

/**
 * The extruded number (§2.2): weight 900, paper fill, an ink-deep stroke and a stepped teal
 * extrusion. One per visible state; scripts/check-iso-ui.mjs counts them.
 */
export function IsoDisplay({ size = 'lg', className, children }: { size?: 'xl' | 'lg' | 'md'; className?: string; children: ReactNode }) {
  return <span className={clsx('iso-display', `iso-display--${size}`, className)}>{children}</span>;
}

/**
 * An amount that counts up from zero once, on first load (900 ms, ease-out), then rests on the
 * real figure. Screen readers get the real figure only. The count writes the text node in place
 * (no React state per frame), and every step is an integer count of minor units: the easing is
 * turned into parts per thousand before it touches the amount. Reduced motion: no count.
 */
export function CountUp({ minor, format, ms = 900 }: { minor: bigint; format: (minor: bigint) => string; ms?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const ran = useRef(false);
  const final = format(minor);

  useLayoutEffect(() => {
    const el = ref.current;
    // React's own text node, written in place (nodeValue), so React keeps owning it.
    const text = el?.firstChild;
    if (!el || !text || text.nodeType !== Node.TEXT_NODE || ran.current || minor <= 0n) return;
    ran.current = true;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    text.nodeValue = format(0n);
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const p = Math.min(1, (now - start) / ms);
      const perMille = BigInt(Math.round((1 - (1 - p) ** 3) * 1000));
      text.nodeValue = format((minor * perMille) / 1000n);
      if (p < 1) frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
      // React has already written the new figure to data-final in this commit; rest on it.
      text.nodeValue = el.dataset.final ?? text.nodeValue;
    };
  }, [minor, format, ms]);

  return (
    <>
      <span className="iso-sr">{final}</span>
      <span ref={ref} aria-hidden="true" data-final={final}>
        {final}
      </span>
    </>
  );
}
