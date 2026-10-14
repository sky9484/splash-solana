import { ServiceError } from '@/lib/solana-app/errors';
import { fundingView, startTopUp, topUpOptions } from '@/lib/solana-app/funding-service';
import type { FundingSourceId } from '@/lib/solana-app/funding-router';
import { readBody, schemas } from '@/lib/solana-app/http';
import { companyRoute, requireMoneyGates } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Balance › Add money (prompt 10 §5.10): every way in, priced for `?amountMinor=` (US$, 6 decimals). */
export async function GET(request: Request) {
  return companyRoute(request, async (ctx) => {
    const raw = new URL(request.url).searchParams.get('amountMinor') ?? '0';
    if (!/^\d{1,16}$/.test(raw)) throw new ServiceError('bad_request', 'Give the amount in whole units.');
    return await topUpOptions(ctx.orgId, BigInt(raw));
  });
}

/** Add money to the Payments account, after a funds check and a declaration. Splash's fee: US$0. */
export async function POST(request: Request) {
  return companyRoute(
    request,
    async (ctx) => {
      const body = await readBody(request, schemas.topUp);
      await requireMoneyGates(ctx);
      const f = await startTopUp(ctx.orgId, { ...body, source: body.source as FundingSourceId, amountMinor: BigInt(body.amountMinor), by: ctx.personName });
      return { funding: fundingView(f) };
    },
    201,
  );
}
