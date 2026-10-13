import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { afterEach, test } from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '../lib/db/schema.ts';
import { linkVerifiedIdentity } from '../lib/auth/accounts.ts';
import { grantMembership } from '../lib/auth/authority.ts';
import { readSetupStatus } from '../lib/auth/devices.ts';
import { completeSetup, issueSetupChallenges, resetSetupChallengesForTesting } from '../lib/solana-app/account-setup.ts';
import { resetRuntime } from '../lib/solana-app/runtime.ts';
import { createDeviceKey, createMemoryDeviceKeyStore, deviceKeySigner } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } from '../lib/solana/recovery-kit.ts';

/*
 * Account setup, end to end, offline: a signed-in member makes a device key
 * and a recovery kit in "the browser" (real WebCrypto + BIP39 here), proves
 * both to the server, and the organisation's autonomous vault is created by
 * the chain simulator and recorded with the device. The server only ever sees
 * public keys and signatures over its own nonces.
 */

afterEach(() => {
  resetSetupChallengesForTesting();
  resetRuntime();
});

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
  await db.insert(schema.organizations).values({ id: 'acme', name: 'Acme Sdn Bhd' });
  return { client, db };
}

async function member(db, email, role) {
  await linkVerifiedIdentity(db, { email });
  await grantMembership(db, { email, orgId: 'acme', role });
  return { userId: `op_${email}`, orgId: 'acme', isOwner: role === 'admin' };
}

/** What the setup page does in the browser: make both keys, ask for nonces, sign them. */
async function browserKeys() {
  const store = createMemoryDeviceKeyStore();
  await createDeviceKey(store, 'k');
  const device = await deviceKeySigner(store, 'k');
  const kit = deriveRecoveryKey(generateRecoveryWords());
  return {
    device: { publicKey: device.publicKey.toBase58(), sign: (m) => device.signMessage(m) },
    kit: { publicKey: kit.publicKey, sign: (m) => kit.sign(m) },
  };
}

async function prove(who, keys, roles = ['device', 'kit']) {
  const challenges = issueSetupChallenges(who, roles.map((role) => ({ role, publicKey: keys[role].publicKey })));
  return Promise.all(
    challenges.map(async (c) => ({ role: c.role, publicKey: c.publicKey, nonce: c.nonce, signature: await signPossessionChallenge(keys[c.role], c) })),
  );
}

test('owner: device + kit proven, vault created autonomous, device and vault recorded together', async () => {
  const { client, db } = await migratedDb();
  const owner = await member(db, 'ops@acme.com', 'admin');
  const keys = await browserKeys();

  const result = await completeSetup(db, owner, await prove(owner, keys));

  assert.equal(result.outcome, 'created');
  assert.equal(result.devicePublicKey, keys.device.publicKey);
  assert.equal(result.vault.simulated, true, 'offline: the simulator, labelled (I-7)');
  assert.equal(result.vault.threshold, 1);
  assert.deepEqual(result.vault.members.map((m) => m.publicKey).sort(), [keys.device.publicKey, keys.kit.publicKey].sort());

  const status = await readSetupStatus(db, 'ops@acme.com');
  assert.equal(status.state, 'ready');
  const [row] = await db.select().from(schema.orgVaults);
  assert.equal(row.configAuthorityNull, true, 'I-1 recorded');
  await client.close();
});

test('a proof is single-use: replaying it is refused and nothing more is written', async () => {
  const { client, db } = await migratedDb();
  const owner = await member(db, 'ops@acme.com', 'admin');
  const proofs = await prove(owner, await browserKeys());
  await completeSetup(db, owner, proofs);
  await assert.rejects(completeSetup(db, owner, proofs), (e) => e.code === 'possession_failed');
  await client.close();
});

test('a proof issued to one member cannot be spent by another', async () => {
  const { client, db } = await migratedDb();
  const owner = await member(db, 'ops@acme.com', 'admin');
  const other = await member(db, 'cfo@acme.com', 'admin');
  const proofs = await prove(owner, await browserKeys());
  await assert.rejects(completeSetup(db, other, proofs), (e) => e.code === 'possession_failed');
  assert.equal((await readSetupStatus(db, 'cfo@acme.com')).state, 'no_device');
  await client.close();
});

test('a signature over the wrong nonce, or by another key, is refused and nothing is saved', async () => {
  const { client, db } = await migratedDb();
  const owner = await member(db, 'ops@acme.com', 'admin');
  const keys = await browserKeys();
  const intruder = await browserKeys();
  const challenges = issueSetupChallenges(owner, [{ role: 'device', publicKey: keys.device.publicKey }, { role: 'kit', publicKey: keys.kit.publicKey }]);
  const proofs = await Promise.all(challenges.map(async (c) => ({
    role: c.role,
    publicKey: c.publicKey,
    nonce: c.nonce,
    // Signed by a key the browser does not hold for this public key.
    signature: await signPossessionChallenge(intruder[c.role], c),
  })));
  await assert.rejects(completeSetup(db, owner, proofs), (e) => e.code === 'possession_failed');
  assert.equal((await readSetupStatus(db, 'ops@acme.com')).state, 'no_device');
  assert.equal((await db.select().from(schema.orgVaults)).length, 0);
  await client.close();
});

test('a non-owner cannot create the vault, and nothing is recorded for them', async () => {
  const { client, db } = await migratedDb();
  const checker = await member(db, 'ap@acme.com', 'checker');
  await assert.rejects(completeSetup(db, checker, await prove(checker, await browserKeys())), (e) => e.code === 'not_authorized');
  assert.equal((await readSetupStatus(db, 'ap@acme.com')).state, 'no_device');
  assert.equal((await db.select().from(schema.orgVaults)).length, 0);
  await client.close();
});

test('joining an existing vault records the device, which can sign nothing until the vault adds it', async () => {
  const { client, db } = await migratedDb();
  const owner = await member(db, 'ops@acme.com', 'admin');
  await completeSetup(db, owner, await prove(owner, await browserKeys()));

  const checker = await member(db, 'ap@acme.com', 'checker');
  const keys = await browserKeys();
  const joined = await completeSetup(db, checker, await prove(checker, keys, ['device']));

  assert.equal(joined.outcome, 'joined');
  const status = await readSetupStatus(db, 'ap@acme.com');
  assert.equal(status.state, 'device_not_in_vault', 'registered, not a vault member: not ready');
  assert.equal(status.vault.members.some((m) => m.publicKey === keys.device.publicKey), false);
  await client.close();
});

test('the device key and the recovery kit must be different keys', async () => {
  const { client, db } = await migratedDb();
  const owner = await member(db, 'ops@acme.com', 'admin');
  const keys = await browserKeys();
  const same = { device: keys.device, kit: keys.device };
  await assert.rejects(completeSetup(db, owner, await prove(owner, same)), (e) => e.code === 'bad_request');
  assert.equal((await readSetupStatus(db, 'ops@acme.com')).state, 'no_device');
  await client.close();
});

test('a member already set up cannot register a second device here', async () => {
  const { client, db } = await migratedDb();
  const owner = await member(db, 'ops@acme.com', 'admin');
  await completeSetup(db, owner, await prove(owner, await browserKeys()));
  await assert.rejects(completeSetup(db, owner, await prove(owner, await browserKeys())), (e) => e.code === 'device_exists');
  await client.close();
});
