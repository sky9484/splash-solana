/**
 * The T-bill pool's booked price, one a day, and the interest each day booked (prompt 11 §4.2,
 * decision 8). Pure and integer: a price is US$ minor units (6 decimals) per whole unit, units are
 * millionths of a unit (reference.ts UNIT), interest is US$ minor units.
 *
 * In test mode the simulator books Ondo's official price once a day: TBILLS.testPriceMinor on the day
 * the rate is dated (PRICE_ANCHOR_DAY), and on every other day that price grown (or, before it,
 * shrunk) by the dated rate compounded daily, (1 + rate)^(1/365) a day. A live adapter reads Ondo's
 * published price instead (not built: test mode only). This is what the books use; the ticking figure
 * on Treasury is a display-only estimate between two booked prices (components/solana/treasury/live.ts)
 * and never comes back here.
 *
 * Interest booked on a day is what the units held at the start of that day gained since the day
 * before: units × (P(day) − P(day − 1)). Units subscribed during a day start gaining the next day;
 * units redeemed during a day still gained that day.
 */
import { TBILLS, UNIT } from './reference.ts';

/** The day the simulator's price is TBILLS.testPriceMinor: the day the rate is dated. */
export const PRICE_ANCHOR_DAY = TBILLS.rate.asOf;
/** A quarter's interest is drafted back to the Payments account only from this much (decision 10). */
export const QUARTER_INTEREST_MIN = 50n * UNIT;

const SCALE = 10n ** 18n;
const DAY_MS = 86_400_000;

export const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);
export const addDays = (day: string, n: number) => utcDay(new Date(dayMs(day) + n * DAY_MS));
/** Whole days from `a` to `b` (both YYYY-MM-DD: UTC midnights, so the division is exact). */
export const daysBetween = (a: string, b: string) => (dayMs(b) - dayMs(a)) / DAY_MS;

const factors = new Map<number, bigint>();
/**
 * (1 + bps / 10,000)^(1/365) in parts of 10^18, rounded down: how much the price grows in a day. The
 * largest g with g^365 ≤ (1 + rate) · 10^(18·365), found by bisection on integers.
 */
export function dailyFactor(bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error(`a rate in basis points, 0 to 10,000: ${bps}`);
  const hit = factors.get(bps);
  if (hit !== undefined) return hit;
  const target = ((10_000n + BigInt(bps)) * SCALE ** 365n) / 10_000n;
  let lo = SCALE;
  let hi = 2n * SCALE;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (mid ** 365n <= target) lo = mid;
    else hi = mid - 1n;
  }
  factors.set(bps, lo);
  return lo;
}

const prices = new Map<string, bigint>();
/** The price booked on `day` (YYYY-MM-DD), rounded down to a millionth of a dollar. */
export function bookedPrice(day: string, bps: number = TBILLS.rate.value.bps): bigint {
  const key = `${bps}:${day}`;
  const hit = prices.get(key);
  if (hit !== undefined) return hit;
  const n = daysBetween(PRICE_ANCHOR_DAY, day);
  const g = dailyFactor(bps);
  const p0 = TBILLS.testPriceMinor;
  const price = n >= 0 ? (p0 * g ** BigInt(n)) / SCALE ** BigInt(n) : (p0 * SCALE ** BigInt(-n)) / g ** BigInt(-n);
  if (prices.size > 4_000) prices.clear();
  prices.set(key, price);
  return price;
}

/** A settled T-bill order, as the history needs it: when it settled and the units it added or took. */
export interface UnitsEvent {
  at: string;
  kind: 'subscribe' | 'redeem';
  unitsMicro: bigint;
}

/** Units held at the start of `day` (00:00 UTC): everything settled before then. Never below zero. */
export function unitsAtStart(day: string, events: readonly UnitsEvent[]): bigint {
  const start = dayMs(day);
  let units = 0n;
  for (const e of events) {
    if (Date.parse(e.at) >= start) continue;
    units += e.kind === 'subscribe' ? e.unitsMicro : -e.unitsMicro;
  }
  return units < 0n ? 0n : units;
}

/** The interest booked on `day`: the units held at its start × the day's price rise. */
export function interestOn(day: string, events: readonly UnitsEvent[], bps: number = TBILLS.rate.value.bps): bigint {
  const units = unitsAtStart(day, events);
  if (units === 0n) return 0n;
  return (units * (bookedPrice(day, bps) - bookedPrice(addDays(day, -1), bps))) / UNIT;
}

export interface InterestDay {
  day: string;
  unitsMicro: bigint;
  interestMinor: bigint;
}

/** Each day's booked interest, `days` of them ending on `lastDay`, oldest first. */
export function dailyInterest(lastDay: string, days: number, events: readonly UnitsEvent[], bps: number = TBILLS.rate.value.bps): InterestDay[] {
  const out: InterestDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = addDays(lastDay, -i);
    out.push({ day, unitsMicro: unitsAtStart(day, events), interestMinor: interestOn(day, events, bps) });
  }
  return out;
}

/** The interest booked from `fromDay` to `toDay`, both included. */
export function interestBetween(fromDay: string, toDay: string, events: readonly UnitsEvent[], bps: number = TBILLS.rate.value.bps): bigint {
  let sum = 0n;
  for (let day = fromDay; day <= toDay; day = addDays(day, 1)) sum += interestOn(day, events, bps);
  return sum;
}

/* ── Calendar quarters (decision 10) ──────────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface Quarter {
  /** "2026-Q3". */
  key: string;
  first: string;
  last: string;
  /** "Jul–Sep". */
  months: string;
}

export function quarterOf(day: string): Quarter {
  const date = new Date(dayMs(day));
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const q = (m - (m % 3)) / 3;
  const first = `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`;
  const next = q === 3 ? `${y + 1}-01-01` : `${y}-${String(q * 3 + 4).padStart(2, '0')}-01`;
  return { key: `${y}-Q${q + 1}`, first, last: addDays(next, -1), months: `${MONTHS[q * 3]}–${MONTHS[q * 3 + 2]}` };
}

/** The calendar quarter before the one `day` is in. */
export function previousQuarter(day: string): Quarter {
  return quarterOf(addDays(quarterOf(day).first, -1));
}

/** Monday to Friday. Public holidays are not known here. */
export function isBusinessDay(day: string): boolean {
  const wd = new Date(dayMs(day)).getUTCDay();
  return wd !== 0 && wd !== 6;
}

/** The first business day of the quarter `day` is in: the first business day after the last quarter ended. */
export function firstBusinessDayOfQuarter(day: string): string {
  let d = quarterOf(day).first;
  while (!isBusinessDay(d)) d = addDays(d, 1);
  return d;
}
