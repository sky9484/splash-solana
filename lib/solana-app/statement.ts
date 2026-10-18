/**
 * The monthly statement (prompt 12 §5.5, decision 11): one month of one account, printable, in the
 * receipt's style. The accountant posts from it, line by line, each with its receipt.
 *
 * Read only from the records Balance and History already read (payments, fundings, money received,
 * moves between the company's own accounts, treasury orders) and the booked T-bill interest
 * (lib/treasury/history.ts). No new store. Integers only; months are Malaysia time (UTC+8).
 *
 *   Payments   the Payments account: money in, each payment out with its fees on their own line, moves.
 *   Treasury   the Reserve and the Investments account, as a book: money in and out at what moved,
 *              interest booked on T-bills (posted at the end of each month and before a redemption),
 *              and a sale's result against the average cost of what was sold, so the book never drifts.
 *   All        both, without the moves between them (they change neither total).
 *
 * The closing balance is the opening balance plus the month's lines, so
 *   opening + in − payments out − fees + interest ± moves ± results = closing
 * holds by construction; tests/solana-company.test.mjs also checks the Payments account against its
 * real balance.
 */
import { addDays, interestOn, utcDay, type UnitsEvent } from '../treasury/history.ts';
import { fundingWords } from './balance.ts';
import type { BatchRecord } from './batch-service.ts';
import { defaultStatementMonth, monthLabel, monthStart, mytMonth, nextMonth, statementMonths } from './months.ts';
import { ServiceError } from './errors.ts';
import { receiptNumber } from './receipt-number.ts';
import { runtime } from './runtime.ts';
import { getOrg } from './service.ts';
import { store, type EvidenceRecord, type InvoiceRecord, type OrgRecord, type PaymentRecord, type PaymentRequestRecord } from './store.ts';

export type StatementAccount = 'payments' | 'treasury' | 'all';
type Book = 'payments' | 'treasury';
type Kind = 'in' | 'payment' | 'fee' | 'interest' | 'move' | 'result';

interface Entry {
  id: string;
  at: string;
  book: Book;
  kind: Kind;
  /** Signed: in is positive, out negative. US$ minor units. */
  amountMinor: bigint;
  description: string;
  receiptId: string | null;
  /** A move between the company's own Payments and Treasury: left out of "All". */
  internal: boolean;
}

export interface StatementLine {
  id: string;
  at: string;
  description: string;
  receiptId: string | null;
  receiptNumber: string | null;
  inMinor: bigint;
  outMinor: bigint;
  balanceAfterMinor: bigint;
}

export interface Statement {
  companyName: string;
  month: string;
  account: StatementAccount;
  /** Months the company existed in, oldest first (YYYY-MM, Malaysia time). */
  months: string[];
  openingMinor: bigint;
  closingMinor: bigint;
  summary: { inMinor: bigint; paymentsOutMinor: bigint; feesMinor: bigint; interestMinor: bigint; movesMinor: bigint; resultsMinor: bigint };
  lines: StatementLine[];
}

export { defaultStatementMonth, monthLabel, monthStart, mytMonth, nextMonth, statementMonths };

export interface StatementInput {
  org: OrgRecord;
  payments: PaymentRecord[];
  invoices: Map<string, InvoiceRecord>;
  evidence: Map<string, EvidenceRecord>;
  requests: Map<string, PaymentRequestRecord>;
  batches: Map<string, BatchRecord>;
  month: string;
  account: StatementAccount;
  now: Date;
}

