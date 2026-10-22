import { setSweepRule } from '@/lib/solana-app/investments';
import { readBody, schemas } from '@/lib/solana-app/http';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The owner turns sweep on or off and sets the cushion (recorded with who and when). A draft still needs a person's approval. */
export async function POST(request: Request) {
  return companyRoute(request, async (ctx) => {
    const body = await readBody(request, schemas.sweepRule);
    const cushionMinor = body.cushionMinor === undefined ? undefined : BigInt(body.cushionMinor);
    return { sweep: setSweepRule(ctx.orgId, { on: body.on, cushionMinor }, { isOwner: ctx.isOwner, name: ctx.personName }) };
  });
}
