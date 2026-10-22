/**
 * Sweep (prompt 10 §7.3, decision 18; prompt 11 §4.4, decisions 9 and 10): from the owner's rule, at
 * most one draft a day, and once a quarter a draft to bring the quarter's interest back. Pure and
 * integer. It only says what to draft; it never approves, signs or moves anything. A person approves
 * every move on a device: there is no standing rule that moves money by itself.
 *
 *   Hold (rule off)   nothing, ever.
 *   Sweep (rule on)   when the Payments account and the Reserve are short of the floor, redeem T-bills
 *                     (only units out of their hold); otherwise subscribe the cash above the floor and
 *                     the cushion. Never both in one day; nothing under US$500; whole cents.
 *   Quarter interest  from the first business day after a calendar quarter ends, redeem the interest
 *   (rule on)         that quarter booked (history.ts), no more than can be redeemed now, back to the
 *                     Payments account. Its own minimum, US$50, because a quarter's interest is
 *                     usually under the US$500 sweep minimum.
 */
import { firstBusinessDayOfQuarter, interestBetween, previousQuarter, QUARTER_INTEREST_MIN, type Quarter, type UnitsEvent } from './history.ts';
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

export interface QuarterInterestDraft {
  kind: 'redeem';
  reason: 'quarter_interest';
  amountMinor: bigint;
  /** The quarter whose interest this brings back. */
  quarter: Quarter;
  /** What that quarter booked, before the cap at what can be redeemed now. */
  bookedMinor: bigint;
}

/**
 * The quarter's interest to bring back, from `today` (YYYY-MM-DD): null with Hold, before the first
 * business day of the quarter, or under US$50. The caller keeps it to one a quarter.
 */
export function quarterInterestDraft(input: { today: string; rule: SweepRule; events: readonly UnitsEvent[]; redeemableMinor: bigint }): QuarterInterestDraft | null {
  if (!input.rule.on) return null;
  if (input.today < firstBusinessDayOfQuarter(input.today)) return null;
  const quarter = previousQuarter(input.today);
  const bookedMinor = interestBetween(quarter.first, quarter.last, input.events);
  const capped = bookedMinor < input.redeemableMinor ? bookedMinor : input.redeemableMinor;
  const amountMinor = cents(capped < 0n ? 0n : capped);
  if (amountMinor < QUARTER_INTEREST_MIN) return null;
  return { kind: 'redeem', reason: 'quarter_interest', amountMinor, quarter, bookedMinor };
}
