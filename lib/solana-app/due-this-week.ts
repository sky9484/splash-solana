/**
 * "What's due this week?" answered from the company's own bills (prompt 10 §7A, frame Flow-Zeke), for
 * the agent's offline planner. Reads only. It lists the unpaid bills due in the next 7 days (Malaysia's
 * day) and, when the first already has a drafted payment, hands off a ticket that opens it on
 * Transfer, where a person reads it in full and approves it on a device. It never drafts, approves or
 * moves anything itself, and states nothing it didn't read.
 */
import { billHref } from '../dashboard/links.ts';
import { isCommitted, type PaymentState } from './payment-machine.ts';
import { runtime } from './runtime.ts';
import { isBill, store, type InvoiceRecord, type PaymentRecord } from './store.ts';
import { formatPhp, formatUsd } from '../solana-zeke/router.ts';

const DAY_MS = 86_400_000;
const KL_OFFSET_MS = 8 * 3_600_000;
const klDay = (d: Date) => new Date(d.getTime() + KL_OFFSET_MS).toISOString().slice(0, 10);
const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export interface DueHandoff {
  title: string;
  lines: string[];
  href: string;
  cta: string;
}

export interface DueAnswer {
  text: string;
  handoff: DueHandoff | null;
}

function fieldsOf(i: InvoiceRecord) {
  return i.confirmed ?? i.draft.fields;
}

/** A bill's amount in its own currency: pesos for an invoice, US$ for a request from a business on Splash. */
function amountOf(i: InvoiceRecord): string {
  return i.request && i.peer ? formatUsd(i.peer.amountUsdMinor) : formatPhp(fieldsOf(i).amountPhpMinor);
}

export async function dueThisWeek(orgId: string, now = new Date()): Promise<DueAnswer> {
  const today = klDay(now);
  const horizon = klDay(new Date(now.getTime() + 7 * DAY_MS));
  const payments = (await runtime().payments.listByOrg(orgId)).filter((p) => p.state !== 'discarded');
  const sent = new Set(payments.filter((p) => isCommitted(p.state as PaymentState)).map((p) => p.invoiceId));
  const open = [...store().invoices.values()].filter((i) => i.orgId === orgId && isBill(i) && !i.dismissed && !sent.has(i.id) && fieldsOf(i).dueDate);
  const byDue = [...open].sort((a, b) => (fieldsOf(a).dueDate < fieldsOf(b).dueDate ? -1 : 1));
  const due = byDue.filter((i) => fieldsOf(i).dueDate <= horizon);

  if (due.length === 0) {
    const next = byDue[0];
    return {
      text: next
        ? `Nothing is due this week. The next bill is ${fieldsOf(next).supplierName}'s ${fieldsOf(next).invoiceNumber}, ${amountOf(next)}, due ${shortDay(fieldsOf(next).dueDate)}.`
        : 'Nothing is due this week, and no unpaid bills are waiting.',
      handoff: null,
    };
  }

  const lines = due.map((i) => {
    const f = fieldsOf(i);
    const late = f.dueDate < today ? ' (overdue)' : '';
    return `• ${f.supplierName}, ${f.invoiceNumber}, ${amountOf(i)}, due ${shortDay(f.dueDate)}${late}`;
  });
  const head = due.length === 1 ? 'One bill is due this week:' : `${due.length} bills are due this week:`;
  const draftOf = (i: InvoiceRecord): PaymentRecord | undefined =>
    payments.filter((p) => p.invoiceId === i.id && !isCommitted(p.state as PaymentState)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  // The ticket is the earliest bill that already has a payment drafted; else the earliest one to check.
  const withDraft = due.find((i) => draftOf(i));
  if (withDraft) {
    const draft = draftOf(withDraft)!;
    const f = fieldsOf(withDraft);
    const youPay = draft.approval?.youPayUsdcMinor ?? null;
    return {
      text: `${head}\n${lines.join('\n')}\n${f.supplierName}'s ${f.invoiceNumber} already has a payment drafted. It's not approved: you approve it in Transfer, on your device.`,
      handoff: {
        title: `${f.supplierName} · ${amountOf(withDraft)}`,
        lines: [youPay !== null ? `You pay about ${formatUsd(youPay)} · due ${shortDay(f.dueDate)}` : `Due ${shortDay(f.dueDate)}`, f.invoiceNumber],
        href: `/dashboard/transfer?payment=${draft.id}&step=quote`,
        cta: 'Open to review',
      },
    };
  }
  const first = due[0]!;
  const f = fieldsOf(first);
  return {
    text: `${head}\n${lines.join('\n')}\n${first.confirmed ? 'The first one is checked and ready to pay.' : 'Check the first one before it can be paid.'}`,
    handoff: { title: `${f.supplierName} · ${amountOf(first)}`, lines: [`Due ${shortDay(f.dueDate)}`, f.invoiceNumber], href: billHref(first.id), cta: 'Open to review' },
  };
}
