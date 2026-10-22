/**
 * Balance (prompt 10 §5.10, frame Flow-Balance), in one read: the Payments account, what is waiting
 * for approval and what is free after it, the Reserve and Investments (as links to Treasury), and the
 * money that went in and out of the Payments account. From the company's own state, integers only;
 * every sum is made here, with the shared money rules (lib/treasury/reserve.ts). The screen formats.
 *
 * Money in and out is read from the same records History reads: payments, fundings, the moves
 * between the company's own accounts, and treasury orders that drew on or landed in the Payments account.
 */
import { payablesDue, reserveFloor, sharesPct } from '../treasury/reserve.ts';
import { investmentsSummary, treasuryHistory } from './investments.ts';
import { accountBalances, payablesOf } from './money-position.ts';
import { isCommitted, type PaymentState } from './payment-machine.ts';
import { runtime } from './runtime.ts';
import { getOrg } from './service.ts';
import { stationLabel, stationOf } from './stations.ts';
import { store, type PaymentRecord } from './store.ts';

export const BALANCE_ROWS = 8;

const max0 = (v: bigint) => (v < 0n ? 0n : v);

/** A moment's calendar day in Malaysia time (UTC+8), the day the receipt and History show (prompt 12 Phase 7). */
const mytDayOf = (ms: number) => new Date(ms + 8 * 3_600_000).toISOString().slice(0, 10);

