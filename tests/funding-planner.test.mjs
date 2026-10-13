// Prompt 10 §5.6 and §5.9: the funding planner. Covered; a reserve move; each outside option by cost;
// integer totals; exact approvals on EVM; Splash's fee is zero; no option lands anywhere but the
// company's own Payments account. And the router follows Phase A's adapter table (all mocks).
import assert from 'node:assert/strict';
import test from 'node:test';

import { chargeOn, planFunding } from '../lib/solana-app/funding-planner.ts';
import { createTestModeFundingRouter, WALLET_ASSETS, WALLET_NETWORKS } from '../lib/solana-app/funding-router.ts';

const ACCOUNT = 'PaymentsVau1t1111111111111111111111111111111';
const USD = (n) => BigInt(n) * 1_000_000n;
const routes = () => createTestModeFundingRouter().routes({ destination: ACCOUNT });

test('covered: the Payments account pays it, with the balance now and after', () => {
  const plan = planFunding({ needMinor: USD(5_000), paymentsMinor: USD(25_000), reserveMinor: USD(70_000), paymentsAccount: ACCOUNT, routes: routes() });
  assert.deepEqual(plan, { kind: 'covered', needMinor: USD(5_000), paymentsNowMinor: USD(25_000), paymentsAfterMinor: USD(20_000) });
  assert.equal(planFunding({ needMinor: USD(10), paymentsMinor: USD(10), reserveMinor: 0n, paymentsAccount: ACCOUNT, routes: [] }).kind, 'covered', 'exactly enough is enough');
});

test('reserve: when the reserve covers what is missing, move exactly that first', () => {
  const plan = planFunding({ needMinor: USD(5_012) + 500_000n, paymentsMinor: USD(3_000), reserveMinor: USD(70_000), paymentsAccount: ACCOUNT, routes: routes() });
  assert.equal(plan.kind, 'reserve');
  assert.equal(plan.moveMinor, USD(2_012) + 500_000n);
  assert.equal(plan.reserveAfterMinor, USD(70_000) - plan.moveMinor);
  assert.equal(plan.paymentsAfterMinor, 0n);
  assert.equal(typeof plan.moveMinor, 'bigint');
});

test('external: every available route, cheapest all-in first, integers rounded up, Splash fee zero', () => {
  const plan = planFunding({ needMinor: USD(5_000) + 1n, paymentsMinor: USD(1_000), reserveMinor: USD(500), paymentsAccount: ACCOUNT, routes: routes() });
  assert.equal(plan.kind, 'external');
  assert.equal(plan.shortMinor, USD(4_000) + 1n, 'the whole shortfall comes in; a reserve that cannot cover it is left alone');
  const totals = plan.options.map((o) => o.totalMinor);
  assert.deepEqual(totals, [...totals].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), 'cheapest all-in first');
  for (const o of plan.options) {
    assert.equal(typeof o.chargeMinor, 'bigint');
    assert.equal(o.totalMinor, o.amountMinor + o.chargeMinor);
    assert.equal(o.chargeMinor, chargeOn(plan.shortMinor, o.chargeBps));
    assert.equal(o.splashFeeBps, 0);
    assert.equal(o.destination, ACCOUNT, `${o.id} lands in the company’s own account`);
    assert.equal(o.adapter, 'mock', 'Phase A: every outside source is a mock in this build');
    assert.equal(o.testMode, true);
    assert.equal(o.steps.at(-1), 'Lands in your Payments account');
    if (o.exactApproval) assert.equal(o.approvalMinor, o.totalMinor, `${o.id}: the approval is for the exact amount`);
    else assert.equal(o.approvalMinor, null);
  }
  assert.equal(plan.options[0].id, 'wallet:USDC:solana', 'USDC on Solana: no swap, no charge, fewest steps');
  assert.equal(plan.options.at(-1).id, 'bank_card', 'the top-up provider charges most');
  const swap = plan.options.find((o) => o.id === 'wallet:USDT:solana');
  assert.equal(swap.chargeMinor, (plan.shortMinor * 20n + 9_999n) / 10_000n, '0.20%, rounded up');
});

test('charges round up and never go negative', () => {
  assert.equal(chargeOn(1n, 20), 1n);
  assert.equal(chargeOn(10_000n, 20), 20n);
  assert.equal(chargeOn(0n, 50), 0n);
  assert.equal(chargeOn(USD(1), 0), 0n);
  assert.throws(() => planFunding({ needMinor: -1n, paymentsMinor: 0n, reserveMinor: 0n, paymentsAccount: ACCOUNT, routes: [] }));
});

test('no option targets a non-company address, and none charges a Splash fee: the planner refuses to plan with one', () => {
  const tampered = routes().map((r) => (r.id === 'wallet:USDC:base' ? { ...r, destination: '0x' + 'ab'.repeat(20) } : r));
  assert.throws(() => planFunding({ needMinor: USD(10), paymentsMinor: 0n, reserveMinor: 0n, paymentsAccount: ACCOUNT, routes: tampered }), /does not land in the company’s own Payments account/);
  const fee = routes().map((r) => (r.id === 'bank_card' ? { ...r, splashFeeBps: 10 } : r));
  assert.throws(() => planFunding({ needMinor: USD(10), paymentsMinor: 0n, reserveMinor: 0n, paymentsAccount: ACCOUNT, routes: fee }), /Splash fee/);
});

test('the router: every asset on every network, one bank or card top-up; only USDC and USDT; Sui not yet', () => {
  const all = routes();
  assert.equal(all.length, 1 + WALLET_ASSETS.length * WALLET_NETWORKS.length);
  assert.equal(new Set(all.map((r) => r.id)).size, all.length, 'unique ids');
  assert.ok(all.every((r) => r.destination === ACCOUNT));
  const top = all.find((r) => r.id === 'bank_card');
  assert.equal(top.label, 'Bank or card top-up · test mode');
  for (const r of all.filter((x) => x.asset === 'PYUSD' || x.asset === 'OTHER')) {
    assert.equal(r.available, false, r.id);
    assert.match(r.unavailableReason, /Only USDC and USDT are accepted/);
  }
  for (const r of all.filter((x) => x.network === 'sui' && (x.asset === 'USDC' || x.asset === 'USDT'))) assert.match(r.unavailableReason, /Not available yet/, r.id);
  for (const id of ['wallet:USDC:ethereum', 'wallet:USDC:base', 'wallet:USDC:arbitrum', 'wallet:USDC:polygon', 'wallet:USDC:avalanche', 'wallet:USDT:base']) {
    const r = all.find((x) => x.id === id);
    assert.equal(r.available, true, id);
    assert.equal(r.exactApproval, true, `${id}: EVM, exact approval`);
  }
  assert.equal(all.find((x) => x.id === 'wallet:USDC:solana').exactApproval, false);
  assert.throws(() => createTestModeFundingRouter().routes({ destination: '' }));
});
