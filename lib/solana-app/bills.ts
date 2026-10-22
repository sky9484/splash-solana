/**
 * Pay an invoice (prompt 10 §6.2): the bills inbox and "Check the invoice".
 *
 *   inbox      every bill (an invoice Zeke read, or a request from a business on Splash) on one of four
 *              tabs, To check / Ready to pay / Waiting for approval / Paid, from its own record and its
 *              latest payment. Counts for the chooser and the sidebar come from here too.
 *   check      the document with its lines numbered, the bank account masked, where each field came
 *              from, and the amber panel when the bank details are new or changed.
 *   call-back  who verified, who they spoke to, the number they called (from the company's own records,
 *              never one printed on the invoice), and when. Until then the bill can't be paid.
 *   pay        confirm, then quote: the payment opens on Transfer's Step 3 (one engine, one approval card).
 *
 * Integers only. No full account number leaves this module: the document is stored masked.
 */
import { utcDay } from '../solana/kora.ts';
import type { InvoiceFieldName } from '../solana-zeke/reader.ts';
import { loadCompany } from './company.ts';
import { ServiceError } from './errors.ts';
import { bankCodeFor, itemsCheck, maskedAccount, numberIsInDocument } from './invoice-document.ts';
import { isCommitted, type PaymentState } from './payment-machine.ts';
import { markRequestViewed } from './requests.ts';
import { runtime } from './runtime.ts';
import { confirmInvoice, confirmRequestBill, getInvoice, getOrg, quote } from './service.ts';
import { isBill, store, type InvoiceRecord, type PaymentRecord } from './store.ts';

const DAY_MS = 86_400_000;

export type BillTab = 'check' | 'ready' | 'waiting' | 'paid';
type Tone = 'coral' | 'amber' | 'ok' | 'ink' | 'danger';

const WAITING: PaymentState[] = ['checked', 'proposed'];
const REQUOTABLE: PaymentState[] = ['quoted', 'checked', 'rejected_by_policy', 'quote_expired', 'proposal_failed'];
const FAILED_TO_SEND: PaymentState[] = ['execute_failed', 'proposal_failed'];

function shortDate(isoDay: string): string {
  return new Date(`${isoDay.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Days from today to a due date: negative when it has passed. */
function daysUntil(dueDate: string, now: Date): number {
  // Both are UTC midnights, so the difference is a whole number of days.
  return (Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${utcDay(now)}T00:00:00Z`)) / DAY_MS;
}

/** The bill's latest payment that isn't discarded: what it is doing now. */
function latestPayments(all: PaymentRecord[]): Map<string, PaymentRecord> {
  const m = new Map<string, PaymentRecord>();
  for (const p of all) {
    if (p.state === 'discarded') continue;
    const prev = m.get(p.invoiceId);
    if (!prev || p.createdAt > prev.createdAt) m.set(p.invoiceId, p);
  }
  return m;
}

const fieldsOf = (inv: InvoiceRecord) => inv.confirmed ?? inv.draft.fields;

/** "Due 24 Oct", amber within three days ("in 3 days", "today", "tomorrow") and once it has passed. */
function dueOf(dueDate: string, now: Date, paidAt: string | null): { label: string; tone: Tone | null } {
  if (paidAt) return { label: `Paid ${shortDate(paidAt)}`, tone: null };
  if (!dueDate) return { label: '—', tone: null };
  const d = daysUntil(dueDate, now);
  const day = shortDate(dueDate);
  if (d < 0) return { label: `Overdue · ${-d} ${d === -1 ? 'day' : 'days'}`, tone: 'amber' };
  if (d === 0) return { label: `Due ${day} · today`, tone: 'amber' };
  if (d === 1) return { label: `Due ${day} · tomorrow`, tone: 'amber' };
  if (d <= 3) return { label: `Due ${day} · in ${d} days`, tone: 'amber' };
  return { label: `Due ${day}`, tone: null };
}

