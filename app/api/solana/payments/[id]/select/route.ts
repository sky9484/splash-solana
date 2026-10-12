import { paymentFor, readBody, schemas } from '@/lib/solana-app/http';
import { paymentView, selectRoute } from '@/lib/solana-app/service';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The person chose a route: deterministic policy runs and the approval card is built from engine fields only. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    const body = await readBody(request, schemas.select);
    await paymentFor(id, ctx.orgId);
    await selectRoute(id, { quoteId: body.quoteId, rehearsal: body.rehearsal });
    return { payment: await paymentView(id) };
  });
}
