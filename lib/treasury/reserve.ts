/**
 * The shared money rules (prompt 10 §2.4), in one place. Overview, Transfer, Balance and Treasury
 * all call these; no screen does its own sums. Pure, and integers only: every amount is a bigint
 * count of US dollar minor units (6 decimals, the same unit as the accounts hold).
 *
 * The words, as a finance manager reads them:
 * - Payables due (30 days): approved payments not yet sent, plus accepted bills (checked, not yet
 *   paid) due in the next 30 days. Drafts and unchecked bills don't count.
 * - Reserve floor: payables due plus 10% (a setting, read-only at its default for now).
 * - Covered: the Payments account and the Reserve together hold at least the payables due.
 * - Only US dollars in the Reserve and the Payments account count. Investments never do.
 * - Available to invest: what the Reserve holds above its floor, plus what the Payments account
 *   holds above what is waiting for approval; never below zero. A subscription or a buy draws on the
 *   Reserve's surplus first, then the Payments account's.
 * - Treasury (for the stock limit): the Reserve plus Investments.
 * - Sweep, out: the Reserve's surplus, plus what the Payments account holds above what is waiting
 *   and a cushion (US$5,000 by default). Sweep, back: what the two accounts are short of the floor,
 *   capped at the T-bill units that can be redeemed now.
 */

export const USD = 1_000_000n;

/** The reserve floor's margin over payables due, in percent. Read-only at its default (§12). */
export const RESERVE_MARGIN_PCT_DEFAULT = 10n;
/** Stocks may be at most this share of treasury, in percent. Read-only at its default (§12). */
export const STOCK_CAP_PCT_DEFAULT = 20n;
/** What the sweep rule keeps in the Payments account on top of what is waiting (decision 18). */
export const SWEEP_CUSHION_DEFAULT = 5_000n * USD;
/** No sweep draft under this. */
export const SWEEP_MIN_DRAFT = 500n * USD;

export interface Position {
  /** The Payments account (vault #0): pays suppliers. */
  paymentsMinor: bigint;
  /** The Reserve (vault #1). */
  reserveMinor: bigint;
  /** Investments (vault #2), T-bills and stocks at their value. Never counts towards the floor. */
  investmentsMinor: bigint;
  /** The stocks part of Investments. */
  stocksMinor: bigint;
  /** Approved payments not yet sent ("You pay" totals). */
  approvedUnsentMinor: bigint;
  /** Accepted bills (checked, not yet paid) due in the next 30 days, in US dollars. */
  billsDueMinor: bigint;
  /** "You pay" totals of payments waiting for approval (proposed). */
  waitingMinor: bigint;
}

const max0 = (v: bigint) => (v < 0n ? 0n : v);
const min = (a: bigint, b: bigint) => (a < b ? a : b);
/** Round up, for a floor: a reserve floor is never a cent short. */
const ceilDiv = (n: bigint, d: bigint) => (n <= 0n ? 0n : (n + d - 1n) / d);

export function payablesDue(p: Pick<Position, 'approvedUnsentMinor' | 'billsDueMinor'>): bigint {
  return p.approvedUnsentMinor + p.billsDueMinor;
}

export function reserveFloor(payables: bigint, marginPct: bigint = RESERVE_MARGIN_PCT_DEFAULT): bigint {
  return ceilDiv(payables * (100n + marginPct), 100n);
}

/** "Enough for everything due in the next 30 days": exactly this. */
export function isCovered(p: Position): boolean {
  return p.paymentsMinor + p.reserveMinor >= payablesDue(p);
}

/** How much the two accounts are short of payables due (0 when covered). */
export function shortfall(p: Position): bigint {
  return max0(payablesDue(p) - (p.paymentsMinor + p.reserveMinor));
}

export interface Available {
  /** What may be invested now. */
  totalMinor: bigint;
  /** The Reserve's surplus over its floor (drawn first). */
  fromReserveMinor: bigint;
  /** The Payments account's surplus over what is waiting (drawn second). */
  fromPaymentsMinor: bigint;
  floorMinor: bigint;
}

export function availableToInvest(p: Position, marginPct: bigint = RESERVE_MARGIN_PCT_DEFAULT): Available {
  const floor = reserveFloor(payablesDue(p), marginPct);
  const total = max0(p.reserveMinor - floor + (p.paymentsMinor - p.waitingMinor));
  const reserveSurplus = min(max0(p.reserveMinor - floor), total);
  return { totalMinor: total, fromReserveMinor: reserveSurplus, fromPaymentsMinor: total - reserveSurplus, floorMinor: floor };
}

