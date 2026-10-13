/**
 * Account setup on Solana, bound to a signed-in member (prompt 07 §3.2):
 * device key → recovery kit (checked in the browser) → register the public
 * keys → create or join the organisation's vault.
 *
 * The browser makes both keys. The server sees public keys and signatures
 * over fresh nonces, never a private key or a word. Proving the keys and
 * creating the vault happen in ONE request so a member is never left half set
 * up (a device on record whose recovery kit key was lost on a restart).
 *
 *   no vault yet:  an owner proves device + kit; the vault is created with
 *                  both as members (threshold 1, configAuthority null); the
 *                  device and the vault are recorded in one transaction.
 *   vault exists:  the member proves their device and it is recorded. It is
 *                  not a vault member until the existing members approve a
 *                  config transaction, so it can sign nothing yet.
 */
import type { PgDatabase } from 'drizzle-orm/pg-core';

import { DeviceRegistryError, findActiveDevice, findOrgVault, recordOrgVault, registerDevice, type OrgVault } from '../auth/devices.ts';
import type * as schemaModule from '../db/schema.ts';
import type { OrgVaultMember } from '../db/schema.ts';
import { createPossessionChallenge, verifyPossession, type PossessionChallenge } from '../solana/recovery-kit.ts';
import { ServiceError } from './errors.ts';
import { runtime } from './runtime.ts';
import { createAutonomousVault } from './service.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PgDatabase<any, typeof schemaModule, any>;

export type KeyRole = 'device' | 'kit';

export interface SetupMember {
  userId: string;
  orgId: string;
  /** Only an OWNER may create the organisation's vault. */
  isOwner: boolean;
}

type Pending = { challenge: PossessionChallenge; role: KeyRole; userId: string; orgId: string };

/** Outstanding challenges, by nonce. Short-lived (5 minutes) and single-use. */
const globalPending = globalThis as typeof globalThis & { splashSetupChallenges?: Map<string, Pending> };
const pending = globalPending.splashSetupChallenges ?? new Map<string, Pending>();
globalPending.splashSetupChallenges = pending;

function purgeExpired(now: Date) {
  for (const [nonce, p] of pending) if (Date.parse(p.challenge.expiresAt) < now.getTime()) pending.delete(nonce);
}

export function issueSetupChallenges(member: SetupMember, keys: Array<{ role: KeyRole; publicKey: string }>, now = new Date()) {
  purgeExpired(now);
  if (!keys.some((k) => k.role === 'device')) throw new ServiceError('bad_request', 'A device key is required.');
  if (new Set(keys.map((k) => k.role)).size !== keys.length) throw new ServiceError('bad_request', 'One key per role.');
  return keys.map((k) => {
    let challenge: PossessionChallenge;
    try {
      // The org id binds the proof to this organisation; the user id is checked on the way back.
      challenge = createPossessionChallenge(member.orgId, k.publicKey, now);
    } catch (e) {
      throw new ServiceError('bad_request', `That ${k.role === 'kit' ? 'recovery kit' : 'device'} key is not a valid public key.`, 400, { reason: (e as Error).message });
    }
    pending.set(challenge.nonce, { challenge, role: k.role, userId: member.userId, orgId: member.orgId });
    return { role: k.role, ...challenge };
  });
}

export type SetupOutcome =
  | { outcome: 'created'; devicePublicKey: string; vault: OrgVault }
  | { outcome: 'joined'; devicePublicKey: string; vault: OrgVault };

export async function completeSetup(
  db: DrizzleDb,
  member: SetupMember,
  proofs: Array<{ role: KeyRole; publicKey: string; nonce: string; signature: string }>,
  now = new Date(),
): Promise<SetupOutcome> {
  const proven: Partial<Record<KeyRole, string>> = {};
  const rt = runtime();
  for (const proof of proofs) {
    const p = pending.get(proof.nonce);
    // Unknown, already used, someone else's, or for another role: all the same answer.
    if (!p || p.role !== proof.role || p.userId !== member.userId || p.orgId !== member.orgId) {
      throw new ServiceError('possession_failed', 'That key check is unknown or already used. Start the key step again.');
    }
    pending.delete(proof.nonce);
    const result = await verifyPossession(p.challenge, proof.publicKey, proof.signature, rt.nonces, now);
    if (!result.ok) {
      throw new ServiceError('possession_failed', `The ${proof.role === 'kit' ? 'recovery kit' : 'device key'} check failed (${result.reason}). Nothing was saved. Try the key step again.`);
    }
    proven[proof.role] = proof.publicKey;
  }
  const device = proven.device;
  if (!device) throw new ServiceError('keys_missing', 'Create the device key on this device first.', 409);

  if (await findActiveDevice(db, member)) {
    throw new ServiceError('device_exists', 'You already have a device set up for this company. Adding another needs an approval from the vault.', 409);
  }

  const existing = await findOrgVault(db, member.orgId);
  if (existing) {
    await withRegistryErrors(() => registerDevice(db, { userId: member.userId, orgId: member.orgId, publicKey: device, provenAt: now }));
    return { outcome: 'joined', devicePublicKey: device, vault: existing };
  }

  if (!member.isOwner) {
    throw new ServiceError('not_authorized', 'Your company’s owner sets up the vault first. Ask them, then come back to add this device.', 403);
  }
  const kit = proven.kit;
  if (!kit) throw new ServiceError('keys_missing', 'Save your recovery kit and check three words first.', 409);

  const created = await createAutonomousVault({ devicePublicKey: device, kitPublicKey: kit, sponsorTag: member.orgId });
  const members: OrgVaultMember[] = created.members.map((m) => ({ role: m.role, publicKey: m.publicKey }));
  // The chain call is done; the two records land together or not at all. If
  // this write fails the vault exists without a record: setup can be run
  // again (a new vault is made), and the orphan holds no money.
  const vault = await db.transaction(async (tx) => {
    await registerDevice(tx as unknown as DrizzleDb, { userId: member.userId, orgId: member.orgId, publicKey: device, provenAt: now });
    return recordOrgVault(tx as unknown as DrizzleDb, {
      orgId: member.orgId,
      cluster: created.cluster,
      simulated: created.simulated,
      multisigPda: created.multisigPda,
      vaultPda: created.vaultPda,
      threshold: created.threshold,
      members,
      createSignature: created.signature,
      createdBy: member.userId,
      configAuthority: created.configAuthority,
    });
  }).catch((error: unknown) => {
    if (error instanceof DeviceRegistryError) throw toServiceError(error);
    throw error;
  });
  return { outcome: 'created', devicePublicKey: device, vault };
}

async function withRegistryErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof DeviceRegistryError) throw toServiceError(error);
    throw error;
  }
}

function toServiceError(error: DeviceRegistryError): ServiceError {
  switch (error.code) {
    case 'device_exists':
      return new ServiceError('device_exists', error.message, 409);
    case 'vault_exists':
      return new ServiceError('vault_exists', error.message, 409);
    case 'no_membership':
      return new ServiceError('not_authorized', error.message, 403);
    default:
      return new ServiceError('bad_request', error.message);
  }
}

/** Test seam. */
export function resetSetupChallengesForTesting() {
  pending.clear();
}
