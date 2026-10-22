import { readBody, schemas } from '@/lib/solana-app/http';
import { invoiceView, startTransfer } from '@/lib/solana-app/service';
import { companyRoute, requireMoneyGates, requireReadyToApprove } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A transfer with no invoice. The person who types it confirms every field by sending it; a new
 * recipient carries its call-back. The answer is a confirmed record: quote it next (POST /payments),
 * the same path an invoice takes from here.
 */
export async function POST(request: Request) {
  return companyRoute(
    request,
    async (ctx) => {
      const body = await readBody(request, schemas.transfer);
      requireReadyToApprove(ctx);
      await requireMoneyGates(ctx);
      const inv = startTransfer(ctx.orgId, { ...body, by: ctx.personName });
      return { invoice: invoiceView(inv) };
    },
    201,
  );
}
