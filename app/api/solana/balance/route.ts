import { balanceFor } from '@/lib/solana-app/balance';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Balance (prompt 10 §5.10), in one read: the Payments account, what's waiting and free, and money in and out. */
export async function GET(request: Request) {
  return companyRoute(request, async (ctx) => balanceFor(ctx.orgId));
}