/** Where an amount being invested is drawn from: the Reserve's surplus first, then the Payments account's. */
export function drawPlan(p: Position, amountMinor: bigint, marginPct: bigint = RESERVE_MARGIN_PCT_DEFAULT): { fromReserveMinor: bigint; fromPaymentsMinor: bigint; withinAvailable: boolean } {
  const a = availableToInvest(p, marginPct);
  const fromReserve = min(amountMinor, a.fromReserveMinor);
  return { fromReserveMinor: fromReserve, fromPaymentsMinor: amountMinor - fromReserve, withinAvailable: amountMinor <= a.totalMinor };
}

export function treasuryMinor(p: Pick<Position, 'reserveMinor' | 'investmentsMinor'>): bigint {
  return p.reserveMinor + p.investmentsMinor;
}

/**
 * The most that may be put into stocks today: stocks after the buy at most `capPct` of treasury
 * after the buy. Money from the Reserve's surplus stays inside treasury; money from the Payments
 * account grows it. Within what is available to invest. Floors to the minor unit.
 */
export function maxStockBuy(p: Position, capPct: bigint = STOCK_CAP_PCT_DEFAULT, marginPct: bigint = RESERVE_MARGIN_PCT_DEFAULT): bigint {
  const a = availableToInvest(p, marginPct);
  const t = treasuryMinor(p);
  const s = p.stocksMinor;
  // Room while the treasury total stays the same (drawing on the Reserve's surplus).
  const roomAtT = max0((capPct * t) / 100n - s);
  if (roomAtT <= a.fromReserveMinor) return min(roomAtT, a.totalMinor);
  // Beyond the Reserve's surplus, each dollar from the Payments account also grows treasury:
  // s + r + x ≤ cap·(t + x)  ⇒  x ≤ (cap·t − 100·(s + r)) / (100 − cap).
  const r = a.fromReserveMinor;
  const fromPayments = max0((capPct * t - 100n * (s + r)) / (100n - capPct));
  return min(r + min(fromPayments, a.fromPaymentsMinor), a.totalMinor);
}

/** Stocks as a whole percent of treasury (half up), for "Stocks are 14% of treasury". */
export function stockSharePct(p: Pick<Position, 'reserveMinor' | 'investmentsMinor' | 'stocksMinor'>): bigint {
  const t = treasuryMinor(p);
  return t === 0n ? 0n : (p.stocksMinor * 100n * 2n + t) / (2n * t);
}

/** Sweep, out: cash above the reserve floor and above the cushion kept in the Payments account. */
export function sweepOut(p: Position, cushionMinor: bigint = SWEEP_CUSHION_DEFAULT, marginPct: bigint = RESERVE_MARGIN_PCT_DEFAULT): bigint {
  const floor = reserveFloor(payablesDue(p), marginPct);
  return max0(p.reserveMinor - floor) + max0(p.paymentsMinor - p.waitingMinor - cushionMinor);
}

/** Sweep, back: what the two accounts are short of the floor, capped at the units redeemable now. */
export function sweepBack(p: Position, redeemableMinor: bigint, marginPct: bigint = RESERVE_MARGIN_PCT_DEFAULT): bigint {
  const floor = reserveFloor(payablesDue(p), marginPct);
  return min(max0(floor - (p.paymentsMinor + p.reserveMinor)), max0(redeemableMinor));
}

/**
 * Whole-percent shares of a total for a stacked bar, adding up to exactly 100 (largest remainder).
 * Empty parts get 0; an all-zero total gives all zeros.
 */
export function sharesPct(parts: bigint[]): bigint[] {
  const total = parts.reduce((a, b) => a + b, 0n);
  if (total <= 0n) return parts.map(() => 0n);
  const floors = parts.map((v) => (max0(v) * 100n) / total);
  const rems = parts.map((v, i) => ({ i, rem: (max0(v) * 100n) % total }));
  let left = 100n - floors.reduce((a, b) => a + b, 0n);
  rems.sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  for (const r of rems) {
    if (left <= 0n) break;
    if (parts[r.i] <= 0n) continue;
    floors[r.i] += 1n;
    left -= 1n;
  }
  return floors;
}
