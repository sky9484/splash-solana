/**
 * "Money comes from" on Transfer's Step 3 (prompt 10 §5.6): a plan, not a list. Pure and integer-only.
 *
 *   1. The Payments account covers it       → "Covered", with the balance now and after.
 *   2. The reserve covers what's missing    → "Move US$X from your reserve first", in the same
 *                                             approval sequence (a real move between the company's
 *                                             own accounts, treasury-service.ts).
 *   3. Otherwise                            → bring in what's missing from outside: every available
 *                                             route (funding-router.ts), cheapest all-in first.
 *
 * Every outside route must land in the company's own Payments account; one that doesn't is a bug, and
 * the planner refuses to plan with it rather than show it.
 */
import type { FundingRoute } from './funding-router.ts';

export interface PlanInput {
  /** What this payment takes from the Payments account ("You pay"), USDC minor units. */
  needMinor: bigint;
  paymentsMinor: bigint;
  reserveMinor: bigint;
  /** The company's own Payments account: the only place outside money may land. */
  paymentsAccount: string;
  routes: FundingRoute[];
}

export interface PricedRoute extends FundingRoute {
  /** What lands in the Payments account. */
  amountMinor: bigint;
  /** The third party's charge on top, rounded up. Splash's is zero. */
  chargeMinor: bigint;
  /** What the company sends in total. */
  totalMinor: bigint;
  /** EVM: the exact allowance the wallet approves (equal to what is sent), never more. */
  approvalMinor: bigint | null;
}

export type FundingPlan =
  | { kind: 'covered'; needMinor: bigint; paymentsNowMinor: bigint; paymentsAfterMinor: bigint }
  | { kind: 'reserve'; needMinor: bigint; moveMinor: bigint; paymentsNowMinor: bigint; reserveNowMinor: bigint; reserveAfterMinor: bigint; paymentsAfterMinor: bigint }
  | { kind: 'external'; needMinor: bigint; shortMinor: bigint; paymentsNowMinor: bigint; reserveNowMinor: bigint; options: PricedRoute[]; unavailable: FundingRoute[] };

/** A charge in basis points, rounded up to the minor unit: never a float. */
export function chargeOn(amountMinor: bigint, bps: number): bigint {
  if (bps <= 0 || amountMinor <= 0n) return 0n;
  return (amountMinor * BigInt(bps) + 9_999n) / 10_000n;
}

/** Every available way in, priced for `shortMinor` (charge rounded up), cheapest first, then fewest steps. */
export function priceRoutes(routes: readonly FundingRoute[], shortMinor: bigint): PricedRoute[] {
  return routes
    .filter((r) => r.available)
    .map((r) => {
      const chargeMinor = chargeOn(shortMinor, r.chargeBps);
      const totalMinor = shortMinor + chargeMinor;
      return { ...r, amountMinor: shortMinor, chargeMinor, totalMinor, approvalMinor: r.exactApproval ? totalMinor : null };
    })
    .sort((a, b) => (a.totalMinor < b.totalMinor ? -1 : a.totalMinor > b.totalMinor ? 1 : a.steps.length - b.steps.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}

export function planFunding(input: PlanInput): FundingPlan {
  const { needMinor, paymentsMinor, reserveMinor } = input;
  if (needMinor < 0n || paymentsMinor < 0n || reserveMinor < 0n) throw new Error('amounts are never negative');
  for (const r of input.routes) {
    if (r.destination !== input.paymentsAccount) throw new Error(`funding route ${r.id} does not land in the company’s own Payments account`);
    if (r.splashFeeBps !== 0) throw new Error(`funding route ${r.id} charges a Splash fee; adding money is free`);
  }
  if (paymentsMinor >= needMinor) return { kind: 'covered', needMinor, paymentsNowMinor: paymentsMinor, paymentsAfterMinor: paymentsMinor - needMinor };
  const shortMinor = needMinor - paymentsMinor;
  if (reserveMinor >= shortMinor) {
    return { kind: 'reserve', needMinor, moveMinor: shortMinor, paymentsNowMinor: paymentsMinor, reserveNowMinor: reserveMinor, reserveAfterMinor: reserveMinor - shortMinor, paymentsAfterMinor: 0n };
  }
  const options = priceRoutes(input.routes, shortMinor);
  return { kind: 'external', needMinor, shortMinor, paymentsNowMinor: paymentsMinor, reserveNowMinor: reserveMinor, options, unavailable: input.routes.filter((r) => !r.available) };
}
