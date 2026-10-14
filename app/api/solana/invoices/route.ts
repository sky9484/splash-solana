import { billsView } from '@/lib/solana-app/bills';
import { readBody, schemas } from '@/lib/solana-app/http';
import { invoiceView, readInvoiceDraft } from '@/lib/solana-app/service';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Pay an invoice's inbox (prompt 10 §6.2): every bill on its tab, with the tab counts. */
export async function GET(request: Request) {
  return companyRoute(request, async (ctx) => billsView(ctx.orgId));
}

/**
 * Zeke's Reader: a DRAFT of the invoice fields with a source for each. A person confirms every field
 * next. The text that comes back is the document with its account number masked; the full number is
 * sealed and never returned (prompt 10 §6.2).
 */
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
