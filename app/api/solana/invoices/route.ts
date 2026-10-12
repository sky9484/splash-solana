import { readBody, schemas } from '@/lib/solana-app/http';
import { invoiceView, readInvoiceDraft } from '@/lib/solana-app/service';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Zeke's Reader: a DRAFT of the invoice fields with a source for each. A person confirms every field next. */
export async function POST(request: Request) {
  return companyRoute(
    request,
    async (ctx) => {
      const body = await readBody(request, schemas.invoice);
      const { invoice, text } = await readInvoiceDraft(ctx.orgId, body);
      return { invoice: invoiceView(invoice), text };
    },
    201,
  );
}
