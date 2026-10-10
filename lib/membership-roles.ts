/**
 * Roles, and what they mean in an operator's words.
 *
 * A separate module from `lib/server/memberships.ts` for a reason the bundler
 * enforces: that file reaches `lib/db/client.ts` and therefore `pg`, so a
 * client component importing a role name from it drags a Postgres driver into
 * the browser bundle. This file imports nothing at all.
 *
 * It is also the shape the console renders, which is why `AccountRow` lives
 * here — the type crosses the server/client boundary and nothing else in it
 * does.
 */

export type MembershipRole = 'maker' | 'checker' | 'admin' | 'viewer';

export const MEMBERSHIP_ROLES: readonly MembershipRole[] = ['viewer', 'maker', 'checker', 'admin'];

/**
 * `checker` maps to APPROVER, which is in APPROVAL_ROLES — it releases money.
 * The console says so at the point of granting, because "checker" does not
 * look like the most dangerous option in the list and it is.
 */
export const ROLE_MEANING: Record<MembershipRole, string> = {
  viewer: 'Read-only. Sees the workspace, changes nothing.',
  maker: 'Prepares payments and submits them for approval. Cannot approve.',
  checker: 'Releases payments. This role can move money.',
  admin: 'Full workspace authority, including releasing payments.',
};

/** The two roles that can release a payment. Everything else is preparation. */
export const APPROVING_ROLES: readonly MembershipRole[] = ['checker', 'admin'];

export function isMembershipRole(value: unknown): value is MembershipRole {
  return typeof value === 'string' && (MEMBERSHIP_ROLES as readonly string[]).includes(value);
}

export function canApprove(role: MembershipRole): boolean {
  return APPROVING_ROLES.includes(role);
}

export type AccountRow = {
  userId: string;
  email: string;
  name: string;
  createdAt: string;
  /** Whether a password exists — never the hash. */
  hasPassword: boolean;
  emailVerified: boolean;
  membership: { orgId: string; role: MembershipRole; grantedBy: string | null; grantedAt: string } | null;
};
