/**
 * Splash fee and the all-in cap (canon: Business Module v15.1 §5).
 *
 *   Splash fee      0.10% Cheapest / 0.15% Fastest / 0.15% Safest, min US$2
 *   All-in target   ≤ 0.33% on tickets from US$2,000
 *   Cap rule        on a ticket ≥ US$2,000 whose all-in is above 0.33%, Splash
 *                   lowers ITS OWN fee (only as far as needed) to a floor of
 *                   0.05%, and the US$2 minimum is waived; if still above the
 *                   target the quote carries `above_target` and needs an
 *                   explicit tap. Splash never subsidises partner or route cost.
 *                   Below US$2,000 the minimum applies and no flag is raised.
 *
 * Worked example from the canon, reproduced by the tests: US$10,000, partner
 * 0.20%, Fastest 0.03% route + 0.20% + 0.15% = 0.38% → Splash cut to 0.10% →
 * 0.33%.
 *
 * "Ticket" here is the USDC value of the payout: what reaches the supplier,
 * expressed in USDC at the partner's rate (partner gross minus partner fee).
 * Every percentage in a quote is relative to it.
 */
import { applyBps, divRound, parseMinor } from '../money.ts';
import type { Policy } from '../solana/types.ts';

export const SPLASH_FEE_BPS: Readonly<Record<Policy, number>> = Object.freeze({ cheapest: 10, fastest: 15, safest: 15 });
export const SPLASH_MIN_FEE_USDC_MINOR = 2_000_000n; // US$2
export const FEE_CAP_MIN_TICKET_USDC_MINOR = 2_000_000_000n; // US$2,000
export const ALL_IN_TARGET_BPS = 33n; // 0.33%
export const SPLASH_FEE_FLOOR_BPS = 5; // 0.05%

export interface SplashFeeInput {
  policy: Policy;
  ticketUsdcMinor: bigint;
  routeMinor: bigint;
  partnerMinor: bigint;
}

export interface SplashFeeResult {
  splashMinor: bigint;
  /** The fee before the cap rule (bps with the US$2 minimum). */
  nominalMinor: bigint;
  capApplied: boolean;
  minimumWaived: boolean;
  aboveTarget: boolean;
  allInMinor: bigint;
}

export function computeSplashFee({ policy, ticketUsdcMinor: t, routeMinor, partnerMinor }: SplashFeeInput): SplashFeeResult {
  if (t <= 0n) throw new RangeError('ticket must be positive');
  if (routeMinor < 0n || partnerMinor < 0n) throw new RangeError('costs cannot be negative');
  const pct = applyBps(t, SPLASH_FEE_BPS[policy], 'ceil');
  const nominal = pct > SPLASH_MIN_FEE_USDC_MINOR ? pct : SPLASH_MIN_FEE_USDC_MINOR;
  const passThrough = routeMinor + partnerMinor;
  const over = (fee: bigint) => (passThrough + fee) * 10_000n > ALL_IN_TARGET_BPS * t;

  if (t < FEE_CAP_MIN_TICKET_USDC_MINOR || !over(nominal)) {
    return { splashMinor: nominal, nominalMinor: nominal, capApplied: false, minimumWaived: false, aboveTarget: false, allInMinor: passThrough + nominal };
  }
  const floor = applyBps(t, SPLASH_FEE_FLOOR_BPS, 'ceil');
  const headroom = divRound(ALL_IN_TARGET_BPS * t, 10_000n, 'floor') - passThrough;
  // Cut only as far as needed, never below the floor, never below zero.
  let fee = pct < headroom ? pct : headroom;
  if (fee < floor) fee = floor;
  return {
    splashMinor: fee,
    nominalMinor: nominal,
    capApplied: fee < nominal,
    minimumWaived: fee < SPLASH_MIN_FEE_USDC_MINOR,
    aboveTarget: over(fee),
    allInMinor: passThrough + fee,
  };
}

/** All-in as basis points with two decimals (display only; decisions use bigint). */
export function allInBps(allInMinor: bigint, ticketUsdcMinor: bigint): number {
  return Number(divRound(allInMinor * 1_000_000n, ticketUsdcMinor, 'half-up')) / 100;
}

/**
 * A fee in fractional basis points, e.g. a CCTP V2 Fast Transfer fee of 1.3
 * bps. Accepted as a decimal string or a number with ≤ 2 decimals and held as
 * centi-bps, so 1.3 bps never passes through a float multiply.
 */
export function toCentiBps(bps: number | string): bigint {
  const s = typeof bps === 'number' ? String(bps) : bps;
  const c = parseMinor(s, 2);
  if (c < 0n || c >= 1_000_000n) throw new RangeError(`fee bps out of range: ${s}`);
  return c;
}

export function centiBpsFee(amountMinor: bigint, centiBps: bigint): bigint {
  return divRound(amountMinor * centiBps, 1_000_000n, 'ceil');
}

/**
 * Smallest burn amount B such that B − fee(B) − fixed ≥ net, where fee is
 * charged in centi-bps of B (CCTP V2 Fast Transfer deducts its fee from the
 * burned amount at mint).
 */
export function grossUpForFee(netMinor: bigint, centiBps: bigint, fixedMinor = 0n): bigint {
  const target = netMinor + fixedMinor;
  if (centiBps === 0n) return target;
  let b = divRound(target * 1_000_000n, 1_000_000n - centiBps, 'ceil');
  while (b > 0n && b - 1n - centiBpsFee(b - 1n, centiBps) >= target) b -= 1n;
  while (b - centiBpsFee(b, centiBps) < target) b += 1n;
  return b;
}
