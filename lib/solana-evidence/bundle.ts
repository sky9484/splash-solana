/**
 * Evidence bundles, kind 3 (corridor payout), kind 4 (a payment to a Splash business), kind 5 (money
 * received against a request), kind 6 (a treasury order), and batch building.
 *
 * One bundle per payout. It records, without plaintext invoice data:
 *   invoice commitment (salted sha256) + e-invoice ref
 *   approval chain: who, when, which key, the policy result they approved under
 *   KYT result id
 *   the quoted route vs the executed route
 *   chain signatures
 *   partner payout id + signed webhook events
 *   FX rate + reference, bank reference, receipt
 *
 * leaf(bundle) = hashLeaf(canonicalJson(bundle)) (see merkle.ts for the
 * domain separation). Bundles over a period form a batch whose root is
 * anchored on Solana (anchor.ts). Changing any field of a bundle changes its
 * leaf and so fails verification against the anchored root.
 *
 * Builder invariants (throw on violation):
 *   - at least one person's approval (I-4)
 *   - executed deposit address === quoted deposit address, and the quoted
 *     route's partner is the bundle's partner (I-2)
 *   - executed route refers to the quoted route id
 *   - fx === the quoted route's fx
 *   - a 'paid' event exists and carries the bundle's bank reference
 *   - any simulated chain signature ⇒ receipt.simulated === true (I-7)
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';

import type { Cluster, DeliveryNetwork, InvoiceFields, PartnerPayoutEvent, PolicyResult, RouteQuote, RouteStep, VaultInfo } from '../solana/types.ts';
import { canonicalJson } from './canonical.ts';
import { buildLevels, hashLeaf, merkleProof, type MerkleProof } from './merkle.ts';

export const EVIDENCE_BUNDLE_VERSION = 1 as const;
export const EVIDENCE_KIND_CORRIDOR_PAYOUT = 3 as const;
/** A payment into another business's Splash account (prompt 10 §5.2): no partner, no conversion. */
export const EVIDENCE_KIND_PEER_TRANSFER = 4 as const;
export const INVOICE_SALT_BYTES = 32;

export class EvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceError';
  }
}

export type ApproverRole = VaultInfo['members'][number]['role'];

export interface ApprovalRecord {
  who: string;
  role: ApproverRole;
  action: 'propose' | 'approve' | 'execute';
  at: string;
  /** Public key that signed (device key or recovery kit). */
  keyPublic: string;
  /** The deterministic policy result shown on the approval card. */
  policyResult: Pick<PolicyResult, 'allowed' | 'reasons' | 'checks'>;
}

export type ChainSignaturePurpose = 'squads_proposal_create' | 'squads_proposal_approve' | 'squads_vault_execute' | 'spl_transfer' | 'cctp_burn' | 'cctp_mint';

export interface ChainSignatureRecord {
  purpose: ChainSignaturePurpose;
  network: DeliveryNetwork;
  signature: string;
  cluster: Cluster | 'polygon-amoy' | 'polygon';
  simulated: boolean;
}

export interface ExecutedRoute {
  quoteId: string;
  network: DeliveryNetwork;
  depositAddress: string;
  /** USDC that left the vault toward the route (transfer or burn amount). */
  amountMinor: bigint;
  steps: RouteStep[];
}

export interface CorridorPayoutBundle {
  version: typeof EVIDENCE_BUNDLE_VERSION;
  kind: typeof EVIDENCE_KIND_CORRIDOR_PAYOUT;
  kindName: 'corridor_payout';
  bundleId: string;
  paymentId: string;
  createdAt: string;
  invoice: { commitmentHex: string; einvoiceRef: string | null };
  approvals: ApprovalRecord[];
  kyt: { provider: string; resultId: string; verdict: 'clear' | 'flagged' };
  quotedRoute: RouteQuote;
  executedRoute: ExecutedRoute;
  chain: { signatures: ChainSignatureRecord[] };
  partner: { partnerId: string; payoutId: string; events: PartnerPayoutEvent[] };
  fx: RouteQuote['fx'];
  bank: { reference: string; rail: string };
  receipt: { receiptId: string; issuedAt: string; simulated: boolean };
}

