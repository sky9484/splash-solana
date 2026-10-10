/**
 * Mock payout partner for devnet and offline runs. Labelled everywhere as
 * "Mock partner · devnet"; its rate is a fixed reference, not a market rate.
 *
 * It has the same surface a real partner adapter has (`PayoutPartner`):
 *   quote()        a priced quote for one size on one delivery network
 *   createPayout() a payout with ONE-PAYMENT deposit addresses on Solana and
 *                  Polygon (deterministic, derived from a seed + paymentId)
 *   webhooks       `received` then `paid` with a fake bank reference
 *                  ('MOCK-PESONET-…'), HMAC-SHA256 signed with a secret
 *   verifyWebhook()
 *
 * A real sandbox adapter (Noah's sandbox is the intended one) can replace this
 * module behind the same interface without the engine or evidence changing.
 *
 * Pure apart from an in-memory payout map; no network, no env reads.
 */
import { Keypair } from '@solana/web3.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

import { applyBps, applyRate, divideByRate, parseRate, MICRO_DECIMALS } from '../money.ts';
import type { DeliveryNetwork, PartnerPayoutEvent } from '../solana/types.ts';
import { canonicalJson } from '../solana-evidence/canonical.ts';
import {
  MOCK_PARTNER_ENTRY,
  partnerAccepts,
  type CreatePayoutRequest,
  type PartnerDepositAddress,
  type PartnerPayout,
  type PartnerQuote,
  type PartnerQuoteRequest,
  type PayoutPartner,
  type PayoutRail,
  type WebhookVerification,
} from './registry.ts';

const PHP_DECIMALS = 2;

export const MOCK_RATE = '57.40';
export const MOCK_RATE_REFERENCE = 'MOCK · not a live rate';
/** 0.20%: the partner-cost assumption in the canon's worked example. */
export const MOCK_FEE_BPS = 20;
/** InstaPay's per-transfer ceiling, PHP 50,000.00. Above it the mock uses PESONet. */
export const INSTAPAY_MAX_PHP_MINOR = 5_000_000n;
export const MOCK_QUOTE_TTL_SEC = 60;
const ETA: Record<PayoutRail, { sec: number; arrival: string }> = {
  InstaPay: { sec: 900, arrival: 'within minutes' },
  PESONet: { sec: 8 * 3600, arrival: 'same banking day' },
};

export interface MockPartnerOptions {
  /** HMAC key for webhooks. Required: an unsigned webhook is not evidence. */
  webhookSecret: string | Uint8Array;
  /** Seed for deposit-address derivation. Same seed + paymentId → same addresses. */
  seed?: string;
  rate?: string;
  feeBps?: number;
  feeFixedUsdcMinor?: bigint;
  quoteTtlSec?: number;
}

export class MockPartnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MockPartnerError';
  }
}

export interface SimulatedDeposit {
  payoutId: string;
  network: DeliveryNetwork;
  address: string;
  amountUsdcMinor: bigint;
  now?: Date;
}

export interface MockPayoutPartner extends PayoutPartner {
  getPayout(payoutId: string): PartnerPayout | undefined;
  /** Offline stand-in for "USDC arrived at the deposit address". Returns signed webhooks in order. */
  simulateDeposit(deposit: SimulatedDeposit): PartnerPayoutEvent[];
}

// ---------------------------------------------------------------------------
// Webhook signing (exported so an API route can verify without the mock)

export function webhookBody(event: Omit<PartnerPayoutEvent, 'signature'> | PartnerPayoutEvent): string {
  const body: Record<string, unknown> = { ...event };
  delete body.signature;
  return canonicalJson(body);
}

function keyBytes(secret: string | Uint8Array): Uint8Array {
  const key = typeof secret === 'string' ? utf8ToBytes(secret) : secret;
  if (key.length < 16) throw new MockPartnerError('webhook secret must be at least 16 bytes');
  return key;
}

