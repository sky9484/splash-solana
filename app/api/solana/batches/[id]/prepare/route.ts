import { prepareBatch } from '@/lib/solana-app/batch-service';
import { ServiceError } from '@/lib/solana-app/errors';
import { readBody, schemas } from '@/lib/solana-app/http';
import { companyRoute, requireCanAct, requireMoneyGates, requireReadyToApprove } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The unsigned chunk transactions for THIS member's device: every chunk, or one chunk to retry. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    requireCanAct(ctx);
    const { id } = await params;
    if (!schemas.batchId.safeParse(id).success) throw new ServiceError('payment_not_found', 'That batch is not on the server for this company.', 404);
    const body = await readBody(request, schemas.batchPrepare);
    const { deviceKey } = requireReadyToApprove(ctx);
    await requireMoneyGates(ctx);
    return await prepareBatch(ctx.orgId, id, { signer: deviceKey, chunk: body.chunk, rehearsal: body.rehearsal });
  });
}
