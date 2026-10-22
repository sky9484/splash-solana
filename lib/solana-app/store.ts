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
import type { ApprovalRecord, ChainSignatureRecord, EvidenceBundle, ExecutedRoute } from '../solana-evidence/bundle.ts';
import type { MerkleProof } from '../solana-evidence/merkle.ts';
import type { StoredEvidence } from '../solana-evidence/store.ts';
import type { ReaderOutput } from '../solana-zeke/reader.ts';
import type { RouterOutput } from '../solana-zeke/router.ts';
import type { PossessionChallenge } from '../solana/recovery-kit.ts';
import type { Cluster, ConfirmedInvoice, PartnerPayoutEvent, VaultInfo } from '../solana/types.ts';
import type { BatchRecord } from './batch-service.ts';
import type { ShareRecord } from './doc-store.ts';
import type { WalletNetwork } from './funding-router.ts';
import type { PaymentState } from './payment-machine.ts';

export type BankVerification = {
  by: string;
  method: 'call-back' | 'supplier-account' | 'existing-record';
  at: string;
  /** A call-back (prompt 10 §6.2): who answered at the supplier, and the number called, from the company's own records. */
  spokeTo?: string;
  numberCalled?: string;
};

export interface SupplierRecord {
  /**
   * Stable id (`sup_<uuid>`), the recipient's name everywhere: routes, the bank-number vault's
   * beneficiary_id. Companies saved before it existed get one on first read (ensureSupplierIds).
   */
  id: string;
  name: string;
  bank: string;
  accountLast4: string;
  /** The call-back (or record) that checked these details. Null for a recipient saved to check later. */
  verified: BankVerification | null;
  /** The current full number's record in bank_account_secrets (prompt 10 Phase S). Never the number. */
  secretId?: string;
  /**
   * Details not yet confirmed by a call-back: the recipient reads as "changed" and can't be paid.
   * `previousLast4` is null for a new recipient that was never checked.
   */
  pendingCallBack?: { since: string; previousLast4: string | null };
  /** Saved through Transfer's "New bank recipient" (prompt 10 §5.3); absent on recipients saved by a paid invoice. */
  bankCode?: string;
  /**
   * Who they are, as the payout partner asks once per recipient (business or individual, SEC/DTI number
   * or ID, address, account holder): given in the sheet, so a transfer asks only about itself.
   */
  partnerRecipient?: TransferDetails['recipient'];
  country?: 'PH';
  createdAt?: string;
  createdBy?: string;
}

/** A new recipient id. */
export const newSupplierId = () => `sup_${globalThis.crypto.randomUUID()}`;

/**
 * Give every saved recipient a stable id the first time its company is read (prompt 10 §S.1.0).
 * Returns how many it assigned; a second run assigns none.
 */
export function ensureSupplierIds(org: { suppliers: Array<Omit<SupplierRecord, 'id'> & { id?: string }> }): number {
  let assigned = 0;
  for (const s of org.suppliers) {
    if (s.id) continue;
    s.id = newSupplierId();
    assigned++;
  }
  return assigned;
}

/** Where the company is registered, from its onboarding profile (organizations.address_*). Country is ISO alpha-2. */
export interface CompanyPlace {
  city: string | null;
  state: string | null;
  country: string | null;
}

