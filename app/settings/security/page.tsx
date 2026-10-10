import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import PasskeyEnrolment from '@/components/auth/PasskeyEnrolment';
import { getCustomerSession } from '@/lib/server/customer-auth';

/**
 * Security settings — today, the approval signer.
 *
 * Enrolment only. There is deliberately no approval action here: the Move
 * entry point an approval would call does not exist yet, and a button that
 * signs something nothing can verify on chain would be theatre. The signer is
 * the prerequisite, and it is what this page sets up.
 */
export const dynamic = 'force-dynamic';

export default async function SecuritySettingsPage() {
  const session = await getCustomerSession();
  if (!session) redirect('/login');

  return (
    <main className="iso-settings">
      <Link href="/dashboard" className="iso-settings-back">
        <ArrowLeft aria-hidden="true" />
        Back to workspace
      </Link>

      <header className="iso-settings-head">
        <p className="iso-kicker">Security</p>
        <h1>Your approval signer</h1>
        <p>
          A payment leaves Splash when a named person releases it. This is the device that proves it was you: the key
          lives in your phone or laptop, never leaves it, and cannot be exported — so an approval is something only
          your device could have produced, rather than a record saying your name was on it.
        </p>
      </header>

      <section className="iso-settings-block">
        <PasskeyEnrolment />
      </section>
    </main>
  );
}
