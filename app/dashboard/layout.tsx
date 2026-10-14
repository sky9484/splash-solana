import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import DashboardShell from '@/components/dashboard/DashboardShell';
import { solscanAccountUrl } from '@/lib/explorer';
import { readSolanaEnv } from '@/lib/solana/config';
import { custodyPhaseEnabled, sweepAccountEnabled } from '@/lib/server/custody-phase';
import { getCustomerSession } from '@/lib/server/customer-auth';
import { readKybGateState } from '@/lib/server/kyb-gate';
import { readOnboardingState } from '@/lib/server/onboarding';
import { launchScope } from '@/lib/server/launch-scope';
import { PATHNAME_HEADER, isSetupExempt, readSetupStatusForSession, setupRedirectFor } from '@/lib/server/setup-gate';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getCustomerSession();

  if (!session) {
    redirect('/login');
  }

  // The device check (prompt 07 §3.2): no registered device, or no vault with
  // that device in it, means setup first. Fails closed when unreadable.
  const pathname = (await headers()).get(PATHNAME_HEADER) ?? '/dashboard';
  const setup = await readSetupStatusForSession(session);
  const setupRedirect = setupRedirectFor(pathname, isSetupExempt(pathname) ? null : setup);
  if (setupRedirect) redirect(setupRedirect);

  // The run mode the shell reads for its Test mode badge. The account IDs themselves live in
  // Settings › Account details. A vault made offline is simulated: it is on no network, so no Solscan link.
  const solanaEnv = readSolanaEnv();
  const recorded = setup && 'vault' in setup ? setup.vault : null;
  const solana = {
    mode: solanaEnv.mode,
    cluster: solanaEnv.cluster,
    vault: recorded ? { address: recorded.vaultPda, solscanUrl: recorded.simulated || solanaEnv.mode !== 'devnet' ? null : solscanAccountUrl(recorded.vaultPda, recorded.cluster) } : null,
  };

  // Wallet spec §3.2 — resolve the KYB state ONCE, here. Every page under
  // /dashboard is a client component and cannot read the session or the DB, so
  // the banner state has to be computed server-side and passed down.
  // This is presentation only: the money routes enforce the gate themselves
  // (lib/server/kyb-gate.ts), because /queue lives outside this layout.
  const kyb = await readKybGateState(session);

  // Onboarding: the intent question is asked exactly once, and the nav locks
  // are computed from the same server truths the money routes enforce. On a
  // machine without a database the state is unreadable — nothing locks and
  // nothing redirects, mirroring how the gates themselves behave in dev.
  let locks: { termsDone: boolean; moneyBlocked: boolean; custodyOn: boolean; reason: string } | undefined;
  let needsIntent = false;
  // Account setup's steps, for the sidebar's progress card (it disappears when they are all done).
  let setupSteps: Array<{ id: string; title: string; done: boolean }> | null = null;
  try {
    const onboarding = await readOnboardingState(session);
    needsIntent = onboarding.intent === null;
    setupSteps = onboarding.steps.map(({ id, title, done }) => ({ id, title, done }));
    locks = {
      termsDone: onboarding.steps[0].done,
      moneyBlocked: kyb.blocked,
      custodyOn: custodyPhaseEnabled(),
      reason: kyb.reason,
    };
  } catch {
    locks = undefined;
  }
  if (needsIntent) redirect('/onboarding/intent');

  // One line on purpose: tests/oxwal-frontend.test.mjs pins the shape
  // {children}</DashboardShell> as the no-second-wrapper contract.
  // sweepOn needs no database, so it is resolved even when `locks` is not.
  return <DashboardShell session={session} kyb={kyb} locks={locks} sweepOn={sweepAccountEnabled()} launchScope={launchScope()} solana={solana} setup={setupSteps}>{children}</DashboardShell>;
}