/** Every money movement of both books, oldest first, with interest and sale results posted. */
function entriesOf(input: StatementInput, upTo: number): Entry[] {
  const { org, payments, invoices, requests } = input;
  const raw: Entry[] = [];

  for (const [i, f] of org.fundings.entries()) {
    const w = fundingWords(f.note, f.simulated);
    raw.push({ id: `fund_${i}`, at: f.at, book: 'payments', kind: 'in', amountMinor: f.amountMinor, description: `${w.what}: ${w.detail.replaceAll(' · ', ', ')}`, receiptId: null, internal: false });
  }
  for (const r of org.received ?? []) {
    const req = r.requestId ? requests.get(r.requestId) : undefined;
    raw.push({ id: r.id, at: r.at, book: 'payments', kind: 'in', amountMinor: r.amountMinor, description: req ? `${r.from.name}, request ${req.number}` : `${r.from.name}${r.memo ? `, ${r.memo}` : ''}`, receiptId: req?.receiptId ?? null, internal: false });
  }
  for (const p of payments) {
    // Money leaves the Payments account when the payment is sent, at what the approval card showed.
    if (!p.timeline.sentAt || !p.approval) continue;
    const inv = invoices.get(p.invoiceId);
    const name = p.approval.supplierName ?? inv?.confirmed?.supplierName ?? 'Payment';
    const ref = inv?.confirmed?.invoiceNumber ?? '';
    const fees = p.approval.costs.routeMinor + p.approval.costs.partnerMinor + p.approval.costs.splashMinor;
    raw.push({ id: p.id, at: p.timeline.sentAt, book: 'payments', kind: 'payment', amountMinor: -(p.approval.youPayUsdcMinor - fees), description: ref ? `${name}, ${ref}` : name, receiptId: p.receiptId, internal: false });
    if (fees > 0n) raw.push({ id: `${p.id}_fees`, at: p.timeline.sentAt, book: 'payments', kind: 'fee', amountMinor: -fees, description: `Fees, payment to ${name}`, receiptId: p.receiptId, internal: false });
  }
  // A batch payout leaves the Payments account chunk by chunk: each confirmed chunk's transfers and its
  // fees, when its execute was confirmed. A chunk that never went out moved nothing.
  for (const b of input.batches.values()) {
    if (b.orgId !== org.id) continue;
    for (const c of b.chunks) {
      if (c.state !== 'confirmed') continue;
      const at = c.calls.find((x) => x.step === 'execute' && (x.status === 'confirmed' || x.status === 'finalized'))?.at ?? b.updatedAt;
      const part = `${b.chunks.length > 1 ? `part ${c.index + 1} of ${b.chunks.length}, ` : ''}${c.rowIds.length} supplier${c.rowIds.length === 1 ? '' : 's'}`;
      raw.push({ id: `${b.id}_c${c.index}`, at, book: 'payments', kind: 'payment', amountMinor: -c.payoutMinor, description: `Batch payout, ${part}`, receiptId: null, internal: false });
      if (c.feeMinor > 0n) raw.push({ id: `${b.id}_c${c.index}_fees`, at, book: 'payments', kind: 'fee', amountMinor: -c.feeMinor, description: `Fees, batch payout${b.chunks.length > 1 ? ` part ${c.index + 1}` : ''}`, receiptId: null, internal: false });
    }
  }
  for (const m of org.moves ?? []) {
    if (m.state !== 'confirmed') continue;
    if (m.from === 'payments' && m.to === 'treasury') {
      raw.push({ id: `${m.id}_p`, at: m.updatedAt, book: 'payments', kind: 'move', amountMinor: -m.amountMinor, description: 'To your Reserve', receiptId: null, internal: true });
      raw.push({ id: `${m.id}_t`, at: m.updatedAt, book: 'treasury', kind: 'move', amountMinor: m.amountMinor, description: 'From your Payments account', receiptId: null, internal: true });
    } else if (m.from === 'treasury' && m.to === 'payments') {
      raw.push({ id: `${m.id}_t`, at: m.updatedAt, book: 'treasury', kind: 'move', amountMinor: -m.amountMinor, description: 'To your Payments account', receiptId: null, internal: true });
      raw.push({ id: `${m.id}_p`, at: m.updatedAt, book: 'payments', kind: 'move', amountMinor: m.amountMinor, description: 'From your Reserve', receiptId: null, internal: true });
    }
  }
  for (const f of org.treasuryFundings ?? []) {
    raw.push({ id: `tfund_${f.signature.slice(0, 12)}`, at: f.at, book: 'treasury', kind: 'in', amountMinor: f.amountMinor, description: 'Added to your Reserve', receiptId: null, internal: false });
  }

  // Treasury orders, oldest first: the cash legs now, the sale results with the interest below.
  const orders = (org.investments?.orders ?? []).filter((o) => o.state === 'settled').map((o) => ({ ...o, when: o.settlement?.at ?? o.approval?.at ?? o.createdAt }));
  orders.sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : 0));
  const nameOf = (asset: string) => (asset === 'usdy' ? 'US Treasury bills' : asset.toUpperCase());
  for (const o of orders) {
    if (o.kind === 'subscribe' || o.kind === 'buy') {
      const fromPayments = o.from?.paymentsMinor ?? 0n;
      if (fromPayments > 0n) {
        raw.push({ id: `${o.id}_p`, at: o.when, book: 'payments', kind: 'move', amountMinor: -fromPayments, description: `To your Investments account: ${nameOf(o.asset)}`, receiptId: o.receiptId, internal: true });
        raw.push({ id: `${o.id}_t`, at: o.when, book: 'treasury', kind: 'move', amountMinor: fromPayments, description: `From your Payments account: ${nameOf(o.asset)}`, receiptId: o.receiptId, internal: true });
      }
      // What came from the Reserve stays in the Treasury book: the Reserve to the Investments account.
    } else if (o.landsIn === 'payments') {
      raw.push({ id: `${o.id}_t`, at: o.when, book: 'treasury', kind: 'move', amountMinor: -o.amountMinor, description: `To your Payments account: ${nameOf(o.asset)} ${o.kind === 'redeem' ? 'redeemed' : 'sold'}`, receiptId: o.receiptId, internal: true });
      raw.push({ id: `${o.id}_p`, at: o.when, book: 'payments', kind: 'move', amountMinor: o.amountMinor, description: `From your Investments account: ${nameOf(o.asset)} ${o.kind === 'redeem' ? 'redeemed' : 'sold'}`, receiptId: o.receiptId, internal: true });
    } else if (o.landsIn === 'bank_wire') {
      raw.push({ id: `${o.id}_t`, at: o.when, book: 'treasury', kind: 'move', amountMinor: -o.amountMinor, description: `To your company’s bank account, by wire: ${nameOf(o.asset)} redeemed`, receiptId: o.receiptId, internal: false });
    }
  }

  // Interest booked on T-bill units (one figure a UTC day), posted at each Malaysia month end and right
  // before a redemption; each sale's result against the average cost of what it sold.
  const units: UnitsEvent[] = orders.filter((o) => o.asset === 'usdy' && (o.kind === 'subscribe' || o.kind === 'redeem')).map((o) => ({ at: o.when, kind: o.kind as 'subscribe' | 'redeem', unitsMicro: o.unitsMicro }));
  const posted: Entry[] = [];
  const firstUnits = units[0]?.at ?? null;
  let nextDay = firstUnits ? utcDay(new Date(Date.parse(firstUnits))) : null;
  const pool = new Map<string, { units: bigint; cost: bigint }>();
  const postInterest = (throughDay: string, at: string) => {
    if (!nextDay) return;
    let sum = 0n;
    for (let d = nextDay; d <= throughDay; d = addDays(d, 1)) sum += interestOn(d, units);
    nextDay = addDays(throughDay, 1);
    if (sum === 0n) return;
    const p = pool.get('usdy') ?? { units: 0n, cost: 0n };
    p.cost += sum;
    pool.set('usdy', p);
    posted.push({ id: `int_${throughDay}`, at, book: 'treasury', kind: 'interest', amountMinor: sum, description: 'Interest booked on US Treasury bills', receiptId: null, internal: false });
  };

  // Month ends from the first units to `upTo`, merged with the orders in time order.
  const ends: Array<{ at: string; day: string }> = [];
  if (firstUnits) {
    for (let m = mytMonth(firstUnits); monthStart(m) <= upTo; m = nextMonth(m)) {
      const endMs = Math.min(monthStart(nextMonth(m)) - 1, upTo);
      ends.push({ at: new Date(endMs).toISOString(), day: utcDay(new Date(endMs)) });
    }
  }
  const steps = [...orders.map((o) => ({ at: o.when, order: o })), ...ends.map((e) => ({ at: e.at, end: e }))].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  for (const s of steps) {
    if ('end' in s && s.end) {
      postInterest(s.end.day, s.end.at);
      continue;
    }
    const o = (s as { order: (typeof orders)[number] }).order;
    if (o.asset === 'usdy' && o.kind === 'redeem') postInterest(utcDay(new Date(Date.parse(o.when))), o.when);
    const p = pool.get(o.asset) ?? { units: 0n, cost: 0n };
    if (o.kind === 'subscribe' || o.kind === 'buy') {
      p.units += o.unitsMicro;
      p.cost += o.amountMinor;
    } else if (p.units > 0n) {
      const sold = o.unitsMicro < p.units ? o.unitsMicro : p.units;
      const cost = (p.cost * sold) / p.units;
      p.units -= sold;
      p.cost -= cost;
      const result = o.amountMinor - cost;
      if (result !== 0n) posted.push({ id: `${o.id}_r`, at: o.when, book: 'treasury', kind: 'result', amountMinor: result, description: `Result on ${nameOf(o.asset)} ${o.kind === 'redeem' ? 'redeemed' : 'sold'}, against what they cost`, receiptId: o.receiptId, internal: false });
    }
    pool.set(o.asset, p);
  }

  const all = [...raw, ...posted].filter((e) => Date.parse(e.at) <= upTo);
  // Time order; on the same moment, money in before money out, and a result after its sale.
  const rank: Record<Kind, number> = { in: 0, interest: 1, move: 2, payment: 3, fee: 4, result: 5 };
  all.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : rank[a.kind] - rank[b.kind]));
  return all;
}

