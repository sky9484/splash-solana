/**
 * Payout partner registry and the interface every partner adapter implements.
 *
 * The engine reads delivery networks from here, never from env. The only
 * entry in this build is the labelled mock; a real sandbox adapter implements
 * `PayoutPartner` and is added beside it with `signed: false` until a
 * contract exists.
 */
import type { DeliveryNetwork, PartnerPayoutEvent } from '../solana/types.ts';

export type PayoutRail = 'PESONet' | 'InstaPay';

export interface PartnerRegistryEntry {
  id: string;
  /** Display name. The UI shows this, never a company name, for the mock. */
  name: string;
  /** true only once a partner agreement is signed. */
  signed: boolean;
  /** true for sandbox / devnet partners; the engine flags their quotes `mock_partner`. */
  sandbox: boolean;
  acceptedTargets: ReadonlyArray<{ network: DeliveryNetwork; token: 'USDC' }>;
  rails: ReadonlyArray<PayoutRail>;
}

/**
 * A partner's price for one payout size on one delivery network.
 *
 * Amounts are for the size requested: `grossUsdcMinor` is what must arrive at
 * the deposit address, `feeUsdcMinor` is what the partner keeps out of it, and
 * `netPhpMinor` is what the supplier's bank account receives.
 */
export interface PartnerQuote {
  partnerId: string;
  network: DeliveryNetwork;
  pair: 'USD/PHP';
  /** PHP per 1 USDC, decimal string. */
  rate: string;
  /** Where the rate came from. The mock says 'MOCK · not a live rate'. */
  reference: string;
  capturedAt: string;
  expiresAt: string;
  feeBps: number;
  feeFixedUsdcMinor: bigint;
  grossUsdcMinor: bigint;
  feeUsdcMinor: bigint;
  netPhpMinor: bigint;
  rail: PayoutRail;
  /** Partner side: deposit seen → bank credited. An estimate, not a finality claim. */
  payoutEtaSec: number;
  /** Plain words for the UI, e.g. 'same banking day'. */
  arrival: string;
  mock: boolean;
}

export type PartnerQuoteRequest = ({ amountUsdcMinor: bigint; amountPhpMinor?: never } | { amountPhpMinor: bigint; amountUsdcMinor?: never }) & {
  /** The recipient's bank, by the partner's code: a bank that takes one rail only is paid by it (banks.ts). */
  bankCode?: string | null;
};

export interface PartnerDepositAddress {
  network: DeliveryNetwork;
  token: 'USDC';
  /** One-payment address: Solana base58 owner, or EIP-55 0x address on Polygon. */
  address: string;
}

export type PartnerPayoutStatus = 'AWAITING_DEPOSIT' | 'RECEIVED' | 'PAID' | 'RETURNED';

export interface PartnerPayout {
  payoutId: string;
  paymentId: string;
  partnerId: string;
  amountPhpMinor: bigint;
  /** What must arrive (USDC minor) for the payout to be made in full. */
  expectedUsdcMinor: bigint;
  /** 'Splash': a payment into another business's Splash account, with no partner (prompt 10 §5.1). */
  rail: PayoutRail | 'Splash';
  beneficiary: { bank: string; accountLast4: string };
  deposits: PartnerDepositAddress[];
  status: PartnerPayoutStatus;
  createdAt: string;
}

export interface CreatePayoutRequest {
  paymentId: string;
  amountPhpMinor: bigint;
  expectedUsdcMinor: bigint;
  /**
   * `accountNumber`: the full number, read from the vault just for this request when the recipient has
   * one (prompt 10 Phase S). A partner uses it to pay; it never comes back in the payout record.
   */
  beneficiary: { bank: string; accountLast4: string; accountNumber?: string };
  now?: Date;
}

export type WebhookVerification = { ok: true } | { ok: false; reason: string };

export interface PayoutPartner {
  readonly entry: PartnerRegistryEntry;
  quote(req: PartnerQuoteRequest, opts?: { network?: DeliveryNetwork; now?: Date }): PartnerQuote;
  createPayout(req: CreatePayoutRequest): PartnerPayout;
  verifyWebhook(event: PartnerPayoutEvent, opts?: { now?: Date; maxAgeSec?: number }): WebhookVerification;
}

export const MOCK_PARTNER_ENTRY: PartnerRegistryEntry = Object.freeze({
  id: 'mock-partner',
  name: 'Test payout partner',
  signed: false,
  sandbox: true,
  acceptedTargets: Object.freeze([
    Object.freeze({ network: 'solana' as const, token: 'USDC' as const }),
    Object.freeze({ network: 'polygon' as const, token: 'USDC' as const }),
  ]),
  rails: Object.freeze(['PESONet', 'InstaPay'] as PayoutRail[]),
});

export const PARTNER_REGISTRY: ReadonlyArray<PartnerRegistryEntry> = Object.freeze([MOCK_PARTNER_ENTRY]);

/**
 * Where a company can pay, and what is next (prompt 10 §4.2): read by the rate strip and Overview's
 * "Where you can pay". Malaysia → Philippines is open, in test mode until a partner is signed and
 * live; Indonesia is next and Vietnam later. No new corridor opens without a partner behind it.
 */
export interface Corridor {
  route: string;
  /** The currency pair the rate strip shows. */
  pair: string;
  status: 'test' | 'live' | 'next' | 'later';
  detail: string;
}

export const CORRIDORS: ReadonlyArray<Corridor> = Object.freeze([
  Object.freeze({ route: 'Malaysia → Philippines', pair: 'USD → PHP', status: (MOCK_PARTNER_ENTRY.signed && !MOCK_PARTNER_ENTRY.sandbox ? 'live' : 'test') as Corridor['status'], detail: 'Any bank by InstaPay or PESONet' }),
  Object.freeze({ route: 'Malaysia → Indonesia', pair: 'USD → IDR', status: 'next' as const, detail: 'Bank payouts' }),
  Object.freeze({ route: 'Malaysia → Vietnam', pair: 'USD → VND', status: 'later' as const, detail: 'Bank payouts' }),
]);

export function getPartnerEntry(id: string): PartnerRegistryEntry | undefined {
  return PARTNER_REGISTRY.find((p) => p.id === id);
}

export function partnerAccepts(entry: PartnerRegistryEntry, network: DeliveryNetwork): boolean {
  return entry.acceptedTargets.some((t) => t.network === network && t.token === 'USDC');
}
