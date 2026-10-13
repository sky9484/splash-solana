import { applyBps, formatMinor, MICRO_DECIMALS, parseMinor, sumMinor } from '../money.ts';
import type { KybLifecycleState } from '../compliance/kyb-state.ts';
import { explorerCluster, solanaTxUrl, type ExplorerCluster } from '../explorer.ts';

/**
 * The stablecoin lane — what a business may send before, and after, it is
 * verified.
 *
 * ─── The asset ──────────────────────────────────────────────────────────────
 * Settlement is native Circle USDC on Solana (the classic SPL Token mint in
 * lib/solana/config.ts), and only that. Businesses may FUND from USDC on other
 * chains through Circle's CCTP V2 (lib/solana/cctp-v2-solana.ts), but what moves here is
 * native USDC. Settling in a bridge wrapper would add a bridge's failure modes
 * to every payment for no gain.
 *
 * ─── Who may use it ─────────────────────────────────────────────────────────
 * A business still in onboarding (REGISTERED through KYB_ADMIN_APPROVED) may
 * send USDC to wallet recipients it has saved, up to a cap. USD in and
 * local-currency payouts stay locked until verification completes, because
 * those rails move value through regulated partners on the business's behalf.
 *
 * A business that was REJECTED or SUSPENDED gets nothing here. A suspension is
 * a compliance action; an "unverified allowance" that survived it would be the
 * first thing a suspended actor reached for.
 *
 * ─── Who signs ──────────────────────────────────────────────────────────────
 * The money sits in the business's own Squads vault, which no Splash key can
 * move (configAuthority is null, I-1). A person approves each transfer with
 * their device key, and the principal goes vault to wallet in one
 * transaction — it never passes through an address Splash controls. Splash
 * quotes, reserves allowance, pays the network fee through Kora, and records
 * what the vault did. (Whether that is enough for a given jurisdiction is
 * counsel's call, not this comment's — it describes the mechanism, not a
 * regulatory status.)
 */

// ─── The asset ──────────────────────────────────────────────────────────────

/** The cluster the lane settles on: SOLANA_CLUSTER, devnet unless told otherwise. */
export function stablecoinCluster(env: NodeJS.ProcessEnv = process.env): ExplorerCluster {
  return explorerCluster(env);
}

export const USDC_DECIMALS = MICRO_DECIMALS;

/** Where a person can look a transaction up themselves (lib/explorer.ts). */
export function explorerTxUrl(signature: string): string {
  return solanaTxUrl(signature);
}

// ─── Price ──────────────────────────────────────────────────────────────────

/**
 * Stablecoin transfers are free (decision of 2026-09-26).
 *
 *   To a Splash user's wallet    free, always: it never leaves Splash.
 *   To a wallet outside Splash   the audit-anchor fee — 0.02% with a 0.05 USDC
 *                                floor and a 5 USDC cap — pays for the record
 *                                Splash anchors for the transfer. Built, but
 *                                OFF until STABLECOIN_ANCHOR_FEE=on, so today
 *                                it is free too and the screens say so.
 *   x402                         no Splash fee (the seller sets the price).
 *
 * Network gas is separate, and on a wallet transfer there is none: see Gas
 * below. Local-currency payouts are priced elsewhere (lib/fx/corridors.ts,
 * 0.70%).
 *
 * A fee, when there is one, is charged ON TOP: the recipient receives exactly
 * the amount the business entered, and the business's wallet is debited
 * amount + fee. An invoice states what the payee must receive, and an x402
 * seller verifies it received exactly `amount` — a fee deducted from the
 * principal would break both. Rounded half-up, the house convention.
 */
export const ANCHOR_FEE_BPS = 2;
/** 0.05 USDC: covers the anchor's own cost on small transfers. */
export const ANCHOR_FEE_MIN_MINOR = 50_000n;
/** 5 USDC: keeps large treasury moves cheap. */
export const ANCHOR_FEE_CAP_MINOR = 5_000_000n;

/** Where the USDC goes: to a Splash user's wallet, or out of Splash. */
export type StablecoinDestination = 'SPLASH' | 'EXTERNAL';

export type StablecoinFeeKind = 'FREE' | 'AUDIT_ANCHOR';

