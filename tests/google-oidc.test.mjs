import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';

import {
  GoogleOidcError,
  assertStateMatches,
  beginGoogleSignIn,
  clearGoogleJwksForTesting,
  exchangeCodeForIdToken,
  openFlowState,
  pkceChallenge,
  primeGoogleJwksForTesting,
  readGoogleOidcConfig,
  safeReturnTo,
  sealFlowState,
  verifyGoogleIdToken,
} from '../lib/auth/google-oidc.ts';

/*
 * "Continue with Google" must refuse every token that is not, provably, a
 * fresh Google token for THIS app and THIS sign-in attempt, with a verified
 * mailbox. Google's signing key is stood in for by a local RSA key served
 * through the JWKS test seam; nothing here touches the network.
 */

const CLIENT_ID = 'splash-test.apps.googleusercontent.com';
const NOW = new Date('2026-10-12T10:00:00Z');
const NOW_S = Math.floor(NOW.getTime() / 1000);

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-kid', alg: 'RS256', use: 'sig' };
const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function signJwt(claims, { header = { alg: 'RS256', kid: 'test-kid', typ: 'JWT' }, key = privateKey } = {}) {
  const input = `${b64(header)}.${b64(claims)}`;
  const signature = createSign('RSA-SHA256').update(input).sign(key).toString('base64url');
  return `${input}.${signature}`;
}

const goodClaims = (over = {}) => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  sub: '1098765432101234567890',
  email: 'Finance@Example.com',
  email_verified: true,
  name: 'Aisha Rahman',
  nonce: 'nonce-from-this-browser',
  iat: NOW_S - 30,
  exp: NOW_S + 3600,
  ...over,
});

const verify = (idToken, over = {}) =>
  verifyGoogleIdToken({ idToken, clientId: CLIENT_ID, expectedNonce: 'nonce-from-this-browser', now: NOW, ...over });

async function rejects(promise, code) {
  await assert.rejects(promise, (error) => error instanceof GoogleOidcError && error.code === code);
}

beforeEach(() => primeGoogleJwksForTesting([jwk]));
afterEach(() => clearGoogleJwksForTesting());

test('a fresh Google token for this app and this attempt verifies, email lower-cased', async () => {
  const claims = await verify(signJwt(goodClaims()));
  assert.equal(claims.email, 'finance@example.com');
  assert.equal(claims.emailVerified, true);
  assert.equal(claims.sub, '1098765432101234567890');
});

test('nonce: a token from another sign-in attempt is refused', async () => {
  await rejects(verify(signJwt(goodClaims({ nonce: 'someone-elses-nonce' }))), 'bad_nonce');
});

test('nonce: a token with no nonce is refused', async () => {
  const { nonce: _omit, ...claims } = goodClaims();
  await rejects(verify(signJwt(claims)), 'bad_nonce');
});

test('nonce: the server refuses to verify without an expected nonce at all', async () => {
  await rejects(verify(signJwt(goodClaims()), { expectedNonce: '' }), 'bad_nonce');
});

test('aud: a valid Google token minted for another app is refused', async () => {
  await rejects(verify(signJwt(goodClaims({ aud: 'another-app.apps.googleusercontent.com' }))), 'bad_audience');
});

test('aud: an array audience is not accepted as a string', async () => {
  await rejects(verify(signJwt(goodClaims({ aud: [CLIENT_ID] }))), 'missing_claim');
});

test('iss: a token from anyone but Google is refused', async () => {
  await rejects(verify(signJwt(goodClaims({ iss: 'https://evil.example' }))), 'bad_issuer');
});

test('exp / iat: expired and future-dated tokens are refused', async () => {
  await rejects(verify(signJwt(goodClaims({ exp: NOW_S - 120 }))), 'expired');
  await rejects(verify(signJwt(goodClaims({ iat: NOW_S + 600 }))), 'not_yet_valid');
});

test('email_verified: absent, false and the string "true" all refuse', async () => {
  const { email_verified: _omit, ...absent } = goodClaims();
  await rejects(verify(signJwt(absent)), 'email_unverified');
  await rejects(verify(signJwt(goodClaims({ email_verified: false }))), 'email_unverified');
  await rejects(verify(signJwt(goodClaims({ email_verified: 'true' }))), 'email_unverified');
});

test('signature: a token signed by another key, or tampered after signing, is refused', async () => {
  await rejects(verify(signJwt(goodClaims(), { key: otherKey })), 'bad_signature');
  const [h, , s] = signJwt(goodClaims()).split('.');
  await rejects(verify(`${h}.${b64(goodClaims({ email: 'ceo@example.com' }))}.${s}`), 'bad_signature');
});

