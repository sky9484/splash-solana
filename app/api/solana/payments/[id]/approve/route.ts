import { after } from 'next/server';

import { withCompany } from '@/lib/solana-app/company';
import { paymentFor, readBody, schemas } from '@/lib/solana-app/http';
import { deliverPartnerEvents, noteProblem, paymentView, submitApproval } from '@/lib/solana-app/service';
import { companyRoute, requireMoneyGates, requireReadyToApprove } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Execute with the device key's signatures (I-4: refused without them). Afterwards the mock partner
 * watches its deposit address and sends its signed webhooks, spaced out so the progress line can show
 * each stop. The evidence those produce is the company's document, so that work saves it too.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    const body = await readBody(request, schemas.approve);
    requireReadyToApprove(ctx);
    await requireMoneyGates(ctx);
    await paymentFor(id, ctx.orgId);
    const p = await submitApproval(id, { signatures: body.signatures, who: ctx.personName });
    // Only once the execute is confirmed does the mock partner look at its deposit address.
    if (p.state === 'confirmed') {
      after(async () => {
        await new Promise((r) => setTimeout(r, 1500));
        await withCompany(ctx.orgId, async () => {
          try {
            await deliverPartnerEvents(id, { gapMs: 1800 });
          } catch (e) {
            await noteProblem(id, { code: 'uncertain', message: `Checking whether this payment went through. Don't retry yet. (${(e as Error).message})` }).catch(() => undefined);
          }
        }).catch((e) => console.error('[api/solana] partner events', e));
      });
    }
    return { payment: await paymentView(id) };
  });
}
