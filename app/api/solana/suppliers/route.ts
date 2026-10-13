import { ServiceError } from '@/lib/solana-app/errors';
import { readBody, schemas } from '@/lib/solana-app/http';
import { removeSupplier } from '@/lib/solana-app/service';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Take a saved recipient off the company's verified list. An owner decides who the company pays;
 * payments already made are not touched, and paying this recipient again starts with a call-back.
 */
export async function DELETE(request: Request) {
  return companyRoute(request, async (ctx) => {
    if (!ctx.isOwner) throw new ServiceError('not_authorized', 'Only an owner can remove a saved recipient.', 403);
    const body = await readBody(request, schemas.supplierRemove);
    return { remaining: removeSupplier(ctx.orgId, body) };
  });
}