export type CorridorPayoutBundleInput = Omit<CorridorPayoutBundle, 'version' | 'kind' | 'kindName' | 'bundleId' | 'fx'> & { bundleId?: string; fx?: RouteQuote['fx'] };

// ---------------------------------------------------------------------------
// Invoice commitment

/**
 * sha256(salt || canonicalJson(fields)), hex. Matches `ConfirmedInvoice.commitmentHex`.
 * Only the confirmed `InvoiceFields` are committed (amount as a decimal string of centavos).
 */
export function computeInvoiceCommitment(fields: InvoiceFields, salt: Uint8Array): string {
  if (salt.length !== INVOICE_SALT_BYTES) throw new EvidenceError(`salt must be ${INVOICE_SALT_BYTES} bytes`);
  const committed: InvoiceFields = {
    invoiceNumber: fields.invoiceNumber,
    supplierName: fields.supplierName,
    supplierBank: fields.supplierBank,
    supplierAccountLast4: fields.supplierAccountLast4,
    amountPhpMinor: fields.amountPhpMinor,
    dueDate: fields.dueDate,
    einvoiceRef: fields.einvoiceRef,
  };
  return bytesToHex(sha256(concatBytes(salt, utf8ToBytes(canonicalJson(committed)))));
}

export function randomSalt(): Uint8Array {
  const salt = new Uint8Array(INVOICE_SALT_BYTES);
  globalThis.crypto.getRandomValues(salt);
  return salt;
}

// ---------------------------------------------------------------------------
// Bundle

export function buildCorridorPayoutBundle(input: CorridorPayoutBundleInput): CorridorPayoutBundle {
  const q = input.quotedRoute;
  if (!/^[0-9a-f]{64}$/.test(input.invoice.commitmentHex)) throw new EvidenceError('invoice commitment must be 32-byte hex');
  if (input.approvals.length === 0) throw new EvidenceError('a payout bundle needs at least one person’s approval');
  if (!input.approvals.some((a) => a.action === 'approve' || a.action === 'execute')) throw new EvidenceError('no approve/execute signature in the approval chain');
  if (input.executedRoute.quoteId !== q.id) throw new EvidenceError('executed route does not refer to the quoted route');
  if (input.executedRoute.depositAddress !== q.target.depositAddress || input.executedRoute.network !== q.target.network) {
    throw new EvidenceError('executed destination differs from the quoted partner deposit address');
  }
  if (input.partner.partnerId !== q.target.partnerId) throw new EvidenceError('partner differs from the quoted route');
  const fx = input.fx ?? q.fx;
  if (canonicalJson(fx) !== canonicalJson(q.fx)) throw new EvidenceError('fx differs from the quoted fx');
  const paid = input.partner.events.find((e) => e.status === 'paid');
  if (!paid) throw new EvidenceError('no paid event from the partner');
  if (paid.bankReference !== input.bank.reference) throw new EvidenceError('bank reference does not match the paid event');
  if (input.partner.events.some((e) => e.paymentId !== input.paymentId || e.partnerId !== input.partner.partnerId)) {
    throw new EvidenceError('a partner event belongs to another payment or partner');
  }
  if (input.chain.signatures.some((s) => s.simulated) && !input.receipt.simulated) {
    throw new EvidenceError('a simulated signature cannot back a receipt that is not marked simulated');
  }
  const bundle: CorridorPayoutBundle = {
    version: EVIDENCE_BUNDLE_VERSION,
    kind: EVIDENCE_KIND_CORRIDOR_PAYOUT,
    kindName: 'corridor_payout',
    bundleId: input.bundleId ?? `evb3_${input.paymentId}`,
    paymentId: input.paymentId,
    createdAt: input.createdAt,
    invoice: { commitmentHex: input.invoice.commitmentHex, einvoiceRef: input.invoice.einvoiceRef },
    approvals: input.approvals,
    kyt: input.kyt,
    quotedRoute: q,
    executedRoute: input.executedRoute,
    chain: input.chain,
    partner: input.partner,
    fx,
    bank: input.bank,
    receipt: input.receipt,
  };
  // Detach from caller objects so later mutation of inputs cannot alter the bundle.
  return structuredClone(bundle);
}