export function signWebhook(event: Omit<PartnerPayoutEvent, 'signature'>, secret: string | Uint8Array): PartnerPayoutEvent {
  const signature = bytesToHex(hmac(sha256, keyBytes(secret), utf8ToBytes(webhookBody(event))));
  return { ...event, signature };
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]*$/.test(a) || !/^[0-9a-f]*$/.test(b) || a.length !== b.length) return false;
  const x = hexToBytes(a);
  const y = hexToBytes(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export function verifyWebhookSignature(
  event: PartnerPayoutEvent,
  secret: string | Uint8Array,
  opts: { expectedPartnerId?: string; now?: Date; maxAgeSec?: number } = {},
): WebhookVerification {
  if (typeof event?.signature !== 'string') return { ok: false, reason: 'missing signature' };
  const expected = bytesToHex(hmac(sha256, keyBytes(secret), utf8ToBytes(webhookBody(event))));
  if (!constantTimeEqualHex(event.signature, expected)) return { ok: false, reason: 'bad signature' };
  if (opts.expectedPartnerId && event.partnerId !== opts.expectedPartnerId) return { ok: false, reason: 'wrong partner' };
  if (opts.maxAgeSec !== undefined) {
    const age = ((opts.now ?? new Date()).getTime() - Date.parse(event.at)) / 1000;
    if (!Number.isFinite(age) || age > opts.maxAgeSec) return { ok: false, reason: 'stale event' };
    if (age < -300) return { ok: false, reason: 'event from the future' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Deterministic one-payment deposit addresses

function depositSeed(seed: string, network: DeliveryNetwork, paymentId: string): Uint8Array {
  return sha256(
    concatBytes(
      utf8ToBytes('splash.mock-partner.deposit.v1'),
      Uint8Array.of(0),
      utf8ToBytes(seed),
      Uint8Array.of(0),
      utf8ToBytes(network),
      Uint8Array.of(0),
      utf8ToBytes(paymentId),
    ),
  );
}

/** EIP-55 mixed-case checksum. */
export function toChecksumAddress(hex40: string): string {
  const lower = hex40.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{40}$/.test(lower)) throw new MockPartnerError('not a 20-byte hex address');
  const hash = bytesToHex(keccak_256(utf8ToBytes(lower)));
  let out = '0x';
  for (let i = 0; i < 40; i++) out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  return out;
}

export function deriveMockDepositAddress(seed: string, network: DeliveryNetwork, paymentId: string): string {
  const s = depositSeed(seed, network, paymentId);
  if (network === 'solana') {
    // A real ed25519 key (on curve), so the ATA can be derived the normal way.
    return Keypair.fromSeed(s).publicKey.toBase58();
  }
  return toChecksumAddress(bytesToHex(keccak_256(s).slice(12)));
}

// ---------------------------------------------------------------------------

export function createMockPartner(options: MockPartnerOptions): MockPayoutPartner {
  const secret = keyBytes(options.webhookSecret);
  const seed = options.seed ?? 'splash-devnet';
  const rateStr = options.rate ?? MOCK_RATE;
  const rate = parseRate(rateStr);
  const feeBps = options.feeBps ?? MOCK_FEE_BPS;
  const feeFixed = options.feeFixedUsdcMinor ?? 0n;
  const ttl = Math.min(options.quoteTtlSec ?? MOCK_QUOTE_TTL_SEC, MOCK_QUOTE_TTL_SEC);
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps >= 10_000) throw new MockPartnerError('feeBps must be an integer 0..9999');
  const entry = MOCK_PARTNER_ENTRY;
  const payouts = new Map<string, PartnerPayout>();

  const feeFor = (gross: bigint) => applyBps(gross, feeBps, 'ceil') + feeFixed;
  const phpFor = (gross: bigint) => {
    const fee = feeFor(gross);
    return gross > fee ? applyRate(gross - fee, rate, 'floor', MICRO_DECIMALS, PHP_DECIMALS) : 0n;
  };
  const railFor = (php: bigint): PayoutRail => (php <= INSTAPAY_MAX_PHP_MINOR ? 'InstaPay' : 'PESONet');

  function grossForPhp(php: bigint): bigint {
    const need = divideByRate(php, rate, 'ceil', PHP_DECIMALS, MICRO_DECIMALS);
    // smallest gross with gross - fee(gross) >= need, then nudge for rate rounding
    let gross = ((need + feeFixed) * 10_000n + BigInt(10_000 - feeBps) - 1n) / BigInt(10_000 - feeBps);
    while (gross > 0n && phpFor(gross - 1n) >= php) gross -= 1n;
    while (phpFor(gross) < php) gross += 1n;
    return gross;
  }

  function quote(req: PartnerQuoteRequest, opts: { network?: DeliveryNetwork; now?: Date } = {}): PartnerQuote {
    const network = opts.network ?? 'solana';
    if (!partnerAccepts(entry, network)) throw new MockPartnerError(`mock partner does not accept ${network}`);
    const now = opts.now ?? new Date();
    let gross: bigint;
    if (req.amountUsdcMinor !== undefined) {
      if (req.amountUsdcMinor <= 0n) throw new MockPartnerError('amount must be positive');
      gross = req.amountUsdcMinor;
    } else if (req.amountPhpMinor !== undefined) {
      if (req.amountPhpMinor <= 0n) throw new MockPartnerError('amount must be positive');
      gross = grossForPhp(req.amountPhpMinor);
    } else {
      throw new MockPartnerError('quote needs amountUsdcMinor or amountPhpMinor');
    }
    const fee = feeFor(gross);
    if (fee >= gross) throw new MockPartnerError('amount does not cover the partner fee');
    const netPhp = phpFor(gross);
    const rail = railFor(netPhp);
    return {
      partnerId: entry.id,
      network,
      pair: 'USD/PHP',
      rate: rateStr,
      reference: MOCK_RATE_REFERENCE,
      capturedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
      feeBps,
      feeFixedUsdcMinor: feeFixed,
      grossUsdcMinor: gross,
      feeUsdcMinor: fee,
      netPhpMinor: netPhp,
      rail,
      payoutEtaSec: ETA[rail].sec,
      arrival: ETA[rail].arrival,
      mock: true,
    };
  }

  function payoutIdFor(paymentId: string): string {
    return `mockpo_${bytesToHex(hmac(sha256, secret, utf8ToBytes(`payout:${paymentId}`))).slice(0, 20)}`;
  }

  function createPayout(req: CreatePayoutRequest): PartnerPayout {
    if (!req.paymentId) throw new MockPartnerError('paymentId required');
    if (req.amountPhpMinor <= 0n || req.expectedUsdcMinor <= 0n) throw new MockPartnerError('amounts must be positive');
    if (!/^\d{4}$/.test(req.beneficiary.accountLast4)) throw new MockPartnerError('accountLast4 must be 4 digits');
    const payoutId = payoutIdFor(req.paymentId);
    const existing = payouts.get(payoutId);
    if (existing) {
      // Idempotent on paymentId; a different amount under the same id is a bug upstream.
      if (existing.amountPhpMinor !== req.amountPhpMinor || existing.expectedUsdcMinor !== req.expectedUsdcMinor) {
        throw new MockPartnerError('payment already has a payout with different amounts');
      }
      return { ...existing, deposits: existing.deposits.map((d) => ({ ...d })) };
    }
    const deposits: PartnerDepositAddress[] = entry.acceptedTargets.map((t) => ({
      network: t.network,
      token: 'USDC',
      address: deriveMockDepositAddress(seed, t.network, req.paymentId),
    }));
    const payout: PartnerPayout = {
      payoutId,
      paymentId: req.paymentId,
      partnerId: entry.id,
      amountPhpMinor: req.amountPhpMinor,
      expectedUsdcMinor: req.expectedUsdcMinor,
      rail: railFor(req.amountPhpMinor),
      beneficiary: { bank: req.beneficiary.bank, accountLast4: req.beneficiary.accountLast4 },
      deposits,
      status: 'AWAITING_DEPOSIT',
      createdAt: (req.now ?? new Date()).toISOString(),
    };
    payouts.set(payoutId, payout);
    return { ...payout, deposits: deposits.map((d) => ({ ...d })) };
  }

  function bankReference(payout: PartnerPayout, at: Date): string {
    const day = at.toISOString().slice(0, 10).replace(/-/g, '');
    const tag = bytesToHex(hmac(sha256, secret, utf8ToBytes(`bankref:${payout.payoutId}`))).slice(0, 8).toUpperCase();
    return `MOCK-${payout.rail.toUpperCase()}-${day}-${tag}`;
  }

  function simulateDeposit(deposit: SimulatedDeposit): PartnerPayoutEvent[] {
    const payout = payouts.get(deposit.payoutId);
    if (!payout) throw new MockPartnerError('unknown payout');
    if (payout.status !== 'AWAITING_DEPOSIT') throw new MockPartnerError(`payout is already ${payout.status}`);
    const target = payout.deposits.find((d) => d.network === deposit.network);
    if (!target || target.address !== deposit.address) throw new MockPartnerError('deposit did not reach this payout’s address');
    const now = deposit.now ?? new Date();
    const base = { partnerId: entry.id, paymentId: payout.paymentId, amountPhpMinor: payout.amountPhpMinor };
    if (deposit.amountUsdcMinor < payout.expectedUsdcMinor) {
      payout.status = 'RETURNED';
      return [signWebhook({ ...base, status: 'returned', at: now.toISOString() }, secret)];
    }
    payout.status = 'RECEIVED';
    const received = signWebhook({ ...base, status: 'received', at: now.toISOString() }, secret);
    const paidAt = new Date(now.getTime() + 1000);
    payout.status = 'PAID';
    const paid = signWebhook({ ...base, status: 'paid', bankReference: bankReference(payout, paidAt), at: paidAt.toISOString() }, secret);
    return [received, paid];
  }

  return {
    entry,
    quote,
    createPayout,
    getPayout: (id) => {
      const p = payouts.get(id);
      return p ? { ...p, deposits: p.deposits.map((d) => ({ ...d })) } : undefined;
    },
    simulateDeposit,
    verifyWebhook: (event, opts = {}) => verifyWebhookSignature(event, secret, { expectedPartnerId: entry.id, ...opts }),
  };
}
