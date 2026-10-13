import { searchCompany } from '@/lib/solana-app/search';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The top row's search: this company's payments, bills and recipients (at most 8, grouped). The
 * company comes from the session; the query from `?q=`. No full account number is searched or sent.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get('q') ?? '';
  return companyRoute(request, async (ctx) => searchCompany(ctx.orgId, q));
}
