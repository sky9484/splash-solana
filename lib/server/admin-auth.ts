import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { cookies } from 'next/headers';

export type AdminSession = {
  email: string;
  name: string;
  role: 'compliance' | 'support' | 'operations';
};

export const ADMIN_SESSION_COOKIE = 'splash_admin_session';

const fallbackEmail = 'staff@splash.finance';
const fallbackPassword = 'splash-admin-demo';
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Resolve the signing secret used to mint and verify admin session tokens.
 *
 * Security: trust is NEVER derived from the client-controlled Host header, and
 * no signing secret is ever a constant shipped in source (that would let anyone
 * forge an admin cookie offline).
 *   • If ADMIN_SESSION_SECRET is set, it is always used — in every environment.
 *   • In production without it we FAIL CLOSED (return null): no session can be
 *     minted or verified, so every admin route stays locked.
 *   • In local development without it, an ephemeral random secret is generated
 *     once per process (sessions reset on restart). It is never a shipped
 *     constant, so cookies cannot be forged from the public source.
 */
const DEV_SECRET_FILE = join(process.cwd(), '.admin-session-secret.local');

let cachedDevSecret: string | null = null;
function resolveSecret(): string | null {
  const configured = process.env.ADMIN_SESSION_SECRET?.trim();
  if (configured) return configured;

  if (isProduction) return null;

  if (!cachedDevSecret) cachedDevSecret = loadOrCreateDevSecret();
  return cachedDevSecret;
}

/**
 * Stable per-machine dev secret, persisted to a gitignored local file.
 *
 * Why a file: Next bundles this module SEPARATELY for route handlers
 * (/api/admin/login) and server components (the /admin layout), so a purely
 * in-memory random secret differs between them and a cookie signed at login
 * fails to verify in the layout — bouncing the operator back to login. A shared
 * file makes every module instance (and process restart / HMR reload) converge
 * on the same value. It is random per machine (never a shipped constant) and is
 * never used in production, where an unset ADMIN_SESSION_SECRET fails closed.
 */
function loadOrCreateDevSecret(): string {
  try {
    if (existsSync(DEV_SECRET_FILE)) {
      const existing = readFileSync(DEV_SECRET_FILE, 'utf8').trim();
      if (existing.length >= 32) return existing;
    }
  } catch {
    /* unreadable — fall through and (re)generate */
  }

  const secret = randomBytes(32).toString('hex');
  try {
    // Exclusive create avoids a write race between concurrent module instances.
    writeFileSync(DEV_SECRET_FILE, secret, { flag: 'wx', mode: 0o600 });
    console.warn(
      '[admin-auth] ADMIN_SESSION_SECRET is not set. Generated a local dev ' +
        'secret at .admin-session-secret.local (gitignored). Set ' +
        'ADMIN_SESSION_SECRET before deploying.',
    );
    return secret;
  } catch {
    // Another instance created it first (or fs is unavailable) — prefer the
    // persisted value so every instance converges on the same secret.
    try {
      const existing = readFileSync(DEV_SECRET_FILE, 'utf8').trim();
      if (existing.length >= 32) return existing;
    } catch {
      /* ignore — last resort: this instance's in-memory secret */
    }
    return secret;
  }
}

function timingSafeStrEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

/**
 * Admin session token: `v2.${nonce}.${email}.${issuedAt}.${epoch}.${hmac}`.
 *
 * Audit finding (high): the previous token was `${nonce}.${hmac(nonce)}` — it
 * carried no issue time, no identity and no revocation handle. The 8-hour
 * `maxAge` on the cookie is a CLIENT-side hint; a copied token verified forever
 * because nothing server-side ever aged it out, and `clearAdminSessionCookie`
 * only deletes the browser's copy. A stolen admin cookie was permanent,
 * unattributable access — and this is the console that can rewrite contract
 * config and settlement risk parameters.
 *
 * Now: the issue time is inside the signed payload and enforced on every read,
 * the subject is bound so the token names who it was minted for, and a
 * revocation epoch lets "sign out everywhere" invalidate live tokens.
 */
const TOKEN_VERSION = 'v2';
const SESSION_TTL_SECONDS = 60 * 60 * 8;

function tokenPayload(nonce: string, email: string, issuedAt: number, epoch: number): string {
  return `admin:${TOKEN_VERSION}:${nonce}:${email}:${issuedAt}:${epoch}`;
}

function signToken(secret: string, email: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const nonce = randomBytes(18).toString('hex');
  const epoch = readRevocationEpoch();
  const payload = tokenPayload(nonce, email, nowSeconds, epoch);
  const mac = createHmac('sha256', secret).update(payload).digest('hex');
  return [TOKEN_VERSION, nonce, Buffer.from(email).toString('base64url'), String(nowSeconds), String(epoch), mac].join('.');
}

type VerifiedToken = { email: string; issuedAt: number };