/** Whether a bill's bank details still wait for a call-back. A request from a Splash business has none. */
export function needsCallBack(inv: InvoiceRecord): boolean {
  if (inv.source === 'request') return false;
  if (inv.bankStatus === 'known') return false;
  const f = inv.draft.fields;
  const v = inv.bankVerification;
  return !(v && v.bank === f.supplierBank && v.accountLast4 === f.supplierAccountLast4);
}

export interface BillRow {
  id: string;
  tab: BillTab;
  supplier: string;
  /** A request from a business on Splash: "on Splash". */
  from: 'invoice' | 'splash';
  number: string;
  due: { label: string; tone: Tone | null };
  amount: { currency: 'PHP' | 'USD'; minor: bigint };
  status: { tone: Tone; label: string };
  /** One action: open the check, pay (confirm and quote), or follow the payment. */
  action: { kind: 'check' | 'pay' | 'open'; label: string; href: string | null };
  paymentId: string | null;
  createdAt: string;
}

function rowFor(inv: InvoiceRecord, p: PaymentRecord | undefined, now: Date): BillRow {
  const f = fieldsOf(inv);
  const request = inv.request ?? null;
  const amount = request && inv.peer ? { currency: 'USD' as const, minor: inv.peer.amountUsdMinor } : { currency: 'PHP' as const, minor: f.amountPhpMinor };
  const base = { id: inv.id, supplier: request ? request.requesterName : f.supplierName, from: request ? ('splash' as const) : ('invoice' as const), number: f.invoiceNumber, amount, paymentId: p?.id ?? null, createdAt: inv.createdAt };
  const due = (paidAt: string | null) => dueOf(request?.dueDate ?? f.dueDate, now, paidAt);
  const transfer = (step: 'approve' | 'track' | 'quote') => `/dashboard/transfer?payment=${p!.id}&step=${step}`;

  if (p && isCommitted(p.state)) {
    if (p.state === 'partner_failed') {
      return { ...base, tab: 'ready', due: due(null), status: { tone: 'danger', label: 'Returned by the bank · pay again' }, action: { kind: 'pay', label: 'Pay', href: null } };
    }
    if (FAILED_TO_SEND.includes(p.state)) {
      return { ...base, tab: 'waiting', due: due(null), status: { tone: 'danger', label: 'Couldn’t send · nothing left your account' }, action: { kind: 'open', label: 'Open', href: transfer('track') } };
    }
    const done = p.state === 'evidenced' || p.state === 'anchored';
    if (done && p.receiptId) {
      return { ...base, tab: 'paid', due: due(p.timeline.paidAt ?? p.execution.confirmedAt ?? p.updatedAt), status: { tone: 'ok', label: 'Paid · proof recorded' }, action: { kind: 'open', label: 'Receipt', href: `/dashboard/receipts/${p.receiptId}` } };
    }
    const paid = p.state === 'partner_paid' || p.state === 'evidence_failed' || (p.kind === 'peer' && p.state === 'confirmed');
    return { ...base, tab: 'paid', due: due(paid ? (p.timeline.paidAt ?? p.updatedAt) : null), status: { tone: paid ? 'ok' : 'ink', label: paid ? 'Paid · recording proof' : 'On its way' }, action: { kind: 'open', label: 'Track', href: transfer('track') } };
  }
  if (p && WAITING.includes(p.state)) {
    return { ...base, tab: 'waiting', due: due(null), status: { tone: 'coral', label: 'Waiting for approval' }, action: { kind: 'open', label: 'Review', href: transfer('approve') } };
  }
  if (request) {
    const reminded = request.remindedAt ? `Reminder ${shortDate(request.remindedAt)}` : null;
    return { ...base, tab: 'ready', due: due(null), status: { tone: reminded ? 'amber' : 'ink', label: reminded ?? 'From a business on Splash' }, action: p ? { kind: 'open', label: 'Continue', href: transfer('quote') } : { kind: 'pay', label: 'Pay', href: null } };
  }
  if (inv.confirmed) {
    if (p && p.state === 'rejected_by_policy') return { ...base, tab: 'ready', due: due(null), status: { tone: 'danger', label: 'Stopped by a rule' }, action: { kind: 'open', label: 'Open', href: transfer('quote') } };
    return { ...base, tab: 'ready', due: due(null), status: { tone: 'ink', label: 'Checked' }, action: p ? { kind: 'open', label: 'Continue', href: transfer('quote') } : { kind: 'pay', label: 'Pay', href: null } };
  }
  const href = `/dashboard/invoices/pay?invoice=${inv.id}`;
  if (needsCallBack(inv)) {
    return { ...base, tab: 'check', due: due(null), status: { tone: 'amber', label: inv.bankStatus === 'changed' ? 'Changed bank details · verify' : 'New bank details · verify' }, action: { kind: 'check', label: 'Check', href } };
  }
  if (inv.draft.suspicious) return { ...base, tab: 'check', due: due(null), status: { tone: 'amber', label: 'Zeke flagged it · check' }, action: { kind: 'check', label: 'Check', href } };
  return { ...base, tab: 'check', due: due(null), status: { tone: 'ink', label: inv.bankVerification ? 'Called back · ready to check' : 'Read by Zeke' }, action: { kind: 'check', label: 'Check', href } };
}

