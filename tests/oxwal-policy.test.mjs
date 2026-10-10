import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluatePolicy } from '../lib/policy/evaluate.ts';

const now = '2026-07-01T00:00:00.000Z';
const future = '2026-07-01T01:00:00.000Z';

function proposal(overrides = {}) {
  return {
    id: 'prop-policy-1',
    idempotencyKey: 'idem-policy-1',
    kind: 'PAYMENT',
    status: 'SIMULATED',
    tier: 'TIER_0_PROPOSE',
    orgId: 'org-1',
    corridor: 'MY_PH',
    unsignedTxBytes: 'dW5zaWduZWQ=',
    simulation: simulation(),
    explain: {
      recommendation: 'Prepare payment.',
      financialImpact: {
        amountOut: BigInt(1_000_000),
        currencyOut: 'USDC',
      },
      evidence: [{ source: 'COUNTERPARTY', ref: 'cp-1', observedAt: now, trusted: true }],
      confidence: 0.8,
      risk: 'LOW',
      requiredApprovers: 0,
      reasoningTraceRef: 'pending-walrus:policy',
    },
    createdBy: 'OXWAL',
    createdAt: now,
    expiresAt: future,
    approvals: [],
    ...overrides,
  };
}

function simulation(overrides = {}) {
  return {
    ok: true,
    balanceChanges: [{ owner: 'payer', coinType: 'USDC', amount: '-1000000' }],
    gasSponsored: true,
    simulatedAt: now,
    ...overrides,
  };
}

function policy(overrides = {}) {
  return {
    orgId: 'org-1',
    tier1ThresholdUsd: BigInt(5_000_000),
    dualApprovalThresholdUsd: BigInt(50_000_000),
    whitelistedAutoKinds: ['TREASURY_ALLOCATE'],
    operatingMinimumByCorridor: { MY_PH: BigInt(5_000_000) },
    perCorridorState: { MY_PH: 'ARMED' },
    globalState: 'ARMED',
    ...overrides,
  };
}

const compliance = {
  kytPassed: true,
  kybStatus: 'VERIFIED',
  sanctionsClear: true,
  flags: [],
};

test('adversarial tier cannot auto-execute third-party payment', () => {
  // $500, deliberately above the $100 settlement floor, so this test exercises
  // what it is named for — that a third-party payment never auto-executes even
  // when PAYMENT is whitelisted at TIER_2 — rather than being short-circuited
  // by the minimum-amount block.
  const amountMicro = BigInt(500_000_000);
  const matchingSimulation = simulation({
    balanceChanges: [{ owner: 'payer', coinType: 'USDC', amount: '-500000000' }],
  });
  const decision = evaluatePolicy({
    proposal: proposal({
      tier: 'TIER_2_SCOPED_AUTO',
      explain: {
        ...proposal().explain,
        financialImpact: { amountOut: amountMicro, currencyOut: 'USDC' },
      },
      simulation: matchingSimulation,
    }),
    actor: 'OWNER',
    // Dual-control threshold raised above the amount so the assertion stays on
    // "one approver, not auto-execute" — the behaviour under test — instead of
    // drifting into the dual-approval path.
    policy: policy({
      whitelistedAutoKinds: ['TREASURY_ALLOCATE', 'PAYMENT'],
      dualApprovalThresholdUsd: BigInt(50_000_000_000),
    }),
    simulation: matchingSimulation,
    compliance,
    now,
  });

  assert.deepEqual(decision, { outcome: 'REQUIRE_APPROVAL', approvers: 1 });
});

test('circuit breaker blocks policy evaluation before approval', () => {
  const decision = evaluatePolicy({
    proposal: proposal(),
    actor: 'OWNER',
    policy: policy({ globalState: 'PAUSED' }),
    simulation: simulation(),
    compliance,
    now,
  });

  assert.equal(decision.outcome, 'BLOCK');
  assert.match(decision.reason, /circuit breaker/);
});

test('simulation mismatch blocks the proposal', () => {
  const decision = evaluatePolicy({
    proposal: proposal(),
    actor: 'OWNER',
    policy: policy(),
    simulation: simulation({ balanceChanges: [{ owner: 'payer', coinType: 'USDC', amount: '-900000' }] }),
    compliance,
    now,
  });

  assert.deepEqual(decision, { outcome: 'BLOCK', reason: 'simulation mismatch' });
});

test('treasury allocation cannot breach corridor operating floor', () => {
  const treasury = proposal({
    kind: 'TREASURY_ALLOCATE',
    tier: 'TIER_2_SCOPED_AUTO',
    explain: {
      ...proposal().explain,
      financialImpact: {
        amountIn: BigInt(2_000_000),
        currencyIn: 'USDC',
      },
      evidence: [{ source: 'TREASURY', ref: 'org-1', observedAt: now, trusted: true }],
    },
  });
  const decision = evaluatePolicy({
    proposal: treasury,
    actor: 'OWNER',
    policy: policy(),
    simulation: simulation({
      balanceChanges: [
        { owner: 'payer', coinType: 'USDC', amount: '-2000000' },
        { owner: 'OPERATING_BALANCE_AFTER:MY_PH', coinType: 'USDC', amount: '4000000' },
      ],
    }),
    compliance,
    now,
  });

  assert.deepEqual(decision, { outcome: 'BLOCK', reason: 'treasury floor' });
});

test('whitelisted scoped treasury allocation can auto-execute when floor remains intact', () => {
  const treasury = proposal({
    kind: 'TREASURY_ALLOCATE',
    tier: 'TIER_2_SCOPED_AUTO',
    explain: {
      ...proposal().explain,
      financialImpact: {
        amountIn: BigInt(2_000_000),
        currencyIn: 'USDC',
      },
      evidence: [{ source: 'TREASURY', ref: 'org-1', observedAt: now, trusted: true }],
    },
  });
  const decision = evaluatePolicy({
    proposal: treasury,
    actor: 'OWNER',
    policy: policy(),
    simulation: simulation({
      balanceChanges: [
        { owner: 'payer', coinType: 'USDC', amount: '-2000000' },
        { owner: 'OPERATING_BALANCE_AFTER:MY_PH', coinType: 'USDC', amount: '6000000' },
      ],
    }),
    compliance,
    now,
  });

  assert.deepEqual(decision, { outcome: 'AUTO_EXECUTE' });
});