/**
 * Kind 4: a payment into another business's own Splash account (prompt 10 §5.2). Both companies, the
 * amount (no conversion, no Splash fee), the approval chain, the payee's screening, the transfer
 * signature and its memo `splash:peer:v1:<paymentId>`. No partner, no bank reference.
 *
 * Builder invariants (throw on violation):
 *   - at least one person's approval (I-4)
 *   - payer and payee are different companies
 *   - the executed destination is the payee's own account, and the amount is what was quoted
 *   - the memo names this payment
 *   - any simulated chain signature ⇒ receipt.simulated === true (I-7)
 */
export interface PeerTransferBundle {
  version: typeof EVIDENCE_BUNDLE_VERSION;
  kind: typeof EVIDENCE_KIND_PEER_TRANSFER;
  kindName: 'peer_transfer';
  bundleId: string;
  paymentId: string;
  createdAt: string;
  payer: { orgId: string };
  payee: { orgId: string; name: string; account: string };
  amount: { currency: 'USD'; amountMinor: bigint };
  reference: { commitmentHex: string };
  approvals: ApprovalRecord[];
  kyt: { provider: string; resultId: string; verdict: 'clear' | 'flagged' };
  executedRoute: ExecutedRoute;
  chain: { signatures: ChainSignatureRecord[] };
  memo: string;
  receipt: { receiptId: string; issuedAt: string; simulated: boolean };
}

export type PeerTransferBundleInput = Omit<PeerTransferBundle, 'version' | 'kind' | 'kindName' | 'bundleId' | 'memo'> & { bundleId?: string };

export const PEER_MEMO_PREFIX = 'splash:peer:v1:';

export function buildPeerTransferBundle(input: PeerTransferBundleInput): PeerTransferBundle {
  if (!/^[0-9a-f]{64}$/.test(input.reference.commitmentHex)) throw new EvidenceError('reference commitment must be 32-byte hex');
  if (input.approvals.length === 0) throw new EvidenceError('a peer bundle needs at least one person’s approval');
  if (!input.approvals.some((a) => a.action === 'approve' || a.action === 'execute')) throw new EvidenceError('no approve/execute signature in the approval chain');
  if (input.payer.orgId === input.payee.orgId) throw new EvidenceError('a peer transfer goes to another company');
  if (input.executedRoute.depositAddress !== input.payee.account) throw new EvidenceError('executed destination is not the payee’s own account');
  if (input.executedRoute.amountMinor !== input.amount.amountMinor) throw new EvidenceError('the amount sent differs from the amount quoted');
  if (input.chain.signatures.some((s) => s.simulated) && !input.receipt.simulated) {
    throw new EvidenceError('a simulated signature cannot back a receipt that is not marked simulated');
  }
  const bundle: PeerTransferBundle = {
    version: EVIDENCE_BUNDLE_VERSION,
    kind: EVIDENCE_KIND_PEER_TRANSFER,
    kindName: 'peer_transfer',
    bundleId: input.bundleId ?? `evb4_${input.paymentId}`,
    paymentId: input.paymentId,
    createdAt: input.createdAt,
    payer: input.payer,
    payee: input.payee,
    amount: input.amount,
    reference: input.reference,
    approvals: input.approvals,
    kyt: input.kyt,
    executedRoute: input.executedRoute,
    chain: input.chain,
    memo: `${PEER_MEMO_PREFIX}${input.paymentId}`,
    receipt: input.receipt,
  };
  return structuredClone(bundle);
}

