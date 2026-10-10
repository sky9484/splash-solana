import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import test from 'node:test';

import { isKilledEntityEmail, emailDomain, killedEntityDomains } from '../lib/auth/killed-entities.ts';
import {
  assertTransition,
  canMoveMoney,
  canTransition,
  coarseKybStatus,
  providerStateForVerdict,
  toKybLifecycleState,
  KybTransitionError,
} from '../lib/compliance/kyb-state.ts';
import {
  createCustomerSessionFromIdentity,
  createCustomerSessionToken,
  readCustomerSessionToken,
} from '../lib/auth/customer-session.ts';
import {
  ZkLoginVerificationError,
  clearJwksCacheForTesting,
  primeJwksCacheForTesting,
  verifyZkLoginJwt,
} from '../lib/auth/zklogin.ts';

/**
 * Wallet / onboarding / custody spec acceptance tests.
 *
 * §2.4 killed-entity denylist · §3 KYB state machine · §4 session widening and
 * server-side zkLogin JWT verification (IACR 2026/227 mitigations).
 */

const SECRET = 'test-secret-'.padEnd(48, 'x');

// ── §2.4 killed-entity denylist ─────────────────────────────────────────────

test('§2.4 denylist blocks the killed entity and its subdomains', () => {
  assert.equal(isKilledEntityEmail('ops@ccacc.io'), true);
  assert.equal(isKilledEntityEmail('OPS@CCACC.IO'), true, 'must be case-insensitive');
  assert.equal(isKilledEntityEmail('ops@pay.ccacc.io'), true, 'subdomains are the same entity');
  assert.equal(isKilledEntityEmail('ops@splash.finance'), false);
  // A lookalike that merely ends with the same letters must NOT match.
  assert.equal(isKilledEntityEmail('ops@notccacc.io'), false);
});

test('§2.4 denylist is extensible by config and tolerates malformed input', () => {
  const env = { KILLED_ENTITY_DOMAINS: 'evil.example, another.test' };
  assert.equal(isKilledEntityEmail('a@evil.example', env), true);
  assert.equal(isKilledEntityEmail('a@another.test', env), true);
  assert.ok(killedEntityDomains(env).has('ccacc.io'), 'built-ins survive config extension');
  // Malformed input is not "killed" — that is the validator's job.
  assert.equal(isKilledEntityEmail('not-an-email'), false);
  assert.equal(isKilledEntityEmail(''), false);
  assert.equal(emailDomain('a@b.com'), 'b.com');
});

// ── §3 KYB state machine ────────────────────────────────────────────────────

test('§3 only ACTIVE unlocks money movement', () => {
  assert.equal(canMoveMoney('ACTIVE'), true);
  for (const state of ['REGISTERED', 'KYB_SUBMITTED', 'KYB_PROVIDER_APPROVED', 'KYB_ADMIN_APPROVED', 'REJECTED', 'SUSPENDED']) {
    assert.equal(canMoveMoney(state), false, `${state} must not move money`);
  }
});

test('§3 the provider can never grant the human sign-off or reach ACTIVE', () => {
  // Sumsub advancing its own verdict is fine...
  assert.doesNotThrow(() => assertTransition('KYB_SUBMITTED', 'KYB_PROVIDER_APPROVED', 'PROVIDER'));
  // ...but it may not sign off, nor activate.
  assert.throws(
    () => assertTransition('KYB_PROVIDER_APPROVED', 'KYB_ADMIN_APPROVED', 'PROVIDER'),
    KybTransitionError,
    'provider must not perform the accountable human approval',
  );
  assert.throws(() => assertTransition('KYB_ADMIN_APPROVED', 'ACTIVE', 'PROVIDER'), KybTransitionError);
});

test('§3 an admin cannot skip the provider verdict', () => {
  // Straight from submitted to admin-approved would bypass the detective control.
  assert.throws(() => assertTransition('KYB_SUBMITTED', 'KYB_ADMIN_APPROVED', 'ADMIN'), KybTransitionError);
  assert.equal(canTransition('KYB_PROVIDER_APPROVED', 'KYB_ADMIN_APPROVED'), true);
  assert.doesNotThrow(() => assertTransition('KYB_PROVIDER_APPROVED', 'KYB_ADMIN_APPROVED', 'ADMIN'));
});

