import { randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';

import { passkeyCredentials } from '../db/schema.ts';
import type * as schemaModule from '../db/schema.ts';

/**
 * Passkeys: enrolment and lookup. Verification is plain WebAuthn in
 * lib/auth/webauthn.ts; the passkey is a sign-in and step-up factor, not a
 * vault signer (prompt 07 §3.2).
 *
 * A passkey is a P-256 keypair held by the authenticator — a phone's secure
 * enclave or a laptop's TPM. The private half never leaves it, so an assertion
 * could only have been made by someone holding that device and passing its
 * biometric or PIN check.
 *
 * The public key is captured at enrolment and never again: WebAuthn returns it
 * once, at registration; a later assertion carries a signature and a
 * credential id and no key. Hence this module stores it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PgDatabase<any, typeof schemaModule, any>;

/** A compressed secp256r1 point. Anything else is not a passkey key. */
export const COMPRESSED_P256_BYTES = 33;

export class PasskeyError extends Error {
  /** Explicit field, not a constructor parameter property: Node's
   *  --experimental-strip-types cannot parse those, and the test runner loads
   *  this module directly. */
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'PasskeyError';
    this.code = code;
  }
}

export type EnrolledCredential = {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  rpId: string;
};

/**
 * The relying-party id for this deployment.
 *
 * A WebAuthn credential is bound to its rpId and the browser will not offer it
 * on any other. A credential enrolled against `localhost` therefore cannot be
 * used on `v1.splashz.xyz` — not as a policy, as a fact of the platform — and
 * that is not fixable after the fact, which is why it is configuration and not
 * a derivation from whatever Host header arrived.
 *
 * Deriving it from the request would also be the vulnerability: an attacker
 * who can influence the Host header could enrol a credential under an rpId
 * they control.
 */
export function relyingPartyId(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.PASSKEY_RP_ID?.trim();
  if (configured) return configured;

  // Fall back to the app's own origin, which is already validated as a URL by
  // lib/env.ts and is not attacker-supplied.
  const appUrl = env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) {
    try {
      return new URL(appUrl).hostname;
    } catch {
      /* fall through */
    }
  }
  return 'localhost';
}

/** A base64 key of exactly the compressed-point length, or an error saying why not. */
export function assertCompressedP256(publicKeyB64: string): Uint8Array {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(publicKeyB64, 'base64');
  } catch {
    throw new PasskeyError('public key is not valid base64', 'bad_public_key');
  }
  if (bytes.length !== COMPRESSED_P256_BYTES) {
    throw new PasskeyError(
      `public key must be ${COMPRESSED_P256_BYTES} bytes compressed secp256r1, got ${bytes.length}`,
      'bad_public_key',
    );
  }
  // Compressed points start 0x02 or 0x03. An uncompressed 0x04 point is the
  // common mistake: the right family, the wrong encoding.
  if (bytes[0] !== 0x02 && bytes[0] !== 0x03) {
    throw new PasskeyError('public key is not a compressed point (expected a 0x02 or 0x03 prefix)', 'bad_public_key');
  }
  return new Uint8Array(bytes);
}


/**
 * Enrol a credential.
 *
 * One per user per rpId: a second enrolment for the same origin replaces
 * nothing and is refused, because "which key approved this" must have exactly
 * one answer. Enrolling on a different origin is a different credential and is
 * allowed.
 */
export async function enrolPasskey(
  db: DrizzleDb,
  input: { userId: string; credentialId: string; publicKey: string; rpId: string },
): Promise<EnrolledCredential> {
  assertCompressedP256(input.publicKey);

  const existing = await db
    .select({ id: passkeyCredentials.id })
    .from(passkeyCredentials)
    .where(
      and(
        eq(passkeyCredentials.userId, input.userId),
        eq(passkeyCredentials.rpId, input.rpId),
        isNull(passkeyCredentials.revokedAt),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    throw new PasskeyError('this account already has a passkey for this origin', 'already_enrolled');
  }

  // Unique per enrolment, not per (user, origin). Revocation is a tombstone,
  // so a deterministic id would collide with the retired row the moment
  // someone re-enrolled on the same origin — locking them out of the very
  // recovery the tombstone was supposed to allow. The partial-unique index on
  // (user, rpId) is what enforces one ACTIVE credential; the primary key only
  // has to be unique.
  const id = `pk_${randomUUID()}`;
  await db.insert(passkeyCredentials).values({
    id,
    userId: input.userId,
    credentialId: input.credentialId,
    publicKey: input.publicKey,
    suiAddress: null,
    rpId: input.rpId,
  });

  return { id, userId: input.userId, credentialId: input.credentialId, publicKey: input.publicKey, rpId: input.rpId };
}

/** The active credential for this user on this origin, or null. */
export async function findCredential(
  db: DrizzleDb,
  input: { userId: string; rpId: string },
): Promise<EnrolledCredential | null> {
  const rows = await db
    .select()
    .from(passkeyCredentials)
    .where(
      and(
        eq(passkeyCredentials.userId, input.userId),
        eq(passkeyCredentials.rpId, input.rpId),
        isNull(passkeyCredentials.revokedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row
    ? {
        id: row.id,
        userId: row.userId,
        credentialId: row.credentialId,
        publicKey: row.publicKey,
        rpId: row.rpId,
      }
    : null;
}

/** Retire a credential. A tombstone, so anchored approvals keep their referent. */
export async function revokePasskey(db: DrizzleDb, id: string): Promise<void> {
  await db.update(passkeyCredentials).set({ revokedAt: new Date() }).where(eq(passkeyCredentials.id, id));
}

/** Record a use, for the security page. Never gates anything. */
export async function markCredentialUsed(db: DrizzleDb, id: string): Promise<void> {
  await db.update(passkeyCredentials).set({ lastUsedAt: new Date() }).where(eq(passkeyCredentials.id, id));
}
