import { dismissBill } from '@/lib/solana-app/bills';
import { scheduleShredForInvoice } from '@/lib/server/bank-details';
import { companyRoute, requireCanAct } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** "Not this one" (prompt 10 §6.2): the bill leaves the inbox, and the number printed on it is destroyed in 30 days. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    requireCanAct(ctx);
    const { id } = await params;
    const inv = await dismissBill(ctx.orgId, id, ctx.personName);
    if (inv.accountSecretId) await scheduleShredForInvoice(ctx.orgId, inv.id);
    return { dismissed: true };
  });
}
