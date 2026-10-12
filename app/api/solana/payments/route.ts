import { handle, readBody, schemas } from '@/lib/solana-app/http';
import { paymentView, quote } from '@/lib/solana-app/service';

/** Quote: mock partner prices, ranked by the route engine; Zeke explains. */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readBody(request, schemas.quote);
    const p = await quote(body.orgId, body.invoiceId);
    return { payment: await paymentView(p.id) };
  }, 201);
}
