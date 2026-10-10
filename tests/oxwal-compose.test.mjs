import assert from 'node:assert/strict';
import test from 'node:test';

import {
  composeAndSimulateProposal,
  simulationMatchesProposalImpact,
} from '../lib/chain/compose.ts';

const now = '2026-07-01T00:00:00.000Z';

function proposal(overrides = {}) {
  return {
    id: 'prop-compose-1',
    idempotencyKey: 'idem-compose-1',
    kind: 'PAYMENT',
    status: 'DRAFTED',
    tier: 'TIER_0_PROPOSE',
    orgId: 'org-1',
    corridor: 'MY_PH',
    unsignedTxBytes: '',
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
      reasoningTraceRef: 'pending-walrus:compose',
    },
    createdBy: 'OXWAL',
    createdAt: now,
    expiresAt: '2026-07-01T01:00:00.000Z',
    approvals: [],
    ...overrides,
  };
}

function fakeSponsor(txBytes = 'SPONSORED_TX_BYTES') {
  return {
    calls: [],
    async sponsorTransaction(input) {
      this.calls.push(input);
      return {
        txBytes: Buffer.from(txBytes).toString('base64'),
        sponsorSignature: 'SPONSOR_SIG',
        txDigest: 'SPONSORED_DIGEST',
        sponsor: 'shinami',
      };
    },
  };
}

function fakeClient(balanceAmount = '-1000000', status = 'success') {
  return {
    calls: [],
    async dryRunTransactionBlock(input) {
      this.calls.push(input);
      return {
        effects: { status: { status } },
        balanceChanges: [
          { owner: { AddressOwner: 'org-1' }, coinType: 'USDC', amount: balanceAmount },
        ],
      };
    },
  };
}

test('composer requests sponsorship, dry-runs sponsored bytes, and attaches simulation deltas', async () => {
  const sponsor = fakeSponsor();
  const client = fakeClient();
  const prepared = await composeAndSimulateProposal(proposal(), {
    mode: 'live',
    sponsor,
    client,
    sender: '0x0000000000000000000000000000000000000000000000000000000000000001',
  });

  assert.equal(prepared.status, 'SIMULATED');
  assert.equal(prepared.simulation?.ok, true);
  assert.equal(prepared.simulation?.gasSponsored, true);
  assert.deepEqual(prepared.simulation?.balanceChanges, [
    { owner: 'org-1', coinType: 'USDC', amount: '-1000000' },
  ]);
  assert.equal(sponsor.calls.length, 1);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].transactionBlock instanceof Uint8Array, true);
});

test('simulation mismatch fails the proposal before approval', async () => {
  const prepared = await composeAndSimulateProposal(proposal(), {
    mode: 'live',
    sponsor: fakeSponsor(),
    client: fakeClient('-900000'),
    sender: '0x0000000000000000000000000000000000000000000000000000000000000001',
  });

  assert.equal(prepared.status, 'FAILED');
  assert.equal(prepared.simulation?.ok, false);
  assert.equal(prepared.simulation?.error, 'simulation mismatch');
});

test('failed dry-run never advances to approval-ready simulation', async () => {
  const prepared = await composeAndSimulateProposal(proposal(), {
    mode: 'live',
    sponsor: fakeSponsor(),
    client: fakeClient('-1000000', 'failure'),
    sender: '0x0000000000000000000000000000000000000000000000000000000000000001',
  });

  assert.equal(prepared.status, 'FAILED');
  assert.equal(prepared.simulation?.ok, false);
});

test('simulation impact matcher uses exact dry-run balance evidence', () => {
  const simulated = {
    ok: true,
    gasSponsored: true,
    simulatedAt: now,
    balanceChanges: [{ owner: 'org-1', coinType: 'USDC', amount: '-1000000' }],
  };
  const mismatched = {
    ...simulated,
    balanceChanges: [{ owner: 'org-1', coinType: 'USDC', amount: '-100' }],
  };

  assert.equal(simulationMatchesProposalImpact(proposal(), simulated), true);
  assert.equal(simulationMatchesProposalImpact(proposal(), mismatched), false);
});
