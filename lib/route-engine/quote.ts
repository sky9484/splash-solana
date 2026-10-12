/**
 * Candidate routes for the Solana lane, normalised to `RouteQuote`.
 *
 * Sources: the business's USDC balance on Solana (the only lane here).
 * Targets: whatever the partner registry entry accepts.
 *   solana  → (a) direct SPL transfer to the partner's one-payment deposit address
 *   polygon → (b) CCTP V2 burn on Solana, `mintRecipient` = the partner's
 *                 Polygon deposit address: Standard (Circle fee 0) and, when a
 *                 fee is passed in, Fast Transfer (flag `fast_transfer`)
 *
 * The engine never invents a price: the partner's quote supplies rate, fee
 * and PHP received; the route costs come from `EngineAssumptions`, whose
 * defaults are estimates (marked below) to be replaced by measured values.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import type { DeliveryNetwork, Policy, RouteFlag, RouteQuote, RouteStep } from '../solana/types.ts';
import type { PartnerQuote, PartnerRegistryEntry } from '../solana-partner/registry.ts';
import { partnerAccepts } from '../solana-partner/registry.ts';
import { canonicalJson } from '../solana-evidence/canonical.ts';
import { allInBps, centiBpsFee, computeSplashFee, grossUpForFee, toCentiBps, type SplashFeeResult } from './fees.ts';

/** Quotes never live longer than this, whatever the partner says. */
export const MAX_QUOTE_TTL_SEC = 60;

export type RouteKind = 'solana_direct' | 'cctp_v2_standard' | 'cctp_v2_fast';
export const ROUTE_KIND_ORDER: readonly RouteKind[] = ['solana_direct', 'cctp_v2_standard', 'cctp_v2_fast'];

export interface EngineAssumptions {
  /** USDC charged to the business for a Solana transfer. 0: Kora pays the network fee ("you don't need SOL"). */
  solanaTransferFeeMinor: bigint;
  /** ESTIMATE, not a finality claim. */
  solanaTransferEtaSec: number;
  /** Circle's Standard Transfer fee is 0. */
  cctpStandardFeeMinor: bigint;
  /** ESTIMATE: burn → attestation → mint on Polygon. */
  cctpStandardEtaSec: number;
  /** ESTIMATE. */
  cctpFastEtaSec: number;
  /** Cost of relaying `receiveMessage` on Polygon, deducted from the mint. UNMEASURED: 0 until a relayer is chosen. */
  polygonMintRelayFeeMinor: bigint;
}

export const DEFAULT_ASSUMPTIONS: Readonly<EngineAssumptions> = Object.freeze({
  solanaTransferFeeMinor: 0n,
  solanaTransferEtaSec: 5,
  cctpStandardFeeMinor: 0n,
  cctpStandardEtaSec: 60,
  cctpFastEtaSec: 20,
  polygonMintRelayFeeMinor: 0n,
});

export type PaymentAmount = { amountPhpMinor: bigint; amountUsdcMinor?: never } | { amountUsdcMinor: bigint; amountPhpMinor?: never };

export interface EngineInput {
  paymentId: string;
  /** PHP the supplier must receive, or USDC to deliver to the partner. */
  amount: PaymentAmount;
  senderBalanceUsdcMinor: bigint;
  partner: PartnerRegistryEntry;
  /** One per delivery network, priced for this payment's size. */
  partnerQuotes: PartnerQuote[];
  /** The partner's one-payment deposit addresses for this payment. */
  deposits: Partial<Record<DeliveryNetwork, string>>;
  /** CCTP V2 Fast Transfer fee in bps (≤ 2 decimals). Omitted → no Fast candidate. */
  fastTransferFeeBps?: number | string;
  assumptions?: Partial<EngineAssumptions>;
  now?: Date;
  /** ENGINE_HOME_CHAIN, passed in by the server layer. Default 'solana'. */
  homeChain?: string;
  /** The business tapped "strictly cheapest": the home-lane rule is off for Cheapest. */
  strictlyCheapest?: boolean;
  /** Policies the home-lane rule applies to. Default Cheapest and Safest (see rank.ts). */
  homeLanePolicies?: readonly Policy[];
}

