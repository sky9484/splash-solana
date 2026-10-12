import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { linkVerifiedIdentity } from '@/lib/auth/accounts';
import {
  GoogleOidcError,
  OIDC_FLOW_COOKIE,
  assertStateMatches,
  exchangeCodeForIdToken,
  hashSubjectForLog,
  openFlowState,
  readGoogleOidcConfig,
  verifyGoogleIdToken,
} from '@/lib/auth/google-oidc';
import { isKilledEntityEmail } from '@/lib/auth/killed-entities';
import { ensureWorkspaceForEmail } from '@/lib/auth/signup-org';
import { customerSessionSecret, sessionForAccount, setCustomerSessionCookie } from '@/lib/server/customer-auth';
import { refreshSetupCookie } from '@/lib/server/setup-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Step 2 of "Continue with Google". In order, and any failure ends at the
 * login page with a code, never a session:
 *   1. the flow cookie opens (signed by us, under ten minutes old) and is
 *      deleted whatever happens next: one attempt, one use;
 *   2. `state` matches the cookie (CSRF guard on the redirect);
 *   3. the code is exchanged with the PKCE verifier from the cookie;
 *   4. the ID token verifies: signature, issuer, OUR audience, freshness,
 *      the nonce from the cookie, and `email_verified: true`;
 *   5. the account is linked by verified email (lib/auth/accounts.ts
 *      linkVerifiedIdentity), or created with no password and no membership.
 *
 * The session proves identity only. What the person may do comes from their
 * membership; what they can sign comes from their device key. The device
 * check after sign-in is the dashboard's job (/dashboard/setup).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const fail = (code: string) => {
    const target = new URL('/login', url.origin);
    target.searchParams.set('error', 'google');
    target.searchParams.set('code', code);
    const response = NextResponse.redirect(target, { status: 303, headers: { 'Cache-Control': 'no-store' } });
    response.cookies.delete({ name: OIDC_FLOW_COOKIE, path: '/api/auth/google' });
    return response;
  };

  const config = readGoogleOidcConfig();
  const secret = customerSessionSecret();
  if (!config || !secret) return fail('google_disabled');

  // The person pressed Cancel on Google's screen, or Google refused.
  if (url.searchParams.get('error')) return fail('cancelled');

  const sealed = (await cookies()).get(OIDC_FLOW_COOKIE)?.value;

  try {
    const flow = openFlowState(sealed, secret);
    assertStateMatches(flow, url.searchParams.get('state'));
    const code = url.searchParams.get('code');
    if (!code) throw new GoogleOidcError('no_code', 'Google returned no authorization code');

    const idToken = await exchangeCodeForIdToken(config, { code, codeVerifier: flow.codeVerifier });
    const claims = await verifyGoogleIdToken({ idToken, clientId: config.clientId, expectedNonce: flow.nonce });

    if (isKilledEntityEmail(claims.email)) return fail('not_available');
    if (!process.env.DATABASE_URL) {
      console.error('[google] Refusing sign-in: DATABASE_URL is not configured, so there are no accounts to link.');
      return fail('unavailable');
    }

    const { getDb } = await import('@/lib/db/client');
    const db = getDb() as never;
    const account = await linkVerifiedIdentity(db, { email: claims.email, name: claims.name });
    await ensureWorkspaceForEmail(account.email);

    const session = await setCustomerSessionCookie(sessionForAccount(account));
    await refreshSetupCookie(session);
    console.info('[google] session minted', { subject: hashSubjectForLog(claims), outcome: account.outcome });

    const response = NextResponse.redirect(new URL(flow.returnTo, url.origin), { status: 303, headers: { 'Cache-Control': 'no-store' } });
    response.cookies.delete({ name: OIDC_FLOW_COOKIE, path: '/api/auth/google' });
    return response;
  } catch (error) {
    if (error instanceof GoogleOidcError) {
      console.warn('[google] sign-in refused', { code: error.code });
      return fail(error.code);
    }
    console.error('[google] unexpected failure', error);
    return fail('failed');
  }
}
