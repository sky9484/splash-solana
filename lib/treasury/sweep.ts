/**
 * Sweep (prompt 10 §7.3, decision 18): from the owner's rule, at most one draft a day. Pure and
 * integer. It only says what to draft; it never approves, signs or moves anything. A person approves
 * every move on a device.
 *
 *   Hold (rule off)   nothing, ever.
 *   Sweep (rule on)   when the Payments account and the Reserve are short of the floor, redeem T-bills
 *                     (only units out of their hold); otherwise subscribe the cash above the floor and
 *                     the cushion. Never both in one day; nothing under US$500; whole cents.
 */
import { SWEEP_CUSHION_DEFAULT, SWEEP_MIN_DRAFT, sweepBack, sweepOut, type Position } from './reserve.ts';

export interface SweepRule {
  on: boolean;
  /** Kept in the Payments account on top of what is waiting for approval. US$5,000 by default. */
  cushionMinor: bigint;
}

export const SWEEP_RULE_DEFAULT: SweepRule = { on: false, cushionMinor: SWEEP_CUSHION_DEFAULT };

export interface SweepDraft {
  kind: 'subscribe' | 'redeem';
  amountMinor: bigint;
  /** In the words the row shows: "cash above your reserve and cushion". */
  reason: string;
}

/** Whole cents, rounded down (an order is in cents). */
const cents = (minor: bigint) => (minor / 10_000n) * 10_000n;

export function sweepDraft(input: { position: Position; rule: SweepRule; redeemableMinor: bigint; marginPct?: bigint }): SweepDraft | null {
  const { position, rule } = input;
  if (!rule.on) return null;
  // Money back first: bills due need it, and it is the only draft that day.
  const back = cents(sweepBack(position, input.redeemableMinor, input.marginPct));
  if (back > 0n) return back >= SWEEP_MIN_DRAFT ? { kind: 'redeem', amountMinor: back, reason: 'bills due need the money back' } : null;
  const out = cents(sweepOut(position, rule.cushionMinor, input.marginPct));
  if (out >= SWEEP_MIN_DRAFT) return { kind: 'subscribe', amountMinor: out, reason: 'cash above your reserve and cushion' };
  return null;
}
