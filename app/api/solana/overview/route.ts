import { readOrgKybState } from '@/lib/compliance/org-kyb';
import { overviewFor } from '@/lib/solana-app/overview';
import { readOnboardingState } from '@/lib/server/onboarding';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Overview, in one read (prompt 10 Phase 2): the money position, what needs the person, this month's
 * pipeline, recent payments, where the company can pay and its checks and limits. The company comes
 * from the session; the business check and the open setup steps are read here, as they are.
 */
export async function GET(request: Request) {
  return companyRoute(request, async (ctx) => {
    let companyCheck: string | null = null;
    try {
      companyCheck = await readOrgKybState(ctx.orgId);
    } catch {
      companyCheck = null;
    }
    let setupOpen: Array<{ id: string; title: string; href: string }> = [];
    try {
      const onboarding = await readOnboardingState(ctx.session);
      setupOpen = onboarding.steps
        .filter((s) => !s.done && (s.id === 'verify' || s.id === 'second_approver'))
        .map((s) => ({ id: s.id, title: s.id === 'verify' ? 'Business documents' : 'Add a second approver', href: s.href }));
    } catch {
      setupOpen = [];
    }
    return overviewFor({ orgId: ctx.orgId, companyCheck, setupOpen });
  });
}
