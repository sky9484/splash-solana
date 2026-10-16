import { paymentFor, readBody, schemas } from '@/lib/solana-app/http';
import { discardPayment } from '@/lib/solana-app/service';
import { companyRoute, requireCanAct } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Drop a payment nothing was sent for. Its record stays (state "discarded", who and when); nothing on chain is touched. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    requireCanAct(ctx);
    const { id } = await params;
    await readBody(request, schemas.empty);
    await paymentFor(id, ctx.orgId);
    const p = await discardPayment(id, ctx.personName);
    return { payment: { id: p.id, state: p.state } };
  });
}