/**
 * Kind 5: money a company asked for and received (prompt 10 §6.3, "Get paid"). The request (a salted
 * commitment over its number, lines and due date), who paid (another Splash company by id, or someone
 * else by a commitment only: their name and email stay off the record), the transfer that brought the
 * money into the requester's own Payments account, and how it was matched to the request.
 *
 * Builder invariants (throw on violation):
 *   - the money landed in the requester's own account, and the amount is the amount asked
 *   - a Splash payer is another company; its payment is named
 *   - a match by reference names a reference
 *   - any simulated chain signature ⇒ receipt.simulated === true (I-7)
 */
export const EVIDENCE_KIND_RECEIVABLE = 5 as const;

export interface ReceivableBundle {
  version: typeof EVIDENCE_BUNDLE_VERSION;
  kind: typeof EVIDENCE_KIND_RECEIVABLE;
  kindName: 'receivable';
  bundleId: string;
  requestId: string;
  createdAt: string;
  payee: { orgId: string; name: string; account: string };
  payer: { kind: 'splash'; orgId: string } | { kind: 'external'; commitmentHex: string };
  amount: { currency: 'USD'; amountMinor: bigint };
  request: { commitmentHex: string; einvoiceRef: string | null };
  incoming: { to: string; amountMinor: bigint; memo: string | null };
  match: { method: 'splash_payment'; paymentId: string } | { method: 'reference_and_amount'; reference: string };
  chain: { signatures: ChainSignatureRecord[] };
  receipt: { receiptId: string; issuedAt: string; simulated: boolean };
}

export type ReceivableBundleInput = Omit<ReceivableBundle, 'version' | 'kind' | 'kindName' | 'bundleId'> & { bundleId?: string };

export function buildReceivableBundle(input: ReceivableBundleInput): ReceivableBundle {
  const hex64 = /^[0-9a-f]{64}$/;
  if (!hex64.test(input.request.commitmentHex)) throw new EvidenceError('request commitment must be 32-byte hex');
  if (input.payer.kind === 'external' && !hex64.test(input.payer.commitmentHex)) throw new EvidenceError('payer commitment must be 32-byte hex');
  if (input.payer.kind === 'splash' && input.payer.orgId === input.payee.orgId) throw new EvidenceError('a company does not pay its own request');
  if (input.amount.amountMinor <= 0n) throw new EvidenceError('a receivable is for an amount above zero');
  if (input.incoming.to !== input.payee.account) throw new EvidenceError('the money did not land in the requester’s own account');
  if (input.incoming.amountMinor !== input.amount.amountMinor) throw new EvidenceError('the amount received differs from the amount asked');
  if (input.match.method === 'splash_payment' && (input.payer.kind !== 'splash' || !input.match.paymentId)) throw new EvidenceError('a Splash payment match names the payment');
  if (input.match.method === 'reference_and_amount' && !input.match.reference) throw new EvidenceError('a reference match names the reference');
  if (input.chain.signatures.length === 0) throw new EvidenceError('a receivable names the transfer that brought the money');
  if (input.chain.signatures.some((s) => s.simulated) && !input.receipt.simulated) {
    throw new EvidenceError('a simulated signature cannot back a receipt that is not marked simulated');
  }
  const bundle: ReceivableBundle = {
    version: EVIDENCE_BUNDLE_VERSION,
    kind: EVIDENCE_KIND_RECEIVABLE,
    kindName: 'receivable',
    bundleId: input.bundleId ?? `evb5_${input.requestId}`,
    requestId: input.requestId,
    createdAt: input.createdAt,
    payee: input.payee,
    payer: input.payer,
    amount: input.amount,
    request: input.request,
    incoming: input.incoming,
    match: input.match,
    chain: input.chain,
    receipt: input.receipt,
  };
  return structuredClone(bundle);
}