test('§3 registration cannot jump straight to ACTIVE', () => {
  assert.equal(canTransition('REGISTERED', 'ACTIVE'), false);
  assert.throws(() => assertTransition('REGISTERED', 'ACTIVE', 'ADMIN'), KybTransitionError);
});

test('§3 suspend/restore and re-KYB after rejection are legal, activation-from-rejected is not', () => {
  assert.doesNotThrow(() => assertTransition('ACTIVE', 'SUSPENDED', 'ADMIN'));
  assert.doesNotThrow(() => assertTransition('SUSPENDED', 'ACTIVE', 'ADMIN'));
  assert.doesNotThrow(() => assertTransition('REJECTED', 'KYB_SUBMITTED', 'SYSTEM'));
  assert.equal(canTransition('REJECTED', 'ACTIVE'), false);
});

test('§3 verdict mapping and coarse projection stay consistent', () => {
  assert.equal(providerStateForVerdict('CLEAR'), 'KYB_PROVIDER_APPROVED');
  assert.equal(providerStateForVerdict('BLOCK'), 'REJECTED');
  assert.equal(providerStateForVerdict('REVIEW'), null, 'REVIEW is not a decision');
  assert.equal(providerStateForVerdict('ERROR'), null);

  assert.equal(coarseKybStatus('ACTIVE'), 'full');
  assert.equal(coarseKybStatus('REGISTERED'), 'none');
  assert.equal(coarseKybStatus('KYB_PROVIDER_APPROVED'), 'pending');
  assert.equal(coarseKybStatus('REJECTED'), 'rejected');
  // Unknown/absent persisted values fall back to the safest state.
  assert.equal(toKybLifecycleState('nonsense'), 'REGISTERED');
  assert.equal(toKybLifecycleState(undefined), 'REGISTERED');
});

// ── §4 session widening ─────────────────────────────────────────────────────

test('§4 session round-trips userRole/suiAddress/orgId without dropping them', () => {
  const session = createCustomerSessionFromIdentity({
    email: 'ops@splash.finance',
    userRole: 'checker',
    suiAddress: '0xabc',
    orgId: 'demo-business',
  });
  const token = createCustomerSessionToken(session, SECRET);
  const decoded = readCustomerSessionToken(token, SECRET);

  assert.ok(decoded);
  assert.equal(decoded.userRole, 'checker');
  assert.equal(decoded.suiAddress, '0xabc');
  assert.equal(decoded.orgId, 'demo-business');
  // The legacy display field is untouched, so DashboardHeader keeps working.
  assert.equal(decoded.role, 'business_admin');
});

test('§4 a legacy cookie without the new fields still verifies', () => {
  const legacy = createCustomerSessionFromIdentity({ email: 'ops@splash.finance' });
  const decoded = readCustomerSessionToken(createCustomerSessionToken(legacy, SECRET), SECRET);
  assert.ok(decoded, 'pre-existing sessions must not be invalidated by the widening');
  assert.equal(decoded.userRole, undefined);
});

test('§4 a forged userRole is rejected with the signature', () => {
  const session = createCustomerSessionFromIdentity({ email: 'ops@splash.finance', userRole: 'viewer' });
  const token = createCustomerSessionToken(session, SECRET);
  const [payload, mac] = token.split('.');
  const tampered = Buffer.from(
    JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), userRole: 'admin' }),
  ).toString('base64url');
  assert.equal(readCustomerSessionToken(`${tampered}.${mac}`, SECRET), null);
});

test('§2.4 a session for a killed-entity domain stops verifying even if signed', () => {
  // Mint a structurally valid, correctly-signed cookie for a killed domain.
  const session = { ...createCustomerSessionFromIdentity({ email: 'ops@splash.finance' }), email: 'ops@ccacc.io' };
  const token = createCustomerSessionToken(session, SECRET);
  assert.equal(readCustomerSessionToken(token, SECRET), null, 'denylist must apply at session mint, not just signup');
});

// ── §4 / T1 zkLogin JWT verification ────────────────────────────────────────

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
const AUD = 'splash-test-client-id';
const ENV = { ZKLOGIN_GOOGLE_CLIENT_ID: AUD };

function signJwt(payload, { header } = {}) {
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-key', ...header })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signer = createSign('RSA-SHA256');
  signer.update(`${head}.${body}`);
  return `${head}.${body}.${signer.sign(privateKey).toString('base64url')}`;
}

