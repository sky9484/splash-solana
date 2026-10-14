/**
 * Transfer, Step 2 (prompt 10 §5.5): while a person types an amount, the other amount, the rail and
 * what's left of the limits. Display only: the exact cost, with every fee, is the route engine's quote
 * at Step 3, and the rules are checked again there and before the device approves.
 *
 *   bank   "They receive" (PHP) ⇄ "You send, before fees" (US$) at the payout partner's rate; the
 *          rail from the partner's routing for that bank and amount ("Paid out by PESONet"). No time
 *          words: a rail is named, never how long it takes (§0.5).
 *   peer   US$ to US$: no conversion, no rail, no Splash fee.
 *   limits the per-payment limit and today's total, on what you send: an amount above either is
 *          blocked here with the rule's name and who can change it.
 *
 * Integers only (lib/money.ts): PHP in centavos, US$ in 6-decimal units, rounded to whole cents.
 */
import { applyRate, divideByRate, MICRO_DECIMALS, parseRate } from '../money.ts';
import { bankByCode, railFor, type PartnerBank } from '../solana-partner/banks.ts';
import type { PayoutRail } from '../solana-partner/registry.ts';

const PHP_DECIMALS = 2;
const MICRO_PER_CENT = 10_000n;

export interface EstimateLimits {
  perPaymentMinor: bigint;
  dailyMinor: bigint;
  usedTodayMinor: bigint;
}

export type EstimateInput =
  | { kind: 'bank'; bankCode: string | null; phpMinor: bigint; usdMinor?: undefined; rate: string; limits: EstimateLimits }
  | { kind: 'bank'; bankCode: string | null; usdMinor: bigint; phpMinor?: undefined; rate: string; limits: EstimateLimits }
  | { kind: 'peer'; usdMinor: bigint; rate?: undefined; limits: EstimateLimits };

export interface Estimate {
  kind: 'bank' | 'peer';
  /** What they receive: PHP centavos (bank), or null (peer: they receive the US$ you send). */
  phpMinor: bigint | null;
  /** What you send before fees, 6-decimal US$ in whole cents. */
  usdMinor: bigint;
  /** "57.40" (bank), or null. */
  rate: string | null;
  /** "PESONet", from the partner's routing for this bank and amount (bank), or null. */
  rail: PayoutRail | null;
  /** Why that rail, in one sentence. */
  railWhy: string | null;
  limits: EstimateLimits & { leftTodayMinor: bigint; leftAfterMinor: bigint };
  /** The rule an amount breaks, named, with who can change it; null when it fits. */
  block: { rule: 'per_payment' | 'daily'; message: string } | null;
}

/** Whole cents, rounded up: "about US$5,000.00 before fees" never understates what you send. */
function toCentsUp(micro: bigint): bigint {
  return ((micro + MICRO_PER_CENT - 1n) / MICRO_PER_CENT) * MICRO_PER_CENT;
}

function usdWords(micro: bigint): string {
  const cents = micro / MICRO_PER_CENT;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `US$${whole}.${(cents % 100n).toString().padStart(2, '0')}`;
}

function railReason(bank: PartnerBank, rail: PayoutRail): string {
  if (rail === 'InstaPay') return `InstaPay, because ${bank.name} takes this amount that way. Above ₱50,000.00 it goes by PESONet.`;
  if (!bank.rails.includes('InstaPay')) return `PESONet, the way ${bank.name} takes payments from the partner.`;
  return `PESONet, because ${bank.name} takes this amount that way. Smaller amounts may go by InstaPay.`;
}

export function estimateTransfer(input: EstimateInput): Estimate {
  let phpMinor: bigint | null = null;
  let usdMinor: bigint;
  let rail: PayoutRail | null = null;
  let railWhy: string | null = null;
  if (input.kind === 'bank') {
    const rate = parseRate(input.rate);
    if (input.phpMinor !== undefined) {
      phpMinor = input.phpMinor < 0n ? 0n : input.phpMinor;
      usdMinor = toCentsUp(divideByRate(phpMinor, rate, 'ceil', PHP_DECIMALS, MICRO_DECIMALS));
    } else {
      usdMinor = toCentsUp(input.usdMinor < 0n ? 0n : input.usdMinor);
      phpMinor = applyRate(usdMinor, rate, 'floor', MICRO_DECIMALS, PHP_DECIMALS);
    }
    const bank = input.bankCode ? bankByCode(input.bankCode) : null;
    if (bank && phpMinor > 0n) {
      rail = railFor(bank, phpMinor);
      railWhy = railReason(bank, rail);
    }
  } else {
    usdMinor = toCentsUp(input.usdMinor < 0n ? 0n : input.usdMinor);
  }
  const { perPaymentMinor, dailyMinor, usedTodayMinor } = input.limits;
  const leftTodayMinor = dailyMinor > usedTodayMinor ? dailyMinor - usedTodayMinor : 0n;
  const leftAfterMinor = leftTodayMinor > usdMinor ? leftTodayMinor - usdMinor : 0n;
  let block: Estimate['block'] = null;
  if (usdMinor > perPaymentMinor) {
    block = { rule: 'per_payment', message: `Above your per-payment limit of ${usdWords(perPaymentMinor)}. Send it in two payments, or ask your owner: limits are set in Rules.` };
  } else if (usdMinor > leftTodayMinor) {
    block = { rule: 'daily', message: `Above today's limit: ${usdWords(leftTodayMinor)} left today. Send the rest tomorrow, or ask your owner: limits are set in Rules.` };
  }
  return {
    kind: input.kind,
    phpMinor,
    usdMinor,
    rate: input.kind === 'bank' ? input.rate : null,
    rail,
    railWhy,
    limits: { perPaymentMinor, dailyMinor, usedTodayMinor, leftTodayMinor, leftAfterMinor },
    block,
  };
}

