import { loadCompany, saveCompany } from '@/lib/solana-app/company';
import { draftSweep } from '@/lib/solana-app/investments';
import { runtime as appRuntime } from '@/lib/solana-app/runtime';
import { store } from '@/lib/solana-app/store';
import { cronAuthorized } from '@/lib/server/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The daily sweep (prompt 10 §7.3): for each company whose owner turned sweep on, at most one draft a
 * day; an earlier draft nobody approved is replaced. The job only drafts. It never approves, signs or
 * moves anything: a person approves every move on a device. Running it twice the same day does nothing
 * the second time.
 *
 * Only the scheduler may call it (lib/server/cron-auth.ts).
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return Response.json({ success: false, error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const ids = new Set([...(await appRuntime().docs.listOrgIds()), ...store().orgs.keys()]);
  let drafted = 0;
  let failed = 0;
  for (const orgId of ids) {
    try {
      await loadCompany(orgId);
      const org = store().orgs.get(orgId);
      if (!org?.treasuryRules?.sweep.on) continue;
      if (await draftSweep(orgId)) drafted++;
      await saveCompany(orgId);
    } catch {
      failed++;
    }
  }
  return Response.json({ success: true, drafted, failed }, { headers: { 'Cache-Control': 'no-store' } });
}
