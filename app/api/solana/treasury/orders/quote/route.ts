import { orderRequestFrom, quoteOrder, resolveOrderRequest } from '@/lib/solana-app/investments';
import { readBody, schemas } from '@/lib/solana-app/http';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** What an order would do and whether it may go, before anyone approves anything. Reads only. */
export async function POST(request: Request) {
  return companyRoute(request, async (ctx) => {
    const body = await readBody(request, schemas.treasuryOrder);
    return { preview: await quoteOrder(ctx.orgId, resolveOrderRequest(ctx.orgId, orderRequestFrom(body))) };
  });
}
