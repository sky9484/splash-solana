/**
 * The sidebar's badges and the floating Zeke's count, from the company's own state in one read
 * (prompt 10 §3.1, §3.5). Never guessed in the browser.
 *
 * - approvals: payments waiting for a person to approve on a device (checked, or proposed and
 *   waiting for the next approver). The same number is the floating Zeke's "drafts waiting".
 * - billsDue7d: bills Zeke read and a person checked, not yet sent, due within 7 days (overdue
 *   ones included: they are due).
 * - unverifiedRecipients: a supplier whose new or changed bank details nobody has verified yet.
 */
import { MOCK_RATE } from '../solana-partner/mock-partner.ts';
import { CORRIDORS, PARTNER_REGISTRY } from '../solana-partner/registry.ts';
import { isCommitted, type PaymentState } from './payment-machine.ts';
import { runtime } from './runtime.ts';
import { getOrg } from './service.ts';
import { store } from './store.ts';

const DAY_MS = 86_400_000;

export interface NavCountsResult {
  approvals: number;
  billsDue7d: number;
  unverifiedRecipients: boolean;
}

/** YYYY-MM-DD of a date in UTC. */
const day = (d: Date) => d.toISOString().slice(0, 10);

export async function navCounts(orgId: string, now = new Date()): Promise<NavCountsResult> {
  const org = getOrg(orgId);
  const payments = (await runtime().payments.listByOrg(org.id)).filter((p) => p.state !== 'discarded');
  const approvals = payments.filter((p) => p.state === 'checked' || p.state === 'proposed').length;

  const sentFor = new Set(payments.filter((p) => isCommitted(p.state as PaymentState)).map((p) => p.invoiceId));
  const horizon = day(new Date(now.getTime() + 7 * DAY_MS));
  const bills = [...store().invoices.values()].filter((i) => i.orgId === org.id && i.source !== 'transfer');
  const billsDue7d = bills.filter((i) => i.confirmed && !sentFor.has(i.id) && i.confirmed.dueDate && i.confirmed.dueDate <= horizon).length;

  const unverifiedRecipients = bills.some((i) => i.bankStatus !== 'known' && !i.bankVerification && !sentFor.has(i.id));

  return { approvals, billsDue7d, unverifiedRecipients };
}

/**
 * The rate strip (§4.2): the payout partner's USD → PHP rate, and the next corridors as text. In
 * test mode it is the test partner's fixed rate, labelled "test rate"; a signed, live partner's rate
 * is labelled "indicative, not a quote". Never a scrolling ticker, never an unrelated pair.
 */
export function rateStrip(): { pair: string; rate: string; label: string; next: string[] } {
  const partner = PARTNER_REGISTRY[0];
  const live = Boolean(partner && partner.signed && !partner.sandbox);
  return {
    pair: 'USD → PHP',
    rate: MOCK_RATE,
    label: live ? 'indicative, not a quote' : 'test rate',
    next: CORRIDORS.filter((c) => c.status === 'next').map((c) => c.pair),
  };
}

/** Everything the shell shows around a page, in one read (GET /api/solana/nav). */
export async function navShell(orgId: string, now = new Date()) {
  return { counts: await navCounts(orgId, now), rate: rateStrip() };
}
