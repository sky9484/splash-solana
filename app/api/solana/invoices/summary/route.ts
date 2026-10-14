import { billCounts } from '@/lib/solana-app/bills';
import { requestsView } from '@/lib/solana-app/requests';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The Invoices chooser's live counts (prompt 10 §6.1), from server state: bills to check and waiting, requests unpaid and overdue. */
export async function GET(request: Request) {
  return companyRoute(request, async (ctx) => {
    const counts = await billCounts(ctx.orgId);
    const req = requestsView(ctx.orgId);
    return { pay: { toCheck: counts.check, ready: counts.ready, waiting: counts.waiting }, get: { unpaid: req.unpaidCount, overdue: req.overdueCount } };
  });
}
