import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';

import { organizations, users, walletIdentities } from './schema.ts';
import type * as schemaModule from './schema.ts';

/**
 * `wallet_identities` persistence (wallet spec §2.3).
 *
 * One org has ONE on-chain BusinessAccount but MANY human signers — a zkLogin
 * address is derived per (iss, sub, aud, salt), so each employee gets their own
 * address and maker-checker gains per-human attribution.
 *
 * The (iss, sub, aud) uniqueness is the cross-app impersonation guard: a token
 * from another OAuth client can never resolve to an existing identity here.
 *
 * `oauth_sub` is a provider user id — PII. Never log it raw; use
 * `hashSubjectForLog` from lib/auth/zklogin.ts.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PgDatabase<any, typeof schemaModule, any>;

export type WalletIdentityInput = {
  userId: string;
  orgId: string;
  suiAddress: string;
  oauthIss: string;
  oauthSub: string;
  oauthAud: string;
  emailAtLogin?: string | null;
};

function identityId(input: Pick<WalletIdentityInput, 'oauthIss' | 'oauthSub' | 'oauthAud'>): string {
  // Deterministic id so repeated logins converge on one row rather than racing
  // to insert duplicates.
  //
  // HASH, never a truncated encoding of the raw tuple: `aud` is the last
  // component, so slicing a base64 of "iss|sub|aud" cut the distinguishing part
  // off and two different OAuth clients collided onto one id — which would have
  // silently dropped the second identity via onConflictDoNothing.
  const digest = createHash('sha256')
    .update(`${input.oauthIss}|${input.oauthSub}|${input.oauthAud}`)
    .digest('hex');
  return `wid_${digest.slice(0, 40)}`;
}

/**
 * Insert-or-refresh the identity for this login.
 *
 * Deliberately does NOT overwrite `sui_address` on conflict: the address is
 * derived from (sub, iss, aud, salt) and must be stable for the lifetime of the
 * identity. If it ever differs, that is a salt change or a derivation-mode
 * change and it needs a human, not a silent update — so we surface it.
 */
export async function upsertWalletIdentity(
  db: DrizzleDb,
  input: WalletIdentityInput,
): Promise<{ id: string; created: boolean }> {
  const existing = await db
    .select()
    .from(walletIdentities)
    .where(and(
      eq(walletIdentities.oauthIss, input.oauthIss),
      eq(walletIdentities.oauthSub, input.oauthSub),
      eq(walletIdentities.oauthAud, input.oauthAud),
    ))
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0];
    if (row.suiAddress !== input.suiAddress) {
      throw new Error(
        `zkLogin address for this identity changed (${row.suiAddress} -> ${input.suiAddress}). ` +
        'That means the salt or derivation mode changed; refusing to rebind silently.',
      );
    }
    await db
      .update(walletIdentities)
      .set({ emailAtLogin: input.emailAtLogin ?? row.emailAtLogin, updatedAt: new Date() })
      .where(eq(walletIdentities.id, row.id));
    return { id: row.id, created: false };
  }

  const id = identityId(input);
  await db.insert(walletIdentities).values({
    id,
    userId: input.userId,
    orgId: input.orgId,
    suiAddress: input.suiAddress,
    oauthIss: input.oauthIss,
    oauthSub: input.oauthSub,
    oauthAud: input.oauthAud,
    emailAtLogin: input.emailAtLogin ?? null,
  }).onConflictDoNothing();

  return { id, created: true };
}

/** Resolve the human behind a signer address — the maker-checker attribution. */
export async function findWalletIdentityByAddress(db: DrizzleDb, suiAddress: string) {
  const rows = await db
    .select()
    .from(walletIdentities)
    .where(eq(walletIdentities.suiAddress, suiAddress))
    .limit(1);
  return rows[0] ?? null;
}

/** Every signer registered for an org. */
export async function listOrgWalletIdentities(db: DrizzleDb, orgId: string) {
  return db.select().from(walletIdentities).where(eq(walletIdentities.orgId, orgId));
}

/**
 * Ensure the identity and organisation rows a wallet identity references
 * exist. Identity only — this grants nothing.
 *
 * It used to insert a `users` row carrying an org and a role, defaulting to
 * `viewer`, because the old schema could not express a user without one. So
 * signing in with zkLogin created a membership as a side effect of creating
 * an identity. A zkLogin address is identity; authority is a separate,
 * deliberate grant, and `grantMembership` is the only thing that makes one.
 */
export async function ensureUserForIdentity(
  db: DrizzleDb,
  input: { userId: string; orgId: string; email: string; name?: string },
): Promise<void> {
  await db.insert(organizations).values({ id: input.orgId, name: input.orgId }).onConflictDoNothing();
  await db.insert(users).values({
    id: input.userId,
    email: input.email.trim().toLowerCase(),
    name: input.name ?? input.email.split('@')[0] ?? 'operator',
  }).onConflictDoNothing();
}
