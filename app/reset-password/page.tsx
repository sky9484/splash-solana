'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';

import IsometricAuthShell from '@/components/auth/IsometricAuthShell';
import PasswordFromLinkForm from '@/components/auth/PasswordFromLinkForm';

/**
 * Where the reset link lands. Choose a new password; every earlier session
 * ends; sign in with the new one. A spent or expired link sends the reader
 * back to request another.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Shell title="Reset your password" description="One moment." />}>
      <ResetPassword />
    </Suspense>
  );
}

function Shell(props: { title: string; description: string; children?: ReactNode }) {
  return (
    <IsometricAuthShell
      eyebrow="Account recovery"
      title={props.title}
      description={props.description}
      art="recovery"
      visualTitle="Recover access"
      visualCopy="The password opens the desk. The vault stays locked until you approve on your device."
    >
      {props.children}
      <p className="au-switch">
        Remembered it? <Link href="/login">Back to sign in</Link>
      </p>
    </IsometricAuthShell>
  );
}

type Stage = 'set' | 'done' | 'invalid';

function ResetPassword() {
  const params = useSearchParams();
  const token = params.get('token')?.trim() ?? '';
  const [stage, setStage] = useState<Stage>(token ? 'set' : 'invalid');

  if (stage === 'done') {
    return (
      <Shell title="Password updated" description="Every session that was signed in before now has ended.">
        <section className="au-success">
          <CheckCircle2 aria-hidden="true" />
          <h2>Sign in with your new password</h2>
          <p>Nothing else about the account changed.</p>
          <Link href="/login">
            Go to sign in
          </Link>
        </section>
      </Shell>
    );
  }

  if (stage === 'set') {
    return (
      <Shell title="Reset your password" description="Choose a new password. The link proves the address is yours.">
        <PasswordFromLinkForm
          endpoint="/api/auth/reset-password"
          token={token}
          submitLabel="Set new password"
          busyLabel="Updating..."
          successToast="Password updated"
          onDone={() => setStage('done')}
          onInvalidLink={() => setStage('invalid')}
        />
      </Shell>
    );
  }

  return (
    <Shell
      title="That link has expired"
      description="Reset links work once and for 30 minutes. Request another and we will email it to you."
    >
      <div className="au-note">
        <strong>Request a new link</strong>
        <span>
          <Link href="/forgot-password">Go to password reset</Link>
        </span>
      </div>
    </Shell>
  );
}
