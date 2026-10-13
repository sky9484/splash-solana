// iso-ui
'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import clsx from 'clsx';

const CIRC = 56.55; // 2πr for r = 9

/** Whole seconds until `expiresAt`, never below zero. */
export function secondsLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
}

export function clock(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The current time, once a second, for a countdown. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/**
 * The quote's clock (§2.3 QuoteRing): a 60 s ring and "New quote in 0:48". Amber in the last 10 s;
 * at 0 the quote dims (the caller adds `iso-stale` to it) and the ring offers "Refresh the quote".
 * Only on a payment with a currency conversion: a payment to another Splash business has none.
 */
export function QuoteRing({
  expiresAt,
  total = 60,
  onRefresh,
  tone = 'teal',
  size = 20,
  prefix = 'New quote in',
}: {
  expiresAt: string;
  total?: number;
  onRefresh?: () => void;
  tone?: 'teal' | 'coral';
  size?: number;
  prefix?: string;
}) {
  const now = useNow();
  const s = secondsLeft(expiresAt, now);
  const expired = s === 0;
  const warn = !expired && s <= 10;
  const offset = (CIRC * (1 - Math.min(total, s) / total)).toFixed(2);
  return (
    <span className={clsx('iso-ring', tone === 'coral' && 'iso-ring--coral', warn && 'iso-ring--warn', expired && 'iso-ring--expired')}>
      <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true" focusable="false">
        <circle className="iso-ring__track" cx="11" cy="11" r="9" fill="none" strokeWidth="3" />
        <circle className="iso-ring__run" cx="11" cy="11" r="9" fill="none" strokeWidth="3" strokeDasharray={CIRC} strokeDashoffset={offset} transform="rotate(-90 11 11)" suppressHydrationWarning />
      </svg>
      {expired ? (
        onRefresh ? (
          <button type="button" className="iso-tip" onClick={onRefresh}>
            <RefreshCw size={14} aria-hidden="true" />
            Refresh the quote
          </button>
        ) : (
          <span>Quote expired</span>
        )
      ) : (
        <span className="iso-num" role="timer" aria-live={warn ? 'polite' : 'off'} suppressHydrationWarning>
          {prefix} {clock(s)}
        </span>
      )}
    </span>
  );
}
