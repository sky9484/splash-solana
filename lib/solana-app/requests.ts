/**
 * Get paid (prompt 10 §6.3): payment requests a company sends, and the money that answers them.
 *
 *   A business on Splash   the request lands in its own "Pay an invoice" inbox as a bill, ready to
 *                          pay; it is paid with a `peer` payment straight into the requester's own
 *                          Payments account. When that payment is final, the request is paid.
 *   Someone else           a link to a page (app/pay/[slug]) with the requester's own account details,
 *                          the exact amount and the reference. A transfer into the requester's account
 *                          with that reference and that amount pays it (test mode: the simulator).
 *
 * Invariant: the money always lands in the requester's own account. Nothing here, and nothing the pay
 * page shows, is a Splash-owned address (tests/requests.test.mjs).
 *
 * Paid requests get a receipt of kind 5 (`receivable`). Integers only: lines are quantity × unit price
 * in US$ minor units (6 decimals).
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

import { utcDay } from '../solana/kora.ts';
import { isSimulator } from '../solana/simulator.ts';
import { buildReceivableBundle, type ChainSignatureRecord } from '../solana-evidence/bundle.ts';
import { canonicalJson } from '../solana-evidence/canonical.ts';
import { formatUsd } from '../solana-zeke/router.ts';
import { loadCompany, saveCompany } from './company.ts';
import { ServiceError } from './errors.ts';
import { runtime } from './runtime.ts';
import { getOrg, sealEvidence } from './service.ts';
import { store, type IncomingRequest, type InvoiceRecord, type OrgRecord, type PaymentRecord, type PaymentRequestRecord, type ReceivedRecord, type RequestLine } from './store.ts';

const DAY_MS = 86_400_000;
const MAX_LINES = 20;
/** US$1,000,000.00 in 6-decimal minor units: the most one request asks for. */
export const REQUEST_MAX_MINOR = 1_000_000_000_000n;
const NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9/.-]{0,31}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  return bytesToHex(b);
}

/** 128 random bits, URL-safe: the pay link's token. */
function newSlug(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return Buffer.from(b).toString('base64url');
}

const commit = (saltHex: string, value: unknown) => bytesToHex(sha256(concatBytes(hexToBytes(saltHex), utf8ToBytes(canonicalJson(value)))));

function shortDate(isoDay: string): string {
  return new Date(`${isoDay.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Whole days a due date has passed (0 when it hasn't). */
export function daysOverdue(dueDate: string, now: Date): number {
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  const today = Date.parse(`${utcDay(now)}T00:00:00Z`);
  // Both are UTC midnights, so the difference is a whole number of days.
  return today > due ? (today - due) / DAY_MS : 0;
}

/* ── Create ───────────────────────────────────────────────────────────── */

export interface NewRequest {
  /** A business on Splash, as the server's directory found it; or someone else, by name and email. */
  payer: { kind: 'splash'; orgId: string; name: string; handle: string | null; country: string | null } | { kind: 'external'; name: string; email: string };
  number: string;
  dueDate: string;
  lines: Array<{ description: string; quantity: string; unitMinor: string }>;
  myInvoisRef?: string | null;
  note?: string | null;
}

function parseLines(raw: NewRequest['lines']): RequestLine[] {
  if (raw.length === 0) throw new ServiceError('bad_request', 'Add at least one line.', 422);
  if (raw.length > MAX_LINES) throw new ServiceError('bad_request', `A request has at most ${MAX_LINES} lines.`, 422);
  return raw.map((l, i) => {
    const description = l.description.trim().replace(/\s+/g, ' ');
    if (description.length < 2 || description.length > 120) throw new ServiceError('bad_request', `Line ${i + 1}: describe it in 2 to 120 characters.`, 422);
    if (!/^\d{1,6}$/.test(l.quantity) || !/^\d{1,13}$/.test(l.unitMinor)) throw new ServiceError('bad_request', `Line ${i + 1}: the quantity or price isn't a whole number.`, 422);
    const quantity = BigInt(l.quantity);
    const unitMinor = BigInt(l.unitMinor);
    if (quantity <= 0n || unitMinor <= 0n) throw new ServiceError('bad_request', `Line ${i + 1}: the quantity and price are above zero.`, 422);
    // Whole cents only: US$ minor units have 6 decimals, a price has 2.
    if (unitMinor % 10_000n !== 0n) throw new ServiceError('bad_request', `Line ${i + 1}: a price is in whole cents.`, 422);
    return { description, quantity, unitMinor, amountMinor: quantity * unitMinor };
  });
}

function validDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** A request, as a draft: nothing is sent until `sendRequest`. */
export function createRequest(orgId: string, input: NewRequest, by: string, now = new Date()): PaymentRequestRecord {
  const org = getOrg(orgId);
  if (!org.vault) throw new ServiceError('vault_missing', 'Set up your Payments account first: a request is paid into it.', 409);
  const number = input.number.trim();
  if (!NUMBER_RE.test(number)) throw new ServiceError('bad_request', 'Your invoice number is letters, digits and - / . only (up to 32).', 422);
  if (requestsOf(orgId).some((r) => r.state !== 'cancelled' && r.number.toLowerCase() === number.toLowerCase())) {
    throw new ServiceError('duplicate_number', `You already have a request numbered ${number}. Use another number.`, 409);
  }
  if (!validDay(input.dueDate)) throw new ServiceError('bad_request', 'Choose a due date.', 422);
  if (input.dueDate < utcDay(now)) throw new ServiceError('bad_request', 'The due date is in the past.', 422);
  let payer: PaymentRequestRecord['payer'];
  if (input.payer.kind === 'splash') {
    if (input.payer.orgId === orgId) throw new ServiceError('bad_request', 'That is your own company.', 422);
    payer = { kind: 'splash', orgId: input.payer.orgId, name: input.payer.name, handle: input.payer.handle, country: input.payer.country };
  } else {
    const name = input.payer.name.trim().replace(/\s+/g, ' ');
    const email = input.payer.email.trim().toLowerCase();
    if (name.length < 2 || name.length > 120) throw new ServiceError('bad_request', 'Give the payer’s name.', 422);
    if (!EMAIL_RE.test(email)) throw new ServiceError('bad_request', 'Check the payer’s email address.', 422);
    payer = { kind: 'external', name, email };
  }
  const lines = parseLines(input.lines);
  const amountMinor = lines.reduce((n, l) => n + l.amountMinor, 0n);
  if (amountMinor > REQUEST_MAX_MINOR) throw new ServiceError('bad_request', `A request is at most ${formatUsd(REQUEST_MAX_MINOR)}.`, 422);
  const myInvoisRef = (input.myInvoisRef ?? '').trim() || null;
  if (myInvoisRef && !/^[A-Za-z0-9-]{4,64}$/.test(myInvoisRef)) throw new ServiceError('bad_request', 'A MyInvois reference is letters, digits and dashes.', 422);
  const at = now.toISOString();
  const r: PaymentRequestRecord = {
    id: `req_${randomHex(8)}`,
    orgId,
    number,
    payer,
    lines,
    amountMinor,
    dueDate: input.dueDate,
    myInvoisRef,
    note: (input.note ?? '').trim().slice(0, 280) || null,
    state: 'draft',
    slug: null,
    createdAt: at,
    createdBy: by,
    updatedAt: at,
    sentAt: null,
    viewedAt: null,
    paidAt: null,
    billId: null,
    paid: null,
    receiptId: null,
    reminders: [],
    saltHex: randomHex(32),
  };
  store().requests.set(r.id, r);
  return r;
}

export function requestsOf(orgId: string): PaymentRequestRecord[] {
  return [...store().requests.values()].filter((r) => r.orgId === orgId);
}

export function getRequest(orgId: string, requestId: string): PaymentRequestRecord {
  const r = store().requests.get(requestId);
  if (!r || r.orgId !== orgId) throw new ServiceError('request_not_found', 'That request is not on your list.', 404);
  return r;
}

/* ── Send ─────────────────────────────────────────────────────────────── */

/** What lands in a Splash payer's inbox: no salt, no email, no account number. */
function incomingOf(r: PaymentRequestRecord, org: OrgRecord): IncomingRequest {
  return {
    requestId: r.id,
    requesterOrgId: r.orgId,
    requesterName: org.companyName,
    number: r.number,
    dueDate: r.dueDate,
    lines: r.lines.map((l) => ({ description: l.quantity === 1n ? l.description : `${l.description} × ${l.quantity}`, amountMinor: l.amountMinor })),
    note: r.note,
    myInvoisRef: r.myInvoisRef,
    sentAt: r.sentAt!,
  };
}

