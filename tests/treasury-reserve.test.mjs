// Prompt 10 §2.4: the shared money rules, one place, integers only. The worked examples are the
// "Look 9 · final" frames' numbers (Overview, Treasury): accounts US$25,000 / US$31,460 / US$40,000,
// payables due US$28,600, US$5,012.50 waiting for approval, US$10,000 in stocks.
import assert from 'node:assert/strict';
import test from 'node:test';

import * as r from '../lib/treasury/reserve.ts';

const $ = (dollars, cents = 0n) => BigInt(dollars) * r.USD + BigInt(cents) * 10_000n;

const frame = {
  paymentsMinor: $(25_000),
  reserveMinor: $(31_460),
  investmentsMinor: $(40_000),
  stocksMinor: $(10_000),
  approvedUnsentMinor: 0n,
  billsDueMinor: $(28_600),
  waitingMinor: $(5_012, 50),
};

test('payables due, the floor (payables + 10%, rounded up) and covered', () => {
  assert.equal(r.payablesDue(frame), $(28_600));
  assert.equal(r.reserveFloor($(28_600)), $(31_460));
  assert.equal(r.isCovered(frame), true);
  assert.equal(r.shortfall(frame), 0n);
  // A floor never comes out a minor unit short.
  assert.equal(r.reserveFloor(1n), 2n);
  assert.equal(r.reserveFloor(0n), 0n);
  // Approved-but-unsent payments count; drafts are simply not passed in.
  assert.equal(r.payablesDue({ approvedUnsentMinor: $(1_000), billsDueMinor: $(2_000) }), $(3_000));
});

test('investments never count towards covering what is due', () => {
  const thin = { ...frame, paymentsMinor: $(1_000), reserveMinor: $(2_000), investmentsMinor: $(1_000_000) };
  assert.equal(r.isCovered(thin), false);
  assert.equal(r.shortfall(thin), $(25_600));
});

test('available to invest: reserve surplus first, then the payments surplus (frame: US$19,987.50)', () => {
  const a = r.availableToInvest(frame);
  assert.equal(a.floorMinor, $(31_460));
  assert.equal(a.totalMinor, $(19_987, 50));
  assert.equal(a.fromReserveMinor, 0n);
  assert.equal(a.fromPaymentsMinor, $(19_987, 50));
  const rich = { ...frame, reserveMinor: $(40_000) };
  const b = r.availableToInvest(rich);
  assert.equal(b.fromReserveMinor, $(8_540));
  assert.equal(b.totalMinor, $(28_527, 50));
  const plan = r.drawPlan(rich, $(10_000));
  assert.deepEqual(plan, { fromReserveMinor: $(8_540), fromPaymentsMinor: $(1_460), withinAvailable: true });
  assert.equal(r.drawPlan(rich, $(30_000)).withinAvailable, false);
  // A reserve below its floor eats into what the payments surplus could otherwise invest; never below 0.
  const short = { ...frame, reserveMinor: $(1_000), paymentsMinor: $(6_000) };
  assert.equal(r.availableToInvest(short).totalMinor, 0n);
});

test('the stock cap: at most 20% of treasury after the buy (frame: US$5,365 more)', () => {
  assert.equal(r.treasuryMinor(frame), $(71_460));
  assert.equal(r.maxStockBuy(frame), $(5_365));
  assert.equal(r.stockSharePct(frame), 14n);
  // Check the boundary: buying exactly the max lands on 20% of the grown treasury, a cent more breaks it.
  const x = r.maxStockBuy(frame);
  assert.ok((frame.stocksMinor + x) * 100n <= 20n * (r.treasuryMinor(frame) + x));
  assert.ok((frame.stocksMinor + x + 10_000n) * 100n > 20n * (r.treasuryMinor(frame) + x + 10_000n));
  // At or over the cap: nothing more.
  assert.equal(r.maxStockBuy({ ...frame, stocksMinor: $(20_000) }), 0n);
  // A reserve surplus is drawn first and keeps treasury the same size.
  const rich = { ...frame, reserveMinor: $(80_000), investmentsMinor: $(20_000), stocksMinor: 0n };
  assert.equal(r.maxStockBuy(rich), $(20_000));
  // Never more than is available to invest.
  const poor = { ...frame, paymentsMinor: $(6_000) };
  assert.equal(r.maxStockBuy(poor), r.availableToInvest(poor).totalMinor);
});

test('sweep: out is the reserve surplus plus payments above waiting and the cushion (frame: US$14,987.50)', () => {
  assert.equal(r.sweepOut(frame), $(14_987, 50));
  assert.equal(r.sweepOut({ ...frame, paymentsMinor: $(9_000) }), 0n);
  assert.equal(r.sweepOut(frame, $(10_000)), $(9_987, 50));
  // Back: the shortfall to the floor, capped at the units redeemable now.
  const low = { ...frame, paymentsMinor: $(10_000), reserveMinor: $(15_000) };
  assert.equal(r.sweepBack(low, $(100_000)), $(6_460));
  assert.equal(r.sweepBack(low, $(4_000)), $(4_000));
  assert.equal(r.sweepBack(frame, $(100_000)), 0n);
  assert.equal(r.SWEEP_MIN_DRAFT, $(500));
  assert.equal(r.SWEEP_CUSHION_DEFAULT, $(5_000));
});

test('bar shares add up to exactly 100 (frame: 26 / 33 / 41)', () => {
  assert.deepEqual(r.sharesPct([$(25_000), $(31_460), $(40_000)]), [26n, 33n, 41n]);
  assert.deepEqual(r.sharesPct([$(1), 0n, 0n]), [100n, 0n, 0n]);
  assert.deepEqual(r.sharesPct([0n, 0n]), [0n, 0n]);
  for (const parts of [[1n, 1n, 1n], [7n, 3n], [$(1), $(2), $(3), $(4)]]) {
    assert.equal(r.sharesPct(parts).reduce((a, b) => a + b, 0n), 100n);
  }
});