/**
 * Kind 6: a treasury order (prompt 10 §7.4), T-bills subscribed or redeemed, a stock bought or sold, in
 * the company's own Investments account (vault #2). In test mode the order is off-chain: a member's device
 * signed the exact order text (its sha256 is here), and the simulator settled the money side.
 *
 * Builder invariants (throw on violation):
 *   - T-bills are subscribed and redeemed; stocks are bought and sold
 *   - a person's device approved it (signature and key present)
 *   - money into the Investments account names the Investments account; Ondo's redemption is by wire and
 *     names no chain transfer into the Payments account
 *   - a sweep order names its draft and the rule's cushion
 *   - any simulated chain signature ⇒ receipt.simulated === true (I-7)
 */
export const EVIDENCE_KIND_TREASURY = 6 as const;

export interface TreasuryOrderBundle {
  version: typeof EVIDENCE_BUNDLE_VERSION;
  kind: typeof EVIDENCE_KIND_TREASURY;
  kindName: 'treasury';
  bundleId: string;
  orderId: string;
  createdAt: string;
  org: { orgId: string; investmentsAccount: string };
  asset: { id: string; issuer: 'Ondo'; token: string };
  order: {
    kind: 'subscribe' | 'redeem' | 'buy' | 'sell';
    path: 'market' | 'ondo';
    amountMinor: bigint;
    unitsMicro: bigint;
    priceMinor: bigint;
    priceMovedBps: bigint | null;
    holdUntil: string | null;
    landsIn: 'investments' | 'payments' | 'bank_wire';
  };
  approval: { who: string; keyPublic: string; at: string; signature: string; messageSha256: string };
  chain: { signatures: ChainSignatureRecord[] };
  wire: { to: string; reference: string } | null;
  sweep: { draftId: string; reason: string; cushionMinor: bigint } | null;
  receipt: { receiptId: string; issuedAt: string; simulated: boolean };
}

export type TreasuryOrderBundleInput = Omit<TreasuryOrderBundle, 'version' | 'kind' | 'kindName' | 'bundleId'> & { bundleId?: string };

export function buildTreasuryOrderBundle(input: TreasuryOrderBundleInput): TreasuryOrderBundle {
  const tbill = input.asset.id === 'usdy';
  const k = input.order.kind;
  if (tbill !== (k === 'subscribe' || k === 'redeem')) throw new EvidenceError('T-bills are subscribed and redeemed; stocks are bought and sold');
  if (input.order.amountMinor <= 0n || input.order.unitsMicro <= 0n) throw new EvidenceError('an order is for an amount above zero');
  if (!input.approval.signature || !input.approval.keyPublic) throw new EvidenceError('a person’s device approves every order');
  if (!/^[0-9a-f]{64}$/.test(input.approval.messageSha256)) throw new EvidenceError('the approved order text’s hash must be 32-byte hex');
  if (!input.org.investmentsAccount) throw new EvidenceError('an order names the Investments account');
  const paying = k === 'subscribe' || k === 'buy';
  if (paying && input.order.landsIn !== 'investments') throw new EvidenceError('units land in the Investments account');
  if (!paying && input.order.landsIn === 'investments') throw new EvidenceError('money from a redemption or sale leaves the Investments account');
  if (input.order.landsIn === 'bank_wire') {
    if (!input.wire) throw new EvidenceError('a redemption by wire names the wire');
    if (input.order.path !== 'ondo') throw new EvidenceError('only Ondo redeems by wire');
  } else if (input.wire) throw new EvidenceError('only a redemption with Ondo goes by wire');
  if (input.order.landsIn !== 'bank_wire' && input.chain.signatures.length === 0) throw new EvidenceError('an order names the transfers that settled it');
  if (input.sweep && (!input.sweep.draftId || input.sweep.cushionMinor < 0n)) throw new EvidenceError('a sweep order names its draft and the rule’s cushion');
  if (input.chain.signatures.some((s) => s.simulated) && !input.receipt.simulated) {
    throw new EvidenceError('a simulated signature cannot back a receipt that is not marked simulated');
  }
  const bundle: TreasuryOrderBundle = {
    version: EVIDENCE_BUNDLE_VERSION,
    kind: EVIDENCE_KIND_TREASURY,
    kindName: 'treasury',
    bundleId: input.bundleId ?? `evb6_${input.orderId}`,
    orderId: input.orderId,
    createdAt: input.createdAt,
    org: input.org,
    asset: input.asset,
    order: input.order,
    approval: input.approval,
    chain: input.chain,
    wire: input.wire,
    sweep: input.sweep,
    receipt: input.receipt,
  };
  return structuredClone(bundle);
}

