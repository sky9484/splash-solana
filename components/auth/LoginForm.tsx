'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { toast } from 'sonner';

import GoogleSignInButton from '@/components/auth/GoogleSignInButton';
import IsometricAuthShell from '@/components/auth/IsometricAuthShell';
import SplashLoading from '@/components/SplashLoading';

/**
 * Sign in to Splash: email + password, or Google when the server has it
 * configured. No chain is named here; the business doesn't need to know.
 * Where to land is decided after sign-in by the dashboard, which sends a
 * browser without a device key for this member to /dashboard/setup.
 */
export default function LoginForm({ googleEnabled, initialError }: { googleEnabled: boolean; initialError: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState(initialError);

  const canSubmit = email.trim().length > 0 && password.length >= 6 && !isSubmitting;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, remember }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };

      if (!response.ok) {
        throw new Error(body.error ?? 'Unable to sign in. Check your credentials and try again.');
      }

      toast.success('Signed in');
      setAuthorizing(true);
      router.push('/dashboard');
      router.refresh();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unable to sign in. Check your credentials and try again.';
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (authorizing) return <SplashLoading label="Securing your session" />;

  return (
    <IsometricAuthShell
      eyebrow="Business workspace"
      title="Sign in to Splash"
      description="Your approvals are signed on this device. Splash never holds your keys."
      art="/isometric/payment-intent.svg"
      artAlt="Isometric payment moving from a business to a supplier"
      visualTitle="Every payment, one record"
      visualCopy="Invoice, approval, transfer and rate, kept together for the auditor."
    >
      <form onSubmit={onSubmit} className="iso-auth-form">
        <label className="iso-auth-field" htmlFor="login-email">
          <span>Business email</span>
          <div>
            <Mail aria-hidden="true" />
            <input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              placeholder="name@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
        </label>

        <label className="iso-auth-field" htmlFor="login-password">
          <span>Password</span>
          <div>
            <Lock aria-hidden="true" />
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              required
              minLength={6}
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              className="iso-auth-reveal"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
          </div>
        </label>

        <div className="iso-auth-options">
          <label>
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            Keep me signed in for 30 days
          </label>
          <Link href="/forgot-password">Forgot password?</Link>
        </div>

        {error ? <p className="iso-auth-error" role="alert">{error}</p> : null}

        <button type="submit" disabled={!canSubmit} className="iso-auth-submit">
          {isSubmitting ? 'Signing in...' : 'Sign in'}
          {!isSubmitting ? <ArrowRight aria-hidden="true" /> : null}
        </button>
      </form>

      {googleEnabled ? <GoogleSignInButton /> : null}

      <p className="iso-auth-switch">
        New to Splash? <Link href="/signup">Create a business account</Link>
      </p>
    </IsometricAuthShell>
  );
}
