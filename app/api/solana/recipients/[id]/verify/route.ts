import { verifyRecipient } from '@/lib/server/bank-recipients';
import { readBody, schemas } from '@/lib/solana-app/http';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The call-back on this recipient passed (a number you already had, not one on the invoice): payable. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    const body = await readBody(request, schemas.recipientVerify);
    return { recipient: verifyRecipient(ctx.orgId, id, body, { isOwner: ctx.isOwner, role: ctx.role }) };
  });
}
