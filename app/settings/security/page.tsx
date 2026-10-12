import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import PasskeyEnrolment from '@/components/auth/PasskeyEnrolment';
import { getCustomerSession } from '@/lib/server/customer-auth';

/**
 * Security settings: the sign-in passkey (a second factor at login).
 *
 * Not a payment signer. Approvals are Ed25519 signatures from the member's
 * device key on the company's Squads vault, set up at /dashboard/setup.
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
        <h1>Sign-in passkey</h1>
        <p>
          A passkey adds a second check when you sign in. It does not approve payments: those are signed with the
          device key you set up for your company&rsquo;s vault, which never leaves the device it was made on.{' '}
          <Link href="/dashboard/setup">See this device and your vault</Link>.
        </p>
      </header>

      <section className="iso-settings-block">
        <PasskeyEnrolment />
      </section>
    </main>
  );
}
