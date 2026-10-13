// Prompt 10 §5.5: Transfer's Step 2 while a person types. The other amount at the partner's rate, the
// rail for this bank and amount (no time words), and the limits, with the rule that stops an amount.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { estimateTransfer } from '../lib/solana-app/transfer-estimate.ts';
import { createMockPartner } from '../lib/solana-partner/mock-partner.ts';

const LIMITS = { perPaymentMinor: 20_000_000_000n, dailyMinor: 50_000_000_000n, usedTodayMinor: 0n };

test('they receive ₱287,000.00 at 57.40: you send US$5,000.00 before fees, by PESONet', () => {
  const e = estimateTransfer({ kind: 'bank', bankCode: 'BDO', phpMinor: 28_700_000n, rate: '57.40', limits: LIMITS });
  assert.equal(e.usdMinor, 5_000_000_000n);
  assert.equal(e.phpMinor, 28_700_000n);
  assert.equal(e.rail, 'PESONet');
  assert.match(e.railWhy, /^PESONet, because BDO Unibank takes this amount that way\./);
  assert.doesNotMatch(e.railWhy, /\b(minute|hour|day|second|arriv|instant|fast)/i, 'a rail, never a time');
  assert.equal(e.limits.leftAfterMinor, 45_000_000_000n);
  assert.equal(e.block, null);
});

test('the other direction, and rounding: US$ is rounded up to whole cents, pesos down to the centavo', () => {
  const fromPhp = estimateTransfer({ kind: 'bank', bankCode: 'BDO', phpMinor: 100n, rate: '57.40', limits: LIMITS });
  assert.equal(fromPhp.usdMinor, 20_000n, '₱1.00 is US$0.0174…, shown as US$0.02 so it never understates');
  const fromUsd = estimateTransfer({ kind: 'bank', bankCode: 'BDO', usdMinor: 1_000_000n, rate: '57.40', limits: LIMITS });
  assert.equal(fromUsd.phpMinor, 5_740n);
  const odd = estimateTransfer({ kind: 'bank', bankCode: 'BDO', usdMinor: 1_234_567n, rate: '57.40', limits: LIMITS });
  assert.equal(odd.usdMinor, 1_240_000n, 'whole cents');
  for (const v of [fromPhp.usdMinor, fromUsd.phpMinor, odd.usdMinor, odd.phpMinor]) assert.equal(typeof v, 'bigint');
});

test('the rail follows the bank and the amount, as the partner routes it', () => {
  const small = estimateTransfer({ kind: 'bank', bankCode: 'BDO', phpMinor: 1_000_000n, rate: '57.40', limits: LIMITS });
  assert.equal(small.rail, 'InstaPay');
  const aub = estimateTransfer({ kind: 'bank', bankCode: 'AUB', phpMinor: 1_000_000n, rate: '57.40', limits: LIMITS });
  assert.equal(aub.rail, 'PESONet', 'a bank that takes PESONet only');
  assert.match(aub.railWhy, /the way Asia United Bank takes payments/);
  const none = estimateTransfer({ kind: 'bank', bankCode: null, phpMinor: 1_000_000n, rate: '57.40', limits: LIMITS });
  assert.equal(none.rail, null);
  // The partner's own quote names the same rail for that bank.
  const partner = createMockPartner({ webhookSecret: 'x'.repeat(32) });
  assert.equal(partner.quote({ amountPhpMinor: 1_000_000n, bankCode: 'AUB' }).rail, 'PESONet');
  assert.equal(partner.quote({ amountPhpMinor: 1_000_000n, bankCode: 'BDO' }).rail, 'InstaPay');
  assert.equal(partner.quote({ amountPhpMinor: 1_000_000n }).rail, 'InstaPay');
});

test('an amount above a limit is blocked here, naming the rule and who can change it', () => {
  const perPayment = estimateTransfer({ kind: 'bank', bankCode: 'BDO', usdMinor: 20_000_010_000n, rate: '57.40', limits: LIMITS });
  assert.equal(perPayment.block.rule, 'per_payment');
  assert.match(perPayment.block.message, /per-payment limit of US\$20,000\.00.*owner.*Rules/);
  const daily = estimateTransfer({ kind: 'peer', usdMinor: 12_000_000_000n, limits: { ...LIMITS, usedTodayMinor: 40_000_000_000n } });
  assert.equal(daily.block.rule, 'daily');
  assert.match(daily.block.message, /US\$10,000\.00 left today/);
  assert.equal(daily.limits.leftAfterMinor, 0n);
  const exact = estimateTransfer({ kind: 'peer', usdMinor: 10_000_000_000n, limits: { ...LIMITS, usedTodayMinor: 40_000_000_000n } });
  assert.equal(exact.block, null, 'exactly what is left fits');
});

test('a payment to a business on Splash: US$ only, no rate, no rail', () => {
  const e = estimateTransfer({ kind: 'peer', usdMinor: 1_500_000_000n, limits: LIMITS });
  assert.equal(e.phpMinor, null);
  assert.equal(e.rate, null);
  assert.equal(e.rail, null);
  assert.equal(e.usdMinor, 1_500_000_000n);
});
