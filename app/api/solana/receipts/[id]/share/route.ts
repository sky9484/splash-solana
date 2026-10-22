import { ServiceError } from '@/lib/solana-app/errors';
import { readBody, schemas } from '@/lib/solana-app/http';
import { liveShareOf, shareReceipt } from '@/lib/solana-app/service';
import type { ShareRecord } from '@/lib/solana-app/doc-store';
import { mayRevealBankNumbers } from '@/lib/server/bank-details';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const view = (share: ShareRecord) => ({ token: share.token, path: `/receipt/${share.token}`, createdAt: share.createdAt, expiresAt: share.expiresAt ?? null });

/**
 * This receipt's live auditor link, if any, and whether the person asking may stop it (an owner or
 * admin, the rule for revealing a bank number). "Share with auditor" reads it before offering a new link.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    if (!schemas.receiptId.safeParse(id).success) throw new ServiceError('receipt_not_found', 'That receipt is not on the server for this company.', 404);
    const share = liveShareOf(ctx.orgId, id);
    return { share: share ? view(share) : null, mayStopSharing: mayRevealBankNumbers(ctx) };
  });
}

/**
 * "Share with auditor": a link that opens this one receipt without signing in, with its verify steps,
 * the Solscan trace and the evidence pack. One live link per receipt; a new one opens for 90 days.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    await readBody(request, schemas.empty);
    if (!schemas.receiptId.safeParse(id).success) throw new ServiceError('receipt_not_found', 'That receipt is not on the server for this company.', 404);
    return view(shareReceipt(ctx.orgId, id, ctx.personName));
  });
}
