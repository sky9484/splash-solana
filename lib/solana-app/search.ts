/**
 * The top row's search (prompt 10 §3.3): the company's own payments, bills and recipients, by name,
 * invoice number, reference or amount. At most 8 results, grouped by type. Only this company's
 * records are read (the org comes from the session), and a recipient shows its last four digits
 * only: no full account number is searched or returned. Payment requests join in Phase 4.
 */
import { formatPhp, formatUsd } from '../solana-zeke/router.ts';
import { STATE_LABEL } from './payment-machine.ts';
import { runtime } from './runtime.ts';
import { getOrg } from './service.ts';
import { store } from './store.ts';

export type SearchKind = 'payment' | 'bill' | 'recipient';

export interface SearchResult {
  kind: SearchKind;
  id: string;
  title: string;
  detail: string;
  href: string;
}

export interface SearchGroup {
  kind: SearchKind;
  label: string;
  results: SearchResult[];
}

export const SEARCH_LIMIT = 8;

/** "2026-10-30" → "30 Oct" (UTC, so the day never shifts). */
function shortDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
const GROUP_LABEL: Record<SearchKind, string> = { payment: 'Payments', bill: 'Bills', recipient: 'Recipients' };

/** Lower case, accents off, spaces squashed. */
const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
/** An amount as the digits a person might type: "287000", "287000.00", "5012.5". */
function amountKeys(formatted: string): string[] {
  const plain = formatted.replace(/[^\d.]/g, '');
  const whole = plain.split('.')[0];
  const trimmed = plain.replace(/\.?0+$/, '');
  return [...new Set([plain, whole, trimmed])].filter(Boolean);
}

function matches(q: string, texts: string[], amounts: string[]): boolean {
  const nq = norm(q);
  if (texts.some((t) => norm(t).includes(nq))) return true;
  const digits = q.replace(/[^\d.]/g, '');
  if (digits.length >= 2 && /^[\d.,\s₱$US]+$/i.test(q.trim())) return amounts.some((a) => a.startsWith(digits));
  return false;
}

export async function searchCompany(orgId: string, rawQuery: string): Promise<{ query: string; groups: SearchGroup[]; total: number }> {
  const org = getOrg(orgId);
  const q = rawQuery.trim().slice(0, 80);
  if (q.length < 2) return { query: q, groups: [], total: 0 };

  const found: Record<SearchKind, SearchResult[]> = { payment: [], bill: [], recipient: [] };
  const invoices = [...store().invoices.values()].filter((i) => i.orgId === org.id);

  const payments = (await runtime().payments.listByOrg(org.id))
    .filter((p) => p.state !== 'discarded')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  for (const p of payments) {
    const inv = invoices.find((i) => i.id === p.invoiceId);
    const name = inv?.confirmed?.supplierName ?? '';
    const ref = inv?.confirmed?.invoiceNumber ?? '';
    const php = formatPhp(p.payout.amountPhpMinor);
    const usd = p.approval ? formatUsd(p.approval.youPayUsdcMinor) : null;
    if (!matches(q, [name, ref], [...amountKeys(php), ...(usd ? amountKeys(usd) : [])])) continue;
    found.payment.push({
      kind: 'payment',
      id: p.id,
      title: name || 'Payment',
      detail: [ref, php, STATE_LABEL[p.state]].filter(Boolean).join(' · '),
      href: `/dashboard/${inv?.source === 'transfer' ? 'transfer' : 'invoices'}?payment=${p.id}`,
    });
  }

  for (const i of invoices.filter((x) => x.source !== 'transfer')) {
    const f = i.confirmed ?? i.draft?.fields ?? null;
    if (!f) continue;
    const php = formatPhp(f.amountPhpMinor);
    if (!matches(q, [f.supplierName, f.invoiceNumber], amountKeys(php))) continue;
    found.bill.push({
      kind: 'bill',
      id: i.id,
      title: f.supplierName || 'Bill',
      detail: [f.invoiceNumber, php, f.dueDate ? `due ${shortDate(f.dueDate)}` : null].filter(Boolean).join(' · '),
      href: `/dashboard/invoices?invoice=${i.id}`,
    });
  }

  for (const s of org.suppliers) {
    // Searched by name and bank only; the account shows as its last four digits and is never matched.
    if (!matches(q, [s.name, s.bank], [])) continue;
    found.recipient.push({ kind: 'recipient', id: `${s.name}|${s.bank}|${s.accountLast4}`, title: s.name, detail: `${s.bank} •••• ${s.accountLast4}`, href: '/dashboard/recipients' });
  }

  // At most 8, shared fairly across the groups (one from each in turn), then shown grouped.
  const kinds: SearchKind[] = ['payment', 'bill', 'recipient'];
  const take: Record<SearchKind, number> = { payment: 0, bill: 0, recipient: 0 };
  let left = SEARCH_LIMIT;
  while (left > 0 && kinds.some((k) => take[k] < found[k].length)) {
    for (const k of kinds) {
      if (left > 0 && take[k] < found[k].length) {
        take[k] += 1;
        left -= 1;
      }
    }
  }
  const groups = kinds.filter((k) => take[k] > 0).map((k) => ({ kind: k, label: GROUP_LABEL[k], results: found[k].slice(0, take[k]) }));
  return { query: q, groups, total: groups.reduce((n, g) => n + g.results.length, 0) };
}
