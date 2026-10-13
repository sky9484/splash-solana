import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import { PublicKey } from '@solana/web3.js';

import {
  createMockPartner,
  deriveMockDepositAddress,
  toChecksumAddress,
  verifyWebhookSignature,
  MOCK_RATE_REFERENCE,
  INSTAPAY_MAX_PHP_MINOR,
} from '../lib/solana-partner/mock-partner.ts';
import { MOCK_PARTNER_ENTRY, PARTNER_REGISTRY, getPartnerEntry, partnerAccepts } from '../lib/solana-partner/registry.ts';

const SECRET = 'partner-test-secret-0123456789';
const NOW = new Date('2026-10-11T03:00:00.000Z');
const beneficiary = { bank: 'BDO Unibank, Inc.', accountLast4: '4471' };

test('registry entry is exactly the labelled mock', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(MOCK_PARTNER_ENTRY)), {
    id: 'mock-partner',
    name: 'Test payout partner',
    signed: false,
    sandbox: true,
    acceptedTargets: [
      { network: 'solana', token: 'USDC' },
      { network: 'polygon', token: 'USDC' },
    ],
    rails: ['PESONet', 'InstaPay'],
  });
  assert.equal(PARTNER_REGISTRY.length, 1);
  assert.equal(getPartnerEntry('mock-partner'), MOCK_PARTNER_ENTRY);
  assert.ok(partnerAccepts(MOCK_PARTNER_ENTRY, 'polygon'));
  assert.ok(Object.isFrozen(MOCK_PARTNER_ENTRY));
});

test('quote is labelled MOCK and priced exactly in minor units', () => {
  const p = createMockPartner({ webhookSecret: SECRET });
  const q = p.quote({ amountPhpMinor: 56_000_000n }, { network: 'solana', now: NOW });
  assert.equal(q.reference, MOCK_RATE_REFERENCE);
  assert.equal(q.rate, '57.40');
  assert.equal(q.mock, true);
  assert.equal(q.rail, 'PESONet');
  assert.equal(q.arrival, 'same banking day');
  assert.ok(q.netPhpMinor >= 56_000_000n);
  // minimal gross: one micro-USDC less no longer covers the invoice
  const less = p.quote({ amountUsdcMinor: q.grossUsdcMinor - 1n }, { network: 'solana', now: NOW });
  assert.ok(less.netPhpMinor < 56_000_000n);
  // USDC mode round-trips
  const same = p.quote({ amountUsdcMinor: q.grossUsdcMinor }, { network: 'polygon', now: NOW });
  assert.equal(same.netPhpMinor, q.netPhpMinor);
  assert.equal(same.network, 'polygon');
  assert.equal((Date.parse(q.expiresAt) - NOW.getTime()) / 1000, 60);
  // small payouts go InstaPay
  assert.equal(p.quote({ amountPhpMinor: INSTAPAY_MAX_PHP_MINOR }, { now: NOW }).rail, 'InstaPay');
  assert.throws(() => p.quote({ amountPhpMinor: 0n }));
});

