import { ServiceError } from '@/lib/solana-app/errors';
import { readBody, schemas } from '@/lib/solana-app/http';
import { moveSummary } from '@/lib/solana-app/service';
import { submitMove } from '@/lib/solana-app/treasury-service';
import { companyRoute, requireMoneyGates, requireReadyToApprove } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Send the signed move: proposal, then execute. Refused without every signature from this device. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    if (!schemas.moveId.safeParse(id).success) throw new ServiceError('payment_not_found', 'That move is not on the server for this company.', 404);
    const body = await readBody(request, schemas.moveApprove);
    requireReadyToApprove(ctx);
    await requireMoneyGates(ctx);
    return { move: moveSummary(await submitMove(ctx.orgId, id, { signatures: body.signatures, who: ctx.personName })) };
  });
}
