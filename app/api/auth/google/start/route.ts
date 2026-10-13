import { NextResponse } from 'next/server';

import { FLOW_TTL_SECONDS, OIDC_FLOW_COOKIE, beginGoogleSignIn, readGoogleOidcConfig, sealFlowState } from '@/lib/auth/google-oidc';
import { customerSessionSecret } from '@/lib/server/customer-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Step 1 of "Continue with Google": mint state, nonce and a PKCE verifier,
 * keep them in a signed httpOnly cookie for ten minutes, and send the
 * browser to Google. Nothing about the account is decided here.
 */
export async function GET(request: Request) {
  const config = readGoogleOidcConfig();
  const secret = customerSessionSecret();
  if (!config || !secret) {
    return NextResponse.json({ error: 'Google sign-in is not enabled here.', code: 'google_disabled' }, { status: 404 });
  }

  const returnTo = new URL(request.url).searchParams.get('returnTo');
  const { flow, authorizeUrl } = beginGoogleSignIn(config, { returnTo });

  const response = NextResponse.redirect(authorizeUrl, { status: 302, headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(OIDC_FLOW_COOKIE, sealFlowState(flow, secret), {
    httpOnly: true,
    // Lax, not Strict: Google's redirect back is a top-level GET from another site.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth/google',
    maxAge: FLOW_TTL_SECONDS,
  });
  return response;
}
