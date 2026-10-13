import LoginForm from '@/components/auth/LoginForm';
import { readGoogleOidcConfig } from '@/lib/auth/google-oidc';

export const dynamic = 'force-dynamic';

/** What a failed Google round trip says. Codes come from app/api/auth/google/callback. */
const GOOGLE_ERRORS: Record<string, string> = {
  cancelled: 'Google sign-in was cancelled.',
  email_unverified: 'Google has not verified that email address, so it can’t be used to sign in.',
  not_available: 'Splash isn’t available for this email domain.',
  unavailable: 'Sign-in is unavailable on this server right now.',
  flow_expired: 'That sign-in took too long. Start again.',
  google_disabled: 'Google sign-in isn’t enabled here.',
};

/**
 * Server half of the login page: it alone can read whether Google sign-in is
 * configured, so the button is shown only when the flow can complete.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const code = typeof params.code === 'string' ? params.code : '';
  const initialError = params.error === 'google' ? GOOGLE_ERRORS[code] ?? 'Google sign-in could not be completed. Try again.' : '';
  return <LoginForm googleEnabled={readGoogleOidcConfig() !== null} initialError={initialError} />;
}