/** The audit-anchor fee is charged only when switched on. Off by default. */
export function anchorFeeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.STABLECOIN_ANCHOR_FEE ?? '').trim().toLowerCase() === 'on';
}

export function stablecoinFeeMinor(
  principalMinor: bigint,
  destination: StablecoinDestination,
  anchorFeeOn: boolean,
): bigint {
  if (principalMinor <= 0n) throw new StablecoinLaneError('amount must be positive');
  if (destination === 'SPLASH' || !anchorFeeOn) return 0n;
  const proportional = applyBps(principalMinor, ANCHOR_FEE_BPS, 'half-up');
  if (proportional < ANCHOR_FEE_MIN_MINOR) return ANCHOR_FEE_MIN_MINOR;
  if (proportional > ANCHOR_FEE_CAP_MINOR) return ANCHOR_FEE_CAP_MINOR;
  return proportional;
}

/** Below this a wallet transfer is refused: 1.00 USDC. It keeps test-sized
 *  sends and typos off the ledger. x402 is exempt — the seller sets the
 *  price, and cents are the point of it. */
export const MIN_STABLECOIN_TRANSFER_MINOR = 1_000_000n;

// ─── Network fee ────────────────────────────────────────────────────────────

/**
 * The business needs no SOL. Splash's fee payer (Kora, lib/solana/kora.ts)
 * signs as fee payer for the vault's transactions and covers the network fee
 * and rent; the plan fee recovers it. The vault itself only ever holds and
 * moves USDC.
 */
export const NETWORK_FEE_LINE = "You don't need SOL: Splash's fee payer covers the network fee.";

export interface StablecoinQuote {
  principalMinor: bigint;
  feeMinor: bigint;
  totalDebitMinor: bigint;
  feeKind: StablecoinFeeKind;
  destination: StablecoinDestination;
}

export function quoteStablecoinTransfer(
  principalMinor: bigint,
  pricing: { destination: StablecoinDestination; anchorFeeOn: boolean },
): StablecoinQuote {
  if (principalMinor < MIN_STABLECOIN_TRANSFER_MINOR) {
    throw new StablecoinLaneError(
      `the minimum wallet transfer is ${formatMinor(MIN_STABLECOIN_TRANSFER_MINOR, USDC_DECIMALS)} USDC`,
    );
  }
  const feeMinor = stablecoinFeeMinor(principalMinor, pricing.destination, pricing.anchorFeeOn);
  return {
    principalMinor,
    feeMinor,
    totalDebitMinor: principalMinor + feeMinor,
    feeKind: feeMinor > 0n ? 'AUDIT_ANCHOR' : 'FREE',
    destination: pricing.destination,
  };
}

/** How a quote's fee reads to the person paying. */
export function describeStablecoinFee(quote: Pick<StablecoinQuote, 'feeMinor' | 'destination'>): string {
  if (quote.feeMinor === 0n) {
    return quote.destination === 'SPLASH' ? 'Free: to another Splash user' : 'Free';
  }
  return `Audit-anchor fee ${formatUsdc(quote.feeMinor)} USDC (0.02%, min 0.05, max 5)`;
}

// ─── Limits ─────────────────────────────────────────────────────────────────

/** 5,000 USDC for a business still in onboarding. */
export const UNVERIFIED_STABLECOIN_CAP_MINOR = 5_000_000_000n;

/**
 * A ROLLING 30-day window, not a calendar month. A calendar month resets on
 * the 1st, so an unverified business could send 5,000 on the 31st and 5,000 on
 * the 1st — 10,000 in two days against a "5,000 a month" rule.
 */
export const STABLECOIN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** A verified business on the stablecoin lane: 20,000 per transfer, 500,000
 *  over the window — the Tier 3 limits the earlier build enforced, kept as
 *  Splash policy. */
export const VERIFIED_PER_TRANSFER_MINOR = 20_000_000_000n;
export const VERIFIED_WINDOW_CAP_MINOR = 500_000_000_000n;

export interface StablecoinLimits {
  perTransferMinor: bigint;
  windowCapMinor: bigint;
  windowMs: number;
}

// ─── Who may use which lane ─────────────────────────────────────────────────

export type Lane =
  | 'FIAT_IN_USD'
  | 'FIAT_OUT_LOCAL'
  | 'STABLECOIN_WALLET'
  | 'X402'
  | 'TREASURY';

