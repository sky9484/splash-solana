import { paymentFor } from '@/lib/solana-app/http';
import { paymentView, resumePayment } from '@/lib/solana-app/service';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    await paymentFor(id, ctx.orgId);
    // One status check per poll: moves a payment on if its transaction landed (or expired) meanwhile.
    await resumePayment(id).catch(() => undefined);
    return { payment: await paymentView(id) };
  });
}
