import { confirmEligibility } from '@/lib/solana-app/investments';
import { readBody, schemas } from '@/lib/solana-app/http';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The owner confirms once that no owner (25% or more), director or approver is a US person or in a
 * restricted country (prompt 10 §7.5). Recorded with who and when. Required before the first subscription or buy.
 */
export async function POST(request: Request) {
  return companyRoute(request, async (ctx) => {
    await readBody(request, schemas.eligibility);
    return { eligibility: confirmEligibility(ctx.orgId, { isOwner: ctx.isOwner, name: ctx.personName }) };
  });
}