function claims(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: 'https://accounts.google.com',
    sub: 'provider-user-123',
    aud: AUD,
    email: 'ops@splash.finance',
    nonce: 'expected-nonce',
    iat: now - 10,
    exp: now + 3600,
    ...overrides,
  };
}

test.beforeEach(() => {
  clearJwksCacheForTesting();
  primeJwksCacheForTesting('google', [JWK]);
});

test('T1 a well-formed, correctly-audienced token verifies', async () => {
  const verified = await verifyZkLoginJwt({ jwt: signJwt(claims()), provider: 'google', env: ENV });
  assert.equal(verified.sub, 'provider-user-123');
  assert.equal(verified.email, 'ops@splash.finance');
});

test('T1 a token minted for ANOTHER app is refused (cross-app impersonation)', async () => {
  await assert.rejects(
    () => verifyZkLoginJwt({ jwt: signJwt(claims({ aud: 'some-other-app' })), provider: 'google', env: ENV }),
    (error) => error instanceof ZkLoginVerificationError && error.code === 'bad_audience',
  );
});

test('T1 a token from a non-allowlisted issuer is refused', async () => {
  await assert.rejects(
    () => verifyZkLoginJwt({ jwt: signJwt(claims({ iss: 'https://evil.example' })), provider: 'google', env: ENV }),
    (error) => error instanceof ZkLoginVerificationError && error.code === 'bad_issuer',
  );
});

test('T1 an expired token is refused', async () => {
  const now = Math.floor(Date.now() / 1000);
  await assert.rejects(
    () => verifyZkLoginJwt({ jwt: signJwt(claims({ exp: now - 3600, iat: now - 7200 })), provider: 'google', env: ENV }),
    (error) => error instanceof ZkLoginVerificationError && error.code === 'expired',
  );
});

test('T1 a tampered payload fails the signature check', async () => {
  const token = signJwt(claims());
  const [head, , sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify(claims({ email: 'attacker@evil.example' }))).toString('base64url');
  await assert.rejects(
    () => verifyZkLoginJwt({ jwt: `${head}.${forged}.${sig}`, provider: 'google', env: ENV }),
    (error) => error instanceof ZkLoginVerificationError && error.code === 'bad_signature',
  );
});

test('T1 alg=none / alg-confusion is refused before any signature work', async () => {
  const head = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims())).toString('base64url');
  await assert.rejects(
    () => verifyZkLoginJwt({ jwt: `${head}.${body}.`, provider: 'google', env: ENV }),
    (error) => error instanceof ZkLoginVerificationError && ['bad_algorithm', 'malformed_token'].includes(error.code),
  );
});

test('T1 non-canonical / malformed tokens are refused (strict parsing)', async () => {
  for (const bad of ['not-a-jwt', 'a.b', 'a.b.c.d', 'a.b.c']) {
    await assert.rejects(
      () => verifyZkLoginJwt({ jwt: bad, provider: 'google', env: ENV }),
      (error) => error instanceof ZkLoginVerificationError,
      `"${bad}" must be refused`,
    );
  }
});

test('T1 nonce must bind the presented ephemeral key', async () => {
  // Correct nonce passes.
  await assert.doesNotReject(() => verifyZkLoginJwt({
    jwt: signJwt(claims()), provider: 'google', env: ENV, expectedNonce: 'expected-nonce',
  }));
  // A token whose nonce belongs to a different ephemeral key is refused.
  await assert.rejects(
    () => verifyZkLoginJwt({ jwt: signJwt(claims()), provider: 'google', env: ENV, expectedNonce: 'a-different-nonce' }),
    (error) => error instanceof ZkLoginVerificationError && error.code === 'bad_nonce',
  );
});

test('T1 verification fails closed when no client id is configured for the env', async () => {
  await assert.rejects(
    () => verifyZkLoginJwt({ jwt: signJwt(claims()), provider: 'google', env: {} }),
    (error) => error instanceof ZkLoginVerificationError && error.code === 'not_configured',
  );
});

test('T1 an unknown signing key is refused', async () => {
  // Same kid, different key: the provider rotated, or an attacker is bluffing.
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  primeJwksCacheForTesting('google', [{
    ...other.publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig',
  }]);
  await assert.rejects(
    () => verifyZkLoginJwt({ jwt: signJwt(claims()), provider: 'google', env: ENV }),
    (error) => error instanceof ZkLoginVerificationError && error.code === 'bad_signature',
  );
});