/**
 * Checked invoices to a bank, ready to pay, for Transfer's Step 2 chip (prompt 11 §2.3): the supplier,
 * the bank (and its code) and the last 4 digits the invoice names, its number and amount. A read with no side
 * effects (unlike billsView, it marks no request as seen). The chip pays through payBill, which picks
 * up the invoice's open payment when it has one, so an invoice is never paid twice. A bill stopped by
 * a rule or returned by the bank isn't offered: it needs a look first.
 */
export async function readyBankBills(orgId: string, now = new Date()) {
  getOrg(orgId);
  const bills = [...store().invoices.values()].filter((i) => i.orgId === orgId && isBill(i) && !i.dismissed && !i.request);
  const latest = latestPayments(await runtime().payments.listByOrg(orgId));
  return bills
    .map((i) => ({ inv: i, row: rowFor(i, latest.get(i.id), now) }))
    .filter(({ row }) => row.tab === 'ready' && row.status.tone !== 'danger' && row.amount.currency === 'PHP')
    .map(({ inv, row }) => {
      const f = fieldsOf(inv);
      // The bank as the invoice prints it ("BDO Unibank, Inc.") and its code (BDO), which a saved recipient carries.
      return { id: row.id, number: row.number, supplier: row.supplier, bank: f.supplierBank, bankCode: bankCodeFor(f.supplierBank), last4: f.supplierAccountLast4, amountPhpMinor: row.amount.minor };
    });
}

/** The inbox: every bill on its tab, newest first, with the counts the chooser and the tabs show. */
export async function billsView(orgId: string, now = new Date()) {
  getOrg(orgId);
  const bills = [...store().invoices.values()].filter((i) => i.orgId === orgId && isBill(i) && !i.dismissed);
  const latest = latestPayments(await runtime().payments.listByOrg(orgId));
  const rows = bills.map((i) => rowFor(i, latest.get(i.id), now));
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const counts: Record<BillTab, number> = { check: 0, ready: 0, waiting: 0, paid: 0 };
  for (const r of rows) counts[r.tab]++;
  // A request from a business on Splash that the inbox now shows: its sender sees "Viewed".
  for (const i of bills) {
    if (!i.request || i.request.seenAt) continue;
    i.request.seenAt = now.toISOString();
    await markRequestViewed(i.request.requesterOrgId, i.request.requestId, now).catch(() => undefined);
  }
  return { rows, counts };
}

/** For the chooser: the same counts, and nothing else. */
export async function billCounts(orgId: string, now = new Date()) {
  const bills = [...store().invoices.values()].filter((i) => i.orgId === orgId && isBill(i) && !i.dismissed);
  const latest = latestPayments(await runtime().payments.listByOrg(orgId));
  const counts: Record<BillTab, number> = { check: 0, ready: 0, waiting: 0, paid: 0 };
  for (const i of bills) counts[rowFor(i, latest.get(i.id), now).tab]++;
  return counts;
}