test('createPayout: one-payment deposit addresses on Solana and Polygon, deterministic and valid', () => {
  const p = createMockPartner({ webhookSecret: SECRET, seed: 's1' });
  const a = p.createPayout({ paymentId: 'pay_A', amountPhpMinor: 56_000_000n, expectedUsdcMinor: 977_590_000n, beneficiary, now: NOW });
  const b = p.createPayout({ paymentId: 'pay_B', amountPhpMinor: 56_000_000n, expectedUsdcMinor: 977_590_000n, beneficiary, now: NOW });
  const sol = a.deposits.find((d) => d.network === 'solana').address;
  const evm = a.deposits.find((d) => d.network === 'polygon').address;
  assert.ok(PublicKey.isOnCurve(new PublicKey(sol).toBytes()), 'Solana deposit owner is a real ed25519 key');
  assert.match(evm, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(toChecksumAddress(evm.toLowerCase()), evm, 'EIP-55 checksummed');
  assert.notEqual(sol, b.deposits.find((d) => d.network === 'solana').address, 'one address per payment');
  assert.equal(sol, deriveMockDepositAddress('s1', 'solana', 'pay_A'));
  // a second mock with the same seed derives the same addresses
  const p2 = createMockPartner({ webhookSecret: SECRET, seed: 's1' });
  assert.deepEqual(p2.createPayout({ paymentId: 'pay_A', amountPhpMinor: 56_000_000n, expectedUsdcMinor: 977_590_000n, beneficiary }).deposits, a.deposits);
  // idempotent on paymentId; a different amount is refused
  assert.equal(p.createPayout({ paymentId: 'pay_A', amountPhpMinor: 56_000_000n, expectedUsdcMinor: 977_590_000n, beneficiary }).payoutId, a.payoutId);
  assert.throws(() => p.createPayout({ paymentId: 'pay_A', amountPhpMinor: 1n, expectedUsdcMinor: 977_590_000n, beneficiary }));
});

test('EIP-55 reference vector', () => {
  assert.equal(toChecksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'), '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
  assert.equal(toChecksumAddress('fb6916095ca1df60bb79ce92ce3ea74c37c5d359'), '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359');
});

test('deposit → signed webhooks received then paid with a MOCK bank reference', () => {
  const p = createMockPartner({ webhookSecret: SECRET });
  const po = p.createPayout({ paymentId: 'pay_W', amountPhpMinor: 56_000_000n, expectedUsdcMinor: 977_590_000n, beneficiary, now: NOW });
  const dep = po.deposits.find((d) => d.network === 'solana');
  const events = p.simulateDeposit({ payoutId: po.payoutId, network: 'solana', address: dep.address, amountUsdcMinor: 977_590_000n, now: NOW });
  assert.deepEqual(events.map((e) => e.status), ['received', 'paid']);
  const paid = events[1];
  assert.match(paid.bankReference, /^MOCK-PESONET-20261011-[0-9A-F]{8}$/);
  assert.equal(paid.amountPhpMinor, 56_000_000n);
  for (const e of events) {
    assert.match(e.signature, /^[0-9a-f]{64}$/);
    assert.deepEqual(p.verifyWebhook(e), { ok: true });
    assert.deepEqual(verifyWebhookSignature(e, SECRET), { ok: true });
  }
  assert.equal(p.getPayout(po.payoutId).status, 'PAID');
  assert.throws(() => p.simulateDeposit({ payoutId: po.payoutId, network: 'solana', address: dep.address, amountUsdcMinor: 977_590_000n }), /already PAID/);
});

test('webhook tampering, wrong secret, stale events and wrong partner are rejected', () => {
  const p = createMockPartner({ webhookSecret: SECRET });
  const po = p.createPayout({ paymentId: 'pay_T', amountPhpMinor: 56_000_000n, expectedUsdcMinor: 977_590_000n, beneficiary, now: NOW });
  const [, paid] = p.simulateDeposit({ payoutId: po.payoutId, network: 'polygon', address: po.deposits[1].address, amountUsdcMinor: 977_590_000n, now: NOW });
  assert.equal(p.verifyWebhook({ ...paid, amountPhpMinor: paid.amountPhpMinor + 1n }).ok, false);
  assert.equal(p.verifyWebhook({ ...paid, bankReference: 'MOCK-PESONET-OTHER' }).ok, false);
  assert.equal(p.verifyWebhook({ ...paid, status: 'returned' }).ok, false);
  assert.equal(p.verifyWebhook({ ...paid, signature: paid.signature.toUpperCase() }).ok, false);
  assert.equal(verifyWebhookSignature(paid, 'another-secret-0123456789').ok, false);
  assert.deepEqual(p.verifyWebhook(paid, { now: new Date(NOW.getTime() + 3_600_000), maxAgeSec: 600 }), { ok: false, reason: 'stale event' });
  assert.deepEqual(verifyWebhookSignature(paid, SECRET, { expectedPartnerId: 'someone-else' }), { ok: false, reason: 'wrong partner' });
  assert.throws(() => createMockPartner({ webhookSecret: 'short' }));
});

test('deposit to the wrong address throws; an underpayment is returned, not paid', () => {
  const p = createMockPartner({ webhookSecret: SECRET });
  const po = p.createPayout({ paymentId: 'pay_U', amountPhpMinor: 56_000_000n, expectedUsdcMinor: 977_590_000n, beneficiary, now: NOW });
  assert.throws(() => p.simulateDeposit({ payoutId: po.payoutId, network: 'solana', address: po.deposits[1].address, amountUsdcMinor: 977_590_000n }));
  const [ev] = p.simulateDeposit({ payoutId: po.payoutId, network: 'solana', address: po.deposits[0].address, amountUsdcMinor: 977_589_999n, now: NOW });
  assert.equal(ev.status, 'returned');
  assert.equal(ev.bankReference, undefined);
  assert.equal(p.getPayout(po.payoutId).status, 'RETURNED');
});

test('no real partner names in the partner layer except one comment', () => {
  const dir = new URL('../lib/solana-partner/', import.meta.url);
  const hits = [];
  for (const f of readdirSync(dir)) {
    readFileSync(new URL(f, dir), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/noah|pdax|durian|coins\.ph|bridge\.xyz|airwallex|straitsx/i.test(line)) hits.push({ f, i, line });
      });
  }
  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.match(hits[0].line, /^\s*\*/, 'the one mention is a comment');
});
