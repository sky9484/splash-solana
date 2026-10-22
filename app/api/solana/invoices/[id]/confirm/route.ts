import { readBody, schemas } from '@/lib/solana-app/http';
import { confirmInvoice } from '@/lib/solana-app/service';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The person's confirmed fields become the invoice record; its salted commitment is computed here. Signed by who is signed in. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    const body = await readBody(request, schemas.confirm);
    const fields: Record<string, string> = { ...body.fields, einvoiceRef: body.fields.einvoiceRef ?? '' };
    return { confirmed: confirmInvoice(ctx.orgId, id, { fields, confirmed: body.confirmed, confirmedBy: ctx.personName }) };
  });
}
