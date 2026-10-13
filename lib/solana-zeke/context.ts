/**
 * Which page the floating Zeke is open on (prompt 10 §3.5): the context bar's words ("Looking at:
 * Transfer · Step 3, quote") and three suggestions for that page. Pure. The same table is the
 * server's allow-list for the page label the chat sends (app/api/oxwal), so the label can only ever
 * be one of these words: no account number, no name, nothing a person typed.
 */

export interface ZekeContext {
  label: string;
  chips: [string, string, string];
}

const TRANSFER_STEPS: Record<string, string> = { '1': 'recipient', '2': 'amount', '3': 'quote', '4': 'approve', '5': 'track' };

const BY_PATH: Array<{ match: (p: string) => boolean; ctx: ZekeContext }> = [
  { match: (p) => p === '/dashboard', ctx: { label: 'Overview', chips: ['What needs me today?', "What's due this week?", 'Summarise this month'] } },
  { match: (p) => p === '/dashboard/invoices/pay', ctx: { label: 'Invoices · Pay an invoice', chips: ['Which bills are due this week?', 'Which invoices need checking?', 'Read the sample invoice'] } },
  { match: (p) => p === '/dashboard/invoices/get', ctx: { label: 'Invoices · Get paid', chips: ['Who owes us money?', 'Which requests are overdue?', 'Draft a reminder'] } },
  { match: (p) => p.startsWith('/dashboard/invoices'), ctx: { label: 'Invoices', chips: ['Which bills are due this week?', 'Which invoices need checking?', 'Who owes us money?'] } },
  { match: (p) => p.startsWith('/dashboard/treasury'), ctx: { label: 'Treasury', chips: ["What's idle above my reserve?", 'How much is in T-bills?', "What's my stock limit today?"] } },
  { match: (p) => p.startsWith('/dashboard/fund'), ctx: { label: 'Balance', chips: ["What's waiting for approval?", 'How do I add money?', 'What came in this week?'] } },
  { match: (p) => p.startsWith('/dashboard/history'), ctx: { label: 'History', chips: ["Show this month's payments", 'Which payments are still on their way?', 'Find a receipt'] } },
  { match: (p) => p.startsWith('/dashboard/batch'), ctx: { label: 'Batch payout', chips: ['How do I lay out a payout sheet?', "What's left of today's limit?", 'Check my last batch'] } },
  { match: (p) => p.startsWith('/dashboard/recipients'), ctx: { label: 'Recipients', chips: ["Which recipients aren't verified?", 'Who did we pay most this month?', 'How do I verify bank details?'] } },
  { match: (p) => p.startsWith('/dashboard/settings/policy'), ctx: { label: 'Rules', chips: ['What are my limits?', 'Who can approve?', 'Explain the rules'] } },
  { match: (p) => p.startsWith('/dashboard/settings'), ctx: { label: 'Settings', chips: ["What's left to set up?", 'How do I add a second approver?', 'What does Test mode mean?'] } },
  { match: (p) => p.startsWith('/dashboard/setup'), ctx: { label: 'Account setup', chips: ["What's left to set up?", 'How do I add a second approver?', 'What does Test mode mean?'] } },
  { match: (p) => p.startsWith('/dashboard/receipts'), ctx: { label: 'Receipt', chips: ['What does this receipt prove?', 'How do I share it with an auditor?', 'Find another receipt'] } },
];

const TRANSFER_CHIPS: [string, string, string] = ['Why is Cheapest cheaper?', 'Is this recipient verified?', "What's left of today's limit?"];
const FALLBACK: ZekeContext = { label: 'Dashboard', chips: ['What needs me today?', "What's due this week?", 'Summarise this month'] };

/** The context for a dashboard URL: its path, and for Transfer the step in `?step=`. */
export function zekeContextFor(pathname: string, search: string | URLSearchParams = ''): ZekeContext {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/dashboard/transfer') {
    const step = new URLSearchParams(search).get('step');
    const name = step ? TRANSFER_STEPS[step] : undefined;
    return { label: name ? `Transfer · Step ${step}, ${name}` : 'Transfer', chips: TRANSFER_CHIPS };
  }
  return BY_PATH.find((r) => r.match(path))?.ctx ?? FALLBACK;
}

/** Every label the chat may send as its page: the server accepts these and nothing else. */
export const ZEKE_PAGE_LABELS: ReadonlySet<string> = new Set([
  ...BY_PATH.map((r) => r.ctx.label),
  FALLBACK.label,
  'Transfer',
  ...Object.entries(TRANSFER_STEPS).map(([n, name]) => `Transfer · Step ${n}, ${name}`),
]);

/** Where the floating Zeke is hidden: on the Zeke page itself. (Sheets and the approval moment hide it too, at run time.) */
export function floatingZekeHiddenOn(pathname: string): boolean {
  return pathname === '/dashboard/zeke' || pathname.startsWith('/dashboard/zeke/');
}

/** The one nudge beside the launcher: only when something waits, never small talk. */
export function zekeNudge(waiting: number): string | null {
  if (waiting <= 0) return null;
  return waiting === 1 ? '1 draft needs your approval' : `${waiting} drafts need your approval`;
}
