import assert from 'node:assert/strict';
import test from 'node:test';

import { quoteRoutes, evaluatePolicy, createKytStub, TIER_LIMITS } from '../lib/route-engine/index.ts';
import { tenThousandUsdPhpFixture, FIXTURE_NOW, FIXTURE_PHP_MINOR } from '../lib/route-engine/fixtures.ts';

const quote = quoteRoutes(tenThousandUsdPhpFixture().input).picks.cheapest;

const invoice = {
  invoiceNumber: 'INV-0412',
  supplierName: 'Manila Freight Services Inc.',
  supplierBank: 'BDO Unibank, Inc.',
  supplierAccountLast4: '4471',
  amountPhpMinor: FIXTURE_PHP_MINOR,
  dueDate: '2026-10-30',
  confirmedBy: 'finance@example.test',
  confirmedAt: '2026-10-11T02:59:00.000Z',
  commitmentHex: 'ab'.repeat(32),
  bankDetailsVerified: { by: 'finance@example.test', method: 'call-back', at: '2026-10-11T02:58:00.000Z' },
};

const base = { tier: 'advanced', quote, invoice, usedTodayUsdcMinor: 0n, seenCommitments: new Set(), now: FIXTURE_NOW };
const failing = (r) => [...r.checks, ...r.extraChecks].filter((c) => !c.passed).map((c) => c.name);

test('a clean Advanced payment passes every check', () => {
  const r = evaluatePolicy(base);
  assert.equal(r.allowed, true, r.reasons.join('; '));
  assert.deepEqual(r.checks.map((c) => c.name), ['tier', 'per_payment_limit', 'daily_limit', 'kyt', 'duplicate_invoice', 'quote_expiry', 'bank_details_verified']);
  assert.equal(r.kyt.provider, 'stub');
  assert.match(r.kyt.label, /stub/);
  assert.match(r.checks.find((c) => c.name === 'kyt').detail, /stub/);
});

test('tier and limits: Basic US$5,000/day, Advanced US$100,000/day, per-payment cap', () => {
  assert.equal(TIER_LIMITS.basic.dailyUsdcMinor, 5_000_000_000n);
  assert.equal(TIER_LIMITS.advanced.dailyUsdcMinor, 100_000_000_000n);
  assert.deepEqual(failing(evaluatePolicy({ ...base, tier: 'basic' })), ['per_payment_limit', 'daily_limit']);
  assert.deepEqual(failing(evaluatePolicy({ ...base, tier: null })), ['tier', 'per_payment_limit', 'daily_limit']);
  assert.deepEqual(failing(evaluatePolicy({ ...base, usedTodayUsdcMinor: 95_000_000_000n })), ['daily_limit']);
  assert.deepEqual(failing(evaluatePolicy({ ...base, limits: { perPaymentUsdcMinor: 10_000_000_000n } })), ['per_payment_limit']);
});

test('KYT stub can flag a deny-listed deposit address', () => {
  const r = evaluatePolicy({ ...base, kyt: createKytStub([quote.target.depositAddress]) });
  assert.deepEqual(failing(r), ['kyt']);
  assert.equal(r.kyt.verdict, 'flagged');
});

test('duplicate invoice by commitment (Set or lookup function)', () => {
  assert.deepEqual(failing(evaluatePolicy({ ...base, seenCommitments: new Set([invoice.commitmentHex]) })), ['duplicate_invoice']);
  assert.deepEqual(failing(evaluatePolicy({ ...base, seenCommitments: (h) => h === invoice.commitmentHex })), ['duplicate_invoice']);
  assert.deepEqual(failing(evaluatePolicy({ ...base, invoice: { ...invoice, commitmentHex: 'INV-0412' } })), ['duplicate_invoice']);
});

test('quote expiry, unverified bank details, and a quote that does not cover the invoice', () => {
  assert.deepEqual(failing(evaluatePolicy({ ...base, now: new Date(Date.parse(quote.expiresAt)) })), ['quote_expiry']);
  assert.deepEqual(failing(evaluatePolicy({ ...base, invoice: { ...invoice, bankDetailsVerified: null } })), ['bank_details_verified']);
  const r = evaluatePolicy({ ...base, invoice: { ...invoice, amountPhpMinor: FIXTURE_PHP_MINOR + 1n } });
  assert.deepEqual(failing(r), ['amount_covers_invoice']);
  assert.equal(r.allowed, false);
  assert.equal(r.reasons.length, 1);
});
