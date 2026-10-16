import { readBody, schemas } from '@/lib/solana-app/http';
import { paymentView, quote } from '@/lib/solana-app/service';
import { companyRoute, requireCanAct, requireMoneyGates } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Quote: mock partner prices, ranked by the route engine; Zeke explains. */
export async function POST(request: Request) {
  return companyRoute(
    request,
    async (ctx) => {
      requireCanAct(ctx);
      const body = await readBody(request, schemas.quote);
      await requireMoneyGates(ctx);
      const p = await quote(ctx.orgId, body.invoiceId, { allowShort: body.allowShort === true });
      return { payment: await paymentView(p.id) };
    },
    201,
  );
}
