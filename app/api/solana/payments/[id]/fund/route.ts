import { fundingOptions, fundingView, startFunding } from '@/lib/solana-app/funding-service';
import { paymentFor, readBody, schemas } from '@/lib/solana-app/http';
import { companyRoute, requireMoneyGates } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Step 3 of a transfer: the two vaults, what the chosen route costs, and every way to bring the USDC in. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    await paymentFor(id, ctx.orgId);
    const quoteId = new URL(request.url).searchParams.get('quoteId');
    return await fundingOptions(ctx.orgId, id, quoteId && /^rq_[a-z0-9_]{1,77}$/.test(quoteId) ? quoteId : null);
  });
}

/** Bring the route's USDC into the company's own payments vault from outside its vaults, after a funds check. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(
    request,
    async (ctx) => {
      const { id } = await params;
      const body = await readBody(request, schemas.fund);
      await requireMoneyGates(ctx);
      await paymentFor(id, ctx.orgId);
      const f = await startFunding(ctx.orgId, id, { ...body, by: ctx.personName });
      return { funding: fundingView(f) };
    },
    201,
  );
}
