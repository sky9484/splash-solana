import { randomBytes } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';

import { memberDevices, memberships, orgVaults, users, type OrgVaultMember } from '../db/schema.ts';
import type * as schemaModule from '../db/schema.ts';

/**
 * Device keys and vaults, per member and per organisation.
 *
 * A session says who someone is. A membership says what they may do. A
 * registered device says what they can SIGN: approvals are Ed25519
 * signatures from a non-extractable key on that device, and this table holds
 * only its public half, written after the browser proved it holds the key.
 *
 * DB-injected so the same code runs against Postgres and PGlite in tests.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PgDatabase<any, typeof schemaModule, any>;

export class DeviceRegistryError extends Error {
  readonly code: 'device_exists' | 'key_in_use' | 'vault_exists' | 'not_autonomous' | 'no_membership';

  constructor(code: DeviceRegistryError['code'], message: string) {
    super(message);
    this.name = 'DeviceRegistryError';
    this.code = code;
  }
}

export interface MemberDevice {
  id: string;
  userId: string;
  orgId: string;
  publicKey: string;
  label: string;
  provenAt: Date;
}

export async function findActiveDevice(db: DrizzleDb, input: { userId: string; orgId: string }): Promise<MemberDevice | null> {
  const rows = await db
    .select({
      id: memberDevices.id,
      userId: memberDevices.userId,
      orgId: memberDevices.orgId,
      publicKey: memberDevices.publicKey,
      label: memberDevices.label,
      provenAt: memberDevices.provenAt,
    })
    .from(memberDevices)
    .where(and(eq(memberDevices.userId, input.userId), eq(memberDevices.orgId, input.orgId), isNull(memberDevices.revokedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Record a device the browser has ALREADY proven it holds (the caller ran
 * verifyPossession on a fresh server nonce). Refuses a second active device
 * for the same member (adding one is a vault config transaction) and a key
 * already registered to anyone, active or revoked: a public key is never
 * re-used, so a signature can always be attributed to one person.
 */
export async function registerDevice(
  db: DrizzleDb,
  input: { userId: string; orgId: string; publicKey: string; provenAt: Date; label?: string },
): Promise<MemberDevice> {
  const member = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.userId, input.userId), eq(memberships.orgId, input.orgId)))
    .limit(1);
  if (member.length === 0) throw new DeviceRegistryError('no_membership', 'Only a member of this organisation can register a device for it.');

  if (await findActiveDevice(db, input)) {
    throw new DeviceRegistryError('device_exists', 'You already have a device registered for this organisation. Adding another needs an approval from the vault.');
  }
  const used = await db.select({ id: memberDevices.id }).from(memberDevices).where(eq(memberDevices.publicKey, input.publicKey)).limit(1);
  if (used.length > 0) throw new DeviceRegistryError('key_in_use', 'That device key is already registered. Create a new one.');

  const row: MemberDevice = {
    id: `dev_${randomBytes(12).toString('hex')}`,
    userId: input.userId,
    orgId: input.orgId,
    publicKey: input.publicKey,
    label: input.label?.trim() || 'This device',
    provenAt: input.provenAt,
  };
  await db.insert(memberDevices).values(row);
  return row;
}

export interface OrgVault {
  orgId: string;
  cluster: 'devnet' | 'mainnet-beta';
  simulated: boolean;
  multisigPda: string;
  vaultPda: string;
  threshold: number;
  members: OrgVaultMember[];
  createSignature: string;
  createdBy: string;
  createdAt: Date;
}

export async function findOrgVault(db: DrizzleDb, orgId: string): Promise<OrgVault | null> {
  const rows = await db
    .select({
      orgId: orgVaults.orgId,
      cluster: orgVaults.cluster,
      simulated: orgVaults.simulated,
      multisigPda: orgVaults.multisigPda,
      vaultPda: orgVaults.vaultPda,
      threshold: orgVaults.threshold,
      members: orgVaults.members,
      createSignature: orgVaults.createSignature,
      createdBy: orgVaults.createdBy,
      createdAt: orgVaults.createdAt,
    })
    .from(orgVaults)
    .where(eq(orgVaults.orgId, orgId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Record the organisation's vault, once. `configAuthority` must be null: the
 * caller read it from the created account, and the database CHECK refuses
 * anything else as a second line (I-1).
 */
export async function recordOrgVault(
  db: DrizzleDb,
  input: Omit<OrgVault, 'createdAt'> & { configAuthority: null | string },
): Promise<OrgVault> {
  if (input.configAuthority !== null) {
    throw new DeviceRegistryError('not_autonomous', 'The vault has a config authority. It cannot be recorded as this organisation’s vault.');
  }
  if (await findOrgVault(db, input.orgId)) throw new DeviceRegistryError('vault_exists', 'This organisation already has a vault.');
  const createdAt = new Date();
  const row = {
    orgId: input.orgId,
    cluster: input.cluster,
    simulated: input.simulated,
    multisigPda: input.multisigPda,
    vaultPda: input.vaultPda,
    threshold: input.threshold,
    members: input.members,
    createSignature: input.createSignature,
    createdBy: input.createdBy,
  };
  await db.insert(orgVaults).values({ ...row, configAuthorityNull: true, createdAt, updatedAt: createdAt });
  return { ...row, createdAt };
}

export type SetupStatus =
  | { state: 'no_membership' }
  | { state: 'no_device'; orgId: string; userId: string; vault: OrgVault | null }
  | { state: 'no_vault'; orgId: string; userId: string; device: MemberDevice }
  | { state: 'ready'; orgId: string; userId: string; device: MemberDevice; vault: OrgVault };

/**
 * Where a signed-in person stands. `ready` only when they are a member, have
 * a registered device, and their organisation has a vault. Everything that
 * moves money requires `ready`; everything else sends them to setup.
 */
export async function readSetupStatus(db: DrizzleDb, email: string): Promise<SetupStatus> {
  const rows = await db
    .select({ userId: users.id, orgId: memberships.orgId })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  const member = rows[0];
  if (!member) return { state: 'no_membership' };

  const [device, vault] = await Promise.all([findActiveDevice(db, member), findOrgVault(db, member.orgId)]);
  if (!device) return { state: 'no_device', ...member, vault };
  if (!vault) return { state: 'no_vault', ...member, device };
  return { state: 'ready', ...member, device, vault };
}
