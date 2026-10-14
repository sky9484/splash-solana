import { checkView } from '@/lib/solana-app/bills';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Check the invoice" (prompt 10 §6.2): the document with the account number masked, where each field
 * came from, and the bank panel. Whether "Show number" is offered depends on who is asking.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    return { check: await checkView(ctx.orgId, id, { isOwner: ctx.isOwner, role: ctx.session.userRole, hasDevice: Boolean(ctx.deviceKey) }) };
  });
}
