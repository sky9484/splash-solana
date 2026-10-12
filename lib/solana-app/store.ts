/**
 * The in-process working copy of the Solana app's companies, invoices, evidence and receipt share
 * links. With a database these are documents in solana_documents, loaded on a company's first
 * request and written back after each one (company.ts, doc-store.ts); without one, this is all
 * there is. Payments are NOT here: they live behind the payment repository (payment-repo.ts), in
 * Postgres when one is configured, so the state machine survives a restart (prompt 07 §5.1).
 * A module singleton kept on globalThis (so Next's dev reloads and separately bundled route
 * handlers share one copy). Nothing here is a secret a person holds: the recovery
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
import type { BatchRecord } from './batch-service.ts';
import type { ShareRecord } from './doc-store.ts';
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
  /** USDC added to the treasury vault (vault #1). Absent on companies saved before treasury existed. */
  treasuryFundings?: Array<{ signature: string; amountMinor: bigint; at: string; simulated: boolean; note: string }>;
  /** Moves between the company's own two vaults. Absent on companies saved before treasury existed. */
  moves?: MoveRecord[];
  /** Splash refuses service: no Kora signature, no new proposal. Splash cannot freeze the vault itself. */
  suspended: { at: string; by: string; reason: string } | null;
  /** Every suspend and unsuspend, oldest first, never edited (the admin console's audit log). */
  serviceLog?: ServiceLogEntry[];
}

export interface ServiceLogEntry {
  at: string;
  /** The staff member's email (admin session). */
  by: string;
  action: 'suspend' | 'unsuspend';
  reason: string;
}

/** A partner webhook as it arrived, and what Splash did with it (the admin console's webhooks section). */
export interface WebhookLogEntry {
  at: string;
  paymentId: string;
  status: string;
  /** accepted: applied; duplicate: the same (payment, status) again, a no-op; refused: not applied, with why. */
  result: 'accepted' | 'duplicate' | 'refused';
  /** The HMAC check: true passed, false failed, null not reached (the body was malformed). */
  signatureOk: boolean | null;
  reason: string | null;
}

/** Which of the company's two vaults: #0 pays suppliers, #1 holds operating cash (treasury). */
export type VaultKind = 'payments' | 'treasury';

export interface MoveCall {
  step: 'proposal' | 'execute';
  part: number;
  signature: string;
  lastValidBlockHeight: number;
  status: 'signed' | 'confirmed' | 'finalized' | 'failed' | 'expired' | 'pending';
  at: string;
}

/**
 * USDC moved between the company's own vaults (lib/solana-app/treasury-service.ts). Both vaults are
 * PDAs of the company's Squads multisig: Splash holds no key to either, takes no fee on a move, and
 * a person approves every move on a device.
 */
export interface MoveRecord {
  id: string;
  orgId: string;
  from: VaultKind;
  to: VaultKind;
  amountMinor: bigint;
  memo: string;
  transactionIndex: bigint;
  state: 'prepared' | 'sending' | 'checking' | 'confirmed' | 'failed';
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  approvedBy: { who: string; keyPublic: string; at: string } | null;
  vault: SerializedInstruction[];
  preExecute: SerializedInstruction[];
  prepared: { signer: string; messages: Array<{ id: string; step: 'proposal' | 'execute'; part: number; txBase64: string; messageBase64: string; lastValidBlockHeight: number }> } | null;
  calls: MoveCall[];
  problem: { code: string; message: string } | null;
}

export interface InvoiceRecord {
  id: string;
  orgId: string;
  createdAt: string;
  /** Where the fields came from: Zeke read a document (sample, paste, upload), or a person typed a transfer. */
  source: 'sample' | 'paste' | 'upload' | 'transfer';
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
  /** Who prepared the payment: Zeke drafts an invoice payment, a person types a transfer; a person approves either (§5.4). */
  draftedBy: string;
  /** An invoice Zeke read, or a transfer a person typed in. */
  kind: 'invoice' | 'transfer';
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
  /** Receipt share links, by token. */
  shares: Map<string, ShareRecord>;
  /** Batch payouts (batch-service.ts), by id. */
  batches: Map<string, BatchRecord>;
  /** Which companies were loaded from the document store, and what was last written for each document. */
  docs: { loaded: Set<string>; written: Map<string, string> };
  /** The last 200 partner webhooks this server received, newest last. Process memory: since this server started. */
  webhookLog: WebhookLogEntry[];
}

const G = globalThis as typeof globalThis & { __splashSolanaAppStore?: SolanaAppStore };

export function store(): SolanaAppStore {
  const s = (G.__splashSolanaAppStore ??= { orgs: new Map(), invoices: new Map(), evidence: new Map(), shares: new Map(), batches: new Map(), docs: { loaded: new Set(), written: new Map() }, webhookLog: [] });
  // A store made by older code in this process (a dev reload) gains the maps added since.
  s.shares ??= new Map();
  s.batches ??= new Map();
  s.docs ??= { loaded: new Set(), written: new Map() };
  s.webhookLog ??= [];
  return s;
}

/** Tests only. */
export function resetStore(): void {
  G.__splashSolanaAppStore = undefined;
}
