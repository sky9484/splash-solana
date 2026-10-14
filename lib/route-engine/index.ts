/**
 * Route engine, Solana lane. Pure and offline: it takes partner quotes and
 * deposit addresses as inputs and returns ranked `RouteQuote`s. It never
 * signs, sends or calls a network.
 *
 *   const result = quoteRoutes({ paymentId, amount: { amountPhpMinor }, senderBalanceUsdcMinor,
 *                                partner, partnerQuotes, deposits, fastTransferFeeBps, now });
 *   result.picks.cheapest / .fastest / .safest
 */
import type { Policy, RouteQuote } from '../solana/types.ts';
import { buildBaseCandidates, priceCandidate, resolveAssumptions, type EngineAssumptions, type EngineInput, type Exclusion } from './quote.ts';
import { applyHomeLane, rankForPolicy, type HomeLaneDecision } from './rank.ts';
import type { SplashFeeResult } from './fees.ts';

export * from './fees.ts';
export * from './quote.ts';
export * from './rank.ts';
export * from './policy.ts';

export const POLICIES: readonly Policy[] = ['cheapest', 'fastest', 'safest'];

export interface EngineResult {
  paymentId: string;
  mode: 'php_receive' | 'usdc_send';
  generatedAt: string;
  homeChain: string;
  picks: Record<Policy, RouteQuote | null>;
  /** Every affordable quote per policy, best first (home-lane rule applied). */
  ranked: Record<Policy, RouteQuote[]>;
  homeLane: Record<Policy, HomeLaneDecision>;
  /** Fee-cap working per quote id, for the approval card's breakdown and the tests. */
  fees: Record<string, SplashFeeResult & { ticketUsdcMinor: bigint }>;
  excluded: Exclusion[];
  assumptions: EngineAssumptions;
}

/**
 * The engine reads no env. The server layer passes ENGINE_HOME_CHAIN as
 * `homeChain` (declare the key in lib/env.ts first: `check:env` enforces it).
 */
export const DEFAULT_HOME_CHAIN = 'solana';
export function engineHomeChain(explicit?: string): string {
  return explicit && explicit.trim() !== '' ? explicit : DEFAULT_HOME_CHAIN;
}

export function quoteRoutes(input: EngineInput): EngineResult {
  if (!input.paymentId) throw new Error('paymentId required');
  const a = input.amount as { amountPhpMinor?: bigint; amountUsdcMinor?: bigint };
  if ((a.amountPhpMinor === undefined) === (a.amountUsdcMinor === undefined)) throw new Error('give exactly one of amountPhpMinor or amountUsdcMinor');
  const amt = a.amountPhpMinor ?? a.amountUsdcMinor!;
  if (amt <= 0n) throw new Error('amount must be positive');
  if (input.senderBalanceUsdcMinor < 0n) throw new Error('balance cannot be negative');

  const now = input.now ?? new Date();
  const homeChain = engineHomeChain(input.homeChain);
  const { candidates, excluded } = buildBaseCandidates(input, now);

  const picks = {} as EngineResult['picks'];
  const ranked = {} as EngineResult['ranked'];
  const homeLane = {} as EngineResult['homeLane'];
  const fees: EngineResult['fees'] = {};

  for (const policy of POLICIES) {
    const priced = candidates.map((c) => priceCandidate(c, policy, input.paymentId));
    const affordable: RouteQuote[] = [];
    for (const p of priced) {
      if (p.quote.source.amountMinor > input.senderBalanceUsdcMinor) {
        excluded.push({ kind: p.kind, policy, reason: 'insufficient_balance', detail: `needs ${p.quote.source.amountMinor}, balance ${input.senderBalanceUsdcMinor}`, neededMinor: p.quote.source.amountMinor });
        continue;
      }
      affordable.push(p.quote);
      fees[p.quote.id] = { ...p.fee, ticketUsdcMinor: p.ticketUsdcMinor };
    }
    const { ordered, decision } = applyHomeLane(rankForPolicy(affordable, policy), policy, { homeChain, strictlyCheapest: input.strictlyCheapest, policies: input.homeLanePolicies });
    ranked[policy] = ordered;
    picks[policy] = ordered[0] ?? null;
    homeLane[policy] = decision;
  }

  return {
    paymentId: input.paymentId,
    mode: a.amountPhpMinor !== undefined ? 'php_receive' : 'usdc_send',
    generatedAt: now.toISOString(),
    homeChain,
    picks,
    ranked,
    homeLane,
    fees,
    excluded,
    assumptions: resolveAssumptions(input.assumptions),
  };
}
