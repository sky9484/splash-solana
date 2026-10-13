import { batchView, resumeBatch } from '@/lib/solana-app/batch-service';
import { ServiceError } from '@/lib/solana-app/errors';
import { schemas } from '@/lib/solana-app/http';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One batch, after a status check of any chunk whose outcome was still unknown. Sends nothing. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    if (!schemas.batchId.safeParse(id).success) throw new ServiceError('payment_not_found', 'That batch is not on the server for this company.', 404);
    return { batch: batchView(await resumeBatch(ctx.orgId, id)) };
  });
}
