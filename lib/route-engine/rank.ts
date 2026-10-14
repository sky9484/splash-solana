/**
 * Ranking by policy, and the home-lane rule.
 *
 * "Value" of a quote is PHP received per USDC debited (netLocal / source),
 * compared by exact cross-multiplication. In PHP-target mode every route pays
 * the same PHP, so value reduces to "least USDC debited"; in USDC mode it is
 * "most PHP received". One comparator serves both.
 *
 *   cheapest  max value
 *   fastest   min ETA among quotes within 0.10% of the best value
 *   safest    same-chain first, then CCTP V2 only (Standard before Fast); value breaks ties
 *
 * Home lane (canon §4 step 6): if a route sourced from ENGINE_HOME_CHAIN that
 * stays on it (here: Solana direct, no bridge) is within max(US$1, 0.02%) of
 * the policy's winner, it wins and the difference is reported. Never applied
 * to Cheapest when the business chose "strictly cheapest".
 *
 * Scope (a judgement call, configurable): by default the rule runs for
 * Cheapest and Safest only. The threshold is a COST tie-break; on Fastest it
 * would hand a business that asked for speed a slower route whenever costs
 * are close (on capped tickets they are often identical), so Fastest is off
 * unless `homeLanePolicies` includes it.
 */
import { applyBps, divRound } from '../money.ts';
import type { Policy, RouteQuote } from '../solana/types.ts';
import { ROUTE_KIND_ORDER, routeKindOf } from './quote.ts';

export const FASTEST_VALUE_TOLERANCE_BPS = 10n; // 0.10%
export const HOME_LANE_MIN_USDC_MINOR = 1_000_000n; // US$1
export const HOME_LANE_BPS = 2; // 0.02%
export const DEFAULT_HOME_LANE_POLICIES: readonly Policy[] = ['cheapest', 'safest'];

/**
 * How many links a route draws on the Transfer map (prompt 10 §5.6): a `transfer` or `partner` step is
 * one link, a `bridge` is two (it leaves one network and lands on another). A same-network route is
 * 2, a route through the partner's lower-cost lane is 3. Display only: nothing is ranked by it.
 */
export function stepCount(q: Pick<RouteQuote, 'steps'>): number {
  return q.steps.reduce((n, s) => n + (s.kind === 'bridge' ? 2 : 1), 0);
}

/** >0 when a is better value than b. */
export function compareValue(a: RouteQuote, b: RouteQuote): number {
  const l = a.netLocal.amountMinor * b.source.amountMinor;
  const r = b.netLocal.amountMinor * a.source.amountMinor;
  return l > r ? 1 : l < r ? -1 : 0;
}

