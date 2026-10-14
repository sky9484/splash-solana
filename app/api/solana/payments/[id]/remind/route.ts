import { paymentFor, readBody, schemas } from '@/lib/solana-app/http';
import { remindApprover } from '@/lib/solana-app/service';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Remind" on a payment waiting at "1 of 2 approved" (prompt 10 §5.7): one in-app notice to whoever is
 * still to approve, at most once every ten minutes. It approves nothing and moves nothing.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    await readBody(request, schemas.empty);
    await paymentFor(id, ctx.orgId);
    return await remindApprover(ctx.orgId, id, ctx.personName);
  });
}
