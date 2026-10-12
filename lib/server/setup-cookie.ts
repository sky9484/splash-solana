import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * "This member is set up", as a signed cookie, for the proxy's optimistic
 * check (lib/server/setup-gate.ts). The proxy runs on every request and must
 * not hit the database there; the authoritative check stays in the dashboard
 * layout and in the routes that move money, which also need a fresh device
 * signature regardless.
 *
 * Bound to the session's email and credential version (a password reset or
 * mailbox proof invalidates it) and to the device key (a different device is
 * a different cookie). Signed with a key derived from the session secret
 * under its own label, so it can never be read as a session.
 */

export const SETUP_COOKIE = 'splash_setup';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface SetupClaim {
  email: string;
  credentialVersion: number | null;
  devicePublicKey: string;
}

function key(secret: string): Buffer {
  return createHmac('sha256', secret).update('splash:setup-ready:v1').digest();
}

function mac(body: string, secret: string): string {
  return createHmac('sha256', key(secret)).update(body).digest('base64url');
}

export function sealSetupClaim(claim: SetupClaim, secret: string): string {
  const body = Buffer.from(
    JSON.stringify({ e: claim.email.trim().toLowerCase(), v: claim.credentialVersion, k: claim.devicePublicKey }),
    'utf8',
  ).toString('base64url');
  return `${body}.${mac(body, secret)}`;
}

/** The claim if the cookie is ours, intact, and for this session; otherwise null. */
export function openSetupClaim(
  value: string | undefined,
  secret: string,
  session: { email: string; credentialVersion?: number },
): SetupClaim | null {
  if (!value) return null;
  const dot = value.indexOf('.');
  if (dot <= 0) return null;
  const body = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1), 'utf8');
  const expected = Buffer.from(mac(body, secret), 'utf8');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let raw: { e?: unknown; v?: unknown; k?: unknown };
  try {
    raw = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof raw.e !== 'string' || typeof raw.k !== 'string' || !raw.k) return null;
  if (raw.e !== session.email.trim().toLowerCase()) return null;
  const version = typeof raw.v === 'number' ? raw.v : null;
  if (version !== (session.credentialVersion ?? null)) return null;
  return { email: raw.e, credentialVersion: version, devicePublicKey: raw.k };
}

export const setupCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: MAX_AGE_SECONDS,
  secure: process.env.NODE_ENV === 'production',
};

/**
 * Set or clear the cookie from a route handler, from the authoritative
 * status. Only `ready` sets it; every other state clears it.
 */
export async function syncSetupCookie(
  session: { email: string; credentialVersion?: number },
  status: { state: string; device?: { publicKey: string } } | null,
): Promise<void> {
  const [{ cookies }, { customerSessionSecret }] = await Promise.all([import('next/headers'), import('@/lib/server/customer-auth')]);
  const store = await cookies();
  const secret = customerSessionSecret();
  if (secret && status?.state === 'ready' && status.device) {
    store.set(
      SETUP_COOKIE,
      sealSetupClaim({ email: session.email, credentialVersion: session.credentialVersion ?? null, devicePublicKey: status.device.publicKey }, secret),
      setupCookieOptions,
    );
  } else {
    store.delete(SETUP_COOKIE);
  }
}
