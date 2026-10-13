/**
 * "Needs you" on Overview (prompt 10 §4.2): what a person has to do, ranked, at most five rows. Pure:
 * the aggregator (overview.ts) reads the company's state and hands it in.
 *
 * Ranking: approvals (the freshest quote first: an approval with a live quote can be done now), then
 * verifications (changed bank details), then bills due within 7 days, then overdue payment requests
 * (Phase 4 supplies them), then a waiting sweep draft (Phase 5), then setup and compliance tasks
 * ("Business documents", a second approver). Never the word "KYB", and never "Approved" as a verdict.
 */

import { INVOICE_LINKS } from '../dashboard/links.ts';

export type NeedKind = 'approve' | 'verify' | 'due' | 'overdue' | 'sweep' | 'setup';

export interface NeedRow {
  kind: NeedKind;
  tag: { tone: 'coral' | 'amber' | 'ink' | 'gold'; label: string };
  title: string;
  detail: string;
  action: { label: string; href: string };
  /** An approval's quote: the row shows its ring and time left. */
  quote?: { expiresAt: string; fresh: boolean };
}

export interface ApprovalIn {
  paymentId: string;
  supplierName: string;
  reference: string | null;
  /** Formatted already (the aggregator owns formatting): "₱287,000.00", "US$5,012.50". */
  theyGet: string;
  youPay: string | null;
  quoteExpiresAt: string | null;
  href: string;
}

export interface VerifyIn {
  invoiceId: string;
  supplierName: string;
  bank: string;
  last4: string;
  href: string;
}

export interface DueIn {
  supplierName: string;
  dueDate: string;
  /** "16 Oct". */
  dueLabel: string;
  amountPhpMinor: bigint;
}

export interface OverdueIn {
  payer: string;
  amount: string;
  daysOverdue: number;
  reference: string;
  href: string;
}

export interface SweepIn {
  kind: 'subscribe' | 'redeem';
  amount: string;
  href: string;
}

export interface SetupIn {
  id: 'verify' | 'second_approver' | string;
  title: string;
  href: string;
}

export interface NeedsInput {
  now: Date;
  approvals: ApprovalIn[];
  verifications: VerifyIn[];
  dueSoon: DueIn[];
  overdue: OverdueIn[];
  sweep: SweepIn | null;
  setup: SetupIn[];
  /** Formats a PHP total of the due bills. */
  php: (minor: bigint) => string;
}

export const NEEDS_LIMIT = 5;
/** "See all" opens the rest in place, up to this many more. */
export const NEEDS_MORE_LIMIT = 20;

/** The first five rows, ranked; the rest for "See all"; and the total count (the title says "4 things need you"). */
export function needsYou(input: NeedsInput): { rows: NeedRow[]; more: NeedRow[]; total: number } {
  const rows: NeedRow[] = [];
  const nowMs = input.now.getTime();

  const approvals = [...input.approvals].sort((a, b) => {
    // A live quote first (it can be approved now), soonest to expire first; expired ones after.
    const la = a.quoteExpiresAt ? Date.parse(a.quoteExpiresAt) - nowMs : -Infinity;
    const lb = b.quoteExpiresAt ? Date.parse(b.quoteExpiresAt) - nowMs : -Infinity;
    const fa = la > 0;
    const fb = lb > 0;
    if (fa !== fb) return fa ? -1 : 1;
    return fa ? la - lb : 0;
  });
  for (const a of approvals) {
    const fresh = a.quoteExpiresAt ? Date.parse(a.quoteExpiresAt) > nowMs : false;
    rows.push({
      kind: 'approve',
      tag: { tone: 'coral', label: 'Approve' },
      title: `${a.supplierName} · ${a.theyGet}`,
      detail: [a.reference, a.youPay ? `you pay ${a.youPay}` : null, fresh ? null : 'Quote expired · refreshes when you open it'].filter(Boolean).join(' · '),
      action: { label: 'Review', href: a.href },
      quote: a.quoteExpiresAt ? { expiresAt: a.quoteExpiresAt, fresh } : undefined,
    });
  }

  for (const v of input.verifications) {
    rows.push({
      kind: 'verify',
      tag: { tone: 'amber', label: 'Verify' },
      title: `${v.supplierName} changed bank details`,
      detail: `Now ${v.bank} ••••${v.last4}. Call them on a number you know before paying.`,
      action: { label: 'Verify', href: v.href },
    });
  }

  if (input.dueSoon.length > 0) {
    const sorted = [...input.dueSoon].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
    const total = sorted.reduce((n, d) => n + d.amountPhpMinor, 0n);
    const names = sorted.slice(0, 2).map((d) => `${d.supplierName}, ${d.dueLabel}`);
    const more = sorted.length > 2 ? ` and ${sorted.length - 2} more` : '';
    rows.push({
      kind: 'due',
      tag: { tone: 'ink', label: 'Due this week' },
      title: `${sorted.length} ${sorted.length === 1 ? 'invoice' : 'invoices'} · ${input.php(total)}`,
      detail: `${names.join(' · ')}${more}`,
      action: { label: 'Plan', href: INVOICE_LINKS.pay },
    });
  }

  for (const o of input.overdue) {
    rows.push({
      kind: 'overdue',
      tag: { tone: 'ink', label: 'Get paid' },
      title: `${o.payer} owes ${o.amount}`,
      detail: `${o.daysOverdue} ${o.daysOverdue === 1 ? 'day' : 'days'} overdue · invoice ${o.reference}`,
      action: { label: 'Remind', href: o.href },
    });
  }

  if (input.sweep) {
    rows.push({
      kind: 'sweep',
      tag: { tone: 'gold', label: 'Zeke drafted' },
      title: `Sweep drafted · ${input.sweep.amount} ${input.sweep.kind === 'subscribe' ? 'into T-bills' : 'back from T-bills'}`,
      detail: 'From your sweep rule. Nothing moves until a person approves it.',
      action: { label: 'Review', href: input.sweep.href },
    });
  }

  for (const s of input.setup) {
    rows.push({
      kind: 'setup',
      tag: { tone: 'ink', label: 'Set up' },
      title: s.title,
      detail: s.id === 'verify' ? 'Payments open once your business documents are checked.' : 'Optional: a second person who can approve payments.',
      action: { label: 'Open', href: s.href },
    });
  }

  return { rows: rows.slice(0, NEEDS_LIMIT), more: rows.slice(NEEDS_LIMIT, NEEDS_LIMIT + NEEDS_MORE_LIMIT), total: rows.length };
}
