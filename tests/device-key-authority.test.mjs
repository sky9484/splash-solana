import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '../lib/db/schema.ts';
import { linkVerifiedIdentity } from '../lib/auth/accounts.ts';
import { UnauthorizedError, grantMembership, resolveAuthorityFromDb } from '../lib/auth/authority.ts';
import { DeviceRegistryError, readSetupStatus, recordOrgVault, registerDevice } from '../lib/auth/devices.ts';
import { IDLE_TIMEOUT_MS, evaluateIdle } from '../lib/auth/idle-timeout.ts';

/*
 * Identity authorizes nothing.
 *
 * Signing in (password or Google) says who someone is. What they may do comes
 * from a membership row; what they can SIGN comes from the device key they
 * registered for that membership. This file pins the first half: no sign-in
 * path grants authority, and an unattended browser stops being signed in.
 */

async function migratedDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const files = (await readdir(new URL('../drizzle', import.meta.url))).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sqlText = await readFile(new URL(`../drizzle/${file}`, import.meta.url), 'utf8');
    for (const statement of sqlText.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }
  return { client, db };
}

/** Source with comments stripped, so prose that names a function is not a call. */
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

/* ── Sign-in grants nothing ────────────────────────────────────────────── */

test('a Google identity, fully linked, can authorize nothing', async () => {
  const { client, db } = await migratedDb();
  await linkVerifiedIdentity(db, { email: 'ceo@acme.com', name: 'CEO' });
  await assert.rejects(() => resolveAuthorityFromDb(db, 'ceo@acme.com'), UnauthorizedError);
  await client.close();
});

test('no sign-in file touches the memberships table', async () => {
  const files = [
    '../app/api/auth/google/start/route.ts',
    '../app/api/auth/google/callback/route.ts',
    '../lib/auth/google-oidc.ts',
    '../app/api/auth/login/route.ts',
    '../components/auth/LoginForm.tsx',
    '../components/auth/GoogleSignInButton.tsx',
  ];
  for (const rel of files) {
    const source = code(await readFile(new URL(rel, import.meta.url), 'utf8'));
    assert.doesNotMatch(source, /memberships|grantMembership|provisionOperatorMembership/, `${rel} must not grant authority`);
  }
  // linkVerifiedIdentity creates or claims an account; it never grants a role.
  const accounts = code(await readFile(new URL('../lib/auth/accounts.ts', import.meta.url), 'utf8'));
  assert.doesNotMatch(accounts, /memberships/);
});

test('no key material is derived from a sign-in', async () => {
  for (const rel of ['../lib/auth/google-oidc.ts', '../app/api/auth/google/callback/route.ts']) {
    const source = code(await readFile(new URL(rel, import.meta.url), 'utf8'));
    assert.doesNotMatch(source, /Keypair|deriveKey|fromSeed|salt/i, `${rel} must not derive a key from the identity`);
  }
});

/* ── The device key is the member's signer ─────────────────────────────── */

const KEY_A = '9fZ34EK7EupQAHvdR6xrnJ8XHPb2w5Tpknabp36rPMPr';
const KEY_B = 'TgRAyTcrJNT1b4eKmRGyUeUeeeyjRxxPydPWThknRwD';
const KIT = 'FCx3qZbgSkSfaMofXCk4Mnifnb3CAjwWetCxnL1SSUPp';

async function memberDb(email = 'ops@acme.com', role = 'admin') {
  const { client, db } = await migratedDb();
  await db.insert(schema.organizations).values({ id: 'acme', name: 'Acme Sdn Bhd' });
  await linkVerifiedIdentity(db, { email });
  await grantMembership(db, { email, orgId: 'acme', role });
  return { client, db, userId: `op_${email}` };
}

const vaultInput = (over = {}) => ({
  orgId: 'acme',
  cluster: 'devnet',
  simulated: true,
  multisigPda: 'H2EoCQ1ejDFSvGMgCjZgTJwXs25dw7KDPA96u6thCoWX',
  vaultPda: 'iFL7ceiXEip4VTqTcTsVR8eZWMTcLHFga8hwm4dkeVS',
  threshold: 1,
  members: [{ role: 'admin_device', publicKey: KEY_A }, { role: 'recovery_kit_a', publicKey: KIT }],
  createSignature: 'sim-signature',
  createdBy: 'op_ops@acme.com',
  configAuthority: null,
  ...over,
});

test('authority carries the member’s registered device key, and null before setup', async () => {
  const { client, db, userId } = await memberDb();
  assert.equal((await resolveAuthorityFromDb(db, 'ops@acme.com')).devicePublicKey, null);
  await registerDevice(db, { userId, orgId: 'acme', publicKey: KEY_A, provenAt: new Date() });
  assert.equal((await resolveAuthorityFromDb(db, 'ops@acme.com')).devicePublicKey, KEY_A);
  await client.close();
});

