import { after } from 'next/server';

import { handle, paymentFor, readBody, schemas } from '@/lib/solana-app/http';
import { deliverPartnerEvents, noteProblem, paymentView, submitApproval } from '@/lib/solana-app/service';

/**
 * Execute with the device key's signatures (I-4: refused without them). Afterwards the mock partner
 * watches its deposit address and sends its signed webhooks, spaced out so the progress line can show
 * each stop.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody(request, schemas.approve);
    await paymentFor(id, body.orgId);
    const p = await submitApproval(id, { signatures: body.signatures });
    // Only once the execute is confirmed does the mock partner look at its deposit address.
    if (p.state === 'confirmed') {
      after(async () => {
        await new Promise((r) => setTimeout(r, 1500));
        try {
          await deliverPartnerEvents(id, { gapMs: 1800 });
        } catch (e) {
          await noteProblem(id, { code: 'uncertain', message: `Checking whether this payment went through. Don't retry yet. (${(e as Error).message})` }).catch(() => undefined);
        }
      });
    }
    return { payment: await paymentView(id) };
  });
}
