import { ServiceError } from '@/lib/solana-app/errors';
import { readBody, schemas } from '@/lib/solana-app/http';
import { assertDetailsEditable, DETAILS_OPTIONS, detailsView, previousDetails, setTransferDetails } from '@/lib/solana-app/transfer-details';
import { getInvoice } from '@/lib/solana-app/service';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function transferId(id: string): string {
  if (!schemas.invoiceId.safeParse(id).success) throw new ServiceError('invoice_not_found', 'That transfer is not on the server for this company.', 404);
  return id;
}

/** What the payout partner needs for this transfer: the answers given, and what was given last time for the recipient. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const id = transferId((await params).id);
    return { details: detailsView(getInvoice(ctx.orgId, id).paymentDetails), previousDetails: detailsView(previousDetails(ctx.orgId, id)), detailsOptions: DETAILS_OPTIONS };
  });
}

/** "Same details as before?" Yes copies them; no gives every answer again. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const id = transferId((await params).id);
    const body = await readBody(request, schemas.transferDetails);
    await assertDetailsEditable(ctx.orgId, id);
    return { details: detailsView(setTransferDetails(ctx.orgId, id, body, ctx.personName)) };
  });
}
