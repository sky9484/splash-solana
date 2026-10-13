import assert from 'node:assert/strict';
import test from 'node:test';

import { ComputeBudgetProgram } from '@solana/web3.js';

import {
  cappedMicroLamports,
  computeBudgetInstructions,
  estimateFromRecentFees,
  MAX_PRIORITY_FEE_LAMPORTS,
  priorityFeeLamports,
  unitLimitFromSimulation,
} from '../lib/solana/compute-budget.ts';
import { defaultSponsorPolicy, validateSponsoredTransaction } from '../lib/solana/kora.ts';
import { buildPaymentMemo, buildMemoInstruction, isPaymentMemo, isSplashMemo } from '../lib/solana/payout.ts';
import { SIMULATED_FEE_PAYER } from '../lib/solana/simulator.ts';
import { buildSponsoredTransaction } from '../lib/solana/squads.ts';

/** Prompt 07 §5.3: compute budget first (limit, then price), a capped priority fee, the payment memo. */

test('limit then price, in that order, as the first instructions', () => {
  const [limit, price] = computeBudgetInstructions({ unitLimit: 200_000, microLamports: 1_500n });
  assert.ok(limit.programId.equals(ComputeBudgetProgram.programId));
  assert.equal(limit.data[0], 2, 'SetComputeUnitLimit');
  assert.equal(Buffer.from(limit.data).readUInt32LE(1), 200_000);
  assert.equal(price.data[0], 3, 'SetComputeUnitPrice');
  assert.equal(Buffer.from(price.data).readBigUInt64LE(1), 1_500n);
  assert.throws(() => computeBudgetInstructions({ unitLimit: 0, microLamports: 0n }), /unit limit/);
});

test('the priority fee is capped so the fee payer never spends more than the Kora ceiling', () => {
  for (const limit of [120_000, 220_000, 420_000, 1_400_000]) {
    for (const estimate of [0, 1, 999, 50_000, 10_000_000, Number.MAX_SAFE_INTEGER]) {
      const price = cappedMicroLamports(limit, estimate);
      assert.ok(priorityFeeLamports(limit, price) <= MAX_PRIORITY_FEE_LAMPORTS, `${limit} units at ${estimate}`);
    }
  }
  assert.equal(cappedMicroLamports(200_000, 1_000), 1_000n, 'under the cap, the estimate stands');
  assert.equal(cappedMicroLamports(200_000, 10_000_000), 500_000n, '100,000 lamports / 200,000 units = 0.5 lamports = 500,000 µL');
  assert.equal(cappedMicroLamports(200_000, -5), 0n);
  assert.equal(cappedMicroLamports(200_000, Number.NaN), 0n);
});

test('a capped price always passes the sponsor check; one micro-lamport more does not', () => {
  const policy = defaultSponsorPolicy('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
  const memo = buildMemoInstruction(buildPaymentMemo('pay_0123456789abcdef'));
  const bh = '11111111111111111111111111111111';
  const capped = cappedMicroLamports(220_000, 1e12);
  const ok = buildSponsoredTransaction(SIMULATED_FEE_PAYER, [...computeBudgetInstructions({ unitLimit: 220_000, microLamports: capped }), memo], bh);
  assert.deepEqual(validateSponsoredTransaction(ok, SIMULATED_FEE_PAYER, policy).reasons, []);
  const over = buildSponsoredTransaction(SIMULATED_FEE_PAYER, [...computeBudgetInstructions({ unitLimit: 220_000, microLamports: capped + 5n }), memo], bh);
  assert.match(validateSponsoredTransaction(over, SIMULATED_FEE_PAYER, policy).reasons.join(';'), /exceeds cap/);
});

test('a unit limit from a simulation adds 15% and rounds up to a thousand; nonsense falls back', () => {
  assert.equal(unitLimitFromSimulation(100_000, 200_000), 115_000);
  assert.equal(unitLimitFromSimulation(100_001, 200_000), 116_000);
  assert.equal(unitLimitFromSimulation(0, 200_000), 200_000);
  assert.equal(unitLimitFromSimulation(Number.NaN, 200_000), 200_000);
  assert.equal(unitLimitFromSimulation(5_000_000, 200_000), 1_400_000);
});

test('the recent-fees estimate is the 75th percentile of non-zero samples', () => {
  assert.equal(estimateFromRecentFees([]), 0);
  assert.equal(estimateFromRecentFees([{ prioritizationFee: 0 }, { prioritizationFee: 0 }]), 0);
  const samples = [10, 20, 30, 40, 0, 0].map((prioritizationFee) => ({ prioritizationFee }));
  assert.equal(estimateFromRecentFees(samples), 40);
  assert.equal(estimateFromRecentFees([5, 1, 3, 2].map((prioritizationFee) => ({ prioritizationFee }))), 5);
});

test('the payment memo carries the payment id only; anything that looks like invoice data is refused', () => {
  assert.equal(buildPaymentMemo('pay_0123456789abcdef'), 'splash:pay:v1:pay_0123456789abcdef');
  assert.equal(buildPaymentMemo('bat_0123456789abcdef.c3'), 'splash:pay:v1:bat_0123456789abcdef.c3');
  for (const bad of ['INV-0412', 'pay_0123', 'pay_0123456789ABCDEF', 'pay_0123456789abcdef Manila', '']) {
    assert.throws(() => buildPaymentMemo(bad), /Memo refused/, bad);
  }
  assert.ok(isPaymentMemo('splash:pay:v1:pay_0123456789abcdef'));
  assert.ok(isSplashMemo('splash:pay:v1:pay_0123456789abcdef'));
  assert.ok(isSplashMemo(`splash:v1:${'ab'.repeat(32)}`), 'the earlier commitment memo still verifies');
  assert.throws(() => buildMemoInstruction('splash:pay:v1:INV-0412'), /Memo refused/);
});