/* ── Check the invoice ────────────────────────────────────────────────── */

export const CHECK_FIELDS: InvoiceFieldName[] = ['supplierName', 'invoiceNumber', 'dueDate', 'amountPhpMinor', 'supplierAccountLast4'];
const FIELD_LABEL: Record<InvoiceFieldName, string> = {
  supplierName: 'Supplier',
  invoiceNumber: 'Invoice number',
  dueDate: 'Due date',
  amountPhpMinor: 'Amount',
  supplierBank: 'Bank',
  supplierAccountLast4: 'Bank account',
  einvoiceRef: 'MyInvois reference',
};

/** Whether this supplier's invoice number was already paid, or is already in the inbox, by this company. */
async function duplicateOf(inv: InvoiceRecord): Promise<{ paidAt: string | null; receiptId: string | null; otherBillId: string | null } | null> {
  const f = fieldsOf(inv);
  const same = [...store().invoices.values()].filter((i) => i.orgId === inv.orgId && i.id !== inv.id && isBill(i) && !i.dismissed && fieldsOf(i).invoiceNumber === f.invoiceNumber && fieldsOf(i).supplierName.toLowerCase() === f.supplierName.toLowerCase());
  if (same.length === 0) return null;
  const latest = latestPayments(await runtime().payments.listByOrg(inv.orgId));
  for (const i of same) {
    const p = latest.get(i.id);
    if (p && isCommitted(p.state) && p.state !== 'partner_failed') return { paidAt: p.timeline.paidAt ?? p.execution.confirmedAt ?? p.updatedAt, receiptId: p.receiptId, otherBillId: i.id };
  }
  return { paidAt: null, receiptId: null, otherBillId: same[0]!.id };
}

/**
 * "Check the invoice": the masked document, Zeke's draft with where each field came from, the bank
 * panel. `viewer` decides whether "Show number" is offered (owner or finance admin, device set up).
 */
