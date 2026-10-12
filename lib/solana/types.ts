/**
 * Shared types for the Splash Solana build (Colosseum, Oct 2026).
 *
 * This file is the contract between three layers:
 *   - chain core   (lib/solana/*)          keys, Squads vault, payout, CCTP V2, Kora
 *   - engine       (lib/route-engine/*)    quotes ranked by local currency received
 *   - evidence     (lib/solana-evidence/*) bundle, Merkle root, SAS anchor
 * and the UI (app/solana/*). Change it only with all three in mind.
 *
 * Money is always bigint minor units: USDC has 6 decimals, PHP is in centavos (2).
 */

export type Cluster = 'devnet' | 'mainnet-beta';

/** Where the build runs. `offline` never touches a network: every chain call is simulated. */
export type RunMode = 'offline' | 'devnet';

export type Policy = 'cheapest' | 'fastest' | 'safest';

/** Networks a payout partner may accept USDC on. Only `solana` is a lane in this build. */
export type DeliveryNetwork = 'solana' | 'polygon';

export type RouteFlag = 'above_target' | 'cctp_v2' | 'fast_transfer' | 'home_lane' | 'mock_partner';

export interface RouteStep {
  kind: 'transfer' | 'bridge' | 'partner';
  provider: string;
  /** USDC minor units. */
  feeMinor: bigint;
  etaSec: number;
}

export interface RouteQuote {
  id: string;
  policy: Policy;
  source: { lane: 'solana'; token: 'USDC'; amountMinor: bigint };
  target: { network: DeliveryNetwork; token: 'USDC'; partnerId: string; depositAddress: string };
  steps: RouteStep[];
  costs: { routeMinor: bigint; partnerMinor: bigint; splashMinor: bigint; allInBps: number };
  fx: { pair: 'USD/PHP'; rate: string; reference: string; capturedAt: string };
  /** What the supplier receives, in PHP centavos. */
  netLocal: { currency: 'PHP'; amountMinor: bigint };
  etaSec: number;
  expiresAt: string;
  flags: RouteFlag[];
}

export interface InvoiceFields {
  invoiceNumber: string;
  supplierName: string;
  supplierBank: string;
  /** Last 4 only for display; the full number never leaves the confirmed record. */
  supplierAccountLast4: string;
  /** What the supplier must receive, PHP centavos. */
  amountPhpMinor: bigint;
  dueDate: string;
  /** Malaysian e-invoice UUID if known (MyInvois). */
  einvoiceRef?: string;
}

/** Fields a person confirmed. The approval card renders ONLY from this and the quote. */
export interface ConfirmedInvoice extends InvoiceFields {
  confirmedBy: string;
  confirmedAt: string;
  /** sha256(salt || canonical invoice json), hex. Goes into the memo, never the plain number. */
  commitmentHex: string;
  bankDetailsVerified: { by: string; method: 'call-back' | 'supplier-account' | 'existing-record'; at: string } | null;
}

export type PaymentStatus =
  | 'DRAFT'
  | 'POLICY_DENIED'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'SENT'
  | 'PARTNER_RECEIVED'
  | 'PAID'
  | 'FAILED'
  | 'REFUNDED';

export interface PolicyResult {
  allowed: boolean;
  reasons: string[];
  checks: Array<{ name: 'tier' | 'per_payment_limit' | 'daily_limit' | 'kyt' | 'duplicate_invoice' | 'quote_expiry' | 'bank_details_verified'; passed: boolean; detail: string }>;
}

export interface VaultInfo {
  multisigPda: string;
  vaultPda: string;
  threshold: number;
  members: Array<{ role: 'admin_device' | 'approver_device' | 'recovery_kit_a' | 'recovery_kit_b'; publicKey: string }>;
  /** Must be null: an autonomous multisig, nobody outside can change members. */
  configAuthority: null;
}

export interface ChainReceipt {
  signature: string;
  cluster: Cluster;
  /** true when produced by the offline simulator, never by a network. */
  simulated: boolean;
  /**
   * What the fee payer paid for this send (sponsored sends only): the fee, exact from the
   * transaction (lib/solana/kora.ts sponsoredFeeLamports), and the rent for accounts it created.
   */
  cost?: SponsoredCost;
}

export interface SponsoredCost {
  feeLamports: bigint;
  rentLamports: bigint;
  /** Exact when the chain knew which accounts were new (offline); an estimate from account sizes otherwise. */
  rentExact: boolean;
}

export interface PartnerPayoutEvent {
  partnerId: string;
  paymentId: string;
  status: 'received' | 'paid' | 'returned';
  bankReference?: string;
  amountPhpMinor: bigint;
  at: string;
  /** HMAC-SHA256 of the canonical body with the partner's webhook secret, hex. */
  signature: string;
}
