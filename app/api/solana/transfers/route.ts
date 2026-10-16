import { readBody, schemas } from '@/lib/solana-app/http';
import { invoiceView, startTransfer } from '@/lib/solana-app/service';
import { DETAILS_OPTIONS, detailsView, previousDetails } from '@/lib/solana-app/transfer-details';
import { companyRoute, requireCanAct, requireMoneyGates, requireReadyToApprove } from '@/lib/server/solana-company';

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
      requireCanAct(ctx);
      const body = await readBody(request, schemas.transfer);
      requireReadyToApprove(ctx);
      await requireMoneyGates(ctx);
      const inv = startTransfer(ctx.orgId, { ...body, by: ctx.personName });
      // What Step 3 offers back: the details given last time for this recipient, if any.
      return { invoice: invoiceView(inv), previousDetails: detailsView(previousDetails(ctx.orgId, inv.id)), detailsOptions: DETAILS_OPTIONS };
    },
    201,
  );
}
