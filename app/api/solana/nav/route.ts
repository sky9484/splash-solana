import { navShell } from '@/lib/solana-app/nav-counts';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What the dashboard's shell shows around every page, in one read: the sidebar's badges, the floating
 * Zeke's count and the rate strip. From this company's own state, never guessed in the browser.
 */
export async function GET(request: Request) {
  return companyRoute(request, async (ctx) => navShell(ctx.orgId));
}