/**
 * Send a draft. A business on Splash: a bill in its inbox, ready to pay, paid into this company's own
 * account. Someone else: a pay link. Sending twice changes nothing.
 */
export async function sendRequest(orgId: string, requestId: string, now = new Date()): Promise<PaymentRequestRecord> {
  const r = getRequest(orgId, requestId);
  if (r.state === 'sent' || r.state === 'paid') return r;
  if (r.state !== 'draft') throw new ServiceError('wrong_state', 'This request was cancelled. Make a new one.', 409);
  const org = getOrg(orgId);
  const vault = org.vault;
  if (!vault) throw new ServiceError('vault_missing', 'Set up your Payments account first: a request is paid into it.', 409);
  const at = now.toISOString();
  r.sentAt = at;
  r.updatedAt = at;
  if (r.payer.kind === 'splash') {
    const payerOrgId = r.payer.orgId;
    await loadCompany(payerOrgId);
    const bill: InvoiceRecord = {
      id: `inv_${randomHex(8)}`,
      orgId: payerOrgId,
      createdAt: at,
      source: 'request',
      request: incomingOf(r, org),
      // Where the money lands: the requester's own Payments account, from the server's record of it.
      peer: { payeeOrgId: orgId, payeeName: org.companyName, payeeHandle: null, payeeCountry: null, payeeVaultPda: vault.vaultPda, amountUsdMinor: r.amountMinor, note: r.note },
      draft: {
        draft: true,
        extractor: 'none',
        fields: { invoiceNumber: r.number, supplierName: org.companyName, supplierBank: 'Splash', supplierAccountLast4: '', amountPhpMinor: 0n, dueDate: r.dueDate },
        sources: {},
        suspicious: false,
        suspiciousReasons: [],
        needsConfirmation: [],
        notes: [`Requested by ${org.companyName} on Splash. Nothing was read.`],
      },
      bankStatus: 'known',
      bankVerification: null,
      confirmed: null,
      saltHex: null,
    };
    store().invoices.set(bill.id, bill);
    r.billId = bill.id;
    await saveCompany(payerOrgId);
  } else {
    r.slug = newSlug();
    store().paylinks.set(r.slug, { slug: r.slug, requestId: r.id, orgId });
  }
  r.state = 'sent';
  return r;
}

/**
 * Cancel a request that isn't paid. Its link stops working; a Splash payer's bill leaves its inbox and
 * can't be paid any more. A payment the payer already sent is still recorded as money in.
 */
export async function cancelRequest(orgId: string, requestId: string, now = new Date()): Promise<PaymentRequestRecord> {
  const r = getRequest(orgId, requestId);
  if (r.state === 'paid') throw new ServiceError('wrong_state', 'This request is paid. It can’t be cancelled.', 409);
  const at = now.toISOString();
  r.state = 'cancelled';
  r.updatedAt = at;
  if (r.slug) store().paylinks.delete(r.slug);
  if (r.payer.kind === 'splash' && r.billId) {
    await loadCompany(r.payer.orgId);
    const bill = store().invoices.get(r.billId);
    if (bill?.request && !bill.confirmed) {
      bill.request.cancelledAt = at;
      bill.dismissed = { at, by: `${getOrg(orgId).companyName} cancelled the request` };
    } else if (bill?.request) {
      bill.request.cancelledAt = at;
    }
    await saveCompany(r.payer.orgId);
  }
  return r;
}

/** A reminder: in a Splash payer's inbox the bill says so; someone else gets the link again (copied here). */
export async function remindRequest(orgId: string, requestId: string, by: string, now = new Date()): Promise<{ request: PaymentRequestRecord; channel: 'inbox' | 'link' }> {
  const r = getRequest(orgId, requestId);
  if (r.state !== 'sent') throw new ServiceError('wrong_state', r.state === 'paid' ? 'This request is paid.' : 'Send the request first.', 409);
  const at = now.toISOString();
  r.reminders.push({ at, by });
  r.updatedAt = at;
  if (r.payer.kind === 'splash' && r.billId) {
    await loadCompany(r.payer.orgId);
    const bill = store().invoices.get(r.billId);
    if (bill?.request) bill.request.remindedAt = at;
    await saveCompany(r.payer.orgId);
    return { request: r, channel: 'inbox' };
  }
  return { request: r, channel: 'link' };
}