export async function checkView(orgId: string, invoiceId: string, viewer: { isOwner: boolean; role?: string; hasDevice: boolean }, now = new Date()) {
  const org = getOrg(orgId);
  const inv = getInvoice(orgId, invoiceId);
  if (!isBill(inv) || inv.source === 'request') throw new ServiceError('bad_request', 'Only an invoice Zeke read has a document to check.', 400);
  const f = inv.draft.fields;
  const lines = inv.document?.lines ?? null;
  const src = inv.draft.sources;
  const lineOf = (k: InvoiceFieldName) => src[k]?.line ?? null;
  const bankLines = new Set([lineOf('supplierBank'), lineOf('supplierAccountLast4')].filter((x): x is number => x !== null));
  const fieldLines = new Set(CHECK_FIELDS.filter((k) => k !== 'supplierAccountLast4').map(lineOf).filter((x): x is number => x !== null && !bankLines.has(x)));
  const known = org.suppliers.find((s) => s.name.toLowerCase() === f.supplierName.toLowerCase() && s.verified);
  const duplicate = await duplicateOf(inv);
  const items = lines ? itemsCheck(lines, lineOf('amountPhpMinor'), f.amountPhpMinor) : null;

  const help: Partial<Record<InvoiceFieldName, { text: string; tone: Tone | null }>> = {
    supplierName: { text: known ? 'a supplier you have paid before' : 'new to you', tone: null },
    invoiceNumber: duplicate?.paidAt
      ? { text: `already paid on ${shortDate(duplicate.paidAt)}. Check it isn’t the same invoice`, tone: 'amber' }
      : duplicate
        ? { text: 'another copy is in your inbox', tone: 'amber' }
        : { text: 'not paid before', tone: null },
    dueDate: (() => {
      const d = f.dueDate ? daysUntil(f.dueDate, now) : null;
      return d !== null && d < 0 ? { text: `${-d} ${d === -1 ? 'day' : 'days'} overdue`, tone: 'amber' as const } : d !== null && d <= 3 ? { text: d === 0 ? 'due today' : `due in ${d} ${d === 1 ? 'day' : 'days'}`, tone: 'amber' as const } : { text: '', tone: null };
    })(),
    amountPhpMinor: items
      ? items.matches
        ? { text: `matches the ${items.count === 2 ? 'two' : items.count} lines above it`, tone: null }
        : { text: `the lines above add up to a different amount (₱${(items.sumMinor / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(items.sumMinor % 100n).toString().padStart(2, '0')}). Check it`, tone: 'amber' }
      : { text: '', tone: null },
  };

  const saved = org.suppliers.filter((s) => s.name.toLowerCase() === f.supplierName.toLowerCase());
  const previous = inv.bankStatus === 'changed' ? (saved.find((s) => s.verified && !s.pendingCallBack) ?? saved[0] ?? null) : null;
  const v = inv.bankVerification;
  const verified = v && v.bank === f.supplierBank && v.accountLast4 === f.supplierAccountLast4 ? v : null;

  return {
    id: inv.id,
    supplierName: f.supplierName,
    number: f.invoiceNumber,
    readAt: inv.createdAt,
    extractor: inv.draft.extractor,
    suspicious: inv.draft.suspicious,
    suspiciousReasons: inv.draft.suspiciousReasons,
    document: lines,
    /** 1-based line → why it is lit: a field Zeke read (mint), or the bank details (amber). */
    highlights: Object.fromEntries([...[...fieldLines].map((l) => [String(l), 'field'] as const), ...[...bankLines].map((l) => [String(l), 'bank'] as const)]),
    // A MyInvois reference Zeke found is checked too: every field read is confirmed by a person.
    fields: [...CHECK_FIELDS, ...(f.einvoiceRef ? (['einvoiceRef'] as const) : [])].map((k) => ({
      key: k,
      label: FIELD_LABEL[k],
      line: lineOf(k),
      grounded: src[k]?.grounded ?? false,
      help: help[k] ?? { text: '', tone: null },
    })),
    values: {
      supplierName: f.supplierName,
      invoiceNumber: f.invoiceNumber,
      dueDate: f.dueDate,
      amountPhpMinor: f.amountPhpMinor,
      supplierBank: f.supplierBank,
      supplierAccountLast4: f.supplierAccountLast4,
      einvoiceRef: f.einvoiceRef ?? null,
    },
    bank: {
      name: f.supplierBank,
      last4: f.supplierAccountLast4,
      masked: maskedAccount(f.supplierAccountLast4),
      /** A full number was printed and is sealed: "Show number" has something to show. */
      full: Boolean(inv.accountSecretId),
      mayReveal: (viewer.isOwner || viewer.role === 'admin') && viewer.hasDevice,
      line: lineOf('supplierAccountLast4'),
    },
    panel:
      inv.bankStatus === 'known'
        ? null
        : {
            status: inv.bankStatus,
            previous: previous ? { bank: previous.bank, last4: previous.accountLast4, masked: maskedAccount(previous.accountLast4) } : null,
            asked: { bank: f.supplierBank, last4: f.supplierAccountLast4, masked: maskedAccount(f.supplierAccountLast4) },
            verified: verified ? { by: verified.by, at: verified.at, spokeTo: verified.spokeTo ?? null, numberCalled: verified.numberCalled ?? null } : null,
          },
    canVerify: viewer.role !== 'viewer',
    confirmed: Boolean(inv.confirmed),
    duplicate,
  };
}

/* ── The call-back ────────────────────────────────────────────────────── */

const PHONE = /^\+?[\d\s()-]{6,24}$/;

/**
 * "Record the call-back": who answered, the number called (from the company's own records), by whom
 * and when. A number printed on the invoice is refused: calling it checks nothing.
 */
