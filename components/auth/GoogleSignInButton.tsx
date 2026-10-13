/**
 * "Continue with Google". A plain link to the server route that starts the
 * OIDC flow (app/api/auth/google/start): no client-side token handling, and it
 * works with JavaScript off. Rendered only when the server says Google
 * sign-in is configured, so it never leads to a dead end.
 *
 * Sized to the password submit so neither reads as the primary path, and
 * followed by the one line that says what signing in does not do.
 */
export default function GoogleSignInButton({ returnTo = '/dashboard' }: { returnTo?: string }) {
  const href = `/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <>
      <div className="iso-auth-divider" role="separator">or</div>
      <a className="iso-auth-oauth" href={href}>
        <GoogleMark />
        Continue with Google
      </a>
      <p className="iso-auth-oauth-note">
        Google confirms who you are. Approving a payment still needs this device.
      </p>
    </>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" width="18" height="18">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}