export interface Exclusion {
  kind: RouteKind;
  policy?: Policy;
  reason:
    | 'network_not_accepted'
    | 'no_partner_quote'
    | 'no_deposit_address'
    | 'bad_deposit_address'
    | 'partner_quote_expired'
    | 'partner_quote_short'
    | 'fast_transfer_fee_unknown'
    | 'insufficient_balance';
  detail?: string;
  /** insufficient_balance: what this route needs from the vault, in USDC minor units. */
  neededMinor?: bigint;
}

/** A route before the Splash fee, which depends on policy. */
export interface BaseCandidate {
  kind: RouteKind;
  network: DeliveryNetwork;
  depositAddress: string;
  partnerQuote: PartnerQuote;
  /** What leaves the vault toward the route (transfer amount or burn amount), before the Splash fee. */
  routeAmountMinor: bigint;
  routeMinor: bigint;
  steps: RouteStep[];
  etaSec: number;
  flags: RouteFlag[];
  expiresAt: Date;
}

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function validDeposit(network: DeliveryNetwork, address: string): boolean {
  return network === 'solana' ? SOLANA_ADDRESS.test(address) : EVM_ADDRESS.test(address);
}

export function resolveAssumptions(partial?: Partial<EngineAssumptions>): EngineAssumptions {
  return { ...DEFAULT_ASSUMPTIONS, ...(partial ?? {}) };
}

export function buildBaseCandidates(input: EngineInput, now: Date): { candidates: BaseCandidate[]; excluded: Exclusion[] } {
  const a = resolveAssumptions(input.assumptions);
  const candidates: BaseCandidate[] = [];
  const excluded: Exclusion[] = [];
  const kindsFor: Record<DeliveryNetwork, RouteKind[]> = { solana: ['solana_direct'], polygon: ['cctp_v2_standard', 'cctp_v2_fast'] };

  for (const network of ['solana', 'polygon'] as DeliveryNetwork[]) {
    const kinds = kindsFor[network];
    const skip = (reason: Exclusion['reason'], detail?: string) => kinds.forEach((kind) => excluded.push({ kind, reason, detail }));
    if (!partnerAccepts(input.partner, network)) {
      skip('network_not_accepted');
      continue;
    }
    const pq = input.partnerQuotes.find((q) => q.network === network && q.partnerId === input.partner.id);
    if (!pq) {
      skip('no_partner_quote');
      continue;
    }
    const expires = Date.parse(pq.expiresAt);
    if (!Number.isFinite(expires) || expires <= now.getTime()) {
      skip('partner_quote_expired', pq.expiresAt);
      continue;
    }
    if (pq.feeUsdcMinor < 0n || pq.feeUsdcMinor >= pq.grossUsdcMinor || pq.netPhpMinor <= 0n) {
      skip('partner_quote_short', 'partner quote is not internally consistent');
      continue;
    }
    if (input.amount.amountPhpMinor !== undefined && pq.netPhpMinor < input.amount.amountPhpMinor) {
      skip('partner_quote_short', `quote pays ${pq.netPhpMinor} centavos, invoice needs ${input.amount.amountPhpMinor}`);
      continue;
    }
    if (input.amount.amountUsdcMinor !== undefined && pq.grossUsdcMinor !== input.amount.amountUsdcMinor) {
      skip('partner_quote_short', 'partner quote was priced for a different USDC amount');
      continue;
    }
    const deposit = input.deposits[network];
    if (!deposit) {
      skip('no_deposit_address');
      continue;
    }
    if (!validDeposit(network, deposit)) {
      skip('bad_deposit_address', deposit);
      continue;
    }

    const expiresAt = new Date(Math.min(expires, now.getTime() + MAX_QUOTE_TTL_SEC * 1000));
    const partnerStep: RouteStep = { kind: 'partner', provider: `${pq.partnerId} · ${pq.rail}`, feeMinor: pq.feeUsdcMinor, etaSec: pq.payoutEtaSec };
    const gross = pq.grossUsdcMinor;
    const baseFlags: RouteFlag[] = input.partner.sandbox || pq.mock ? ['mock_partner'] : [];

    for (const kind of kinds) {
      if (kind === 'solana_direct') {
        const fee = a.solanaTransferFeeMinor;
        candidates.push({
          kind,
          network,
          depositAddress: deposit,
          partnerQuote: pq,
          routeAmountMinor: gross + fee,
          routeMinor: fee,
          steps: [{ kind: 'transfer', provider: 'solana · spl-token transfer', feeMinor: fee, etaSec: a.solanaTransferEtaSec }, partnerStep],
          etaSec: a.solanaTransferEtaSec + pq.payoutEtaSec,
          flags: [...baseFlags],
          expiresAt,
        });
        continue;
      }
      let burn: bigint;
      let eta: number;
      let flags: RouteFlag[];
      if (kind === 'cctp_v2_standard') {
        burn = gross + a.polygonMintRelayFeeMinor + a.cctpStandardFeeMinor;
        eta = a.cctpStandardEtaSec;
        flags = [...baseFlags, 'cctp_v2'];
      } else {
        if (input.fastTransferFeeBps === undefined) {
          excluded.push({ kind, reason: 'fast_transfer_fee_unknown' });
          continue;
        }
        const cbps = toCentiBps(input.fastTransferFeeBps);
        burn = grossUpForFee(gross, cbps, a.polygonMintRelayFeeMinor);
        // sanity: what mints covers the partner's gross
        if (burn - centiBpsFee(burn, cbps) - a.polygonMintRelayFeeMinor < gross) throw new Error('fast transfer gross-up failed');
        eta = a.cctpFastEtaSec;
        flags = [...baseFlags, 'cctp_v2', 'fast_transfer'];
      }
      const routeMinor = burn - gross;
      candidates.push({
        kind,
        network,
        depositAddress: deposit,
        partnerQuote: pq,
        routeAmountMinor: burn,
        routeMinor,
        steps: [{ kind: 'bridge', provider: kind === 'cctp_v2_fast' ? 'cctp-v2 · fast transfer' : 'cctp-v2 · standard', feeMinor: routeMinor, etaSec: eta }, partnerStep],
        etaSec: eta + pq.payoutEtaSec,
        flags,
        expiresAt,
      });
    }
  }
  return { candidates, excluded };
}

