import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '../lib/db/schema.ts';
import { createAccount } from '../lib/auth/accounts.ts';
import { UnauthorizedError, resolveAuthorityFromDb } from '../lib/auth/authority.ts';
import {
  COMPRESSED_P256_BYTES,
  PasskeyError,
  assertCompressedP256,
  enrolPasskey,
  findCredential,
  relyingPartyId,
  revokePasskey,
} from '../lib/auth/passkey.ts';

function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

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

/** A syntactically valid compressed secp256r1 point. */
const KEY_A = Buffer.concat([Buffer.from([0x02]), Buffer.alloc(32, 0xa1)]).toString('base64');
const KEY_B = Buffer.concat([Buffer.from([0x03]), Buffer.alloc(32, 0xb2)]).toString('base64');
const PASSWORD = 'correct-horse-battery-staple-9';

async function accountWithPasskey(db, email, key = KEY_A, rpId = 'localhost') {
  const account = await createAccount(db, { email, password: PASSWORD });
  const credential = await enrolPasskey(db, {
    userId: account.userId,
    credentialId: `cred-${email}`,
    publicKey: key,
    rpId,
  });
  return { account, credential };
}

/* ── The public key is the whole design ────────────────────────────────── */

test('the public key is stored at enrolment, because it is never offered again', async () => {
  const { client, db } = await migratedDb();
  await accountWithPasskey(db, 'approver@example.com');

  const row = (await db.select().from(schema.passkeyCredentials))[0];
  assert.equal(row.publicKey, KEY_A, 'the key must be persisted verbatim');
  // A passkey is a sign-in factor on the Solana build: it derives no chain address.
  assert.equal(row.suiAddress, null);
  await client.close();
});

test('only a 33-byte compressed point is accepted', async () => {
  assert.equal(COMPRESSED_P256_BYTES, 33);
  assert.doesNotThrow(() => assertCompressedP256(KEY_A));

  // An uncompressed 0x04 point is the common mistake: right family, wrong encoding.
  const uncompressed = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(32, 1)]).toString('base64');
  assert.throws(() => assertCompressedP256(uncompressed), /compressed point/);
  assert.throws(() => assertCompressedP256(Buffer.alloc(32).toString('base64')), /33 bytes/);
  assert.throws(() => assertCompressedP256(Buffer.alloc(65).toString('base64')), /33 bytes/);
});

/* ── One credential per origin per user ────────────────────────────────── */

test('a second passkey for the same origin is refused', async () => {
  const { client, db } = await migratedDb();
  const { account } = await accountWithPasskey(db, 'one@example.com');
  await assert.rejects(
    () => enrolPasskey(db, { userId: account.userId, credentialId: 'other', publicKey: KEY_B, rpId: 'localhost' }),
    (error) => {
      assert.ok(error instanceof PasskeyError);
      assert.equal(error.code, 'already_enrolled');
      return true;
    },
  );
  await client.close();
});

test('a passkey on a different origin is a different credential', async () => {
  const { client, db } = await migratedDb();
  const { account } = await accountWithPasskey(db, 'two@example.com', KEY_A, 'localhost');
  const prod = await enrolPasskey(db, {
    userId: account.userId,
    credentialId: 'cred-prod',
    publicKey: KEY_B,
    rpId: 'v1.splashz.xyz',
  });
  assert.notEqual(prod.credentialId, (await findCredential(db, { userId: account.userId, rpId: 'localhost' })).credentialId);

  // And each is only found on its own origin — which is what the browser does
  // too: a credential is scoped to its rpId and is not offered elsewhere.
  assert.equal((await findCredential(db, { userId: account.userId, rpId: 'v1.splashz.xyz' })).credentialId, 'cred-prod');
  await client.close();
});

test('revocation is a tombstone, so an anchored approval keeps its referent', async () => {
  const { client, db } = await migratedDb();
  const { account, credential } = await accountWithPasskey(db, 'gone@example.com');
  await revokePasskey(db, credential.id);

  assert.equal(await findCredential(db, { userId: account.userId, rpId: 'localhost' }), null);
  const rows = await db.select().from(schema.passkeyCredentials);
  assert.equal(rows.length, 1, 'the row survives');
  assert.ok(rows[0].revokedAt instanceof Date);

  // And the origin is free again afterwards.
  await assert.doesNotReject(() =>
    enrolPasskey(db, { userId: account.userId, credentialId: 'fresh', publicKey: KEY_B, rpId: 'localhost' }),
  );
  await client.close();
});

/* Verification is plain WebAuthn: tests/webauthn.test.mjs. */

/* ── rpId is configuration, not a header ───────────────────────────────── */

test('the relying-party id comes from configuration, never the request host', async () => {
  assert.equal(relyingPartyId({ PASSKEY_RP_ID: 'v1.splashz.xyz' }), 'v1.splashz.xyz');
  assert.equal(relyingPartyId({ NEXT_PUBLIC_APP_URL: 'https://v1.splashz.xyz' }), 'v1.splashz.xyz');
  assert.equal(relyingPartyId({}), 'localhost');
  // Deriving it from a Host header would let anyone who can influence that
  // header enrol a credential under an rpId they control.
  const source = code(await readFile(new URL('../lib/auth/passkey.ts', import.meta.url), 'utf8'));
  assert.doesNotMatch(source, /headers\(\)|request\.headers|['"]host['"]/i);
});

/* ── A passkey is how you sign, not permission to act ──────────────────── */

test('enrolling a passkey grants no authority', async () => {
  const { client, db } = await migratedDb();
  const email = 'signer@example.com';
  await accountWithPasskey(db, email);
  // A signer with no membership still authorizes nothing.
  await assert.rejects(() => resolveAuthorityFromDb(db, email), UnauthorizedError);
  await client.close();
});

test('nothing added for passkeys grants a membership', async () => {
  for (const rel of [
    '../lib/auth/passkey.ts',
    '../app/api/auth/passkey/route.ts',
    '../components/auth/PasskeyEnrolment.tsx',
    '../app/settings/security/page.tsx',
  ]) {
    const source = code(await readFile(new URL(rel, import.meta.url), 'utf8'));
    assert.doesNotMatch(source, /grantMembership|memberships/, `${rel} must not grant authority`);
  }
});

test('the enrolment surface never returns the stored public key', async () => {
  const route = code(await readFile(new URL('../app/api/auth/passkey/route.ts', import.meta.url), 'utf8'));
  const getBlock = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function POST'));
  assert.doesNotMatch(getBlock, /publicKey/, 'nothing client-side needs it, and it is what the design depends on keeping');
});

test('the security page enrols a signer and offers no approval control', async () => {
  const page = code(await readFile(new URL('../app/settings/security/page.tsx', import.meta.url), 'utf8'));
  const widget = code(await readFile(new URL('../components/auth/PasskeyEnrolment.tsx', import.meta.url), 'utf8'));
  // The passkey is a sign-in and step-up factor; approving happens on the
  // approval surfaces, which check it there.
  for (const source of [page, widget]) {
    assert.doesNotMatch(source, /\bapprove\s*\(|approveIntent|signAndExecute/);
  }
  const client = code(await readFile(new URL('../lib/auth/webauthn-client.ts', import.meta.url), 'utf8'));
  assert.match(widget, /createPasskey\(/);
  assert.match(client, /authenticatorAttachment: 'platform'/);
  assert.match(client, /userVerification: 'required'/);
});
