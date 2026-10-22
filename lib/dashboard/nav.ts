/**
 * The dashboard's sidebar (prompt 10 §3.1): Overview on its own, then Pay, Money, Contacts and
 * Control. Pure data, shared by the shell (desktop sidebar, collapsed rail, phone overlay) and its
 * tests. Badges are computed from the server's counts (lib/solana-app/nav-counts.ts), never guessed
 * in the browser.
 */

export type NavIcon = 'overview' | 'transfer' | 'invoices' | 'batch' | 'balance' | 'treasury' | 'history' | 'recipients' | 'rules' | 'zeke';

export type NavBadgeKind = 'approvals' | 'billsDue' | 'unverified' | 'ai';

export interface NavItem {
  label: string;
  href: string;
  icon: NavIcon;
  badge?: NavBadgeKind;
}

export interface NavGroup {
  /** null: the top item, with no group label. */
  title: string | null;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  { title: null, items: [{ label: 'Overview', href: '/dashboard', icon: 'overview', badge: 'approvals' }] },
  {
    title: 'Pay',
    items: [
      { label: 'Transfer', href: '/dashboard/transfer', icon: 'transfer' },
      { label: 'Invoices', href: '/dashboard/invoices', icon: 'invoices', badge: 'billsDue' },
      { label: 'Batch payout', href: '/dashboard/batch', icon: 'batch' },
    ],
  },
  {
    title: 'Money',
    items: [
      { label: 'Balance', href: '/dashboard/fund', icon: 'balance' },
      { label: 'Treasury', href: '/dashboard/treasury', icon: 'treasury' },
      { label: 'History', href: '/dashboard/history', icon: 'history' },
    ],
  },
  { title: 'Contacts', items: [{ label: 'Recipients', href: '/dashboard/recipients', icon: 'recipients', badge: 'unverified' }] },
  {
    title: 'Control',
    items: [
      { label: 'Zeke', href: '/dashboard/zeke', icon: 'zeke', badge: 'ai' },
    ],
  },
];

/** What the server counted for the badges (GET /api/solana/nav). */
export interface NavCounts {
  /** Payments waiting for a person to approve on a device. */
  approvals: number;
  /** Bills (checked, unpaid) due within 7 days. */
  billsDue7d: number;
  /** Any saved recipient whose bank details aren't verified. */
  unverifiedRecipients: boolean;
}

export type NavBadge = { kind: 'count'; text: string; label: string; tone: 'coral' | 'ink' } | { kind: 'dot'; label: string } | { kind: 'tag'; text: string; label: string };

/** The badge an item shows for the server's counts, or none. Never shown for a zero. */
export function badgeFor(kind: NavBadgeKind | undefined, counts: NavCounts | null): NavBadge | null {
  if (kind === 'ai') return { kind: 'tag', text: 'AI', label: 'an AI assistant' };
  if (!counts || !kind) return null;
  if (kind === 'approvals' && counts.approvals > 0) {
    return { kind: 'count', text: String(counts.approvals), tone: 'coral', label: counts.approvals === 1 ? '1 payment needs your approval' : `${counts.approvals} payments need your approval` };
  }
  if (kind === 'billsDue' && counts.billsDue7d > 0) {
    return { kind: 'count', text: `${counts.billsDue7d} due`, tone: 'ink', label: counts.billsDue7d === 1 ? '1 bill due within 7 days' : `${counts.billsDue7d} bills due within 7 days` };
  }
  if (kind === 'unverified' && counts.unverifiedRecipients) return { kind: 'dot', label: 'a recipient is not verified' };
  return null;
}

/** Whether a nav item is the current page: Overview only on /dashboard itself, the rest on their subtree. */
export function isActive(href: string, pathname: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Pages outside the sidebar groups (the footer links and the pages they lead to), for the header. */
const OTHER_PAGES: { href: string; group: string | null; label: string }[] = [
  { href: '/dashboard/settings/policy', group: 'Settings', label: 'Rules' },
  { href: '/dashboard/settings/devices', group: 'Settings', label: 'Devices' },
  { href: '/dashboard/settings/recovery', group: 'Settings', label: 'Recovery' },
  { href: '/dashboard/settings/account', group: 'Settings', label: 'Account details' },
  { href: '/dashboard/settings', group: null, label: 'Settings' },
  { href: '/dashboard/customer-service', group: null, label: 'Support' },
  { href: '/dashboard/profile', group: null, label: 'Your profile' },
  { href: '/dashboard/setup', group: null, label: 'Account setup' },
  { href: '/dashboard/receipts', group: 'Money', label: 'Receipt' },
];

/**
 * Where a page sits, for the header: its sidebar group and its own name ("Money", "Balance"). Overview
 * has no group. A page the sidebar doesn't list falls back to "Dashboard".
 */
export function locationFor(pathname: string): { group: string | null; label: string } {
  for (const g of NAV_GROUPS) {
    for (const item of g.items) if (isActive(item.href, pathname)) return { group: g.title, label: item.label };
  }
  for (const p of OTHER_PAGES) if (pathname === p.href || pathname.startsWith(`${p.href}/`)) return { group: p.group, label: p.label };
  return { group: null, label: 'Dashboard' };
}

export interface SetupStepLite {
  id: string;
  title: string;
  done: boolean;
}

/** The sidebar's "Next:" words for each setup step. */
const NEXT_WORDS: Record<string, string> = {
  terms: 'accept the terms',
  profile: 'add your business profile',
  verify: 'verify the business',
  approvals: 'set who approves',
  recipient: 'save your first recipient',
  second_approver: 'add a second approver',
};

/** The optional steps (lib/server/onboarding.ts): the first recipient and a second approver. */
const OPTIONAL_STEPS = new Set(['recipient', 'second_approver']);

/**
 * The Account setup card: "Account setup · 4 of 6", a bar and the next step. Null once every required
 * step is done (prompt 12 B6), so the card disappears; the optional steps stay on the setup page,
 * reachable from Settings. The count is the real one.
 */
export function setupCard(steps: SetupStepLite[] | null | undefined): { done: number; total: number; pct: number; next: string } | null {
  if (!steps || steps.length === 0) return null;
  if (steps.every((s) => s.done || OPTIONAL_STEPS.has(s.id))) return null;
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done)!;
  return { done, total: steps.length, pct: Math.round((done / steps.length) * 100), next: NEXT_WORDS[next.id] ?? next.title.toLowerCase() };
}
