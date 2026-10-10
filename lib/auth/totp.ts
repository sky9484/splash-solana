/**
 * RFC 6238 TOTP verification for payout authorization.
 *
 * Audit finding: both money-moving routes accepted the 6-digit code if it
 * matched `/^\d{6}$/`. There was no secret, no verification, and no MFA
 * dependency anywhere in the repo — while the dashboard advertised "Approve the
 * whole payroll with a single TOTP" and `requireTotp` sat in the operating
 * settings, defaulting to true, read by nothing. A second factor that accepts
 * `000000` is worse than none: it is a control the operator believes they have.
 *
 * Deliberately implemented on `node:crypto` only — no new dependency, and the
 * algorithm is 30 lines. Enrollment is an env-provided base32 secret
 * (`SPLASH_TOTP_SECRET`, optionally `SPLASH_TOTP_SECRET_<ACCOUNT>` per account)
 * because there is no enrollment UI yet; when no secret is enrolled and
 * `requireTotp` is on, authorization FAILS CLOSED rather than falling back to
 * the format check.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Accept the previous and next step to tolerate clock skew (RFC 6238 §5.2). */
export const TOTP_WINDOW_STEPS = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Decode an RFC 4648 base32 secret. Returns null on any invalid character. */
export function decodeBase32(secret: string): Buffer | null {
  const cleaned = secret.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (cleaned.length === 0) return null;

  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return out.length > 0 ? Buffer.from(out) : null;
}

/** The HOTP value for a counter (RFC 4226 §5.3), zero-padded to TOTP_DIGITS. */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const buffer = Buffer.alloc(8);
  // Counters stay far below 2^53, so splitting into two 32-bit halves is exact.
  buffer.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac('sha1', secret).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, which itself leaks length — but
  // both sides are fixed-width TOTP digit strings here, so the lengths are
  // public by construction.
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Which step a code matched, or null. Returning the step (rather than a bool)
 * is what makes single-use enforcement possible: the caller records the step it
 * consumed so the same code cannot authorize a second payout inside its window.
 */
export function matchTotpStep(secret: Buffer, code: string, nowMs: number, window = TOTP_WINDOW_STEPS): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const currentStep = Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
  for (let drift = -window; drift <= window; drift += 1) {
    const step = currentStep + drift;
    if (step < 0) continue;
    if (constantTimeEquals(hotp(secret, step), code)) return step;
  }
  return null;
}

// ── Replay protection ───────────────────────────────────────────────────────
// A TOTP is valid for a whole step (plus the skew window). Without this, one
// captured code authorizes every payout submitted in the next ~90 seconds —
// which is exactly the batch-retry double-pay scenario.

type ConsumedStore = { consumed: Map<string, number> };
const globalStore = globalThis as unknown as { __splashTotpConsumed?: ConsumedStore };
const store: ConsumedStore = (globalStore.__splashTotpConsumed ??= { consumed: new Map() });

function pruneConsumed(nowMs: number) {
  const cutoff = Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS) - (TOTP_WINDOW_STEPS + 2);
  for (const [key, step] of store.consumed) {
    if (step < cutoff) store.consumed.delete(key);
  }
}

export function markStepConsumed(scope: string, step: number, nowMs = Date.now()): boolean {
  pruneConsumed(nowMs);
  const key = `${scope}:${step}`;
  if (store.consumed.has(key)) return false;
  store.consumed.set(key, step);
  return true;
}

/** Test seam — the consumed set is process-global and would leak across tests. */
export function resetConsumedStepsForTesting() {
  store.consumed.clear();
}

// ── Enrollment ──────────────────────────────────────────────────────────────

/**
 * Look up the enrolled secret for an account. Per-account secrets win so a
 * multi-tenant deployment can issue one per org; `SPLASH_TOTP_SECRET` is the
 * single-workspace fallback.
 */
export function enrolledSecret(accountId: string, env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const suffix = accountId.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
  const raw = (env[`SPLASH_TOTP_SECRET_${suffix}`] ?? env.SPLASH_TOTP_SECRET ?? '').trim();
  return raw ? decodeBase32(raw) : null;
}

export type TotpVerdict =
  | { ok: true; mode: 'verified'; step: number }
  | { ok: true; mode: 'disabled' }
  | { ok: false; code: 'not_enrolled' | 'invalid' | 'replayed'; message: string };

/**
 * The single decision point for "may this payout proceed on its second factor".
 *
 * `requireTotp` comes from the operating settings, so the operator's toggle is
 * load-bearing: turning it off is an explicit, persisted, auditable choice
 * rather than a silent code path.
 */
export function verifyPayoutTotp(input: {
  code: string;
  accountId: string;
  requireTotp: boolean;
  nowMs?: number;
  env?: NodeJS.ProcessEnv;
}): TotpVerdict {
  const nowMs = input.nowMs ?? Date.now();
  if (!input.requireTotp) return { ok: true, mode: 'disabled' };

  const secret = enrolledSecret(input.accountId, input.env ?? process.env);
  if (!secret) {
    return {
      ok: false,
      code: 'not_enrolled',
      message:
        'Payout authorization requires a second factor, but no TOTP secret is enrolled. ' +
        'Set SPLASH_TOTP_SECRET (base32) for this deployment, or turn off "Require TOTP" in ' +
        'Settings to accept that payouts run on the session cookie alone.',
    };
  }

  const step = matchTotpStep(secret, input.code, nowMs);
  if (step === null) {
    return { ok: false, code: 'invalid', message: 'The authorization code is not valid.' };
  }
  if (!markStepConsumed(input.accountId, step, nowMs)) {
    return {
      ok: false,
      code: 'replayed',
      message: 'That authorization code was already used. Wait for the next code and try again.',
    };
  }
  return { ok: true, mode: 'verified', step };
}
