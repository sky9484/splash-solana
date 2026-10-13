import { ServiceError } from '@/lib/solana-app/errors';
import { fundingView, refreshFunding } from '@/lib/solana-app/funding-service';
import { schemas } from '@/lib/solana-app/http';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Where one funding stands: checking, held by the funds check, or in the payments vault. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    if (!schemas.fundingId.safeParse(id).success) throw new ServiceError('funding_not_found', 'That funding is not on the server for this company.', 404);
    return { funding: fundingView(await refreshFunding(ctx.orgId, id)) };
  });
}
