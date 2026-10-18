import { ServiceError } from '@/lib/solana-app/errors';
import { readBody, schemas } from '@/lib/solana-app/http';
import { stopSharing } from '@/lib/solana-app/service';
import { mayRevealBankNumbers } from '@/lib/server/bank-details';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Stop sharing" (prompt 12 §5.3): every live auditor link to this receipt stops opening, and the old
 * link shows the not-valid page. Only an owner or admin, the same rule as revealing a bank number.
 * Idempotent: stopping a receipt with no live link changes nothing.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    await readBody(request, schemas.empty);
    if (!schemas.receiptId.safeParse(id).success) throw new ServiceError('receipt_not_found', 'That receipt is not on the server for this company.', 404);
    if (!mayRevealBankNumbers(ctx)) throw new ServiceError('not_authorized', 'Only an owner or admin can stop sharing.', 403);
    return stopSharing(ctx.orgId, id);
  });
}
