/**
 * In-memory server store for the Solana demo: orgs, invoices, payments,
 * evidence. A module singleton kept on globalThis (so Next's dev reloads and
 * separately bundled route handlers share one copy); it resets when the
 * process restarts. Nothing here is a secret a person holds: the recovery
 * words and the device private key never reach the server (only public keys
 * and proof-of-possession signatures do).
 */
import type { EngineResult } from '../route-engine/index.ts';
import type { EnginePolicyResult } from '../route-engine/policy.ts';
import type { RouteKind } from '../route-engine/quote.ts';
import type { PartnerPayout } from '../solana-partner/registry.ts';
import type { ApprovalRecord, ChainSignatureRecord, CorridorPayoutBundle, ExecutedRoute } from '../solana-evidence/bundle.ts';
import type { MerkleProof } from '../solana-evidence/merkle.ts';
import type { StoredEvidence } from '../solana-evidence/store.ts';
import type { ReaderOutput } from '../solana-zeke/reader.ts';
import type { RouterOutput } from '../solana-zeke/router.ts';
import type { PossessionChallenge } from '../solana/recovery-kit.ts';
import type { Cluster, ConfirmedInvoice, PartnerPayoutEvent, PaymentStatus, VaultInfo } from '../solana/types.ts';

export type BankVerification = { by: string; method: 'call-back' | 'supplier-account' | 'existing-record'; at: string };

export interface SupplierRecord {
  name: string;
  bank: string;
  accountLast4: string;
  verified: BankVerification;
}

export interface OrgRecord {
  id: string;
  companyName: string;
  personName: string;
  createdAt: string;
  /** 32 random bytes (hex). Per-invoice salts are HMAC(orgSalt, invoice) so one disclosure reveals no other. */
  saltHex: string;
  challenges: Record<string, PossessionChallenge & { role: 'device' | 'kit' }>;
  keys: { device?: { publicKey: string; provenAt: string }; kit?: { publicKey: string; provenAt: string } };
  vault?: VaultInfo & { createdAt: string; signature: string; simulated: boolean; cluster: Cluster };
  suppliers: SupplierRecord[];
  /** USDC minor debited per UTC day (YYYY-MM-DD). */
  dailyDebits: Record<string, bigint>;
  /** Invoice commitments already paid or in flight (duplicate check). */
  seenCommitments: string[];
  fundings: Array<{ signature: string; amountMinor: bigint; at: string; simulated: boolean; note: string }>;
}

export interface InvoiceRecord {
  id: string;
  orgId: string;
  createdAt: string;
  source: 'sample' | 'paste' | 'upload';
  draft: ReaderOutput;
  /** Whether the draft's supplier bank details are already in the verified directory. */
  bankStatus: 'known' | 'new' | 'changed';
  bankVerification: (BankVerification & { bank: string; accountLast4: string }) | null;
  confirmed: ConfirmedInvoice | null;
  saltHex: string | null;
}

export interface PreparedMessage {
  id: string;
  purpose: 'proposal' | 'execute';
  /** Serialized unsigned VersionedTransaction, base64. */
  txBase64: string;
  /** The exact bytes the device key signs (the transaction message), base64. */
  messageBase64: string;
}

export interface PreparedApproval {
  createdAt: string;
  quoteId: string;
  kind: RouteKind;
  transactionIndex: bigint;
  signer: string;
  messages: PreparedMessage[];
  transferAmountMinor: bigint;
  splashFeeMinor: bigint;
  depositAddress: string;
  /** Proposal groups: which purposes each proposal transaction carries. */
  proposalPurposes: Array<Array<'squads_proposal_create' | 'squads_proposal_approve'>>;
}

export type Rehearsal = 'none' | 'kyt_flag' | 'partner_return';

export interface ApprovalCard {
  paymentId: string;
  quoteId: string;
  supplierName: string;
  bank: string;
  accountLast4: string;
  verified: BankVerification | null;
  receivePhpMinor: bigint;
  youPayUsdcMinor: bigint;
  costs: { allInBps: number; routeMinor: bigint; partnerMinor: bigint; splashMinor: bigint; routeBps: number; partnerBps: number; splashBps: number };
  arrives: string;
  laneNote: string;
  routeLabel: string;
  policyLabel: string;
  invoiceNumber: string;
  einvoiceRef: string | null;
  invoiceMatched: boolean;
  quoteExpiresAt: string;
  aboveTarget: boolean;
  policy: { allowed: boolean; checks: Array<{ name: string; label: string; passed: boolean; detail: string }>; kytLabel: string };
  signerPublicKey: string;
  simulated: boolean;
}

export interface PaymentRecord {
  id: string;
  orgId: string;
  invoiceId: string;
  createdAt: string;
  status: PaymentStatus | 'QUOTED';
  payout: PartnerPayout;
  engine: EngineResult;
  router: RouterOutput;
  selectedQuoteId: string | null;
  policy: EnginePolicyResult | null;
  approval: ApprovalCard | null;
  rehearsal: Rehearsal;
  prepared: PreparedApproval | null;
  signatures: ChainSignatureRecord[];
  approvals: ApprovalRecord[];
  partnerEvents: PartnerPayoutEvent[];
  timeline: { approvedAt?: string; sentAt?: string; receivedAt?: string; paidAt?: string; returnedAt?: string };
  executedRoute: ExecutedRoute | null;
  receiptId: string | null;
  problem: { code: string; message: string } | null;
}

export interface EvidenceRecord {
  receiptId: string;
  paymentId: string;
  orgId: string;
  createdAt: string;
  bundle: CorridorPayoutBundle;
  leafHex: string;
  batch: { rootHex: string; count: number; periodStart: bigint; periodEnd: bigint };
  proof: MerkleProof;
  anchor: {
    method: 'memo';
    memo: string;
    status: 'anchored' | 'pending';
    signature: string | null;
    simulated: boolean;
    attester: string;
  };
  stored: StoredEvidence;
}

export interface SolanaAppStore {
  orgs: Map<string, OrgRecord>;
  invoices: Map<string, InvoiceRecord>;
  payments: Map<string, PaymentRecord>;
  evidence: Map<string, EvidenceRecord>;
}

const G = globalThis as typeof globalThis & { __splashSolanaAppStore?: SolanaAppStore };

export function store(): SolanaAppStore {
  if (!G.__splashSolanaAppStore) {
    G.__splashSolanaAppStore = { orgs: new Map(), invoices: new Map(), payments: new Map(), evidence: new Map() };
  }
  return G.__splashSolanaAppStore;
}

/** Tests only. */
export function resetStore(): void {
  G.__splashSolanaAppStore = undefined;
}
