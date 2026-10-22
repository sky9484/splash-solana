/**
 * The Zeke page (prompt 10 §7A, frame Flow-Zeke), in one read: the three counters, "Waiting for you"
 * and "Today" (Zeke's own log), from the company's own state. Integers only; the page formats.
 *
 *   Drafts today   payments Zeke drafted from invoices it read today, and today's sweep draft
 *   Need you       payments waiting for an approval (coral)
 *   Notices        new or changed bank details still waiting for a call-back (amber)
 *
 * Nothing here can approve anything: each row links to where a person reads it in full and approves
 * it on a device (Transfer, Check the invoice, Treasury).
 */
import { billHref, sweepHref } from '../dashboard/links.ts';
import { readCircuitBreaker } from '../safety/circuit-breaker.ts';
import { formatPhp, formatUsd } from '../solana-zeke/router.ts';
import { safetyLines, ZEKE_ROSTER } from '../solana-zeke/roster.ts';
import { waitingSweepDraft } from './investments.ts';
import { payablesOf } from './money-position.ts';
import { getOrg } from './service.ts';
import { stationOf } from './stations.ts';
import { store, type InvoiceRecord, type PaymentRecord } from './store.ts';

/** The company's day: Malaysia time (UTC+8, no daylight saving). */
const KL_OFFSET_MS = 8 * 3_600_000;
const klDay = (iso: string | Date) => new Date(new Date(iso).getTime() + KL_OFFSET_MS).toISOString().slice(0, 10);
/** "09:02" in Malaysia time, to group what happened in the same minute. */
const klMinute = (iso: string) => new Date(Date.parse(iso) + KL_OFFSET_MS).toISOString().slice(11, 16);

/** A bill Zeke read (a pasted, uploaded or sample invoice), not a request another business sent. */
const readByZeke = (i: InvoiceRecord) => i.source === 'sample' || i.source === 'paste' || i.source === 'upload';
const supplierOf = (i: InvoiceRecord) => (i.confirmed ?? i.draft.fields).supplierName || 'A supplier';

function paymentWords(p: PaymentRecord): string {
  const st = stationOf(p.state, p.kind ?? 'bank');
  if (st === 'draft') return 'not yet sent for approval';
  if (st === 'waiting') return 'waiting for your approval';
  if (st === 'stopped') return 'stopped';
  if (st === 'recorded') return 'paid · proof recorded';
  return 'approved · on its way';
}

export type DeskLogEntry = { at: string; what: string; detail: string };
export type DeskWaitingRow =
  | { kind: 'approve'; id: string; title: string; detail: string; amountMinor: bigint; currency: 'USD'; href: string }
  | { kind: 'verify'; id: string; title: string; detail: string; amountMinor: bigint; currency: 'PHP'; href: string }
  | { kind: 'sweep'; id: string; title: string; detail: string; amountMinor: bigint; currency: 'USD'; href: string };