export interface OrgRecord {
  id: string;
  companyName: string;
  personName: string;
  createdAt: string;
  /**
   * The receipt's "Paid by" line and the default country of "Share with auditor" (prompt 12 §5.3, §5.4).
   * Copied from the organization on each request; absent on companies not seen since it was added.
   */
  place?: CompanyPlace | null;
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
  /** USDC brought in from outside the vaults for one payment. Absent on companies saved before it existed. */
  paymentFundings?: PaymentFunding[];
  /** The last details given for each recipient (key: name|bank|last4), offered again on the next transfer. */
  recipientDetails?: Record<string, TransferDetails>;
  /** Splash refuses service: no Kora signature, no new proposal. Splash cannot freeze the vault itself. */
  suspended: { at: string; by: string; reason: string } | null;
  /** Every suspend and unsuspend, oldest first, never edited (the admin console's audit log). */
  serviceLog?: ServiceLogEntry[];
  /** Who holds each approver key, for "1 of 2 approved · waiting for <name>" (prompt 10 §5.7). Never a secret. */
  memberNames?: Record<string, string>;
  /** In-app notices to members, e.g. "Aisyah asked you to approve a payment" (Remind). Oldest first. */
  notifications?: OrgNotification[];
  /** "Save as template" on a transfer's receipt (prompt 10 §5.8): who and how much, never a bank number. */
  transferTemplates?: TransferTemplate[];
  /**
   * Money that came into the Payments account from outside the company (prompt 10 §6.3): a business on
   * Splash paying, or someone paying a request's link. Oldest first.
   */
  received?: ReceivedRecord[];
  /** Treasury's investments (prompt 10 §7.4): what the Investments account holds, and every order. */
  investments?: { lots: InvestmentLot[]; orders: InvestmentOrder[] };
  /** The owner's treasury rules: sweep, the one-time eligibility confirmation, and the log of who changed what. */
  treasuryRules?: TreasuryRules;
  /** Sweep drafts, at most one a day (prompt 10 §7.3). Newest last; the last 60 kept. */
  sweepDrafts?: SweepDraftRecord[];
}

/** Units of one asset bought in one order. A unit straight from Ondo may be held until `heldUntil`. */
export interface InvestmentLot {
  id: string;
  asset: string;
  /** Millionths of a unit still held from this lot. */
  unitsMicro: bigint;
  /** What the units still held cost, US$ minor units. */
  costMinor: bigint;
  at: string;
  heldUntil: string | null;
  orderId: string;
}

/** An order a member's device approves: off-chain in test mode, the device signs its exact text. */
export interface InvestmentOrder {
  id: string;
  asset: string;
  kind: 'subscribe' | 'redeem' | 'buy' | 'sell';
  path: 'market' | 'ondo';
  amountMinor: bigint;
  unitsMicro: bigint;
  priceMinor: bigint;
  priceMovedBps: bigint | null;
  holdUntil: string | null;
  /** Where the money came from, for a subscription or a buy. */
  from: { reserveMinor: bigint; paymentsMinor: bigint } | null;
  landsIn: 'investments' | 'payments' | 'bank_wire';
  state: 'prepared' | 'settled' | 'expired';
  createdAt: string;
  createdBy: string;
  expiresAt: string;
  nonce: string;
  sweepDraftId: string | null;
  approval: { who: string; keyPublic: string; at: string; signature: string } | null;
  settlement: { signatures: string[]; simulated: boolean; at: string } | null;
  receiptId: string | null;
}

export interface TreasuryRules {
  sweep: { on: boolean; cushionMinor: bigint };
  /** The owner confirmed once that no owner (25% or more), director or approver is a US person. */
  eligibility: { by: string; at: string } | null;
  audit: Array<{ at: string; by: string; change: string }>;
}

/** One day's sweep draft. Nothing moves until a person approves it on a device. */
export interface SweepDraftRecord {
  id: string;
  /** UTC day, YYYY-MM-DD. */
  day: string;
  kind: 'subscribe' | 'redeem';
  amountMinor: bigint;
  reason: string;
  createdAt: string;
  /** 'dismissed': a person pressed "Not now" (prompt 11 §4.3). Only a person approves or dismisses. */
  state: 'drafted' | 'approved' | 'replaced' | 'withdrawn' | 'dismissed';
  orderId: string | null;
  cushionMinor: bigint;
  /** Prompt 11 §4.4: the daily sweep (absent, from before), or the quarter's interest brought back. */
  purpose?: 'sweep' | 'quarter_interest';
  /** For a quarter's interest: which quarter ("2026-Q3") and its months ("Jul–Sep"). */
  quarter?: string;
  months?: string;
  /** Who pressed "Not now", and when. */
  dismissed?: { by: string; at: string } | null;
}

/** Money in from outside the company, into its own Payments account. */
export interface ReceivedRecord {
  id: string;
  at: string;
  amountMinor: bigint;
  /** A business on Splash (by id), or someone who paid a request's link (the name they were asked as). */
  from: { kind: 'splash'; orgId: string; name: string } | { kind: 'link'; name: string };
  /** The request it paid, when it matched one. */
  requestId: string | null;
  /** A business on Splash: its payment. */
  paymentId: string | null;
  signature: string;
  memo: string | null;
  simulated: boolean;
}

