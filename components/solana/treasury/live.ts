/**
 * The live "Interest today" figure on Treasury (prompt 11 §4.2): the one floating-point number in
 * Splash (§0.6). It is an estimate between two booked prices, for the eye only: it never reaches the
 * ledger, an order, an evidence bundle or Zeke, which all use the integer price booked once a day
 * (lib/treasury/history.ts). tests/treasury-smart.test.mjs checks that nothing outside this folder's
 * components imports it.
 *
 *   value_now      = units × P_today × (1 + r_d)^(s / 86400)
 *   r_d            = (1 + rate)^(1/365) − 1
 *   s              = seconds since 00:00 UTC
 *   interest_today = value_now − units × P_today
 */
export interface LiveInput {
  /** Units held, in millionths of a unit (a decimal string from the wire). */
  unitsMicro: string;
  /** The price booked today, US$ minor units (6 decimals) per whole unit. */
  priceTodayMinor: string;
  /** The dated rate, in basis points. */
  bps: number;
}

export interface LiveEstimate {
  /** US dollars, display only. */
  valueNow: number;
  interestToday: number;
  /** About how much a day at today's value: units × P_today × r_d. */
  perDay: number;
}

const DAY_S = 86_400;

export function liveEstimate(input: LiveInput, nowMs: number): LiveEstimate {
  const units = Number(BigInt(input.unitsMicro)) / 1e6;
  const price = Number(BigInt(input.priceTodayMinor)) / 1e6;
  const rd = Math.pow(1 + input.bps / 10_000, 1 / 365) - 1;
  const midnight = Math.floor(nowMs / (DAY_S * 1000)) * DAY_S * 1000;
  const s = (nowMs - midnight) / 1000;
  const base = units * price;
  const valueNow = base * Math.pow(1 + rd, s / DAY_S);
  return { valueNow, interestToday: valueNow - base, perDay: base * rd };
}

/** "+US$1.5963": four decimals, so the second-by-second tick shows. */
export function liveText(v: number): string {
  return `+US$${v.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
}

/** "about US$3.03 a day". */
export function perDayText(v: number): string {
  return `about US$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} a day`;
}