export async function zekeDeskView(orgId: string, now = new Date()) {
  const org = getOrg(orgId);
  const today = klDay(now);
  const { all, sentFor, waiting, bills } = await payablesOf(org, now);
  const invoiceOf = (p: PaymentRecord) => store().invoices.get(p.invoiceId);

  /* ── Waiting for you ── */
  const rows: DeskWaitingRow[] = [];
  for (const p of waiting) {
    const inv = invoiceOf(p);
    const name = p.approval?.supplierName ?? (inv ? supplierOf(inv) : 'Payment');
    const theyGet = inv?.peer ? formatUsd(inv.peer.amountUsdMinor) : formatPhp(p.payout.amountPhpMinor);
    rows.push({ kind: 'approve', id: p.id, title: `${name} · ${theyGet}`, detail: inv?.confirmed?.invoiceNumber ?? 'Transfer', amountMinor: p.approval?.youPayUsdcMinor ?? 0n, currency: 'USD', href: `/dashboard/transfer?payment=${p.id}` });
  }
  const unverified = bills.filter((i) => i.bankStatus === 'changed' && !i.bankVerification && !sentFor.has(i.id));
  for (const i of unverified) {
    const f = i.confirmed ?? i.draft.fields;
    rows.push({ kind: 'verify', id: i.id, title: `${supplierOf(i)} · new bank details`, detail: f.invoiceNumber || 'Invoice', amountMinor: f.amountPhpMinor, currency: 'PHP', href: billHref(i.id) });
  }
  const draft = waitingSweepDraft(org, now);
  if (draft) {
    rows.push({ kind: 'sweep', id: draft.id, title: draft.kind === 'subscribe' ? 'Into T-bills, from your rule' : 'Back from T-bills, from your rule', detail: draft.reason, amountMinor: draft.amountMinor, currency: 'USD', href: sweepHref(draft.id) });
  }

  /* ── Today: what Zeke read, flagged and drafted ── */
  const log: DeskLogEntry[] = [];
  const readToday = bills.filter((i) => readByZeke(i) && klDay(i.createdAt) === today);
  const byMinute = new Map<string, InvoiceRecord[]>();
  for (const i of [...readToday].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))) {
    const k = klMinute(i.createdAt);
    byMinute.set(k, [...(byMinute.get(k) ?? []), i]);
  }
  for (const group of byMinute.values()) {
    log.push({ at: group[0]!.createdAt, what: group.length === 1 ? 'Read an invoice' : `Read ${group.length} invoices`, detail: group.map(supplierOf).join(', ') });
  }
  for (const i of readToday.filter((x) => x.bankStatus === 'changed')) {
    log.push({ at: i.createdAt, what: 'Flagged new bank details', detail: `${supplierOf(i)} · ${i.bankVerification ? 'checked by call-back' : 'waiting for a call-back'}` });
  }
  const drafted = all.filter((p) => {
    const inv = invoiceOf(p);
    return Boolean(inv && readByZeke(inv)) && klDay(p.createdAt) === today;
  });
  for (const p of drafted) {
    const inv = invoiceOf(p)!;
    log.push({ at: p.createdAt, what: 'Drafted a payment', detail: `${p.approval?.supplierName ?? supplierOf(inv)} · ${formatPhp(p.payout.amountPhpMinor)} · ${paymentWords(p)}` });
  }
  const sweepsToday = (org.sweepDrafts ?? []).filter((d) => klDay(d.createdAt) === today);
  for (const d of sweepsToday) {
    log.push({ at: d.createdAt, what: 'Drafted a sweep', detail: `${formatUsd(d.amountMinor)} ${d.kind === 'subscribe' ? 'into' : 'back from'} T-bills, from your owner’s rule${d.state === 'approved' ? ' · approved' : d.state === 'replaced' ? ' · replaced' : d.state === 'withdrawn' ? ' · withdrawn' : ''}` });
  }
  log.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const stop = readCircuitBreaker(orgId).globalState === 'PAUSED' ? 'on' : 'ready';
  // The first suggestion follows what's waiting; the rest are the page's own.
  const first = waiting[0];
  const firstName = first ? (first.approval?.supplierName ?? (invoiceOf(first) ? supplierOf(invoiceOf(first)!) : null)) : null;
  return {
    counters: { draftsToday: drafted.length + sweepsToday.length, needYou: waiting.length, notices: unverified.length },
    waiting: rows,
    today: log.slice(0, 12),
    safety: safetyLines(stop),
    emergencyStop: stop,
    roster: ZEKE_ROSTER.map(({ part, does, never, status }) => ({ part, does, never, status })),
    chips: [firstName ? `Explain the ${firstName} quote` : 'What’s due this week?', 'Who changed bank details?', 'Summarise this month', 'What’s idle above my reserve?'],
  };
}

export type ZekeDesk = Awaited<ReturnType<typeof zekeDeskView>>;
