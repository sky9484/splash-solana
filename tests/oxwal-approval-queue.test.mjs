import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InMemoryApprovalQueue,
  approveQueuedProposal,
  approvalsRemaining,
  buildApprovalQueue,
  canActorApprove,
} from '../lib/queue/approval-queue.ts';
import { ProposalStateError } from '../lib/queue/proposal-state.ts';

const now = new Date('2026-07-01T00:00:00.000Z');
const nowIso = now.toISOString();
const laterIso = new Date('2026-07-01T01:00:00.000Z').toISOString();

function proposal(overrides = {}) {
  return {
    id: 'proposal-1',
    idempotencyKey: 'idem-1',
    kind: 'PAYMENT',
    status: 'PENDING_APPROVAL',
    tier: 'TIER_0_PROPOSE',
    orgId: 'org-1',
    corridor: 'MY_PH',
    unsignedTxBytes: 'dW5zaWduZWQ=',
    simulation: {
      ok: true,
      balanceChanges: [{ owner: '0xpayer', coinType: '0x2::sui::SUI', amount: '-1000' }],
      gasSponsored: true,
      simulatedAt: nowIso,
    },
    explain: {
      recommendation: 'Pay the verified counterparty.',
      financialImpact: {
        amountOut: BigInt(1000),
        currencyOut: 'USDC',
      },
      evidence: [{
        source: 'COUNTERPARTY',
        ref: 'counterparty-1',
        observedAt: nowIso,
        trusted: true,
      }],
      confidence: 0.92,
      risk: 'LOW',
      requiredApprovers: 1,
      reasoningTraceRef: 'walrus-reasoning-1',
    },
    createdBy: 'maker-1',
    createdAt: nowIso,
    expiresAt: laterIso,
    approvals: [],
    ...overrides,
  };
}

function withExplain(base, explainOverrides) {
  return {
    ...base,
    explain: {
      ...base.explain,
      ...explainOverrides,
    },
  };
}

test('queue approval eligibility enforces maker-checker separation', () => {
  const pending = proposal();

  assert.deepEqual(
    canActorApprove(pending, { userId: 'maker-1', role: 'OWNER' }),
    { ok: false, reason: 'maker cannot approve their own proposal' },
  );
  assert.deepEqual(
    canActorApprove(pending, { userId: 'viewer-1', role: 'VIEWER' }),
    { ok: false, reason: 'VIEWER cannot approve proposals' },
  );
  assert.throws(
    () => approveQueuedProposal(pending, { userId: 'maker-1', role: 'OWNER' }, nowIso),
    /maker cannot approve/,
  );
});

test('dual approval requires two distinct approvers before approval', () => {
  const dual = withExplain(proposal(), { requiredApprovers: 2 });
  const first = approveQueuedProposal(dual, { userId: 'approver-1', role: 'APPROVER' }, nowIso);

  assert.equal(first.status, 'PENDING_APPROVAL');
  assert.equal(approvalsRemaining(first), 1);
  assert.throws(
    () => approveQueuedProposal(first, { userId: 'approver-1', role: 'APPROVER' }, nowIso),
    /distinct approver/,
  );

  const second = approveQueuedProposal(first, { userId: 'finance-1', role: 'FINANCE_ADMIN' }, nowIso);
  assert.equal(second.status, 'APPROVED');
  assert.equal(approvalsRemaining(second), 0);
  assert.deepEqual(second.approvals.map((approval) => approval.userId), ['approver-1', 'finance-1']);
});

test('in-memory approval queue persists maker-checker transitions', () => {
  const queue = new InMemoryApprovalQueue();
  queue.create(withExplain(proposal({ id: 'dual-1', idempotencyKey: 'dual-1' }), { requiredApprovers: 2 }));

  const once = queue.approve('dual-1', { userId: 'approver-1', role: 'APPROVER' }, nowIso);
  assert.equal(once.status, 'PENDING_APPROVAL');
  assert.equal(queue.get('dual-1')?.approvals.length, 1);

  assert.throws(
    () => queue.approve('dual-1', { userId: 'approver-1', role: 'APPROVER' }, nowIso),
    ProposalStateError,
  );

  const approved = queue.approve('dual-1', { userId: 'owner-1', role: 'OWNER' }, nowIso);
  assert.equal(approved.status, 'APPROVED');
  assert.equal(queue.view({ now }).totals.PENDING_APPROVALS, 0);
});

test('queue view surfaces pending approvals, holds, expiries, failures, and anomaly halts', () => {
  const expiring = proposal({
    id: 'expiring-1',
    idempotencyKey: 'expiring-1',
    expiresAt: new Date('2026-07-01T00:12:00.000Z').toISOString(),
  });
  const complianceHold = withExplain(proposal({
    id: 'compliance-1',
    idempotencyKey: 'compliance-1',
  }), {
    risk: 'HIGH',
    evidence: [
      { source: 'COMPLIANCE', ref: 'elliptic-hold-1', observedAt: nowIso, trusted: false },
    ],
  });
  const failed = proposal({
    id: 'failed-1',
    idempotencyKey: 'failed-1',
    status: 'FAILED',
    simulation: {
      ok: false,
      balanceChanges: [],
      gasSponsored: true,
      error: 'settlement relay failed',
      simulatedAt: nowIso,
    },
  });
  const anomaly = proposal({
    id: 'anomaly-1',
    idempotencyKey: 'anomaly-1',
    status: 'FAILED',
    simulation: {
      ok: false,
      balanceChanges: [],
      gasSponsored: true,
      error: 'anomaly velocity halt',
      simulatedAt: nowIso,
    },
  });

  const view = buildApprovalQueue([expiring, complianceHold, failed, anomaly], { now, expiringWithinMs: 15 * 60 * 1000 });

  assert.equal(view.totals.proposals, 4);
  assert.equal(view.totals.PENDING_APPROVALS, 2);
  assert.equal(view.totals.COMPLIANCE_HOLDS, 1);
  assert.equal(view.totals.EXPIRING_QUOTES, 1);
  assert.equal(view.totals.FAILED_SETTLEMENTS, 2);
  assert.equal(view.totals.ANOMALY_HALTS, 1);
  assert.equal(view.lanes.EXPIRING_QUOTES[0].proposal.id, 'expiring-1');
});
