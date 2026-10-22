import { ServiceError } from '@/lib/solana-app/errors';
import { cancelRequest, remindRequest, requestRow, sendRequest } from '@/lib/solana-app/requests';
import { companyRoute, requireMoneyGates } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A request's actions (prompt 10 §6.3): `send` a draft, `remind` the payer (a Splash payer's inbox says
 * so; someone else gets the link again), or `cancel` one that isn't paid.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id, action } = await params;
    if (action === 'send') {
      await requireMoneyGates(ctx);
      return { request: requestRow(await sendRequest(ctx.orgId, id), new Date()) };
    }
    if (action === 'remind') {
      const { request: r, channel } = await remindRequest(ctx.orgId, id, ctx.personName);
      return { request: requestRow(r, new Date()), channel };
    }
    if (action === 'cancel') return { request: requestRow(await cancelRequest(ctx.orgId, id), new Date()) };
    throw new ServiceError('bad_request', 'Unknown action.', 404);
  });
}