function verifyToken(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): VerifiedToken | null {
  const parts = token.split('.');
  if (parts.length !== 6) return null;
  const [version, nonce, emailB64, issuedAtRaw, epochRaw, mac] = parts;
  if (version !== TOKEN_VERSION) return null;

  const issuedAt = Number.parseInt(issuedAtRaw, 10);
  const epoch = Number.parseInt(epochRaw, 10);
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(epoch)) return null;

  let email: string;
  try {
    email = Buffer.from(emailB64, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!email) return null;

  const expected = createHmac('sha256', secret).update(tokenPayload(nonce, email, issuedAt, epoch)).digest('hex');
  if (!timingSafeStrEqual(mac, expected)) return null;

  // Expiry is enforced HERE, server-side. A token whose cookie maxAge the
  // client ignored (or that was copied out of the jar) still dies on schedule.
  if (nowSeconds - issuedAt > SESSION_TTL_SECONDS) return null;
  // Reject a clock-skewed token minted "in the future" by more than a minute.
  if (issuedAt - nowSeconds > 60) return null;
  // Revocation: bumping the epoch invalidates every token minted before it.
  if (epoch < readRevocationEpoch()) return null;

  return { email, issuedAt };
}

// ── Revocation epoch ────────────────────────────────────────────────────────
// Persisted so it survives a restart, and so every module instance Next bundles
// separately agrees — the same reason the dev secret lives in a file.

const REVOCATION_FILE = join(process.env.SPLASH_DATA_DIR ?? join(process.cwd(), 'data'), 'admin-session-epoch');

function readRevocationEpoch(): number {
  try {
    const raw = Number.parseInt(readFileSync(REVOCATION_FILE, 'utf8').trim(), 10);
    return Number.isSafeInteger(raw) && raw >= 0 ? raw : 0;
  } catch {
    return 0;
  }
}

/**
 * Invalidate every live admin session. This is the containment lever the Step
 * Finance incident calls for: when a device is suspected compromised you need
 * to kill issued credentials, not just ask the browser to forget one.
 */
export function revokeAllAdminSessions(): number {
  const next = readRevocationEpoch() + 1;
  try {
    mkdirSync(dirname(REVOCATION_FILE), { recursive: true });
    writeFileSync(REVOCATION_FILE, String(next), { mode: 0o600 });
    console.warn(`[admin-auth] all admin sessions revoked (epoch ${next})`);
  } catch (error) {
    // Surface rather than silently pretend the revocation landed.
    throw new Error(`Could not persist the admin session revocation epoch: ${error instanceof Error ? error.message : error}`);
  }
  return next;
}

function configuredSession(): AdminSession {
  const email = process.env.ADMIN_EMAIL || fallbackEmail;

  return {
    email,
    name: email.split('@')[0]?.replace(/[._-]/g, ' ') || 'Splash staff',
    role: 'operations',
  };
}

export function validateAdminCredentials(email: string, password: string) {
  // On a live deployment, never accept the built-in demo credentials and never
  // mint a session without a real signing secret. All three must be configured.
  if (isProduction) {
    const envEmail = process.env.ADMIN_EMAIL?.trim();
    const envPassword = process.env.ADMIN_PASSWORD;
    const envSecret = process.env.ADMIN_SESSION_SECRET?.trim();
    if (!envEmail || !envPassword || !envSecret) {
      console.error(
        '[admin-auth] Refusing login: ADMIN_EMAIL, ADMIN_PASSWORD and ' +
          'ADMIN_SESSION_SECRET must all be set in production.',
      );
      return null;
    }
  }

  const expectedEmail = String(process.env.ADMIN_EMAIL || fallbackEmail);
  const expectedPassword = String(process.env.ADMIN_PASSWORD || fallbackPassword);

  if (String(email ?? '').trim().toLowerCase() !== expectedEmail.toLowerCase()) {
    return null;
  }

  if (!timingSafeStrEqual(password, expectedPassword)) {
    return null;
  }

  return configuredSession();
}

export async function getAdminSession() {
  const secret = resolveSecret();
  if (!secret) return null;

  const cookieStore = await cookies();
  const value = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!value) return null;

  const verified = verifyToken(value, secret);
  if (!verified) return null;

  // The token names the subject it was minted for. If ADMIN_EMAIL has since
  // changed, tokens for the old identity stop working rather than silently
  // continuing to authorize as whoever is configured now.
  const session = configuredSession();
  if (verified.email.toLowerCase() !== session.email.toLowerCase()) return null;

  return session;
}

export async function setAdminSessionCookie(options: { secure?: boolean } = {}) {
  const secret = resolveSecret();
  if (!secret) {
    throw new Error('Cannot create admin session: ADMIN_SESSION_SECRET is not configured.');
  }

  const cookieStore = await cookies();

  cookieStore.set(ADMIN_SESSION_COOKIE, signToken(secret, configuredSession().email), {
    httpOnly: true,
    // Mirrors the TTL now enforced inside the token; the cookie hint alone was
    // never a control.
    maxAge: SESSION_TTL_SECONDS,
    path: '/',
    sameSite: 'lax',
    secure: options.secure ?? isProduction,
  });
}

export async function clearAdminSessionCookie() {
  const cookieStore = await cookies();

  cookieStore.delete(ADMIN_SESSION_COOKIE);
}