test('alg: none and HS256 are refused before any key is consulted', async () => {
  await rejects(verify(signJwt(goodClaims(), { header: { alg: 'none', kid: 'test-kid' } })), 'bad_algorithm');
  await rejects(verify(signJwt(goodClaims(), { header: { alg: 'HS256', kid: 'test-kid' } })), 'bad_algorithm');
});

test('malformed tokens are refused', async () => {
  await rejects(verify('a.b'), 'malformed_token');
  await rejects(verify('a.b.c.d'), 'malformed_token');
  await rejects(verify(`${b64({ alg: 'RS256' })}=.${b64(goodClaims())}.sig`), 'malformed_token');
});

test('flow cookie: round-trips, refuses tampering, a wrong secret, and old attempts', () => {
  const config = { clientId: CLIENT_ID, clientSecret: 's', redirectUri: 'https://app.example/api/auth/google/callback' };
  const { flow, authorizeUrl } = beginGoogleSignIn(config, { returnTo: '/dashboard/setup', now: NOW });
  const url = new URL(authorizeUrl);
  assert.equal(url.searchParams.get('code_challenge'), pkceChallenge(flow.codeVerifier));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('nonce'), flow.nonce);
  assert.equal(url.searchParams.get('state'), flow.state);
  assert.equal(url.toString().includes(flow.codeVerifier), false, 'the PKCE verifier never goes in a URL');

  const secret = 'x'.repeat(64);
  const sealed = sealFlowState(flow, secret);
  assert.deepEqual(openFlowState(sealed, secret, NOW), flow);

  const [body, mac] = sealed.split('.');
  const forged = Buffer.from(JSON.stringify({ ...flow, nonce: 'attacker' })).toString('base64url');
  assert.throws(() => openFlowState(`${forged}.${mac}`, secret, NOW), (e) => e.code === 'bad_flow');
  assert.throws(() => openFlowState(`${body}.${mac}`, 'y'.repeat(64), NOW), (e) => e.code === 'bad_flow');
  assert.throws(() => openFlowState(sealed, secret, new Date(NOW.getTime() + 11 * 60_000)), (e) => e.code === 'flow_expired');
  assert.throws(() => openFlowState(undefined, secret, NOW), (e) => e.code === 'no_flow');

  assertStateMatches(flow, flow.state);
  assert.throws(() => assertStateMatches(flow, 'other'), (e) => e.code === 'bad_state');
  assert.throws(() => assertStateMatches(flow, null), (e) => e.code === 'bad_state');
});

test('returnTo: only same-origin paths survive', () => {
  assert.equal(safeReturnTo('/dashboard/transfer'), '/dashboard/transfer');
  for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'dashboard', 42, undefined]) {
    assert.equal(safeReturnTo(bad), '/dashboard');
  }
});

test('config: off unless the flag and all three values are set', () => {
  const full = { FEATURE_GOOGLE_SIGNIN: 'true', GOOGLE_OIDC_CLIENT_ID: 'a', GOOGLE_OIDC_CLIENT_SECRET: 'b', GOOGLE_OIDC_REDIRECT_URI: 'https://x/cb' };
  assert.ok(readGoogleOidcConfig(full));
  assert.equal(readGoogleOidcConfig({ ...full, FEATURE_GOOGLE_SIGNIN: 'false' }), null);
  assert.equal(readGoogleOidcConfig({ ...full, GOOGLE_OIDC_CLIENT_SECRET: '' }), null);
});

test('code exchange sends the PKCE verifier and refuses a response with no id_token', async () => {
  const config = { clientId: CLIENT_ID, clientSecret: 'secret', redirectUri: 'https://app.example/cb' };
  let sent;
  const ok = async (_url, init) => {
    sent = new URLSearchParams(init.body);
    return new Response(JSON.stringify({ id_token: 'h.p.s' }), { status: 200 });
  };
  assert.equal(await exchangeCodeForIdToken(config, { code: 'c', codeVerifier: 'v' }, ok), 'h.p.s');
  assert.equal(sent.get('code_verifier'), 'v');
  assert.equal(sent.get('grant_type'), 'authorization_code');

  const empty = async () => new Response(JSON.stringify({}), { status: 200 });
  await rejects(exchangeCodeForIdToken(config, { code: 'c', codeVerifier: 'v' }, empty), 'code_exchange_failed');
  const denied = async () => new Response('no', { status: 400 });
  await rejects(exchangeCodeForIdToken(config, { code: 'c', codeVerifier: 'v' }, denied), 'code_exchange_failed');
});
