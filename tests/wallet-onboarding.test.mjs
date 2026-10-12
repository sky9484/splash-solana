import assert from 'node:assert/strict';
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

/**
 * Wallet / onboarding / custody spec acceptance tests.
 *
 * §2.4 killed-entity denylist · §3 KYB state machine · §4 session widening.
 * Google ID-token verification lives in tests/google-oidc.test.mjs.
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

test('§4 session round-trips userRole/orgId without dropping them', () => {
  const session = createCustomerSessionFromIdentity({
    email: 'ops@splash.finance',
    userRole: 'checker',
    orgId: 'demo-business',
  });
  const token = createCustomerSessionToken(session, SECRET);
  const decoded = readCustomerSessionToken(token, SECRET);

  assert.ok(decoded);
  assert.equal(decoded.userRole, 'checker');
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

test('§4 a cookie from the earlier build carrying a Sui address still verifies, and the address is dropped', () => {
  const session = createCustomerSessionFromIdentity({ email: 'ops@splash.finance' });
  const decoded = readCustomerSessionToken(createCustomerSessionToken({ ...session, suiAddress: '0xabc' }, SECRET), SECRET);
  assert.ok(decoded);
  assert.equal('suiAddress' in decoded, false, 'the reader copies known fields only');
});