/** One line of a payment request: integers only (quantity × unit price = amount, US$ minor units). */
export interface RequestLine {
  description: string;
  quantity: bigint;
  unitMinor: bigint;
  amountMinor: bigint;
}

/**
 * A payment request this company sent (prompt 10 §6.3, "Get paid"). A business on Splash finds it in
 * its own "Pay an invoice" inbox, ready to pay; anyone else gets a link to a page with this company's
 * own account details. The money always lands in the requester's Payments account.
 */
export interface PaymentRequestRecord {
  id: string;
  /** The requester. */
  orgId: string;
  /** "Your invoice number": unique among the company's requests that aren't cancelled. */
  number: string;
  payer: { kind: 'splash'; orgId: string; name: string; handle: string | null; country: string | null } | { kind: 'external'; name: string; email: string };
  lines: RequestLine[];
  amountMinor: bigint;
  /** YYYY-MM-DD. */
  dueDate: string;
  /** Text only: kept with the request, never submitted anywhere. */
  myInvoisRef: string | null;
  note: string | null;
  state: 'draft' | 'sent' | 'paid' | 'cancelled';
  /** The pay link's token (someone else pays by link). */
  slug: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  sentAt: string | null;
  viewedAt: string | null;
  paidAt: string | null;
  /** A business on Splash: the bill this request became in its inbox. */
  billId: string | null;
  paid: { by: 'splash'; paymentId: string; signature: string } | { by: 'link'; signature: string } | null;
  receiptId: string | null;
  reminders: Array<{ at: string; by: string }>;
  /** For the request's commitment on its receipt (kind 5). */
  saltHex: string;
}

/** A request someone else pays by link: the token, and whose request it is. */
export interface PayLinkRecord {
  slug: string;
  requestId: string;
  orgId: string;
}

/** A request from a business on Splash, as it lands in the payer's "Pay an invoice" inbox. */
export interface IncomingRequest {
  requestId: string;
  requesterOrgId: string;
  requesterName: string;
  number: string;
  dueDate: string;
  lines: Array<{ description: string; amountMinor: bigint }>;
  note: string | null;
  myInvoisRef: string | null;
  sentAt: string;
  /** The requester's last reminder. */
  remindedAt?: string;
  /** When the payer's inbox first listed it (its sender then sees "Viewed"). */
  seenAt?: string;
  /** The requester cancelled it: it can't be paid. */
  cancelledAt?: string;
}

