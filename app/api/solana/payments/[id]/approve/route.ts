import { after } from 'next/server';

import { handle, paymentFor, readBody, schemas } from '@/lib/solana-app/http';
import { deliverPartnerEvents, getPayment, paymentView, submitApproval } from '@/lib/solana-app/service';

/**
 * Execute with the device key's signatures (I-4: refused without them). Afterwards the mock partner
 * watches its deposit address and sends its signed webhooks, spaced out so the progress line can show
 * each stop.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody(request, schemas.approve);
    paymentFor(id, body.orgId);
    await submitApproval(id, { signatures: body.signatures });
    after(async () => {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        await deliverPartnerEvents(id, { gapMs: 1800 });
      } catch (e) {
        const p = getPayment(id);
        p.problem = { code: 'uncertain', message: `Checking whether this payment went through. Don't retry yet. (${(e as Error).message})` };
      }
    });
    return { payment: paymentView(id) };
  });
}
