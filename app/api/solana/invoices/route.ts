import { handle, readBody, schemas } from '@/lib/solana-app/http';
import { invoiceView, readInvoiceDraft } from '@/lib/solana-app/service';

/** Zeke's Reader: a DRAFT of the invoice fields with a source for each. A person confirms every field next. */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readBody(request, schemas.invoice);
    const { invoice, text } = await readInvoiceDraft(body.orgId, body);
    return { invoice: invoiceView(invoice), text };
  }, 201);
}
