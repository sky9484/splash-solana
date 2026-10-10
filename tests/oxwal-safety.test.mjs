import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluatePolicy } from '../lib/policy/evaluate.ts';
import { transitionProposal } from '../lib/queue/proposal-state.ts';
import {
  circuitBreakerDecision,
  policyWithCircuitBreaker,
  resetCircuitBreakersForTesting,
  setCorridorCircuitBreaker,
  setGlobalCircuitBreaker,
} from '../lib/safety/circuit-breaker.ts';
import { applyAnomalyFindings, evaluateAnomalyRules } from '../lib/safety/anomaly.ts';
import { markProposalSubmitted } from '../lib/safety/submit-guard.ts';
import { proposalObservabilitySummary, resetProposalObservability } from '../lib/observability/proposals.ts';

const now = '2026-07-01T00:00:00.000Z';
const future = '2026-07-01T01:00:00.000Z';

function simulation(overrides = {}) {
  return {
    ok: true,
    balanceChanges: [{ owner: 'payer', coinType: 'USDC', amount: '-1000000' }],
    gasSponsored: true,
    simulatedAt: now,
    ...overrides,
  };
}

function proposal(overrides = {}) {
  return {
    id: 'prop-safety-1',
    idempotencyKey: 'idem-safety-1',
    kind: 'PAYMENT',
    status: 'APPROVED',
    tier: 'TIER_0_PROPOSE',
    orgId: 'org-safety',
    corridor: 'MY_PH',
    unsignedTxBytes: 'dW5zaWduZWQ=',
    simulation: simulation(),
    explain: {
      recommendation: 'Pay verified counterparty.',
      financialImpact: {
        amountOut: BigInt(1_000_000),
        currencyOut: 'USDC',
      },
      evidence: [{ source: 'COUNTERPARTY', ref: 'cp-1', observedAt: now, trusted: true }],
      confidence: 0.9,
      risk: 'LOW',
      requiredApprovers: 1,
      reasoningTraceRef: 'pending-walrus:safety',
    },
    createdBy: 'maker-1',
    createdAt: now,
    expiresAt: future,
    approvals: [{ userId: 'approver-1', role: 'APPROVER', signedAt: now }],
    ...overrides,
  };
}

function policy(overrides = {}) {
  return {
    orgId: 'org-safety',
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

test('persisted global pause overlays policy and blocks evaluation', () => {
  resetCircuitBreakersForTesting();
  setGlobalCircuitBreaker({ orgId: 'org-safety', state: 'PAUSED', actor: 'test', reason: 'manual pause' });

  const overlaid = policyWithCircuitBreaker(policy());
  const decision = evaluatePolicy({
    proposal: proposal({ status: 'SIMULATED' }),
    actor: 'OWNER',
    policy: overlaid,
    simulation: simulation(),
    compliance,
    now,
  });

  assert.equal(decision.outcome, 'BLOCK');
  assert.match(decision.reason, /circuit breaker/);
});

test('submit-time guard re-checks circuit breaker before accepting a human signature', () => {
  resetCircuitBreakersForTesting();
  setCorridorCircuitBreaker({
    orgId: 'org-safety',
    corridor: 'MY_PH',
    state: 'PAUSED',
    actor: 'test',
    reason: 'corridor halt',
  });

  assert.deepEqual(
    circuitBreakerDecision({ proposal: proposal(), policy: policy() }),
    { armed: false, scope: 'corridor', corridor: 'MY_PH', reason: 'circuit breaker' },
  );
  assert.throws(
    () => markProposalSubmitted({
      proposal: proposal(),
      actor: 'APPROVER',
      policy: policy(),
      simulation: simulation(),
      compliance,
      signatureRef: 'sig-human-1',
      signedBy: 'approver-1',
      signedAt: now,
      now,
    }),
    /circuit breaker blocks signing and submission/,
  );
});

test('anomaly rules can auto-pause unsafe proposal bursts', () => {
  resetCircuitBreakersForTesting();
  const events = Array.from({ length: 4 }, (_, index) => ({
    proposal: proposal({ id: `burst-${index}` }),
    observedAt: new Date(Date.parse(now) + index * 1000).toISOString(),
  }));
  const findings = evaluateAnomalyRules(events, {
    proposalsPerMinuteLimit: 3,
    cumulativeOutboundUsdPerHourLimit: BigInt(100_000_000),
    lowConfidenceAverageThreshold: 0.4,
    lowConfidenceSampleSize: 5,
    repeatedSimulationMismatchLimit: 3,
  }, new Date('2026-07-01T00:00:10.000Z'));

  assert.equal(findings.some((finding) => finding.action === 'PAUSE_GLOBAL'), true);
  applyAnomalyFindings({ orgId: 'org-safety', findings, actor: 'test-anomaly' });
  assert.equal(policyWithCircuitBreaker(policy()).globalState, 'PAUSED');
});

test('proposal transitions emit structured metrics and counters', () => {
  resetProposalObservability();
  const simulated = transitionProposal(proposal({ status: 'DRAFTED', approvals: [], explain: { ...proposal().explain, requiredApprovers: 0 } }), {
    type: 'SIMULATION_COMPLETED',
    simulation: simulation(),
  });
  const evaluated = transitionProposal(simulated, { type: 'POLICY_EVALUATED', requiredApprovers: 1 });
  assert.equal(evaluated.status, 'POLICY_EVALUATED');

  const summary = proposalObservabilitySummary();
  assert.equal(summary.transitions.length, 2);
  assert.equal(summary.counters['oxwal.proposal_transition.total'], 2);
  assert.equal(summary.transitions[0].from, 'DRAFTED');
  assert.equal(summary.transitions[0].to, 'SIMULATED');
});
