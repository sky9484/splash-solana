import { handle, readBody, schemas } from '@/lib/solana-app/http';
import { confirmInvoice } from '@/lib/solana-app/service';

/** The person's confirmed fields become the invoice record; its salted commitment is computed here. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody(request, schemas.confirm);
    const fields: Record<string, string> = { ...body.fields, einvoiceRef: body.fields.einvoiceRef ?? '' };
    return { confirmed: confirmInvoice(body.orgId, id, { fields, confirmed: body.confirmed, confirmedBy: body.confirmedBy }) };
  });
}