/** A transfer to start again from Step 2: the recipient by id (or the business on Splash) and the amount. */
export interface TransferTemplate {
  id: string;
  to: 'bank' | 'splash';
  /** A saved bank recipient, by id: its number stays in the vault. */
  recipientId: string | null;
  payee: { orgId: string; name: string; handle: string | null; country: string | null } | null;
  /** "Manila Freight Services": how the template is named. */
  payeeName: string;
  amountPhpMinor: bigint | null;
  amountUsdMinor: bigint | null;
  purpose: 'goods' | 'services' | null;
  description: string | null;
  relationship: TransferDetails['relationship'] | null;
  sourceOfFunds: TransferDetails['sourceOfFunds'] | null;
  note: string | null;
  createdAt: string;
  createdBy: string;
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

/** Where the USDC for one payment comes from when it is not already in the company's vaults (Sky, 13 Oct). */
/**
 * How outside money came in. Today: 'bank_card' (a top-up) or 'wallet' (a crypto wallet; the route is
 * in `sourceId`). The other four are records saved before prompt 10, still readable; they are shown
 * without the providers' names.
 */
export type FundingMethod = 'bank_card' | 'wallet' | 'wallet_usdc' | 'wallet_swap' | 'stripe' | 'airwallex';

/**
 * USDC brought into the company's own payments vault for one payment, from outside its vaults
 * (lib/solana-app/funding-service.ts). The money lands in the vault, never with Splash, and only
 * after a funds check: the sending source is screened and a person declares where the money comes
 * from. Money already in the vaults was checked when it arrived, so paying from them needs neither.
 */
export interface PaymentFunding {
  id: string;
  orgId: string;
  /** The payment it covers, or null for a top-up from Balance (prompt 10 §5.10). */
  paymentId: string | null;
  method: FundingMethod;
  /** The route it took (funding-router.ts), e.g. 'wallet:USDC:base'. Absent on records before prompt 10. */
  sourceId?: string;
  /** The network a wallet sent from. Absent on records before prompt 10 (they were all Solana). */
  network?: WalletNetwork | null;
  /** What the person sends: USDC, or the stablecoin swapped to USDC before it reaches the vault. */
  asset: 'USDC' | 'USDT' | 'PYUSD' | 'USD';
  /** The sending wallet (wallet methods only); screened before the money counts. */
  fromAddress: string | null;
  /** USDC (minor units) that lands in the payments vault: the chosen route's full cost. */
  amountMinor: bigint;
  /** The provider's or swap venue's charge on top, in USD minor units. Splash adds nothing. */
  chargeMinor: bigint;
  chargeBps: number;
  sourceOfFunds: 'business_revenue' | 'owner_capital' | 'loan_or_facility' | 'customer_payment';
  declaredBy: string;
  declaredAt: string;
  /** 'crediting' is claimed before the credit is awaited, so two reads at once credit once. */
  state: 'checking' | 'held' | 'crediting' | 'in_vault';
  /** When the funds check finishes (offline: a fixed hold, so the extra step is visible). */
  checkUntil: string;
  /** `unknown`: screening couldn't answer. Held, like a flag: screening fails closed. */
  check: { resultId: string; label: string; flagged: boolean; unknown?: boolean } | null;
  signature: string | null;
  simulated: boolean;
  createdAt: string;
  settledAt: string | null;
}

export interface InvoiceRecord {
  id: string;
  orgId: string;
  createdAt: string;
  /**
   * Where the fields came from: Zeke read a document (sample, paste, upload), a person typed a transfer
   * to a bank, or a person paid another business on Splash ('peer', prompt 10 §5.1).
   */
  source: 'sample' | 'paste' | 'upload' | 'transfer' | 'peer' | 'request';
  /** A payment to another business on Splash: who, into which account, how much, and the note. */
  peer?: PeerDestination;
  /** 'request': a business on Splash asked this company to pay (prompt 10 §6.3). Paid as a `peer` payment. */
  request?: IncomingRequest;
  /**
   * The document Zeke read, line by line, with the bank account number masked (prompt 10 §6.2): what
   * "Check the invoice" shows. The full number is never kept here; it is sealed (`accountSecretId`).
   */
  document?: { lines: string[] };
  /** The full account number printed on the invoice, sealed in bank_account_secrets under this invoice's id. */
  accountSecretId?: string;
  /** The invoice's bank, as the payout partner's list names it (lib/solana-partner/banks.ts), when it matched one. */
  bankCode?: string | null;
  /** "Not this one": a person set the bill aside. It leaves the inbox; its sealed number is shredded later. */
  dismissed?: { at: string; by: string } | null;
  draft: ReaderOutput;
  /** Whether the draft's supplier bank details are already in the verified directory. */
  bankStatus: 'known' | 'new' | 'changed';
  bankVerification: (BankVerification & { bank: string; accountLast4: string }) | null;
  confirmed: ConfirmedInvoice | null;
  saltHex: string | null;
  /** A transfer's answers for the payout partner (purpose, relationship, the recipient's details). */
  paymentDetails?: TransferDetails | null;
}

/**
 * What the payout partner needs with a transfer (lib/solana-app/transfer-details.ts): why the money
 * is sent, where it comes from, who receives it. Given once per recipient, then offered again
 * ("Same details as before?"), and frozen on the transfer it was given for.
 */
export interface TransferDetails {
  purpose: 'goods' | 'services';
  description: string;
  relationship: 'supplier' | 'related_company' | 'contractor';
  sourceOfFunds: 'business_revenue' | 'owner_capital' | 'loan_or_facility' | 'customer_payment';
  recipient: {
    type: 'business' | 'individual';
    registrationNumber: string | null;
    idNumber: string | null;
    dateOfBirth: string | null;
    addressLine1: string;
    addressCity: string;
    addressCountry: 'PH';
    accountName: string;
  };
  reused: boolean;
  givenBy: string;
  givenAt: string;
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
  /** What they receive: PHP centavos for a bank payout; for a payment to a Splash business, see `receiveUsdMinor`. */
  receivePhpMinor: bigint;
  /** A payment to another business on Splash: what lands in their account, USD minor (prompt 10 §5.7). */
  receiveUsdMinor?: bigint;
  /** "Into Kuching Marine Supply's Splash account" for a payment to a Splash business. */
  intoLine?: string | null;
  youPayUsdcMinor: bigint;
  /** What moves from the reserve to the Payments account first, in the same approval sequence (0 when covered). */
  reserveMoveMinor?: bigint;
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
  kind: 'invoice' | 'transfer' | 'peer';
  /** A transfer's stated purpose, as the payout partner receives it ("Purchase of services: sea freight"). */
  purpose?: string | null;
  simulated: boolean;
}

/** Another business on Splash, as the directory found it (lib/server/splash-directory.ts). */
export interface PeerDestination {
  payeeOrgId: string;
  payeeName: string;
  payeeHandle: string | null;
  payeeCountry: string | null;
  /** The payee's own Payments account (its vault #0): where the money lands. */
  payeeVaultPda: string;
  /** What they get, USD minor units: the same as what you pay (no conversion, no Splash fee). */
  amountUsdMinor: bigint;
  /** On both receipts. */
  note: string | null;
}

export interface PaymentRecord {
  id: string;
  orgId: string;
  invoiceId: string;
  /** 'peer': into another Splash business's own account (no partner, no conversion). Absent: a bank payout. */
  kind?: 'bank' | 'peer';
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
  /**
   * Set when a re-quote abandoned a proposal that already had approvals: they don't carry over to a
   * new quote (prompt 10 §5.7). `previousYouPayMinor` tells "The rate moved" from "The quote ran out".
   */
  approvalsReset?: { at: string; previous: number; previousYouPayMinor: bigint | null } | null;
  /**
   * Prompt 11 §4.3: on a payment into another Splash business's own account, the fee the cheapest bank
   * route would have charged for the same amount, recorded when it is quoted. Absent or null: none
   * recorded (a bank payout, or a payment from before it was kept), and nothing is estimated later.
   */
  feeAvoidedMinor?: bigint | null;
}

export interface OrgNotification {
  id: string;
  kind: 'approval_reminder';
  paymentId: string;
  /** The approver key the notice is for. */
  to: string;
  by: string;
  at: string;
  read: boolean;
}

export interface EvidenceRecord {
  receiptId: string;
  paymentId: string;
  orgId: string;
  createdAt: string;
  bundle: EvidenceBundle;
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
  /** Payment requests (requests.ts), by id, and the pay links someone else opens, by token. */
  requests: Map<string, PaymentRequestRecord>;
  paylinks: Map<string, PayLinkRecord>;
  /** Which companies were loaded from the document store, and what was last written for each document. */
  docs: { loaded: Set<string>; written: Map<string, string> };
  /** The last 200 partner webhooks this server received, newest last. Process memory: since this server started. */
  webhookLog: WebhookLogEntry[];
}

const G = globalThis as typeof globalThis & { __splashSolanaAppStore?: SolanaAppStore };

export function store(): SolanaAppStore {
  const s = (G.__splashSolanaAppStore ??= { orgs: new Map(), invoices: new Map(), evidence: new Map(), shares: new Map(), batches: new Map(), requests: new Map(), paylinks: new Map(), docs: { loaded: new Set(), written: new Map() }, webhookLog: [] });
  // A store made by older code in this process (a dev reload) gains the maps added since.
  s.shares ??= new Map();
  s.batches ??= new Map();
  s.requests ??= new Map();
  s.paylinks ??= new Map();
  s.docs ??= { loaded: new Set(), written: new Map() };
  s.webhookLog ??= [];
  return s;
}

/** Tests only. */
export function resetStore(): void {
  G.__splashSolanaAppStore = undefined;
}

/**
 * A bill (prompt 10 §6.2): an invoice a supplier sent that Zeke read, or a request a business on Splash
 * sent. Not a transfer or a payment a person typed in Transfer.
 */
export const isBill = (inv: Pick<InvoiceRecord, 'source'>) => inv.source === 'sample' || inv.source === 'paste' || inv.source === 'upload' || inv.source === 'request';

/** Paid straight into another Splash company's own account: a payment typed in Transfer, or a request's bill. */
export const paysPeer = (inv: Pick<InvoiceRecord, 'source'>) => inv.source === 'peer' || inv.source === 'request';
