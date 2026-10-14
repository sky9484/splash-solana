import { treasuryView } from '@/lib/solana-app/investments';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Treasury, in one read (prompt 10 §7): the three accounts, the reserve against its floor, what can be
 * invested, the T-bills and stocks with every figure dated and sourced, holdings and their holds, the
 * sweep rule and today's draft. Makes today's sweep draft if the rule is on and none exists yet; never
 * approves or moves anything.
 */
export async function GET(request: Request) {
  return companyRoute(request, async (ctx) => ({ treasury: await treasuryView(ctx.orgId, { isOwner: ctx.isOwner }) }));
}