test('only a member can register a device, one active device each, and a key is never reused', async () => {
  const { client, db, userId } = await memberDb();
  await linkVerifiedIdentity(db, { email: 'stranger@else.com' });
  await assert.rejects(
    registerDevice(db, { userId: 'op_stranger@else.com', orgId: 'acme', publicKey: KEY_B, provenAt: new Date() }),
    (e) => e instanceof DeviceRegistryError && e.code === 'no_membership',
  );
  await registerDevice(db, { userId, orgId: 'acme', publicKey: KEY_A, provenAt: new Date() });
  await assert.rejects(
    registerDevice(db, { userId, orgId: 'acme', publicKey: KEY_B, provenAt: new Date() }),
    (e) => e instanceof DeviceRegistryError && e.code === 'device_exists',
    'a second device is a vault config transaction, not a row',
  );

  await linkVerifiedIdentity(db, { email: 'ap@acme.com' });
  await grantMembership(db, { email: 'ap@acme.com', orgId: 'acme', role: 'checker' });
  await assert.rejects(
    registerDevice(db, { userId: 'op_ap@acme.com', orgId: 'acme', publicKey: KEY_A, provenAt: new Date() }),
    (e) => e instanceof DeviceRegistryError && e.code === 'key_in_use',
    'one key, one person: a signature is always attributable',
  );
  await client.close();
});

test('a vault with a config authority is never recorded (I-1), in code and in the database', async () => {
  const { client, db } = await memberDb();
  await assert.rejects(
    recordOrgVault(db, vaultInput({ configAuthority: 'SomeAuthority1111111111111111111111111111111' })),
    (e) => e instanceof DeviceRegistryError && e.code === 'not_autonomous',
  );
  // The CHECK constraint refuses it even if the code path is bypassed.
  await assert.rejects(
    client.exec(`INSERT INTO org_vaults (org_id, cluster, simulated, multisig_pda, vault_pda, threshold, members, config_authority_null, create_signature, created_by)
      VALUES ('acme', 'devnet', true, 'm', 'v', 1, '[]', false, 's', 'op_ops@acme.com')`),
    /org_vaults_autonomous/,
  );
  await recordOrgVault(db, vaultInput());
  await assert.rejects(recordOrgVault(db, vaultInput()), (e) => e.code === 'vault_exists');
  await client.close();
});

test('setup status: no membership → no device → no vault → ready', async () => {
  const { client, db } = await migratedDb();
  await db.insert(schema.organizations).values({ id: 'acme', name: 'Acme Sdn Bhd' });
  await linkVerifiedIdentity(db, { email: 'ops@acme.com' });
  assert.equal((await readSetupStatus(db, 'ops@acme.com')).state, 'no_membership');
  await grantMembership(db, { email: 'ops@acme.com', orgId: 'acme', role: 'admin' });
  assert.equal((await readSetupStatus(db, 'ops@acme.com')).state, 'no_device');
  await registerDevice(db, { userId: 'op_ops@acme.com', orgId: 'acme', publicKey: KEY_A, provenAt: new Date() });
  assert.equal((await readSetupStatus(db, 'ops@acme.com')).state, 'no_vault');
  await recordOrgVault(db, vaultInput());
  const ready = await readSetupStatus(db, 'OPS@acme.com');
  assert.equal(ready.state, 'ready');
  assert.equal(ready.device.publicKey, KEY_A);
  assert.equal(ready.vault.members.length, 2);
  await client.close();
});

/* ── idle timeout ──────────────────────────────────────────────────────── */

test('the idle window is fifteen minutes and closes on the far side of it', () => {
  assert.equal(IDLE_TIMEOUT_MS, 15 * 60 * 1000);
  const now = Date.now();
  assert.equal(evaluateIdle(now - 60_000, now).state, 'active');
  assert.equal(evaluateIdle(now - 14 * 60 * 1000, now).state, 'active');
  assert.equal(evaluateIdle(now - IDLE_TIMEOUT_MS, now).state, 'expired');
  assert.equal(evaluateIdle(now - 60 * 60 * 1000, now).state, 'expired');
});

test('a session with no lastSeen is stamped rather than logged out', () => {
  // A deploy must not sign everyone out.
  const v = evaluateIdle(undefined);
  assert.equal(v.state, 'active');
  assert.equal(v.refresh, true);
});

test('a lastSeen in the future is treated as now, not as negative idleness', () => {
  const now = Date.now();
  const v = evaluateIdle(now + 60_000, now);
  assert.equal(v.state, 'active');
  assert.equal(v.idleMs, 0);
});

test('the session read enforces the window, and a read alone does not extend it', async () => {
  const source = code(await readFile(new URL('../lib/server/customer-auth.ts', import.meta.url), 'utf8'));
  assert.match(source, /evaluateIdle/);
  assert.match(source, /expired[\s\S]{0,40}return null/);
});
