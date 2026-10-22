import { zekeDeskView } from '@/lib/solana-app/zeke-desk';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The Zeke page's counters, "Waiting for you" and "Today", from the company's own state (prompt 10 §7A). */
export async function GET(request: Request) {
  return companyRoute(request, async (ctx) => ({ desk: await zekeDeskView(ctx.orgId) }));
}
