import { ServiceError } from '@/lib/solana-app/errors';
import { dismissSweepDraft } from '@/lib/solana-app/investments';
import { schemas } from '@/lib/solana-app/http';
import { companyRoute, requireCanAct, requireReadyToApprove } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Not now" on a sweep or quarter-interest draft (prompt 11 §4.3): an approver sets it aside. Nothing
 * moves; a sweep-out draft isn't drafted again for 7 days. Recorded with who and when.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    requireCanAct(ctx);
    const { id } = await params;
    if (!schemas.sweepDraftId.safeParse(id).success) throw new ServiceError('bad_request', 'That draft isn’t here.', 404);
    requireReadyToApprove(ctx);
    const d = dismissSweepDraft(ctx.orgId, id, { name: ctx.personName });
    return { draft: { id: d.id, state: d.state, dismissedAt: d.dismissed?.at ?? null } };
  });
}
