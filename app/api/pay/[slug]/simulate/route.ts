import { NextResponse } from 'next/server';

import { ServiceError } from '@/lib/solana-app/errors';
import { simulateLinkPayment } from '@/lib/solana-app/requests';
import { RATE_LIMITS, clientIp, enforceRateLimit } from '@/lib/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Test mode only (prompt 10 §6.3): pay a request's link "from a wallet" in the simulator. The exact
 * amount moves into the requester's own account with the reference in the memo, and is matched like any
 * transfer. Public, like the page (the token is the capability), and bounded per network. Refused on
 * devnet.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const limited = await enforceRateLimit({ rule: RATE_LIMITS.payLinkIp, key: clientIp(request) });
  if (limited) return limited;
  const { slug } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(slug)) return NextResponse.json({ error: 'This payment link isn’t valid.' }, { status: 404 });
  try {
    return NextResponse.json(await simulateLinkPayment(slug));
  } catch (e) {
    if (e instanceof ServiceError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    throw e;
  }
}