/** The payer saw it: a Splash payer's inbox listed it, or someone opened its link. Once. */
export async function markRequestViewed(requesterOrgId: string, requestId: string, now = new Date()): Promise<void> {
  await loadCompany(requesterOrgId);
  const r = store().requests.get(requestId);
  if (!r || r.orgId !== requesterOrgId || r.viewedAt || r.state !== 'sent') return;
  r.viewedAt = now.toISOString();
  await saveCompany(requesterOrgId);
}

/* ── Views ────────────────────────────────────────────────────────────── */

type Tone = 'amber' | 'ok' | 'ink' | 'danger' | 'gold';

export function requestStatus(r: PaymentRequestRecord, now: Date): { key: 'draft' | 'sent' | 'viewed' | 'overdue' | 'paid' | 'cancelled'; tone: Tone; label: string } {
  if (r.state === 'draft') return { key: 'draft', tone: 'ink', label: 'Draft' };
  if (r.state === 'cancelled') return { key: 'cancelled', tone: 'ink', label: 'Cancelled' };
  if (r.state === 'paid') return { key: 'paid', tone: 'ok', label: r.receiptId ? 'Paid · proof recorded' : 'Paid' };
  const late = daysOverdue(r.dueDate, now);
  if (late > 0) return { key: 'overdue', tone: 'amber', label: `Overdue · ${late} ${late === 1 ? 'day' : 'days'}` };
  if (r.viewedAt) return { key: 'viewed', tone: 'ink', label: `Viewed ${shortDate(r.viewedAt)}` };
  return { key: 'sent', tone: 'ink', label: `Sent ${shortDate(r.sentAt!)}` };
}

export function requestRow(r: PaymentRequestRecord, now: Date) {
  const status = requestStatus(r, now);
  return {
    id: r.id,
    number: r.number,
    payer: r.payer.kind === 'splash' ? { kind: 'splash' as const, name: r.payer.name, detail: 'on Splash' } : { kind: 'external' as const, name: r.payer.name, detail: 'pays by link', email: r.payer.email },
    amountMinor: r.amountMinor,
    lines: r.lines,
    dueDate: r.dueDate,
    dueLabel: r.state === 'paid' && r.paidAt ? `Paid ${shortDate(r.paidAt)}` : shortDate(r.dueDate),
    status,
    myInvoisRef: r.myInvoisRef,
    note: r.note,
    createdAt: r.createdAt,
    sentAt: r.sentAt,
    viewedAt: r.viewedAt,
    paidAt: r.paidAt,
    reminders: r.reminders.length,
    lastReminderAt: r.reminders.at(-1)?.at ?? null,
    /** Someone else's link, as a path on this site. */
    link: r.slug ? `/pay/${r.slug}` : null,
    receiptHref: r.receiptId ? `/dashboard/receipts/${r.receiptId}` : null,
    paidBy: r.paid?.by ?? null,
  };
}

/** Get paid's list: newest first, with what is still owed. */
export function requestsView(orgId: string, now = new Date()) {
  const all = requestsOf(orgId).filter((r) => r.state !== 'cancelled');
  all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const unpaid = all.filter((r) => r.state === 'sent');
  const overdue = unpaid.filter((r) => daysOverdue(r.dueDate, now) > 0);
  const org = getOrg(orgId);
  return {
    requests: all.map((r) => requestRow(r, now)),
    unpaidMinor: unpaid.reduce((n, r) => n + r.amountMinor, 0n),
    unpaidCount: unpaid.length,
    overdueCount: overdue.length,
    companyName: org.companyName,
    hasAccount: Boolean(org.vault),
  };
}

/** For Overview's "Needs you": requests past their due date, the oldest first. */
export function overdueRequests(orgId: string, now = new Date()) {
  return requestsOf(orgId)
    .filter((r) => r.state === 'sent' && daysOverdue(r.dueDate, now) > 0)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
    .map((r) => ({ payer: r.payer.name, amount: formatUsd(r.amountMinor), daysOverdue: daysOverdue(r.dueDate, now), reference: r.number, href: `/dashboard/invoices/get?request=${r.id}` }));
}

/* ── The pay link (someone else) ──────────────────────────────────────── */