export interface PricedQuote {
  quote: RouteQuote;
  kind: RouteKind;
  fee: SplashFeeResult;
  /** USDC value of the payout (partner gross − partner fee): the base of every %. */
  ticketUsdcMinor: bigint;
}

export function priceCandidate(c: BaseCandidate, policy: Policy, paymentId: string): PricedQuote {
  const pq = c.partnerQuote;
  const ticket = pq.grossUsdcMinor - pq.feeUsdcMinor;
  const fee = computeSplashFee({ policy, ticketUsdcMinor: ticket, routeMinor: c.routeMinor, partnerMinor: pq.feeUsdcMinor });
  const flags = [...c.flags];
  if (fee.aboveTarget) flags.push('above_target');
  const sourceAmount = c.routeAmountMinor + fee.splashMinor;
  const core = {
    paymentId,
    kind: c.kind,
    policy,
    sourceAmount,
    net: pq.netPhpMinor,
    deposit: c.depositAddress,
    rate: pq.rate,
    capturedAt: pq.capturedAt,
    expiresAt: c.expiresAt.toISOString(),
  };
  const id = `rq_${c.kind}_${policy}_${bytesToHex(sha256(utf8ToBytes(canonicalJson(core)))).slice(0, 12)}`;
  const quote: RouteQuote = {
    id,
    policy,
    source: { lane: 'solana', token: 'USDC', amountMinor: sourceAmount },
    target: { network: c.network, token: 'USDC', partnerId: pq.partnerId, depositAddress: c.depositAddress },
    steps: c.steps.map((s) => ({ ...s })),
    costs: { routeMinor: c.routeMinor, partnerMinor: pq.feeUsdcMinor, splashMinor: fee.splashMinor, allInBps: allInBps(fee.allInMinor, ticket) },
    fx: { pair: 'USD/PHP', rate: pq.rate, reference: pq.reference, capturedAt: pq.capturedAt },
    netLocal: { currency: 'PHP', amountMinor: pq.netPhpMinor },
    etaSec: c.etaSec,
    expiresAt: c.expiresAt.toISOString(),
    flags,
  };
  return { quote, kind: c.kind, fee, ticketUsdcMinor: ticket };
}

/** A quote is usable only strictly before `expiresAt`. */
export function isQuoteExpired(quote: Pick<RouteQuote, 'expiresAt'>, now: Date = new Date()): boolean {
  const t = Date.parse(quote.expiresAt);
  return !Number.isFinite(t) || now.getTime() >= t;
}

export function routeKindOf(quote: RouteQuote): RouteKind {
  if (quote.target.network === 'solana') return 'solana_direct';
  return quote.flags.includes('fast_transfer') ? 'cctp_v2_fast' : 'cctp_v2_standard';
}