export function recordCallBack(orgId: string, invoiceId: string, input: { by: string; spokeTo: string; numberCalled: string; role?: string }, now = new Date()) {
  const inv = getInvoice(orgId, invoiceId);
  if (input.role === 'viewer') throw new ServiceError('not_authorized', 'A viewer can’t mark bank details as checked. Ask a finance admin or the owner.', 403);
  if (inv.confirmed) throw new ServiceError('wrong_state', 'This invoice is already confirmed.', 409);
  if (inv.source === 'request' || !isBill(inv)) throw new ServiceError('bad_request', 'This bill has no bank details to call back.', 400);
  const spokeTo = input.spokeTo.trim().replace(/\s+/g, ' ');
  const numberCalled = input.numberCalled.trim().replace(/\s+/g, ' ');
  if (spokeTo.length < 2 || spokeTo.length > 80) throw new ServiceError('bad_request', 'Say who you spoke to.', 422);
  if (!PHONE.test(numberCalled) || numberCalled.replace(/\D/g, '').length < 6) throw new ServiceError('bad_request', 'Give the number you called.', 422);
  if (inv.document && numberIsInDocument(inv.document.lines, numberCalled)) {
    throw new ServiceError('number_on_invoice', 'That number is printed on this invoice. Call a number from your own records, then record that one.', 422);
  }
  const f = inv.draft.fields;
  inv.bankVerification = { by: input.by.trim() || 'Finance manager', method: 'call-back', at: now.toISOString(), spokeTo, numberCalled, bank: f.supplierBank, accountLast4: f.supplierAccountLast4 };
  return inv.bankVerification;
}

/** "Not this one": the bill leaves the inbox. Its sealed number is destroyed later (the route schedules it). */
export async function dismissBill(orgId: string, invoiceId: string, by: string, now = new Date()) {
  const inv = getInvoice(orgId, invoiceId);
  if (!isBill(inv)) throw new ServiceError('bad_request', 'That is not a bill.', 400);
  const open = (await runtime().payments.listByOrg(orgId)).find((p) => p.invoiceId === inv.id && p.state !== 'discarded' && (isCommitted(p.state) || WAITING.includes(p.state)));
  if (open) throw new ServiceError('wrong_state', 'A payment for this bill is under way. Open it from the Waiting or Paid tab.', 409);
  inv.dismissed = { at: now.toISOString(), by };
  return inv;
}

/* ── Pay ──────────────────────────────────────────────────────────────── */

/**
 * "Confirm and pay" (an invoice) or "Pay" (a confirmed bill, or a request from a business on Splash):
 * confirm what isn't confirmed yet, then quote. A bill whose payment is still being quoted gets a fresh
 * quote on the same payment. The caller sends the person to Transfer's Step 3 with it.
 */
export async function payBill(
  orgId: string,
  invoiceId: string,
  input: { by: string; fields?: Record<string, string>; confirmed?: string[] },
  now = new Date(),
): Promise<PaymentRecord> {
  const inv = getInvoice(orgId, invoiceId);
  if (!isBill(inv) || inv.dismissed) throw new ServiceError('bad_request', 'That bill isn’t in your inbox.', 404);
  if (inv.source === 'request') {
    if (inv.request?.cancelledAt) throw new ServiceError('wrong_state', `${inv.request.requesterName} cancelled this request. Nothing was sent.`, 409);
    // The requester's account, read again from its own record: it must still be the account the request named.
    const requester = inv.request!.requesterOrgId;
    await loadCompany(requester);
    const account = store().orgs.get(requester)?.vault?.vaultPda ?? null;
    if (!account || account !== inv.peer?.payeeVaultPda) {
      throw new ServiceError('payee_changed', 'The account this request names isn’t the requester’s account on record any more. Ask them to send it again.', 409);
    }
    confirmRequestBill(orgId, invoiceId, input.by, now);
  } else if (!inv.confirmed) {
    if (needsCallBack(inv)) throw new ServiceError('bank_details_unverified', 'New bank details: record the call-back before paying.', 409);
    confirmInvoice(orgId, invoiceId, { fields: input.fields ?? {}, confirmed: input.confirmed ?? [], confirmedBy: input.by });
  }
  const open = (await runtime().payments.listByOrg(orgId)).filter((p) => p.invoiceId === inv.id && REQUOTABLE.includes(p.state)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  return quote(orgId, invoiceId, { now, allowShort: true, ...(open ? { paymentId: open.id } : {}) });
}
