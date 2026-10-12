import type { SetupStatus } from '@/lib/auth/devices';
import type { CustomerSession } from '@/lib/auth/customer-session';

/**
 * The device check after sign-in (prompt 07 §3.2).
 *
 * A signed-in person reaches the dashboard's money pages only when they are a
 * member, have a device key registered for that membership, and their
 * organisation has a vault with that device as a member. Anything less sends
 * them to /dashboard/setup. Fails closed: when the status cannot be read, the
 * answer is "set up first", never "go ahead".
 *
 * The pages under /dashboard are client components, so the check runs once in
 * app/dashboard/layout.tsx, on the path proxy.ts stamps into the request.
 * Server routes that move money check their own preconditions too; this is
 * the screen-level half.
 */

/** Paths a person may open before setup is done: setup itself, and their own account pages. */
export const SETUP_EXEMPT_PREFIXES = [
  '/dashboard/setup',
  '/dashboard/profile',
  '/dashboard/settings',
  '/dashboard/customer-service',
] as const;

/** Header proxy.ts sets on every request, overwriting anything a client sent. */
export const PATHNAME_HEADER = 'x-splash-pathname';

export function isSetupExempt(pathname: string): boolean {
  const path = pathname.split('?')[0]?.replace(/\/+$/, '') || '/';
  return SETUP_EXEMPT_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Pure: where this request must go instead, or null to let it through. */
export function setupRedirectFor(pathname: string, status: SetupStatus | null): string | null {
  if (isSetupExempt(pathname)) return null;
  if (status?.state === 'ready') return null;
  return '/dashboard/setup';
}

/**
 * The proxy half of the check: optimistic, cookie only, no database.
 *
 * Layouts do not re-render on client-side navigation, so a check that lived
 * only in app/dashboard/layout.tsx would let a click from /dashboard/setup to
 * /dashboard/transfer through. proxy.ts runs on every request, including the
 * router's fetches, and calls this for /dashboard paths. It trusts only the
 * signed setup cookie (lib/server/setup-cookie.ts), bound to this session;
 * the authoritative database check stays in the layout and the money routes.
 * A request with no readable session is left alone: the layout sends it to
 * /login.
 */
export async function proxySetupRedirect(
  pathname: string,
  cookies: { session: string | undefined; setup: string | undefined },
): Promise<string | null> {
  if (!pathname.startsWith('/dashboard') || isSetupExempt(pathname) || !cookies.session) return null;
  const [{ readCustomerSessionToken }, { customerSessionSecret }, { openSetupClaim }] = await Promise.all([
    import('@/lib/auth/customer-session'),
    import('@/lib/server/customer-auth'),
    import('@/lib/server/setup-cookie'),
  ]);
  const secret = customerSessionSecret();
  const session = secret ? readCustomerSessionToken(cookies.session, secret) : null;
  if (!session || !secret) return null;
  return openSetupClaim(cookies.setup, secret, session) ? null : '/dashboard/setup';
}

/**
 * From a route handler (which may set cookies): read the authoritative status
 * once and set or clear the proxy's setup cookie to match. Called at sign-in
 * and by the setup routes. Never throws: a failure leaves the cookie unset,
 * which only means one extra hop through /dashboard/setup.
 */
export async function refreshSetupCookie(session: CustomerSession): Promise<void> {
  try {
    const { syncSetupCookie } = await import('@/lib/server/setup-cookie');
    await syncSetupCookie(session, await readSetupStatusForSession(session));
  } catch (error) {
    console.error('[setup-gate] could not refresh the setup cookie', error);
  }
}

/** The member's setup status, or null when it cannot be read (no database, or a read error). */
export async function readSetupStatusForSession(session: CustomerSession): Promise<SetupStatus | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const [{ getDb }, { readSetupStatus }] = await Promise.all([import('@/lib/db/client'), import('@/lib/auth/devices')]);
    return await readSetupStatus(getDb() as never, session.email);
  } catch (error) {
    console.error('[setup-gate] could not read setup status; sending to setup', error);
    return null;
  }
}
