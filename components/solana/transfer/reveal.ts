/**
 * "Show number" (prompt 10 §5.3, decision 15): a recipient's full account number on screen for 30
 * seconds after a device approval, then masked again. Whichever comes first masks it:
 *
 *   expired   the server's `expiresAt` passed (the page keeps no copy after that);
 *   closed    the sheet showing it closed;
 *   hidden    the tab was hidden (another tab, a minimised window, a locked phone).
 *
 * Plain and clock-injected, so a test drives it with a fake clock (tests/transfer-reveal.test.mjs).
 * The number lives only in this closure and in what `onChange` renders; it is never stored or logged.
 */
export interface RevealClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface Revealed {
  number: string;
  expiresAt: number;
}

export type MaskReason = 'expired' | 'closed' | 'hidden';

export interface RevealController {
  show(number: string, expiresAtIso: string): void;
  close(): void;
  visibility(hidden: boolean): void;
  current(): Revealed | null;
}

export function createReveal(clock: RevealClock, onChange: (shown: Revealed | null, reason?: MaskReason) => void): RevealController {
  let shown: Revealed | null = null;
  let timer: unknown = null;
  const stop = () => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  };
  const mask = (reason: MaskReason) => {
    stop();
    if (!shown) return;
    shown = null;
    onChange(null, reason);
  };
  return {
    show(number, expiresAtIso) {
      stop();
      const expiresAt = Date.parse(expiresAtIso);
      const left = expiresAt - clock.now();
      if (!(left > 0)) {
        shown = null;
        onChange(null, 'expired');
        return;
      }
      shown = { number, expiresAt };
      onChange(shown);
      timer = clock.setTimeout(() => mask('expired'), left);
    },
    close() {
      mask('closed');
    },
    visibility(hidden) {
      if (hidden) mask('hidden');
    },
    current() {
      return shown;
    },
  };
}

/** Whole seconds left on screen, for the countdown ("Hidden again in 0:27"). */
export function revealSecondsLeft(shown: Revealed | null, now: number): number {
  return shown ? Math.max(0, Math.ceil((shown.expiresAt - now) / 1000)) : 0;
}
