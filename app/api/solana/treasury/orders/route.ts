import { orderRequestFrom, prepareOrder } from '@/lib/solana-app/investments';
import { readBody, schemas } from '@/lib/solana-app/http';
import { companyRoute, requireMoneyGates, requireReadyToApprove } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * An order, ready for this device to approve: the exact text it signs (valid 60 seconds). The rules, the
 * eligibility gate and the money gates first. Nothing moves until the signed text comes back.
 */
export async function POST(request: Request) {
  return companyRoute(request, async (ctx) => {
    const body = await readBody(request, schemas.treasuryOrder);
    requireReadyToApprove(ctx);
    await requireMoneyGates(ctx);
    const { order, message, preview } = await prepareOrder(ctx.orgId, orderRequestFrom(body), ctx.personName);
    return { order: { id: order.id, expiresAt: order.expiresAt }, message, preview };
  });
}
