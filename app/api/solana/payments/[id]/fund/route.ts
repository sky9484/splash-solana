import { fundingOptions, fundingView, startFunding } from '@/lib/solana-app/funding-service';
import type { FundingSourceId } from '@/lib/solana-app/funding-router';
import { paymentFor, readBody, schemas } from '@/lib/solana-app/http';
import { companyRoute, requireMoneyGates } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Step 3 of a transfer: the two accounts, the plan for the chosen route's cost, and every way to bring money in. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    await paymentFor(id, ctx.orgId);
    const quoteId = new URL(request.url).searchParams.get('quoteId');
    return await fundingOptions(ctx.orgId, id, quoteId && /^rq_[a-z0-9_]{1,77}$/.test(quoteId) ? quoteId : null);
  });
}

/** Bring what's missing into the company's own Payments account from outside, after a funds check. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(
    request,
    async (ctx) => {
      const { id } = await params;
      const body = await readBody(request, schemas.fund);
      await requireMoneyGates(ctx);
      await paymentFor(id, ctx.orgId);
      // The schema's pattern is exactly the router's ids.
      const f = await startFunding(ctx.orgId, id, { ...body, source: body.source as FundingSourceId, by: ctx.personName });
      return { funding: fundingView(f) };
    },
    201,
  );
}
