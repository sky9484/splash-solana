/**
 * Application idle timeout: fifteen minutes.
 *
 * Distinct from `maxEpoch`, and deliberately much shorter. `maxEpoch` bounds
 * how long a zkLogin ephemeral KEY can produce a valid signature — a
 * network-level ceiling of roughly a day, fixed at sign-in and unchangeable.
 * This bounds how long an unattended BROWSER stays authenticated.
 *
 * They must not be the same number. Tie the session to `maxEpoch` and a laptop
 * left open in a café stays able to raise payments until tomorrow; tie
 * `maxEpoch` to fifteen minutes and a signing key dies during a coffee break,
 * forcing a fresh OAuth round trip to finish approving something.
 *
 * The clock is server-side. `lastSeenAt` is re-stamped on the session cookie
 * as requests arrive, so a client cannot extend its own session by lying: the
 * value it sends is the one the server last wrote and signed.
 */

export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Re-stamping on every single request would rewrite the cookie constantly for
 * no benefit. A minute of granularity is far finer than the fifteen-minute
 * window it protects.
 */
export const IDLE_REFRESH_INTERVAL_MS = 60 * 1000;

export type IdleVerdict =
  | { state: 'active'; idleMs: number; refresh: boolean }
  | { state: 'expired'; idleMs: number };

/**
 * Whether a session is still active, given when it was last seen.
 *
 * `lastSeenMs` absent means a session minted before idle tracking existed;
 * those are treated as active and stamped on this request rather than logged
 * out en masse by a deploy.
 */
export function evaluateIdle(lastSeenMs: number | undefined, nowMs: number = Date.now()): IdleVerdict {
  if (lastSeenMs === undefined || !Number.isFinite(lastSeenMs)) {
    return { state: 'active', idleMs: 0, refresh: true };
  }

  // A lastSeen in the future means a clock moved, not a valid session that has
  // been idle for negative time. Treat it as just-seen and re-stamp.
  if (lastSeenMs > nowMs) return { state: 'active', idleMs: 0, refresh: true };

  const idleMs = nowMs - lastSeenMs;
  if (idleMs >= IDLE_TIMEOUT_MS) return { state: 'expired', idleMs };
  return { state: 'active', idleMs, refresh: idleMs >= IDLE_REFRESH_INTERVAL_MS };
}

/**
 * The idle window must always close before the ephemeral key expires,
 * whatever epoch length the network reports. Asserted by the test suite
 * rather than assumed.
 */
export function idleWindowIsShorterThan(maxEpochValidityMs: number): boolean {
  return IDLE_TIMEOUT_MS < maxEpochValidityMs;
}
