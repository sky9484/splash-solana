import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { challengeFor, parseAssertion, spkiToCompressedP256, verifyAssertion } from '../lib/auth/webauthn.ts';

/**
 * The passkey is a sign-in and step-up factor (prompt 07 §3.2), checked with
 * plain WebAuthn and node:crypto. These tests play the authenticator with a
 * real P-256 key, so every check in verifyAssertion is exercised against bytes
 * shaped exactly as a browser produces them.
 */

const RP_ID = 'localhost';
const CREDENTIAL_ID = Buffer.from('credential-one').toString('base64url');
const MESSAGE = new TextEncoder().encode('splash:approve:v1:intent-42:hash-abc');

function authenticator() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return { privateKey, compressed: spkiToCompressedP256(spki) };
}

/** What navigator.credentials.get() returns, serialized as webauthn-client.ts sends it. */
function assertionFor(key, overrides = {}) {
  const {
    message = MESSAGE,
    type = 'webauthn.get',
    origin = `http://${RP_ID}:3000`,
    rpId = RP_ID,
    flags = 0x05, // user present + user verified
    credentialId = CREDENTIAL_ID,
  } = overrides;
  const clientDataJSON = Buffer.from(JSON.stringify({
    type,
    challenge: challengeFor(message).toString('base64url'),
    origin,
    crossOrigin: false,
  }));
  const authenticatorData = Buffer.concat([
    createHash('sha256').update(rpId).digest(),
    Buffer.from([flags]),
    Buffer.from([0, 0, 0, 1]), // sign count
  ]);
  const signed = Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]);
  const signature = sign('sha256', signed, key.privateKey); // DER, as authenticators emit
  return {
    credentialId,
    authenticatorData: authenticatorData.toString('base64url'),
    clientDataJSON: clientDataJSON.toString('base64url'),
    signature: signature.toString('base64url'),
  };
}

const enrolled = (key) => ({ credentialId: CREDENTIAL_ID, publicKey: key.compressed, rpId: RP_ID });
const check = (key, assertion, message = MESSAGE) =>
  verifyAssertion({ assertion, enrolled: enrolled(key), challenge: challengeFor(message) });

test('an assertion from the enrolled passkey over this exact message verifies', () => {
  const key = authenticator();
  assert.deepEqual(check(key, assertionFor(key)), { ok: true });
});

test('the stored form is a 33-byte compressed point, the same bytes the earlier build stored', () => {
  const key = authenticator();
  const bytes = Buffer.from(key.compressed, 'base64');
  assert.equal(bytes.length, 33);
  assert.ok(bytes[0] === 0x02 || bytes[0] === 0x03);
});

test('a signature over a different message is refused: the challenge binds the approval', () => {
  const key = authenticator();
  const other = new TextEncoder().encode('splash:approve:v1:intent-42:hash-EDITED');
  const result = check(key, assertionFor(key, { message: other }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /different challenge/);
});

test('a different passkey, even a valid one, is refused', () => {
  const enrolledKey = authenticator();
  const intruder = authenticator();
  const result = check(enrolledKey, assertionFor(intruder));
  assert.equal(result.ok, false);
  assert.match(result.reason, /does not match the enrolled passkey/);
});

test('an assertion naming another credential id is refused before any crypto runs', () => {
  const key = authenticator();
  const result = check(key, assertionFor(key, { credentialId: 'someone-else' }));
  assert.deepEqual(result, { ok: false, reason: 'not the enrolled passkey' });
});

test('a registration response is not an assertion', () => {
  const key = authenticator();
  const result = check(key, assertionFor(key, { type: 'webauthn.create' }));
  assert.deepEqual(result, { ok: false, reason: 'not an assertion' });
});

test('an assertion made on another site is refused, by origin and by rpIdHash', () => {
  const key = authenticator();
  const byOrigin = check(key, assertionFor(key, { origin: 'https://evil.example' }));
  assert.equal(byOrigin.ok, false);
  assert.match(byOrigin.reason, /another site/);

  const byRpHash = check(key, assertionFor(key, { rpId: 'evil.example' }));
  assert.equal(byRpHash.ok, false);
  assert.match(byRpHash.reason, /authenticator data is for another site/);
});

test('user presence and user verification are both required', () => {
  const key = authenticator();
  assert.match(check(key, assertionFor(key, { flags: 0x04 })).reason, /not present/);
  assert.match(check(key, assertionFor(key, { flags: 0x01 })).reason, /not verified/);
});

test('a tampered signature or truncated authenticator data fails closed, without throwing', () => {
  const key = authenticator();
  const good = assertionFor(key);
  const sig = Buffer.from(good.signature, 'base64url');
  sig[sig.length - 1] ^= 0xff;
  assert.equal(check(key, { ...good, signature: sig.toString('base64url') }).ok, false);
  assert.equal(check(key, { ...good, authenticatorData: Buffer.alloc(10).toString('base64url') }).ok, false);
  assert.equal(check(key, { ...good, clientDataJSON: Buffer.from('not json').toString('base64url') }).ok, false);
});

test('a stored key that is not a compressed point fails closed', () => {
  const key = authenticator();
  const result = verifyAssertion({
    assertion: assertionFor(key),
    enrolled: { credentialId: CREDENTIAL_ID, publicKey: Buffer.alloc(65, 4).toString('base64'), rpId: RP_ID },
    challenge: challengeFor(MESSAGE),
  });
  assert.equal(result.ok, false);
});

test('the wire form round-trips, and anything incomplete parses to null', () => {
  const key = authenticator();
  const assertion = assertionFor(key);
  const wire = Buffer.from(JSON.stringify(assertion)).toString('base64url');
  assert.deepEqual(parseAssertion(wire), assertion);
  assert.equal(parseAssertion(Buffer.from(JSON.stringify({ ...assertion, signature: '' })).toString('base64url')), null);
  assert.equal(parseAssertion('%%%'), null);
});

test('verification uses the ENROLLED key, never one the request supplies', async () => {
  const source = await readFile(new URL('../lib/server/step-up.ts', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('export function enrolledPasskeyVerifier'));
  assert.match(block, /findCredential\(d, \{ userId, rpId: relyingPartyId\(\) \}\)/);
  assert.match(block, /enrolled: credential/);
  assert.doesNotMatch(block, /publicKey:/, 'a caller must not be able to bring its own key');
});

test('the server side of WebAuthn uses node:crypto only, no chain SDK', async () => {
  const source = await readFile(new URL('../lib/auth/webauthn.ts', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(imports, ['node:crypto']);
});
