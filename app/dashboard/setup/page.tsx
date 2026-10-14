import { redirect } from 'next/navigation';

import SetupStepper from '@/components/onboarding/SetupStepper';
import DeviceSetup from '@/components/setup/DeviceSetup';
import { getCustomerSession } from '@/lib/server/customer-auth';
import { readOnboardingState, type OnboardingState } from '@/lib/server/onboarding';

export const dynamic = 'force-dynamic';

/**
 * Account setup. The state is derived server-side on every render — flipping
 * a KYB state in the admin console changes step 3 here with no writes, which
 * is the whole argument for not storing progress.
 */
export default async function SetupPage() {
  const session = await getCustomerSession();
  if (!session) redirect('/login');

  let state: OnboardingState | null = null;
  // Why the stepper is missing matters: with no database nothing can be read,
  // but a member with no company access yet is a normal state, not a fault.
  let unavailable: 'no_database' | 'no_access' | null = null;
  try {
    state = await readOnboardingState(session);
  } catch {
    state = null;
    unavailable = process.env.DATABASE_URL ? 'no_access' : 'no_database';
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <p className="dash-kicker">Account setup</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-[#1F4452]">
        Finish setting up this workspace
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#326273]">
        Six steps; the last two are optional. Money movement unlocks when verification completes —
        everything else here is yours to finish at your own pace.
      </p>

      <section className="mt-8" aria-labelledby="device-vault-heading">
        <h2 id="device-vault-heading" className="text-lg font-bold text-[#1F4452]">This device and your accounts</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[#326273]">
          You approve on this device. Splash never holds your keys.
        </p>
        <div className="mt-4">
          <DeviceSetup />
        </div>
      </section>

      <h2 className="mt-10 text-lg font-bold text-[#1F4452]">Business verification</h2>
      <div className="mt-4">
        {state ? (
          <SetupStepper state={state} />
        ) : unavailable === 'no_access' ? (
          <section className="dash-surface p-6">
            <h3 className="text-lg font-bold text-[#1F4452]">Opens when you have access to your company</h3>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#326273]">
              Business verification belongs to the company. Once its owner gives you access, its steps appear here.
            </p>
          </section>
        ) : (
          <section className="dash-surface p-6">
            <h2 className="text-lg font-bold text-[#1F4452]">Setup is unavailable on this machine</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#326273]">
              No database is configured, so setup state cannot be read or written here. Start the
              local dev database (scripts/dev-db.mjs) or point DATABASE_URL at a database server.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