function tieBreak(a: RouteQuote, b: RouteQuote): number {
  if (a.etaSec !== b.etaSec) return a.etaSec - b.etaSec;
  const k = ROUTE_KIND_ORDER.indexOf(routeKindOf(a)) - ROUTE_KIND_ORDER.indexOf(routeKindOf(b));
  if (k !== 0) return k;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function withinValueTolerance(q: RouteQuote, best: RouteQuote, toleranceBps: bigint): boolean {
  // q.value ≥ best.value × (1 − tol)
  return q.netLocal.amountMinor * best.source.amountMinor * 10_000n >= best.netLocal.amountMinor * q.source.amountMinor * (10_000n - toleranceBps);
}

function safetyTier(q: RouteQuote): number {
  const kind = routeKindOf(q);
  return kind === 'solana_direct' ? 0 : kind === 'cctp_v2_standard' ? 1 : 2;
}

/** Orders quotes for one policy. Quotes are expected to share that policy. */
export function rankForPolicy(quotes: RouteQuote[], policy: Policy): RouteQuote[] {
  const byValue = [...quotes].sort((a, b) => -compareValue(a, b) || tieBreak(a, b));
  if (byValue.length === 0) return [];
  if (policy === 'cheapest') return byValue;
  if (policy === 'fastest') {
    const best = byValue[0];
    const inBand = byValue.filter((q) => withinValueTolerance(q, best, FASTEST_VALUE_TOLERANCE_BPS));
    const outBand = byValue.filter((q) => !inBand.includes(q));
    inBand.sort((a, b) => a.etaSec - b.etaSec || -compareValue(a, b) || tieBreak(a, b));
    return [...inBand, ...outBand];
  }
  // safest: only same-chain and CCTP V2 routes exist in this lane; anything else is dropped.
  return byValue
    .filter((q) => routeKindOf(q) === 'solana_direct' || q.flags.includes('cctp_v2'))
    .sort((a, b) => safetyTier(a) - safetyTier(b) || -compareValue(a, b) || tieBreak(a, b));
}

export interface HomeLaneDecision {
  policy: Policy;
  homeChain: string;
  applied: boolean;
  reason: 'no_quotes' | 'policy_not_in_scope' | 'winner_is_home_lane' | 'no_home_lane_quote' | 'strictly_cheapest' | 'within_threshold' | 'outside_threshold';
  /** The policy's winner before the rule. */
  bestQuoteId?: string;
  homeQuoteId?: string;
  /** USDC the home lane costs over the winner (negative: the home lane is cheaper). */
  deltaUsdcMinor?: bigint;
  thresholdUsdcMinor?: bigint;
}

export function isHomeLane(q: RouteQuote, homeChain: string): boolean {
  return q.source.lane === homeChain && q.target.network === homeChain && !q.steps.some((s) => s.kind === 'bridge');
}

/**
 * USDC-equivalent cost of choosing `home` over `best`: what home debits beyond
 * what best would need to deliver the same PHP, at best's effective rate.
 */
export function homeLaneDelta(home: RouteQuote, best: RouteQuote): bigint {
  const num = home.source.amountMinor * best.netLocal.amountMinor - home.netLocal.amountMinor * best.source.amountMinor;
  return divRound(num, best.netLocal.amountMinor, 'ceil');
}

export function applyHomeLane(
  ordered: RouteQuote[],
  policy: Policy,
  opts: { homeChain: string; strictlyCheapest?: boolean; policies?: readonly Policy[] },
): { ordered: RouteQuote[]; decision: HomeLaneDecision } {
  const base = { policy, homeChain: opts.homeChain };
  if (ordered.length === 0) return { ordered, decision: { ...base, applied: false, reason: 'no_quotes' } };
  if (!(opts.policies ?? DEFAULT_HOME_LANE_POLICIES).includes(policy)) {
    return { ordered, decision: { ...base, applied: false, reason: 'policy_not_in_scope', bestQuoteId: ordered[0].id } };
  }
  const best = ordered[0];
  if (isHomeLane(best, opts.homeChain)) {
    return { ordered, decision: { ...base, applied: false, reason: 'winner_is_home_lane', bestQuoteId: best.id, homeQuoteId: best.id, deltaUsdcMinor: 0n } };
  }
  const home = [...ordered].filter((q) => isHomeLane(q, opts.homeChain)).sort((a, b) => -compareValue(a, b))[0];
  if (!home) return { ordered, decision: { ...base, applied: false, reason: 'no_home_lane_quote', bestQuoteId: best.id } };
  const delta = homeLaneDelta(home, best);
  const pct = applyBps(best.source.amountMinor, HOME_LANE_BPS, 'floor');
  const threshold = pct > HOME_LANE_MIN_USDC_MINOR ? pct : HOME_LANE_MIN_USDC_MINOR;
  const facts = { bestQuoteId: best.id, homeQuoteId: home.id, deltaUsdcMinor: delta, thresholdUsdcMinor: threshold };
  if (policy === 'cheapest' && opts.strictlyCheapest) {
    return { ordered, decision: { ...base, applied: false, reason: 'strictly_cheapest', ...facts } };
  }
  if (delta > threshold) return { ordered, decision: { ...base, applied: false, reason: 'outside_threshold', ...facts } };
  const promoted: RouteQuote = { ...home, flags: home.flags.includes('home_lane') ? home.flags : [...home.flags, 'home_lane'] };
  return {
    ordered: [promoted, ...ordered.filter((q) => q.id !== home.id)],
    decision: { ...base, applied: true, reason: 'within_threshold', ...facts },
  };
}
