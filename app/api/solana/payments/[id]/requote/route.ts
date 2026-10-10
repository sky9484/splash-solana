import { handle, paymentFor, readBody, schemas } from '@/lib/solana-app/http';
import { paymentView, requote } from '@/lib/solana-app/service';

/** A fresh quote for the same payment (quotes live at most 60 seconds). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody(request, schemas.orgOnly);
    paymentFor(id, body.orgId);
    await requote(id);
    return { payment: paymentView(id) };
  });
}
