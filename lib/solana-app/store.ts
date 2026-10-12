/**
 * In-memory server store for the Solana demo: orgs, invoices and evidence.
 * Payments are NOT here: they live behind the payment repository
 * (payment-repo.ts), in Postgres when one is configured, so the state machine
 * survives a restart (prompt 07 §5.1). A module singleton kept on globalThis (so Next's dev reloads and
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
import type { Cluster, ConfirmedInvoice, PartnerPayoutEvent, VaultInfo } from '../solana/types.ts';
import type { PaymentState } from './payment-machine.ts';

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
  /** Splash refuses service: no Kora signature, no new proposal. Splash cannot freeze the vault itself. */
  suspended: { at: string; by: string; reason: string } | null;
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

export type ProposalPurpose = 'squads_proposal_create' | 'squads_proposal_approve';

export interface PreparedMessage {
  id: string;
  purpose: 'proposal' | 'approve' | 'execute';
  /** The chain call step this transaction is recorded under (`paymentId:step`). */
  step: string;
  /** Serialized unsigned VersionedTransaction, base64. */
  txBase64: string;
  /** The exact bytes the device key signs (the transaction message), base64. */
  messageBase64: string;
  /** After this block height the transaction can never land. */
  lastValidBlockHeight: number;
  /** What a proposal transaction carries (evidence records them). */
  purposes: ProposalPurpose[];
  unitLimit: number;
  microLamports: bigint;
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
  /** This signer's approval meets the threshold, so the execute is signed in the same prompt. */
  includesExecute: boolean;
}

/** A TransactionInstruction in JSON, so an expired execute can be rebuilt without the original objects. */
export interface SerializedInstruction {
  programId: string;
  keys: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  dataBase64: string;
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
  /** The partner's one-payment deposit address the vault pays (shown so the approver sees the payee). */
  depositAddress: string;
  /** Who prepared the payment: Zeke drafts, a person approves (§5.4). */
  draftedBy: 'Zeke';
  simulated: boolean;
}

export interface PaymentRecord {
  id: string;
  orgId: string;
  invoiceId: string;
  createdAt: string;
  updatedAt: string;
  /** The state machine (payment-machine.ts). Changed only through the repository's compare-and-set. */
  state: PaymentState;
  version: number;
  /** The vault's approval threshold when the payment was quoted. */
  threshold: number;
  /** Members whose proposalApprove is confirmed on chain. */
  approvedBy: string[];
  /** A member whose approval was sent and is awaiting confirmation (resume picks it up). */
  pendingApprover: string | null;
  /** sha256 over the payee, amounts and route when the route was chosen; re-checked before every device prompt. */
  payeeHash: string | null;
  /** The Squads transaction index once proposed. */
  transactionIndex: bigint | null;
  /** What the vault transaction does and what surrounds the execute, kept so an expired execute can be rebuilt. */
  plan: { vault: SerializedInstruction[]; preExecute: SerializedInstruction[]; postExecute: SerializedInstruction[]; ephemeralSigners: number } | null;
  execution: { attempt: number; signature: string | null; confirmedAt: string | null; finalizedAt: string | null; lastLogs: string[] | null };
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
  evidence: Map<string, EvidenceRecord>;
}

const G = globalThis as typeof globalThis & { __splashSolanaAppStore?: SolanaAppStore };

export function store(): SolanaAppStore {
  if (!G.__splashSolanaAppStore) {
    G.__splashSolanaAppStore = { orgs: new Map(), invoices: new Map(), evidence: new Map() };
  }
  return G.__splashSolanaAppStore;
}

/** Tests only. */
export function resetStore(): void {
  G.__splashSolanaAppStore = undefined;
}