export interface LaneAccess {
  allowed: boolean;
  reason: string;
}

const ONBOARDING_STATES: ReadonlySet<KybLifecycleState> = new Set([
  'REGISTERED',
  'KYB_SUBMITTED',
  'KYB_PROVIDER_APPROVED',
  'KYB_ADMIN_APPROVED',
]);

export const FIAT_LOCKED_REASON =
  'USD in and local-currency payouts unlock when your business is verified. Until then you can send USDC to a wallet recipient you have saved — up to 5,000 USDC in any 30 days.';

export function isOnboarding(state: KybLifecycleState): boolean {
  return ONBOARDING_STATES.has(state);
}

export function laneAccess(state: KybLifecycleState, lane: Lane): LaneAccess {
  if (state === 'SUSPENDED') {
    return { allowed: false, reason: 'This workspace is suspended. No money can move until support restores it.' };
  }
  if (state === 'REJECTED') {
    return { allowed: false, reason: 'Verification was declined. Re-submit KYB to continue — no lane is open until then.' };
  }
  if (state === 'ACTIVE') return { allowed: true, reason: '' };

  // Onboarding.
  switch (lane) {
    case 'STABLECOIN_WALLET':
    case 'X402':
      return { allowed: true, reason: '' };
    case 'FIAT_IN_USD':
    case 'FIAT_OUT_LOCAL':
      return { allowed: false, reason: FIAT_LOCKED_REASON };
    case 'TREASURY':
      return {
        allowed: false,
        reason: 'Treasury is for verified businesses. Finish verification in Account setup to open it.',
      };
  }
}

/**
 * The local currency an invoice payout would be made in, or null for a USDC
 * payout: the question the FIAT_OUT_LOCAL lane answers. Both the record's
 * currency and the one read off the document count: an invoice re-typed as
 * USDC that still says PHP on its face is still a PHP invoice. A currency the
 * reader could not find is not a reading. `parseInvoice` returns '' for it,
 * and then the record alone decides. It used to return an invented 'USD',
 * which this would have treated as a USD payout.
 *
 * Invoice records are three-letter currencies today (/api/invoices), so a
 * USDC record cannot be created there yet; the USDC cases pin the rule for
 * when one can.
 */
export function invoiceLocalCurrency(
  recordCurrency: string | null | undefined,
  readCurrency: string | null | undefined,
): string | null {
  return (
    [recordCurrency, readCurrency]
      .map((currency) => String(currency ?? '').trim().toUpperCase())
      .find((currency) => currency && currency !== 'USDC') ?? null
  );
}

export function stablecoinLimitsFor(state: KybLifecycleState): StablecoinLimits | null {
  if (state === 'ACTIVE') {
    return {
      perTransferMinor: VERIFIED_PER_TRANSFER_MINOR,
      windowCapMinor: VERIFIED_WINDOW_CAP_MINOR,
      windowMs: STABLECOIN_WINDOW_MS,
    };
  }
  if (isOnboarding(state)) {
    return {
      perTransferMinor: UNVERIFIED_STABLECOIN_CAP_MINOR,
      windowCapMinor: UNVERIFIED_STABLECOIN_CAP_MINOR,
      windowMs: STABLECOIN_WINDOW_MS,
    };
  }
  return null; // REJECTED, SUSPENDED
}

// ─── The allowance ──────────────────────────────────────────────────────────

/** One prior outflow as the window sees it. Transfers AND x402 payments — the
 *  cap is shared. Only the principal counts: the fee is Splash's price, not
 *  value sent to a third party. */
export interface PriorOutflow {
  principalMinor: bigint;
  atMs: number;
}

export interface AllowanceCheck {
  ok: boolean;
  usedMinor: bigint;
  remainingMinor: bigint;
  windowCapMinor: bigint;
  reason: string;
}