/** Any bundle a receipt can carry. */
export type EvidenceBundle = CorridorPayoutBundle | PeerTransferBundle | ReceivableBundle | TreasuryOrderBundle;

export function bundleCanonical(bundle: EvidenceBundle): string {
  return canonicalJson(bundle);
}

export function bundleLeaf(bundle: EvidenceBundle): Uint8Array {
  return hashLeaf(bundleCanonical(bundle));
}

export function bundleLeafHex(bundle: EvidenceBundle): string {
  return bytesToHex(bundleLeaf(bundle));
}

// ---------------------------------------------------------------------------
// Batch

export interface EvidenceBatch {
  rootHex: string;
  count: number;
  /** Unix seconds, inclusive start / exclusive end. */
  periodStart: bigint;
  periodEnd: bigint;
  leaves: Array<{ bundleId: string; leafHex: string; proof: MerkleProof }>;
}

/** A Walrus blob id as the publisher returns it (base64url), or an in-memory store id. */
const BLOB_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * walrus_blob_ids_root: sha256 over the batch's blob ids, sorted ascending and
 * joined with '\n', as lowercase hex. It binds the anchored root to exactly
 * the encrypted blobs stored for the batch, so a verifier holding the batch's
 * blob ids can check none was swapped. Sorting makes it independent of upload
 * order; '\n' cannot occur in a blob id, so the join is unambiguous.
 */
export function walrusBlobIdsRoot(blobIds: readonly string[]): string {
  if (blobIds.length === 0) throw new EvidenceError('a batch needs at least one blob id');
  const sorted = [...blobIds].sort();
  for (let i = 0; i < sorted.length; i++) {
    if (!BLOB_ID.test(sorted[i])) throw new EvidenceError(`not a blob id: ${sorted[i].slice(0, 40)}`);
    if (i > 0 && sorted[i] === sorted[i - 1]) throw new EvidenceError(`duplicate blob id ${sorted[i]}`);
  }
  return bytesToHex(sha256(utf8ToBytes(sorted.join('\n'))));
}

/** Bundles are ordered by (createdAt, bundleId) so a batch is reproducible from its bundles. */
export function buildEvidenceBatch(bundles: EvidenceBundle[], period: { start: Date; end: Date }): EvidenceBatch {
  if (bundles.length === 0) throw new EvidenceError('empty batch');
  if (period.end.getTime() <= period.start.getTime()) throw new EvidenceError('period end must be after start');
  const ids = new Set<string>();
  const ordered = [...bundles].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.bundleId < b.bundleId ? -1 : a.bundleId > b.bundleId ? 1 : 0));
  for (const b of ordered) {
    if (ids.has(b.bundleId)) throw new EvidenceError(`duplicate bundle ${b.bundleId}`);
    ids.add(b.bundleId);
    const t = Date.parse(b.createdAt);
    if (!(t >= period.start.getTime() && t < period.end.getTime())) throw new EvidenceError(`bundle ${b.bundleId} is outside the period`);
  }
  const leafBytes = ordered.map(bundleLeaf);
  const levels = buildLevels(leafBytes);
  return {
    rootHex: bytesToHex(levels[levels.length - 1][0]),
    count: ordered.length,
    periodStart: BigInt(Math.floor(period.start.getTime() / 1000)),
    periodEnd: BigInt(Math.floor(period.end.getTime() / 1000)),
    leaves: ordered.map((b, i) => ({ bundleId: b.bundleId, leafHex: bytesToHex(leafBytes[i]), proof: merkleProof(levels, i) })),
  };
}
