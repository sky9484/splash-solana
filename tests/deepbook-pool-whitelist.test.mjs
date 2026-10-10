import assert from 'node:assert/strict';
import test from 'node:test';

import { checkPoolAllowed, normalizeObjectId, parsePoolWhitelist } from '../lib/policy/deepbook-whitelist.ts';

/**
 * Audit S-12 — `peg_monitor::assert_deepbook_liquidity` measures a `Pool` object
 * the CALLER supplies, and DeepBook pools are permissionlessly creatable. The
 * on-chain fix is `ComplianceConfig.allowed_deepbook_pools`; these tests pin the
 * off-chain half, because the ways this control fails silently are all encoding
 * bugs: a short-form id that never matches, a `{bytes}` wrapper that parses to
 * nothing, or an absent field read as an empty (and therefore "clean") list.
 */

// 64 hex chars — the canonical printed form of a Sui object id.
const POOL = '0x1c19362c8b8f0b1e7f0e5e6d0a8b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d';

test('S-12: short-form and full-form object ids compare equal', () => {
  assert.equal(normalizeObjectId('0x2'), `0x${'2'.padStart(64, '0')}`);
  assert.equal(normalizeObjectId('0x2'), normalizeObjectId(`0x${'0'.repeat(63)}2`));
  // Without left-padding, a config holding "0x2" would never match the chain's
  // printed "0x000…002" and the whitelist would reject a legitimate venue.
});

test('S-12: id normalization is case-insensitive and rejects junk', () => {
  assert.equal(normalizeObjectId('0xAbCd'), normalizeObjectId('0xabcd'));
  assert.equal(normalizeObjectId(' 0xabcd '), normalizeObjectId('0xabcd'));
  assert.equal(normalizeObjectId('abcd'), null, 'missing 0x prefix must not parse');
  assert.equal(normalizeObjectId(`0x${'a'.repeat(65)}`), null, 'over-length must not parse');
  assert.equal(normalizeObjectId(''), null);
  assert.equal(normalizeObjectId(null), null);
  assert.equal(normalizeObjectId({ nope: 1 }), null);
});

test('S-12: a VecSet<ID> parses from both the contents wrapper and a bare array', () => {
  assert.deepEqual(parsePoolWhitelist({ allowed_deepbook_pools: { contents: [POOL] } }), [POOL]);
  assert.deepEqual(parsePoolWhitelist({ allowed_deepbook_pools: [POOL] }), [POOL]);
  assert.deepEqual(parsePoolWhitelist({ allowed_deepbook_pools: { contents: [{ bytes: POOL }] } }), [POOL]);
});

test('S-12: an ABSENT field is null, not an empty list', () => {
  // This is the distinction that matters. The deployed package predates the
  // whitelist; reading that as "[] — nothing allowed" would take settlement
  // down, and reading it as "enforced" would claim a control we do not have.
  assert.equal(parsePoolWhitelist({ max_slippage_bps: 150 }), null);
  assert.equal(parsePoolWhitelist(null), null);
  assert.deepEqual(parsePoolWhitelist({ allowed_deepbook_pools: { contents: [] } }), []);
});

test('S-12: the configured venue must be on the list', () => {
  const other = `0x${'f'.repeat(64)}`;
  const allowed = checkPoolAllowed(POOL, [POOL]);
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.enforced, true);

  const rejected = checkPoolAllowed(other, [POOL]);
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.enforced, true);
  assert.match(rejected.reason, /not on the on-chain whitelist/);
});

test('S-12: an empty enforced whitelist rejects everything', () => {
  const verdict = checkPoolAllowed(POOL, []);
  assert.equal(verdict.allowed, false, 'an empty list must never be read as "allow all"');
  assert.equal(verdict.enforced, true);
});

test('S-12: a pre-whitelist package is allowed but reported as unenforced', () => {
  const verdict = checkPoolAllowed(POOL, null);
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.enforced, false, 'callers must be able to see the control is not live yet');
});

test('S-12: a missing or malformed DEEPBOOK_POOL_ID is rejected, never waved through', () => {
  for (const bad of ['', '   ', 'not-an-id', '0xzz']) {
    const verdict = checkPoolAllowed(bad, [POOL]);
    assert.equal(verdict.allowed, false, `expected ${JSON.stringify(bad)} to be rejected`);
  }
  // Even against a pre-whitelist package, garbage in the env is still an error —
  // otherwise a typo'd venue silently becomes "unenforced, therefore fine".
  assert.equal(checkPoolAllowed('not-an-id', null).allowed, false);
});
