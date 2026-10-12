import { readBody, schemas } from '@/lib/solana-app/http';
import { paymentView, quote } from '@/lib/solana-app/service';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Quote: mock partner prices, ranked by the route engine; Zeke explains. */
export async function POST(request: Request) {
  return companyRoute(
    request,
    async (ctx) => {
      const body = await readBody(request, schemas.quote);
      const p = await quote(ctx.orgId, body.invoiceId);
      return { payment: await paymentView(p.id) };
    },
    201,
  );
}
