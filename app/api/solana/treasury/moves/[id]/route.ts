import { ServiceError } from '@/lib/solana-app/errors';
import { schemas } from '@/lib/solana-app/http';
import { moveSummary } from '@/lib/solana-app/service';
import { resumeMove } from '@/lib/solana-app/treasury-service';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One move, its outcome checked again if it was unknown. Reading never sends anything. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    if (!schemas.moveId.safeParse(id).success) throw new ServiceError('payment_not_found', 'That move is not on the server for this company.', 404);
    return { move: moveSummary(await resumeMove(ctx.orgId, id)) };
  });
}
