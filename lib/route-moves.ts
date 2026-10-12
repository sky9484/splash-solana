/**
 * Old URLs that moved (prompt 07 §6.2, and the Phase 0 route map). proxy.ts answers each
 * with a 308, so a bookmark, a shared link or a browser history entry still lands, with its query.
 *
 * The /solana demo became the signed-in dashboard; the dashboard's own duplicates merged.
 * Import-free on purpose: proxy.ts runs it on every request.
 */
const EXACT: Record<string, string> = {
  '/solana': '/dashboard',
  '/solana/onboarding': '/dashboard/setup',
  '/solana/fund': '/dashboard/fund',
  '/solana/pay': '/dashboard/transfer',
  '/solana/policy': '/dashboard/settings/policy',
  '/solana/zeke': '/dashboard/zeke',
  '/dashboard/overview': '/dashboard',
  '/dashboard/send-usdc': '/dashboard/transfer',
  '/dashboard/transfers': '/dashboard/history',
  '/dashboard/copilot': '/dashboard/zeke',
  '/dashboard/0xwal': '/dashboard/zeke',
};

const RECEIPT = /^\/solana\/receipts\/(rcpt_[0-9a-f]{16})$/;

/** Where an old path lives now, or null when it has not moved. Trailing slashes are ignored. */
export function movedRoute(pathname: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (EXACT[path]) return EXACT[path];
  const receipt = RECEIPT.exec(path);
  if (receipt) return `/dashboard/receipts/${receipt[1]}`;
  // Anything else under /solana went with the demo: its nearest home is the dashboard.
  if (path.startsWith('/solana/')) return '/dashboard';
  return null;
}
