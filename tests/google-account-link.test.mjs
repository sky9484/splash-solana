import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '../lib/db/schema.ts';
import {
  createAccount,
  linkVerifiedIdentity,
  sessionCredentialIsCurrent,
  verifyAccountPassword,
} from '../lib/auth/accounts.ts';
import { UnauthorizedError, resolveAuthorityFromDb } from '../lib/auth/authority.ts';

/*
 * "Continue with Google" links by VERIFIED email only, and Google's proof of
 * the mailbox is treated like opening a delivered verification link.
 *
 * The case this file exists for is the pre-account hijack: an attacker signs
 * up first with the victim's address and a password of their choosing, the
 * account sits unverified, the real owner later signs in with Google. If the
 * attacker's password survived that, it would now open a verified account.
 */

const VICTIM = 'cfo@victim.example';
const ATTACKER_PASSWORD = 'attacker-chose-this-one-7';

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

async function userRow(db, email) {
  const rows = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  return rows[0] ?? null;
}

test('no account: creates one, verified, with no password and no membership', async () => {
  const { client, db } = await migratedDb();
  const now = new Date('2026-10-12T09:00:00Z');
  const linked = await linkVerifiedIdentity(db, { email: 'New.Person@Example.com', name: 'New Person', now });

  assert.equal(linked.outcome, 'created');
  assert.equal(linked.email, 'new.person@example.com');
  const row = await userRow(db, 'new.person@example.com');
  assert.equal(row.passwordHash, null, 'a Google-only account has no password');
  assert.equal(row.emailVerifiedAt.toISOString(), now.toISOString());
  await assert.rejects(resolveAuthorityFromDb(db, 'new.person@example.com'), UnauthorizedError, 'signing in grants no authority');
  await client.close();
});

test('pre-account hijack: the attacker password dies when the owner proves the mailbox with Google', async () => {
  const { client, db } = await migratedDb();
  await createAccount(db, { email: VICTIM, password: ATTACKER_PASSWORD });
  assert.ok(await verifyAccountPassword(db, { email: VICTIM, password: ATTACKER_PASSWORD }), 'precondition: the planted password works');
  const attackerSession = { email: VICTIM, credentialVersion: 1 };
  assert.equal(await sessionCredentialIsCurrent(db, attackerSession), true);

  const linked = await linkVerifiedIdentity(db, { email: VICTIM });

  assert.equal(linked.outcome, 'claimed');
  assert.equal(linked.credentialVersion, 2);
  const row = await userRow(db, VICTIM);
  assert.equal(row.passwordHash, null, 'the unproven password is discarded');
  assert.ok(row.emailVerifiedAt);
  assert.equal(await verifyAccountPassword(db, { email: VICTIM, password: ATTACKER_PASSWORD }), null, 'the attacker can no longer log in');
  assert.equal(await sessionCredentialIsCurrent(db, attackerSession), false, 'the attacker session minted before the proof is dead');
  await client.close();
});

test('verified account: links to it and changes nothing', async () => {
  const { client, db } = await migratedDb();
  await linkVerifiedIdentity(db, { email: VICTIM });
  const before = await userRow(db, VICTIM);
  const linked = await linkVerifiedIdentity(db, { email: VICTIM, now: new Date('2030-01-01T00:00:00Z') });
  const after = await userRow(db, VICTIM);

  assert.equal(linked.outcome, 'existing');
  assert.equal(after.credentialVersion, before.credentialVersion);
  assert.equal(after.emailVerifiedAt.toISOString(), before.emailVerifiedAt.toISOString(), 'the first proof time is kept');
  await client.close();
});
