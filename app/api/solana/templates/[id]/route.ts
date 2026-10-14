import { ServiceError } from '@/lib/solana-app/errors';
import { deleteTemplate } from '@/lib/solana-app/templates';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Remove a transfer template. Payments made from it are not touched. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    if (!/^tpl_[0-9a-f]{16}$/.test(id)) throw new ServiceError('bad_request', 'That is not a template.');
    deleteTemplate(ctx.orgId, id);
    return { removed: id };
  });
}
