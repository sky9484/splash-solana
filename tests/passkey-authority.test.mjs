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
  PASSKEY_FLAG,
  PasskeyError,
  assertCompressedP256,
  enrolPasskey,
  findCredential,
  relyingPartyId,
  revokePasskey,
  suiAddressForPasskey,
  verifyApprovalSignature,
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
  const { credential } = await accountWithPasskey(db, 'approver@example.com');

  const row = (await db.select().from(schema.passkeyCredentials))[0];
  assert.equal(row.publicKey, KEY_A, 'the key must be persisted verbatim');
  assert.equal(row.suiAddress, credential.suiAddress);
  assert.match(row.suiAddress, /^0x[0-9a-f]{64}$/);

  // The address is stored, not recomputed per request: an approval is checked
  // against a value we committed to at enrolment.
  assert.equal(await suiAddressForPasskey(row.publicKey), row.suiAddress);
  await client.close();
});

test('a different key gives a different address, so a signer is identifiable', async () => {
  assert.notEqual(await suiAddressForPasskey(KEY_A), await suiAddressForPasskey(KEY_B));
});

test('only a 33-byte compressed point is accepted', async () => {
  assert.equal(COMPRESSED_P256_BYTES, 33);
  assert.equal(PASSKEY_FLAG, 0x06);
  assert.doesNotThrow(() => assertCompressedP256(KEY_A));

  // An uncompressed 0x04 point is the common mistake: right length family,
  // wrong encoding, and it would derive a different address silently.
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
  assert.notEqual(prod.suiAddress, (await findCredential(db, { userId: account.userId, rpId: 'localhost' })).suiAddress);

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

/* ── Verification: the three things that must hold ─────────────────────── */

const baseVerify = (overrides = {}) => ({
  credential: { id: 'pk_1', userId: 'u', credentialId: 'c', publicKey: KEY_A, suiAddress: '0x' + 'ab'.repeat(32), rpId: 'localhost' },
  transactionBytes: Buffer.from('tx-bytes').toString('base64'),
  signature: Buffer.from('sig').toString('base64'),
  sender: '0x' + 'ab'.repeat(32),
  presentedCanonHash: 'hash-1',
  currentCanonHash: 'hash-1',
  ...overrides,
});

test('a canon hash that moved since signing is refused, before any crypto runs', async () => {
  // Dynamic linking, PSD2 RTS Art. 5: the signature covers bytes that name the
  // intent, and the intent carries the amount and payee. Edit the payment and
  // the hash moves, so the signature no longer describes what it approved.
  const result = await verifyApprovalSignature(baseVerify({ currentCanonHash: 'hash-2' }));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'canon_changed');
});

test('a sender that is not the enrolled address is refused', async () => {
  const result = await verifyApprovalSignature(baseVerify({ sender: '0x' + 'cd'.repeat(32) }));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'sender_mismatch');
});

test('the sender check is case-insensitive, since hex casing is not identity', async () => {
  const upper = ('0x' + 'ab'.repeat(32)).toUpperCase().replace('0X', '0x');
  const result = await verifyApprovalSignature(baseVerify({ sender: upper }));
  // Not a sender mismatch — it fails later, on the signature, which is the
  // point: casing must not be what rejects a valid approver.
  assert.equal(result.ok, false);
  assert.notEqual(result.code, 'sender_mismatch');
});

test('a signature that does not verify is refused, and a broken one does not throw', async () => {
  const result = await verifyApprovalSignature(baseVerify());
  assert.equal(result.ok, false);
  assert.ok(['bad_signature', 'verification_error'].includes(result.code), `unexpected code ${result.code}`);
});

test('verification uses the ENROLLED key, never one the request supplies', async () => {
  const source = code(await readFile(new URL('../lib/auth/passkey.ts', import.meta.url), 'utf8'));
  // The only public key that reaches PasskeyPublicKey is credential.publicKey.
  assert.match(source, /new PasskeyPublicKey\(assertCompressedP256\(input\.credential\.publicKey\)\)/);
  const verifyBlock = source.slice(source.indexOf('export async function verifyApprovalSignature'));
  assert.doesNotMatch(verifyBlock, /input\.publicKey/, 'a caller must not be able to bring its own key');
});

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
  // Phase 6 builds the Move entry point. Until it exists, a button that signs
  // something nothing can verify on chain would be theatre.
  for (const source of [page, widget]) {
    assert.doesNotMatch(source, /\bapprove\s*\(|approveIntent|signAndExecute/);
  }
  assert.match(widget, /authenticatorAttachment: 'platform'/);
  assert.match(widget, /userVerification: 'required'/);
});