export function buildStatement(input: StatementInput): Statement {
  const { org, month, account, now, evidence } = input;
  const start = monthStart(month);
  const end = monthStart(nextMonth(month));
  const upTo = Math.min(end - 1, now.getTime());
  const mine = entriesOf(input, upTo).filter((e) => (account === 'all' ? !e.internal : e.book === account));

  let balance = 0n;
  for (const e of mine) if (Date.parse(e.at) < start) balance += e.amountMinor;
  const openingMinor = balance;
  const summary = { inMinor: 0n, paymentsOutMinor: 0n, feesMinor: 0n, interestMinor: 0n, movesMinor: 0n, resultsMinor: 0n };
  const lines: StatementLine[] = [];
  for (const e of mine) {
    const t = Date.parse(e.at);
    if (t < start || t >= end) continue;
    balance += e.amountMinor;
    if (e.kind === 'in') summary.inMinor += e.amountMinor;
    else if (e.kind === 'payment') summary.paymentsOutMinor -= e.amountMinor;
    else if (e.kind === 'fee') summary.feesMinor -= e.amountMinor;
    else if (e.kind === 'interest') summary.interestMinor += e.amountMinor;
    else if (e.kind === 'move') summary.movesMinor += e.amountMinor;
    else summary.resultsMinor += e.amountMinor;
    const ev = e.receiptId ? evidence.get(e.receiptId) : undefined;
    lines.push({
      id: e.id,
      at: e.at,
      description: e.description,
      receiptId: e.receiptId,
      receiptNumber: ev ? receiptNumber(ev.receiptId, ev.bundle.receipt.issuedAt) : null,
      inMinor: e.amountMinor > 0n ? e.amountMinor : 0n,
      outMinor: e.amountMinor < 0n ? -e.amountMinor : 0n,
      balanceAfterMinor: balance,
    });
  }
  return { companyName: org.companyName, month, account, months: statementMonths(org.createdAt, now), openingMinor, closingMinor: balance, summary, lines };
}

/** A company's statement for one month of one account, from its records as they are now. */
export async function statementFor(orgId: string, month: string, account: StatementAccount, now = new Date()): Promise<Statement & { testMode: boolean }> {
  const org = getOrg(orgId);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !statementMonths(org.createdAt, now).includes(month)) {
    throw new ServiceError('bad_request', 'Choose a month your company has been on Splash.', 400);
  }
  if (account !== 'payments' && account !== 'treasury' && account !== 'all') throw new ServiceError('bad_request', 'Choose Payments, Treasury or All.', 400);
  const s = store();
  const payments = await runtime().payments.listByOrg(orgId);
  return { ...buildStatement({ org, payments, invoices: s.invoices, evidence: s.evidence, requests: s.requests, batches: s.batches, month, account, now }), testMode: runtime().env.mode === 'offline' };
}
