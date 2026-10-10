/**
 * Killed-entity domain denylist (wallet spec §2.4).
 *
 * A killed entity must not be able to bind itself into KYB through the auth
 * layer either. The fund-flow kill of CCACC is mirrored here: onboarding
 * rejects any email whose domain is denied, and the check runs BOTH at signup
 * and at every session mint — so a cookie issued before a domain was killed
 * stops verifying rather than lingering until expiry.
 *
 * Config, not code: extend with KILLED_ENTITY_DOMAINS (comma-separated), the
 * same idiom as ALLOWED_ORIGINS in lib/auth/customer-request.ts.
 *
 * Pure and dependency-free on purpose — it is imported by both the auth path
 * and the signup route, and must never pull in server-only modules.
 */

/** Killed in canon. Founder/dev test accounts must use a neutral domain so a
 *  killed entity is never the first identity in our own KYB system. */
const BUILT_IN_KILLED_DOMAINS = ['ccacc.io'] as const;

export function killedEntityDomains(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const configured = (env.KILLED_ENTITY_DOMAINS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return new Set<string>([...BUILT_IN_KILLED_DOMAINS, ...configured]);
}

/** Domain part of an email, lowercased. '' when the input has no '@'. */
export function emailDomain(email: string): string {
  const normalized = String(email ?? '').trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  return at === -1 ? '' : normalized.slice(at + 1);
}

/**
 * True when this email belongs to a killed entity. Subdomains count:
 * `pay.ccacc.io` is the same entity as `ccacc.io`.
 *
 * A malformed/empty email is NOT reported as killed — that is the email
 * validator's job, and conflating the two would produce a misleading error.
 */
export function isKilledEntityEmail(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const domain = emailDomain(email);
  if (!domain) return false;

  for (const denied of killedEntityDomains(env)) {
    if (domain === denied || domain.endsWith(`.${denied}`)) return true;
  }
  return false;
}

export class KilledEntityError extends Error {
  readonly domain: string;

  constructor(email: string) {
    const domain = emailDomain(email);
    super(`onboarding is not available for ${domain || 'this domain'}`);
    this.name = 'KilledEntityError';
    this.domain = domain;
  }
}
