import { ServiceError } from '@/lib/solana-app/errors';
import { approveOrder, orderSummary } from '@/lib/solana-app/investments';
import { readBody, schemas } from '@/lib/solana-app/http';
import { companyRoute, requireCanAct, requireMoneyGates, requireReadyToApprove } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** This device's signature over the order's text: checked, the rules checked again, then settled. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    requireCanAct(ctx);
    const { id } = await params;
    if (!schemas.orderId.safeParse(id).success) throw new ServiceError('payment_not_found', 'That order isn’t on the server for this company.', 404);
    const body = await readBody(request, schemas.orderApprove);
    const { deviceKey } = requireReadyToApprove(ctx);
    await requireMoneyGates(ctx);
    return { order: orderSummary(await approveOrder(ctx.orgId, id, { signature: body.signature, who: ctx.personName, deviceKey })) };
  });
}
