const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Origins a state-changing customer request may legitimately come from.
 *
 *  Behind a reverse proxy (Vercel, nginx, Cloudflare) `request.url` carries
 *  the INTERNAL origin (e.g. http://localhost:3000), while the browser sends
 *  the public one (e.g. https://v1.splashz.xyz) — so comparing against
 *  request.url alone rejects every legitimate production request. Trust the
 *  forwarded host/proto headers the proxy sets, plus explicit configuration.
 */
function allowedOrigins(request: Request): Set<string> {
  const origins = new Set<string>();

  const add = (value: string | null | undefined) => {
    if (!value) return;
    try {
      origins.add(new URL(value).origin);
    } catch {
      /* skip malformed entries */
    }
  };

  // 1. The origin Next.js itself saw (works when serving directly / in dev).
  add(request.url);

  // 2. Proxy-aware: the public host the browser actually addressed.
  //    x-forwarded-host may be a comma-separated chain — the first entry is
  //    the client-facing host.
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || request.headers.get('host');
  if (host) {
    const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    if (proto) add(`${proto}://${host}`);
    add(`https://${host}`);
    add(`http://${host}`);
  }

  // 3. Explicitly configured app origins.
  add(process.env.NEXT_PUBLIC_APP_URL);
  for (const entry of (process.env.ALLOWED_ORIGINS ?? '').split(',')) {
    add(entry.trim());
  }

  return origins;
}

export function customerRequestOriginAllowed(request: Request): boolean {
  if (safeMethods.has(request.method.toUpperCase())) return true;

  const allowed = allowedOrigins(request);

  const origin = request.headers.get('origin');
  if (origin) {
    try {
      return allowed.has(new URL(origin).origin);
    } catch {
      return false;
    }
  }

  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return allowed.has(new URL(referer).origin);
    } catch {
      return false;
    }
  }

  const fetchSite = request.headers.get('sec-fetch-site');
  return fetchSite !== 'cross-site';
}