/**
 * What the pay page shows, read by its token. The account is the requester's own Payments account
 * and nothing else; the page is the one place outside Settings that shows an account ID, inside its
 * "Pay from a crypto wallet" section (prompt 10 §0.6, the allowed zone).
 */
export async function payLinkView(slug: string, opts: { markViewed?: boolean; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const link = store().paylinks.get(slug);
  const owner = link?.orgId ?? (await runtime().docs.ownerOf('paylink', slug));
  if (!owner) return null;
  await loadCompany(owner);
  const l = store().paylinks.get(slug);
  const r = l ? store().requests.get(l.requestId) : undefined;
  const org = store().orgs.get(owner);
  if (!l || !r || !org || r.orgId !== owner || r.slug !== slug || r.state === 'draft' || r.state === 'cancelled' || r.payer.kind !== 'external' || !org.vault) return null;
  if (opts.markViewed && r.state === 'sent' && !r.viewedAt) {
    r.viewedAt = now.toISOString();
    await saveCompany(owner);
  }
  const rt = runtime();
  return {
    requester: { name: org.companyName },
    payerName: r.payer.name,
    number: r.number,
    dueDate: r.dueDate,
    dueLabel: shortDate(r.dueDate),
    overdueDays: r.state === 'sent' ? daysOverdue(r.dueDate, now) : 0,
    lines: r.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitMinor: l.unitMinor, amountMinor: l.amountMinor })),
    amountMinor: r.amountMinor,
    note: r.note,
    myInvoisRef: r.myInvoisRef,
    paid: r.state === 'paid',
    paidAt: r.paidAt,
    /** The requester's own Payments account: where the money lands. Never a Splash address. */
    account: { address: org.vault.vaultPda, network: 'Solana' as const, asset: 'USDC' as const, cluster: org.vault.cluster },
    /** Put this in the transfer's memo: with the exact amount, it is how the payment is matched. */
    reference: r.number,
    /** No collection partner yet: "Pay by bank transfer" stays hidden. */
    bankTransfer: null,
    testMode: isSimulator(rt.chain) || rt.env.mode === 'offline' || org.vault.cluster !== 'mainnet-beta',
    simulator: isSimulator(rt.chain),
  };
}

export type PayLinkView = NonNullable<Awaited<ReturnType<typeof payLinkView>>>;

/**
 * Test mode: someone pays the link from a wallet. The simulator moves the exact amount into the
 * requester's own account with the reference in the memo, and the transfer is matched like any other.
 * Refused on devnet (there, a real transfer pays it; matching it is not wired in this build).
 */
export async function simulateLinkPayment(slug: string, now = new Date()): Promise<{ matched: boolean; requestId: string }> {
  const view = await payLinkView(slug, { now });
  if (!view) throw new ServiceError('request_not_found', 'This payment link isn’t valid any more.', 404);
  if (view.paid) throw new ServiceError('wrong_state', 'This request is already paid.', 409);
  const rt = runtime();
  if (!isSimulator(rt.chain)) throw new ServiceError('sandbox_only', 'Paying a link in the app is test mode only.', 409);
  const l = store().paylinks.get(slug)!;
  const r = store().requests.get(l.requestId)!;
  const org = getOrg(r.orgId);
  const receipt = await rt.chain.fundUsdc(org.vault!.vaultPda, r.amountMinor);
  const matched = await receiveIntoAccount(r.orgId, { amountMinor: r.amountMinor, memo: view.reference, signature: receipt.signature, simulated: true, from: { kind: 'link', name: r.payer.kind === 'external' ? r.payer.name : 'Payer' } }, now);
  await saveCompany(r.orgId);
  return { matched: matched !== null, requestId: r.id };
}

/**
 * Money arrived in the company's own Payments account from outside: record it, and pay the sent
 * request whose reference is the memo and whose amount is exactly the amount (oldest first). A transfer
 * that matches nothing is still recorded, as money in. Returns the request it paid, if any.
 */