function dayLabel(iso: string, now: Date): string {
  const day = mytDayOf(Date.parse(iso));
  if (day === mytDayOf(now.getTime())) return 'Today';
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

type Tone = 'coral' | 'amber' | 'ok' | 'ink' | 'danger' | 'gold';
export interface MoneyRow {
  id: string;
  at: string;
  date: string;
  what: string;
  detail: string;
  /** Signed: money in is positive, money out negative. US$ minor units. */
  amountMinor: bigint;
  tag: { tone: Tone; label: string };
  href: string | null;
}

/** A funding's stored note, in the words Balance uses (records keep what they were written with). */
export function fundingWords(note: string | null | undefined, simulated: boolean): { what: string; detail: string } {
  const n = note ?? '';
  if (/^Returned/i.test(n)) return { what: 'Returned', detail: 'a payment the bank sent back' };
  if (/^Test USDC/i.test(n)) return { what: 'Added', detail: 'test money · test mode' };
  if (/top-up/i.test(n) && /test mode/i.test(n)) return { what: 'Added', detail: /for pay_/.test(n) ? 'bank or card top-up, for a payment · test mode' : 'bank or card top-up · test mode' };
  if (/crypto wallet/i.test(n)) return { what: 'Added', detail: /for pay_/.test(n) ? 'from a crypto wallet, for a payment · test mode' : 'from a crypto wallet · test mode' };
  return { what: 'Added', detail: simulated ? 'test mode' : 'money in' };
}

function paymentRow(p: PaymentRecord, now: Date): MoneyRow | null {
  const inv = store().invoices.get(p.invoiceId);
  const name = p.approval?.supplierName ?? inv?.confirmed?.supplierName ?? 'Payment';
  const ref = inv?.confirmed?.invoiceNumber ?? '';
  const youPay = p.approval?.youPayUsdcMinor ?? null;
  if (youPay === null) return null;
  const kind = p.kind ?? 'bank';
  const st = stationOf(p.state as PaymentState, kind);
  const rail = p.approval?.arrives.split(',')[0] ?? '';
  // Transfer follows every kind of payment, an invoice's too (prompt 10 §6.2: one engine, one approval card).
  const href = p.receiptId ? `/dashboard/receipts/${p.receiptId}` : `/dashboard/transfer?payment=${p.id}`;
  if (st === 'waiting') {
    return { id: p.id, at: p.createdAt, date: dayLabel(p.createdAt, now), what: name, detail: `${ref} · waiting for your approval`, amountMinor: -youPay, tag: { tone: 'ink', label: 'Not taken yet' }, href };
  }
  if (!isCommitted(p.state as PaymentState)) return null;
  const at = p.timeline.sentAt ?? p.timeline.approvedAt ?? p.updatedAt;
  if (p.state === 'partner_failed') {
    return { id: p.id, at, date: dayLabel(at, now), what: name, detail: `${ref} · returned by the bank`, amountMinor: -youPay, tag: { tone: 'danger', label: 'Returned' }, href };
  }
  const detail = kind === 'peer' ? `${ref} · into their Splash account` : rail ? `${ref} · paid by ${rail}` : ref;
  const tag: MoneyRow['tag'] =
    st === 'recorded' ? { tone: 'ok', label: 'Paid · proof recorded' } : st === 'recording' ? { tone: 'ok', label: 'Paid · recording proof' } : st === 'paid' ? { tone: 'ok', label: stationLabel('paid', kind) } : { tone: 'ink', label: stationLabel(st, kind) };
  return { id: p.id, at, date: dayLabel(at, now), what: name, detail, amountMinor: -youPay, tag, href };
}

export async function balanceFor(orgId: string, now = new Date()) {
  const org = getOrg(orgId);
  const rt = runtime();
  // The same reading Overview and Treasury make (money-position.ts), so the three never disagree.
  const { paymentsMinor, reserveMinor } = await accountBalances(org);
  const invested = investmentsSummary(org, now);
  const { all, waitingMinor, approvedUnsentMinor, billsDueMinor } = await payablesOf(org, now);
  const waitingShown = waitingMinor < paymentsMinor ? waitingMinor : paymentsMinor;
  const freeMinor = max0(paymentsMinor - waitingMinor);
  const [freePct, waitingPct] = sharesPct([freeMinor, waitingShown]);
  // What the Reserve is kept for: what's due, plus the margin (the same floor Overview shows).
  const floorMinor = reserveFloor(payablesDue({ approvedUnsentMinor, billsDueMinor }));

  const rows: MoneyRow[] = [];
  for (const p of all) {
    const r = paymentRow(p, now);
    if (r) rows.push(r);
  }
  for (const [i, f] of org.fundings.entries()) {
    const words = fundingWords(f.note, f.simulated);
    rows.push({ id: `fund_${i}_${f.signature.slice(0, 8)}`, at: f.at, date: dayLabel(f.at, now), what: words.what, detail: words.detail, amountMinor: f.amountMinor, tag: { tone: 'ok', label: words.what }, href: null });
  }
  // Money in from outside: a business on Splash paying, or a request's link paid (prompt 10 §6.3).
  for (const r of org.received ?? []) {
    const req = r.requestId ? store().requests.get(r.requestId) : undefined;
    const how = r.from.kind === 'splash' ? 'from a business on Splash' : 'paid by link';
    rows.push({
      id: r.id,
      at: r.at,
      date: dayLabel(r.at, now),
      what: r.from.name,
      detail: req ? `${req.number} · ${how}` : r.memo ? `${r.memo} · ${how}` : how,
      amountMinor: r.amountMinor,
      tag: { tone: 'ok', label: 'Received' },
      href: req?.receiptId ? `/dashboard/receipts/${req.receiptId}` : null,
    });
  }
  for (const m of org.moves ?? []) {
    if (m.state !== 'confirmed' || (m.from !== 'payments' && m.to !== 'payments')) continue;
    const into = m.to === 'payments';
    rows.push({
      id: m.id,
      at: m.updatedAt,
      date: dayLabel(m.updatedAt, now),
      what: into ? 'Moved from your Reserve' : 'Moved to your Reserve',
      detail: into ? 'into your Payments account' : 'what is due, plus a margin',
      amountMinor: into ? m.amountMinor : -m.amountMinor,
      tag: { tone: 'ink', label: 'Moved' },
      href: '/dashboard/treasury',
    });
  }
  // Treasury orders that drew on the Payments account, or landed in it (prompt 10 §7.4): gold, like History.
  for (const o of treasuryHistory(org)) {
    const href = o.receiptId ? `/dashboard/receipts/${o.receiptId}` : '/dashboard/treasury';
    if ((o.kind === 'subscribe' || o.kind === 'buy') && o.fromPaymentsMinor > 0n) {
      const what = o.kind === 'subscribe' ? 'Subscribed to T-bills' : `Bought ${o.name}`;
      rows.push({ id: o.id, at: o.at, date: dayLabel(o.at, now), what, detail: 'from your Payments account, into your Investments account', amountMinor: -o.fromPaymentsMinor, tag: { tone: 'gold', label: 'Treasury' }, href });
    } else if (o.landsIn === 'payments') {
      const what = o.kind === 'redeem' ? 'Redeemed T-bills' : `Sold ${o.name}`;
      rows.push({ id: o.id, at: o.at, date: dayLabel(o.at, now), what, detail: 'from your Investments account, into your Payments account', amountMinor: o.amountMinor, tag: { tone: 'gold', label: 'Treasury' }, href });
    }
  }
  rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return {
    paymentsMinor,
    waitingMinor,
    freeMinor,
    /** Whole percents of the Payments account (they add to 100 when it holds anything). */
    bar: { freePct, waitingPct },
    reserveMinor,
    reserveFloorMinor: floorMinor,
    investmentsMinor: invested.investmentsMinor,
    investmentsSetUp: invested.setUp,
    rows: rows.slice(0, BALANCE_ROWS),
    more: rows.length > BALANCE_ROWS,
    simulated: rt.env.mode === 'offline',
  };
}

export type Balance = Awaited<ReturnType<typeof balanceFor>>;