export function checkStablecoinAllowance(input: {
  state: KybLifecycleState;
  principalMinor: bigint;
  prior: PriorOutflow[];
  nowMs: number;
}): AllowanceCheck {
  const limits = stablecoinLimitsFor(input.state);
  if (!limits) {
    return {
      ok: false,
      usedMinor: 0n,
      remainingMinor: 0n,
      windowCapMinor: 0n,
      reason: laneAccess(input.state, 'STABLECOIN_WALLET').reason,
    };
  }
  if (input.principalMinor <= 0n) throw new StablecoinLaneError('amount must be positive');

  const windowStart = input.nowMs - limits.windowMs;
  const usedMinor = sumMinor(input.prior.filter((o) => o.atMs > windowStart).map((o) => o.principalMinor));
  const remainingMinor = usedMinor >= limits.windowCapMinor ? 0n : limits.windowCapMinor - usedMinor;

  const fmt = (m: bigint) => `${formatMinor(m, USDC_DECIMALS)} USDC`;
  if (input.principalMinor > limits.perTransferMinor) {
    return {
      ok: false,
      usedMinor,
      remainingMinor,
      windowCapMinor: limits.windowCapMinor,
      reason: `A single transfer can be at most ${fmt(limits.perTransferMinor)} at your verification level.`,
    };
  }
  if (input.principalMinor > remainingMinor) {
    return {
      ok: false,
      usedMinor,
      remainingMinor,
      windowCapMinor: limits.windowCapMinor,
      reason: isOnboarding(input.state)
        ? `Unverified businesses can send up to ${fmt(limits.windowCapMinor)} in any 30 days. You have ${fmt(remainingMinor)} left. Finish verification to lift the limit.`
        : `This would exceed your 30-day limit of ${fmt(limits.windowCapMinor)}. You have ${fmt(remainingMinor)} left.`,
    };
  }
  return { ok: true, usedMinor, remainingMinor, windowCapMinor: limits.windowCapMinor, reason: '' };
}

// ─── Recipient wallets ──────────────────────────────────────────────────────

/** The wallets Splash names when it asks for a recipient's Solana address. */
export const WALLET_PROVIDERS = ['PHANTOM', 'SOLFLARE', 'BACKPACK', 'OTHER'] as const;
export type WalletProvider = (typeof WALLET_PROVIDERS)[number];

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX_32 = /^0x[0-9a-fA-F]{64}$/;
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Base58 → bytes, or null. Leading '1's are leading zero bytes. */
function base58Bytes(text: string): Uint8Array | null {
  if (!BASE58.test(text)) return null;
  let value = 0n;
  for (const char of text) value = value * 58n + BigInt(ALPHABET.indexOf(char));
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  for (const char of text) {
    if (char !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/**
 * Validate a recipient's Solana address (base58, 32 bytes), and refuse —
 * never "fix" — an address from another chain. An Ethereum address or a
 * 32-byte hex address is the likeliest paste error: USDC sent to an address
 * nobody on Solana holds is gone. Base58 is case-sensitive, so the address is
 * kept exactly as typed (only trimmed). Program-derived addresses are
 * allowed: a Squads vault is one.
 */
export function normaliseSolanaAddress(input: string): string {
  const raw = input.trim();
  if (EVM_ADDRESS.test(raw)) {
    throw new StablecoinLaneError(
      'That is an Ethereum address. Splash settles in USDC on Solana — ask your recipient for their Solana address (from Phantom, Solflare or Backpack).',
    );
  }
  if (HEX_32.test(raw)) {
    throw new StablecoinLaneError('That address is from another network. A Solana address is 32 to 44 letters and digits, with no 0x.');
  }
  const bytes = base58Bytes(raw);
  if (!bytes || bytes.length !== 32) {
    throw new StablecoinLaneError('A Solana address is 32 to 44 letters and digits (base58), with no 0x.');
  }
  if (bytes.every((b) => b === 0)) throw new StablecoinLaneError('The system address cannot receive a payment.');
  return raw;
}

// ─── Display ────────────────────────────────────────────────────────────────

/** 1_250_500_000n → "1,250.50"; 1_234_567n → "1.234567". Exact: at least two
 *  decimals, never rounded, trailing zeros past the cents dropped. */
export function formatUsdc(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = (abs / 1_000_000n).toLocaleString('en-US');
  let frac = (abs % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  if (frac.length < 2) frac = frac.padEnd(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

/** 9fZ3…kQ7p — enough to confirm, not to copy. */
export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

// ─── Parsing ────────────────────────────────────────────────────────────────

/** "1250.5" USDC → 1_250_500_000n. More than six decimals is refused, not rounded. */
export function parseUsdcMinor(input: string): bigint {
  return parseMinor(input, USDC_DECIMALS);
}

export class StablecoinLaneError extends Error {}
