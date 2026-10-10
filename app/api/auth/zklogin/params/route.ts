import { NextResponse } from 'next/server';

import { expectedAudience, zkLoginEnabled } from '@/lib/auth/zklogin';
import { chooseMaxEpoch, fetchEpochInfo } from '@/lib/auth/zklogin-epoch';

/**
 * GET /api/auth/zklogin/params
 *
 * What the browser needs before it can start a zkLogin sign-in: which provider
 * client id to use, and which `maxEpoch` to bind the ephemeral key to.
 *
 * `maxEpoch` is computed here, not in the browser. It depends on where the
 * network is inside the current epoch, and a client that guessed would either
 * bind a key that expires in minutes or one the network rejects. The rule and
 * the reasoning live in lib/auth/zklogin-epoch.ts.
 *
 * Nothing secret is returned. An OAuth client id is public by design — it
 * appears in the authorisation URL every user's browser sends. What is NOT
 * here is the user salt, which stays server-side.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!zkLoginEnabled()) {
    return NextResponse.json(
      { enabled: false, reason: 'FEATURE_ZKLOGIN is not enabled in this environment.' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const googleClientId = expectedAudience('google');
  if (!googleClientId) {
    // Enabled but unconfigured is a deployment mistake worth naming, not a
    // reason to render a button that cannot work.
    return NextResponse.json(
      { enabled: false, reason: 'ZKLOGIN_GOOGLE_CLIENT_ID is not configured.' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const info = await fetchEpochInfo();
  if (!info) {
    // Refusing beats guessing: a maxEpoch derived from an invented epoch
    // number produces a proof the network will not accept, and the user would
    // meet that failure after completing an OAuth round trip.
    return NextResponse.json(
      { enabled: false, reason: 'The Sui epoch could not be read, so a sign-in window cannot be set.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const decision = chooseMaxEpoch(info);

  return NextResponse.json(
    {
      enabled: true,
      provider: 'google',
      clientId: googleClientId,
      epoch: info.epoch,
      maxEpoch: decision.maxEpoch,
      /** For the sign-in log and for support: why this window, not just what. */
      epochSpan: decision.span,
      epochReason: decision.reason,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
