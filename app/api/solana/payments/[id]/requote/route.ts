import { paymentFor, readBody, schemas } from '@/lib/solana-app/http';
import { paymentView, requote } from '@/lib/solana-app/service';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A fresh quote for the same payment (quotes live at most 60 seconds). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    const body = await readBody(request, schemas.requote);
    await paymentFor(id, ctx.orgId);
    await requote(id, new Date(), { allowShort: body.allowShort === true });
    return { payment: await paymentView(id) };
  });
}
