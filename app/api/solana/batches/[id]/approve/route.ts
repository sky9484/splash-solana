import { batchView, submitBatch } from '@/lib/solana-app/batch-service';
import { ServiceError } from '@/lib/solana-app/errors';
import { readBody, schemas } from '@/lib/solana-app/http';
import { companyRoute, requireCanAct, requireMoneyGates, requireReadyToApprove } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Send the signed chunks in order; each pays all its suppliers or none. Refused without every signature. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    requireCanAct(ctx);
    const { id } = await params;
    if (!schemas.batchId.safeParse(id).success) throw new ServiceError('payment_not_found', 'That batch is not on the server for this company.', 404);
    const body = await readBody(request, schemas.batchApprove);
    requireReadyToApprove(ctx);
    await requireMoneyGates(ctx);
    return { batch: batchView(await submitBatch(ctx.orgId, id, { signatures: body.signatures, who: ctx.personName })) };
  });
}