export async function receiveIntoAccount(
  orgId: string,
  input: { amountMinor: bigint; memo: string | null; signature: string; simulated: boolean; from: ReceivedRecord['from']; paymentId?: string | null; requestId?: string | null },
  now = new Date(),
): Promise<PaymentRequestRecord | null> {
  const org = getOrg(orgId);
  org.received ??= [];
  if (org.received.some((x) => x.signature === input.signature)) return null;
  const memo = input.memo?.trim() ?? null;
  const r =
    (input.requestId ? store().requests.get(input.requestId) : undefined) ??
    requestsOf(orgId)
      .filter((x) => x.state === 'sent' && x.payer.kind === 'external' && memo !== null && x.number === memo && x.amountMinor === input.amountMinor)
      .sort((a, b) => (a.sentAt! < b.sentAt! ? -1 : 1))[0];
  // A Splash payment pays only the request sent to the company that paid it.
  const fromOk = !r || (input.from.kind === 'splash' ? r.payer.kind === 'splash' && r.payer.orgId === input.from.orgId : r.payer.kind === 'external');
  const target = r && fromOk && r.orgId === orgId && r.state === 'sent' && r.amountMinor === input.amountMinor ? r : undefined;
  const at = now.toISOString();
  org.received.push({ id: `rcv_${randomHex(6)}`, at, amountMinor: input.amountMinor, from: input.from, requestId: target?.id ?? null, paymentId: input.paymentId ?? null, signature: input.signature, memo, simulated: input.simulated });
  if (!target) return null;
  target.state = 'paid';
  target.paidAt = at;
  target.updatedAt = at;
  target.paid = input.paymentId ? { by: 'splash', paymentId: input.paymentId, signature: input.signature } : { by: 'link', signature: input.signature };
  const vault = org.vault!;
  const receiptId = `rcpt_${randomHex(8)}`;
  const signature: ChainSignatureRecord = { purpose: input.paymentId ? 'squads_vault_execute' : 'spl_transfer', network: 'solana', signature: input.signature, cluster: vault.cluster, simulated: input.simulated };
  const bundle = buildReceivableBundle({
    requestId: target.id,
    createdAt: at,
    payee: { orgId, name: org.companyName, account: vault.vaultPda },
    payer: target.payer.kind === 'splash' ? { kind: 'splash', orgId: target.payer.orgId } : { kind: 'external', commitmentHex: commit(target.saltHex, { name: target.payer.name, email: target.payer.email }) },
    amount: { currency: 'USD', amountMinor: target.amountMinor },
    request: { commitmentHex: commit(target.saltHex, { number: target.number, dueDate: target.dueDate, lines: target.lines, amountMinor: target.amountMinor }), einvoiceRef: target.myInvoisRef },
    incoming: { to: vault.vaultPda, amountMinor: input.amountMinor, memo },
    match: input.paymentId ? { method: 'splash_payment', paymentId: input.paymentId } : { method: 'reference_and_amount', reference: target.number },
    chain: { signatures: [signature] },
    receipt: { receiptId, issuedAt: at, simulated: input.simulated || runtime().env.mode === 'offline' },
  });
  const record = await sealEvidence({ id: target.id }, org, bundle, receiptId);
  target.receiptId = record.receiptId;
  return target;
}

/**
 * A `peer` payment is final (service.ts settleEvidence): the payee records the money in, and the
 * request it paid, if it paid one, is paid. Runs in the payer's request: the payee's documents are
 * loaded and written back here. Safe to run twice.
 */
export async function recordSplashPaymentReceived(p: PaymentRecord, now = new Date()): Promise<void> {
  const inv = store().invoices.get(p.invoiceId);
  const peer = inv?.peer;
  if (!inv || !peer) return;
  const payeeOrgId = peer.payeeOrgId;
  await loadCompany(payeeOrgId);
  const payee = store().orgs.get(payeeOrgId);
  if (!payee?.vault || payee.vault.vaultPda !== peer.payeeVaultPda) return;
  const execute = p.signatures.find((s) => s.purpose === 'squads_vault_execute') ?? p.signatures.at(-1);
  if (!execute) return;
  const payer = store().orgs.get(p.orgId);
  await receiveIntoAccount(
    payeeOrgId,
    { amountMinor: peer.amountUsdMinor, memo: inv.confirmed?.invoiceNumber ?? null, signature: execute.signature, simulated: execute.simulated, from: { kind: 'splash', orgId: p.orgId, name: payer?.companyName ?? 'A business on Splash' }, paymentId: p.id, requestId: inv.request?.requestId ?? null },
    now,
  );
  await saveCompany(payeeOrgId);
}
