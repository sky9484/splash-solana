import { ServiceError } from '@/lib/solana-app/errors';
import { schemas } from '@/lib/solana-app/http';
import { assertReceiptOf, evidenceBlob } from '@/lib/solana-app/service';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The sealed record as stored, for the receipt's integrity check in the browser. Ciphertext only. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    if (!schemas.receiptId.safeParse(id).success) throw new ServiceError('receipt_not_found', 'That receipt is not on the server for this company.', 404);
    assertReceiptOf(id, ctx.orgId);
    return { blob: await evidenceBlob(id) };
  });
}
