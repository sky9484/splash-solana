/**
 * Deterministic policy gate. Runs as code before the approval card; Zeke can
 * neither call nor override it (it is not exported to the Zeke layer and its
 * inputs are the confirmed invoice and the engine's quote, never model text).
 *
 * Checks (names fixed by `PolicyResult` in lib/solana/types.ts):
 *   tier                   the business has a verified tier
 *   per_payment_limit      this debit ≤ the tier's per-payment cap
 *   daily_limit            today's debits + this one ≤ the tier's daily limit
 *   kyt                    the deposit address screened clear (STUB in this build)
 *   duplicate_invoice      no earlier payment carries this invoice commitment
 *   quote_expiry           the quote is still live
 *   bank_details_verified  new bank details were verified out of band
 * plus one engine-local check returned in `extraChecks` (the shared type's
 * check names are a closed union): the quote pays at least the invoice amount
 * to the invoice's supplier.
 *
 * Limits are in USDC minor units against the quote's total debit.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import { formatMinor, MICRO_DECIMALS } from '../money.ts';
import type { ConfirmedInvoice, PolicyResult, RouteQuote } from '../solana/types.ts';
import { isQuoteExpired } from './quote.ts';

export type Tier = 'basic' | 'advanced';

export interface TierLimits {
  dailyUsdcMinor: bigint;
  perPaymentUsdcMinor: bigint;
}

/** Basic US$5,000/day; Advanced US$100,000/day. Per-payment caps default to the daily limit. */
export const TIER_LIMITS: Readonly<Record<Tier, TierLimits>> = Object.freeze({
  basic: { dailyUsdcMinor: 5_000_000_000n, perPaymentUsdcMinor: 5_000_000_000n },
  advanced: { dailyUsdcMinor: 100_000_000_000n, perPaymentUsdcMinor: 100_000_000_000n },
});

export interface KytResult {
  /** Always 'stub' in this build. The UI must say so. */
  provider: 'stub';
  resultId: string;
  address: string;
  verdict: 'clear' | 'flagged';
  label: 'KYT stub · not a real screening';
}

export interface KytScreener {
  screen(address: string, network: string): KytResult;
}

/** Deterministic stub: clear unless the address is on the supplied deny list. */
export function createKytStub(denyList: Iterable<string> = []): KytScreener {
  const deny = new Set(denyList);
  return {
    screen(address, network) {
      return {
        provider: 'stub',
        resultId: `kyt-stub-${bytesToHex(sha256(utf8ToBytes(`${network}:${address}`))).slice(0, 16)}`,
        address,
        verdict: deny.has(address) ? 'flagged' : 'clear',
        label: 'KYT stub · not a real screening',
      };
    },
  };
}

export interface PolicyInput {
  tier: Tier | null;
  /** Overrides for a tier's limits (e.g. a lower per-payment cap the business set). */
  limits?: Partial<TierLimits>;
  quote: RouteQuote;
  invoice: ConfirmedInvoice;
  /** USDC already debited today (same day boundary as the ledger). */
  usedTodayUsdcMinor: bigint;
  /** Commitments of invoices already paid or in flight. */
  seenCommitments: ReadonlySet<string> | ((commitmentHex: string) => boolean);
  kyt?: KytScreener;
  now?: Date;
}

export interface EnginePolicyResult extends PolicyResult {
  extraChecks: Array<{ name: 'amount_covers_invoice'; passed: boolean; detail: string }>;
  kyt: KytResult;
}

const usd = (m: bigint) => `US$${formatMinor(m, MICRO_DECIMALS).replace(/(\.\d{2})\d*$/, '$1')}`;

export function evaluatePolicy(input: PolicyInput): EnginePolicyResult {
  const now = input.now ?? new Date();
  const checks: PolicyResult['checks'] = [];
  const debit = input.quote.source.amountMinor;

  const tierOk = input.tier === 'basic' || input.tier === 'advanced';
  checks.push({ name: 'tier', passed: tierOk, detail: tierOk ? `tier ${input.tier}` : 'no verified tier' });
  const limits: TierLimits = tierOk ? { ...TIER_LIMITS[input.tier as Tier], ...(input.limits ?? {}) } : { dailyUsdcMinor: 0n, perPaymentUsdcMinor: 0n };

  const perOk = debit <= limits.perPaymentUsdcMinor;
  checks.push({ name: 'per_payment_limit', passed: perOk, detail: `${usd(debit)} vs cap ${usd(limits.perPaymentUsdcMinor)}` });

  const dayTotal = input.usedTodayUsdcMinor + debit;
  const dayOk = input.usedTodayUsdcMinor >= 0n && dayTotal <= limits.dailyUsdcMinor;
  checks.push({ name: 'daily_limit', passed: dayOk, detail: `${usd(dayTotal)} today vs limit ${usd(limits.dailyUsdcMinor)}` });

  const kyt = (input.kyt ?? createKytStub()).screen(input.quote.target.depositAddress, input.quote.target.network);
  checks.push({ name: 'kyt', passed: kyt.verdict === 'clear', detail: `${kyt.verdict} (stub, ${kyt.resultId})` });

  const seen = typeof input.seenCommitments === 'function' ? input.seenCommitments(input.invoice.commitmentHex) : input.seenCommitments.has(input.invoice.commitmentHex);
  const commitOk = /^[0-9a-f]{64}$/.test(input.invoice.commitmentHex);
  checks.push({
    name: 'duplicate_invoice',
    passed: commitOk && !seen,
    detail: !commitOk ? 'invoice commitment missing or malformed' : seen ? 'this invoice was already paid or is in flight' : 'first payment of this invoice',
  });

  const expired = isQuoteExpired(input.quote, now);
  checks.push({ name: 'quote_expiry', passed: !expired, detail: expired ? `quote expired at ${input.quote.expiresAt}` : `valid until ${input.quote.expiresAt}` });

  const bv = input.invoice.bankDetailsVerified;
  checks.push({ name: 'bank_details_verified', passed: bv !== null, detail: bv ? `${bv.method} by ${bv.by} at ${bv.at}` : 'bank details not verified out of band' });

  const covers = input.quote.netLocal.currency === 'PHP' && input.quote.netLocal.amountMinor >= input.invoice.amountPhpMinor;
  const extraChecks: EnginePolicyResult['extraChecks'] = [
    { name: 'amount_covers_invoice', passed: covers, detail: `quote pays ${input.quote.netLocal.amountMinor} centavos; invoice ${input.invoice.amountPhpMinor}` },
  ];

  const failed = [...checks, ...extraChecks].filter((c) => !c.passed);
  return {
    allowed: failed.length === 0,
    reasons: failed.map((c) => `${c.name}: ${c.detail}`),
    checks,
    extraChecks,
    kyt,
  };
}
