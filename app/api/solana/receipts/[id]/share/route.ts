import { ServiceError } from '@/lib/solana-app/errors';
import { readBody, schemas } from '@/lib/solana-app/http';
import { shareReceipt } from '@/lib/solana-app/service';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Share with auditor": a link that opens this one receipt without signing in, with its verify steps,
 * the Solscan trace and the evidence pack. One live link per receipt.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    await readBody(request, schemas.empty);
    if (!schemas.receiptId.safeParse(id).success) throw new ServiceError('receipt_not_found', 'That receipt is not on the server for this company.', 404);
    const share = shareReceipt(ctx.orgId, id, ctx.personName);
    return { token: share.token, path: `/receipt/${share.token}`, createdAt: share.createdAt };
  });
}
