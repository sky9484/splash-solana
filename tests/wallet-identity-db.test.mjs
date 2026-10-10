import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';

import * as schema from '../lib/db/schema.ts';
import {
  ensureUserForIdentity,
  findWalletIdentityByAddress,
  listOrgWalletIdentities,
  upsertWalletIdentity,
} from '../lib/db/wallet-identities.ts';

/**
 * wallet_identities persistence (wallet spec §2.3) against real migrations.
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

const GOOGLE = 'https://accounts.google.com';
const AUD = 'splash-test-client';

function identity(overrides = {}) {
  return {
    userId: 'op_ceo@acme.com',
    orgId: 'org_acme',
    suiAddress: '0xceo',
    oauthIss: GOOGLE,
    oauthSub: 'google-sub-ceo',
    oauthAud: AUD,
    emailAtLogin: 'ceo@acme.com',
    ...overrides,
  };
}

test('§2.3 an identity is created once and repeat logins converge on the same row', async () => {
  const { client, db } = await migratedDb();
  await ensureUserForIdentity(db, { userId: 'op_ceo@acme.com', orgId: 'org_acme', email: 'ceo@acme.com' });

  const first = await upsertWalletIdentity(db, identity());
  assert.equal(first.created, true);

  const second = await upsertWalletIdentity(db, identity());
  assert.equal(second.created, false, 'a repeat login must not create a second identity');
  assert.equal(second.id, first.id);

  const rows = await listOrgWalletIdentities(db, 'org_acme');
  assert.equal(rows.length, 1);
  await client.close();
});

test('§2.1 two humans in the SAME org get distinct addresses and distinct rows', async () => {
  const { client, db } = await migratedDb();
  for (const [userId, email] of [['op_ceo@acme.com', 'ceo@acme.com'], ['op_fin@acme.com', 'controller@acme.com']]) {
    await ensureUserForIdentity(db, { userId, orgId: 'org_acme', email });
  }

  await upsertWalletIdentity(db, identity());
  await upsertWalletIdentity(db, identity({
    userId: 'op_fin@acme.com',
    suiAddress: '0xcontroller',
    oauthSub: 'google-sub-controller',
    emailAtLogin: 'controller@acme.com',
  }));

  const rows = await listOrgWalletIdentities(db, 'org_acme');
  assert.equal(rows.length, 2, 'one org, many signers — this is what gives maker-checker per-human attribution');
  assert.notEqual(rows[0].suiAddress, rows[1].suiAddress);
  await client.close();
});

test('§2.3 a changed address for the same identity is REFUSED, not silently rebound', async () => {
  const { client, db } = await migratedDb();
  await ensureUserForIdentity(db, { userId: 'op_ceo@acme.com', orgId: 'org_acme', email: 'ceo@acme.com' });
  await upsertWalletIdentity(db, identity());

  await assert.rejects(
    () => upsertWalletIdentity(db, identity({ suiAddress: '0xsomethingelse' })),
    /address for this identity changed/i,
    'a salt or derivation change must surface, not overwrite the signer',
  );
  await client.close();
});

test('§2.2 the same subject from a DIFFERENT OAuth client is a separate identity', async () => {
  const { client, db } = await migratedDb();
  await ensureUserForIdentity(db, { userId: 'op_ceo@acme.com', orgId: 'org_acme', email: 'ceo@acme.com' });
  await upsertWalletIdentity(db, identity());

  // Same iss+sub, different aud (a token minted for another app / environment).
  const other = await upsertWalletIdentity(db, identity({ oauthAud: 'some-other-app', suiAddress: '0xotherapp' }));
  assert.equal(other.created, true, 'aud is part of the identity key — this is the cross-app guard');

  const rows = await listOrgWalletIdentities(db, 'org_acme');
  assert.equal(rows.length, 2);
  await client.close();
});

test('§2.3 a signer address resolves back to its human', async () => {
  const { client, db } = await migratedDb();
  await ensureUserForIdentity(db, { userId: 'op_ceo@acme.com', orgId: 'org_acme', email: 'ceo@acme.com' });
  await upsertWalletIdentity(db, identity());

  const found = await findWalletIdentityByAddress(db, '0xceo');
  assert.ok(found);
  assert.equal(found.userId, 'op_ceo@acme.com');
  assert.equal(found.emailAtLogin, 'ceo@acme.com');
  assert.equal(await findWalletIdentityByAddress(db, '0xunknown'), null);
  await client.close();
});

test('§3 organizations carry the KYB lifecycle and the on-chain account id', async () => {
  const { client, db } = await migratedDb();
  await db.insert(schema.organizations).values({ id: 'org_acme', name: 'Acme' });

  const [row] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, 'org_acme'));
  assert.equal(row.kybLifecycle, 'REGISTERED', 'a new org starts un-verified, not active');
  assert.equal(row.suiBusinessAccountId, null);

  await db.update(schema.organizations)
    .set({ kybLifecycle: 'ACTIVE', kybStatus: 'full', suiBusinessAccountId: '0xbiz' })
    .where(eq(schema.organizations.id, 'org_acme'));

  const [updated] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, 'org_acme'));
  assert.equal(updated.kybLifecycle, 'ACTIVE');
  assert.equal(updated.suiBusinessAccountId, '0xbiz');
  await client.close();
});
