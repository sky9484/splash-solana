import { NextResponse } from 'next/server';
import { z } from 'zod';

import { verifyAccountPassword } from '@/lib/auth/accounts';
import {
  checkLoginRateLimit,
  clearLoginFailures,
  clientIp,
  recordFailedLogin,
} from '@/lib/auth/login-rate-limit';
import { setCustomerSessionCookie, sessionForAccount } from '@/lib/server/customer-auth';
import { readJsonBody } from '@/lib/server/http';

/**
 * Log in against a real account.
 *
 * This used to compare the submitted pair against CUSTOMER_EMAIL and
 * CUSTOMER_PASSWORD — one plaintext credential for the whole deployment. It
 * now verifies a scrypt hash on a row in `users`, behind a rate limit.
 *
 * A successful login proves identity and nothing else. Authority comes from a
 * membership row, read per request by resolveAuthorityForSession, and an
 * account without one reaches an empty workspace.
 */

const loginSchema = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(256),
  remember: z.boolean().optional(),
});

/** One message for every failure. Which of them it was is not the caller's
 *  business, and saying would enumerate accounts. */
const INVALID = 'Invalid email or password';

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
  }

  if (!process.env.DATABASE_URL) {
    console.error('[auth] Refusing login: DATABASE_URL is not configured, so there are no accounts to check.');
    return NextResponse.json({ error: INVALID }, { status: 401 });
  }

  const { getDb } = await import('@/lib/db/client');
  const db = getDb() as never;
  const ip = clientIp(request);
  const { email, password } = parsed.data;

  // Before the password check, not after: a limiter consulted afterwards
  // still lets an attacker test every candidate it then declines to answer.
  const verdict = await checkLoginRateLimit(db, { email, ip });
  if (!verdict.allowed) {
    return NextResponse.json(
      {
        error:
          verdict.scope === 'email'
            ? 'Too many failed attempts for this account. Try again shortly.'
            : 'Too many failed attempts from this network. Try again shortly.',
      },
      { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSeconds) } },
    );
  }

  const account = await verifyAccountPassword(db, { email, password });
  if (!account) {
    await recordFailedLogin(db, { email, ip });
    return NextResponse.json({ error: INVALID }, { status: 401 });
  }

  await clearLoginFailures(db, account.email);

  const session = sessionForAccount(account);
  const refreshedSession = await setCustomerSessionCookie(session, { remember: parsed.data.remember });
  return NextResponse.json({ session: refreshedSession });
}
