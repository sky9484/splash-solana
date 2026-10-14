import { payBill } from '@/lib/solana-app/bills';
import { readBody, schemas } from '@/lib/solana-app/http';
import { paymentView } from '@/lib/solana-app/service';
import { companyRoute, requireMoneyGates } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Confirm and pay" a bill (prompt 10 §6.2): confirm it as checked, then quote it. The answer is the
 * payment; the page opens it on Transfer's Step 3 (one engine, one approval card). New bank details are
 * refused until their call-back is recorded.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    const body = await readBody(request, schemas.payBill);
    await requireMoneyGates(ctx);
    const p = await payBill(ctx.orgId, id, { by: ctx.personName, fields: body.fields ? { ...body.fields, einvoiceRef: body.fields.einvoiceRef ?? '' } : undefined, confirmed: body.confirmed });
    return { payment: await paymentView(p.id) };
  });
}
