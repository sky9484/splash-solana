import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryProposalStore } from '../lib/queue/proposal-state.ts';
import { resolveApprovalClaim } from '../lib/server/approved-proposal.ts';
import { APPROVAL_RUN_KEY_PREFIX, batchRunKey, batchSecondFactor } from '../lib/server/batch-approval.ts';
import { batchPayoutSubstance, batchTargetCurrency, payableBatchRows } from '../lib/server/step-up-subjects.ts';

/**
 * An approved payroll run, carried out.
 *
 * The approval queue replays an approved BATCH_PAYOUT through
 * /api/batches/authorize with the proposal's payload, `{ rows, targetCurrency }`.
 * The route verified TOTP before it read the approval, and the replay carries
 * no code — none could be valid, because the maker's was single-use and was
 * spent when the route made the proposal. With `requireTotp` on by default,
 * every approved payroll run was recorded FAILED: "The authorization code is
 * not valid."
 *
 * The route cannot be imported here (next/server), so the decision lives in
 * lib/server/batch-approval.ts and is exercised against real claims resolved
 * from a proposal store; the route's use of it is pinned from its source.
 */

delete process.env.DATABASE_URL;

const ADDR_A = `0x${'a'.repeat(64)}`;
const ADDR_B = `0x${'b'.repeat(64)}`;
const ADDR_C = `0x${'c'.repeat(64)}`;

/** What the batch dashboard posts: the file, a blocked row and the maker's code. */
function batchBody(overrides = {}) {
  return {
    rows: [
      { name: 'Maria Santos', address: ADDR_A, amount: '12500.00' },
      { name: 'Jose Rizal', address: ADDR_B, amount: '8000.00' },
      { name: '', address: ADDR_C, amount: '500.00' },
    ],
    targetCurrency: 'PHP',
    totp: '123456',
    ...overrides,
  };
}

/** What the route puts on the proposal, and so what the replay posts: no code. */
function approvedPayload(body = batchBody()) {
  return { rows: payableBatchRows(body.rows), targetCurrency: batchTargetCurrency(body) };
}

const batchScope = (body) => ({ kind: 'BATCH_PAYOUT', substance: batchPayoutSubstance, body, consumer: 'batches/authorize' });

function claimRequest(proposalId) {
  return new Request('http://splash.test/api/batches/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-splash-approved-proposal': proposalId },
  });
}

function freshStore() {
  const store = new InMemoryProposalStore();
  globalThis.oxwalProposalStore = store;
  return store;
}

let sequence = 0;

/** A proposal walked the way the submit route walks one, two checkers signing. */
function approvedProposal(store, { kind = 'BATCH_PAYOUT', payload, orgId = 'acme', until = 'SUBMITTED' } = {}) {
  const id = `prop_batch_${++sequence}`;
  const now = new Date().toISOString();
  store.create({
    id,
    idempotencyKey: `idem_${id}`,
    kind,
    status: 'SIMULATED',
    tier: 'TIER_0_PROPOSE',
    orgId,
    corridor: 'PHP',
    unsignedTxBytes: 'deadbeef',
    createdBy: 'usr_maker',
    createdAt: now,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    approvals: [],
    explain: {
      recommendation: 'Pay the run',
      financialImpact: { amountIn: 20_500_000_000n, currencyIn: 'USD' },
      evidence: [],
      confidence: 1,
      risk: 'MEDIUM',
      requiredApprovers: 2,
      reasoningTraceRef: 'dual-approval:test',
    },
    simulation: { ok: true, balanceChanges: [], gasSponsored: false, simulatedAt: now },
    executionPayload: payload,
  });
  store.transition(id, { type: 'POLICY_EVALUATED', requiredApprovers: 2 });
  store.transition(id, { type: 'QUEUE_FOR_APPROVAL' });
  store.transition(id, { type: 'APPROVE', approval: { userId: 'usr_checker_1', role: 'APPROVER', signedAt: now } });
  store.transition(id, { type: 'APPROVE', approval: { userId: 'usr_checker_2', role: 'FINANCE_ADMIN', signedAt: now } });
  const signed = store.transition(id, { type: 'SIGN', signatureRef: 'sig', signedBy: 'usr_checker_2', policyAuthorized: true, signedAt: now });
  if (until === 'SIGNED') return signed;
  return store.transition(id, { type: 'SUBMIT' });
}

// The org's second-factor dials: the defaults, WhatsApp style, and TOTP off.
const CODE = { requireTotp: true, whatsappEnabled: false };
const WHATSAPP = { requireTotp: true, whatsappEnabled: true };
const OFF = { requireTotp: false, whatsappEnabled: true };

// ── The second factor ───────────────────────────────────────────────────────

test('the approval of this run stands in for the code its maker already spent', async () => {
  const store = freshStore();
  const proposal = approvedProposal(store, { payload: approvedPayload() });

  // The replay posts the approved payload exactly: the payable rows and the
  // currency, and no code.
  assert.equal(proposal.executionPayload.totp, undefined);
  const claim = await resolveApprovalClaim(claimRequest(proposal.id), 'acme', batchScope(proposal.executionPayload));
  assert.equal(claim.approved, true);

  for (const settings of [CODE, WHATSAPP, OFF]) {
    // Neither a code nor a WhatsApp approval is asked of it: the maker's
    // factor was checked, and spent, before the proposal existed.
    assert.deepEqual(batchSecondFactor(claim, settings), { by: 'approval', proposalId: proposal.id });
  }
});

test('anything short of an approval of this run leaves the second factor to the request', async () => {
  const store = freshStore();
  const payload = approvedPayload();
  const [maria, jose] = batchBody().rows;
  const claims = {};

  claims['no claim at all'] = await resolveApprovalClaim(
    new Request('http://splash.test/api/batches/authorize', { method: 'POST' }),
    'acme',
    batchScope(batchBody()),
  );

  const other = approvedProposal(store, { payload });
  claims['an approval of other rows'] = await resolveApprovalClaim(
    claimRequest(other.id),
    'acme',
    batchScope(batchBody({ rows: [{ ...maria, amount: '99999.00' }, jose] })),
  );
  claims['an approval in another currency'] = await resolveApprovalClaim(
    claimRequest(other.id),
    'acme',
    batchScope(batchBody({ targetCurrency: 'MYR' })),
  );

  const payout = approvedProposal(store, { kind: 'PAYMENT', payload });
  claims['a payout approval with the same payload'] = await resolveApprovalClaim(claimRequest(payout.id), 'acme', batchScope(payload));

  const foreign = approvedProposal(store, { payload, orgId: 'northwind' });
  claims["another org's approval"] = await resolveApprovalClaim(claimRequest(foreign.id), 'acme', batchScope(payload));

  const signed = approvedProposal(store, { payload, until: 'SIGNED' });
  claims['signed but not yet submitted'] = await resolveApprovalClaim(claimRequest(signed.id), 'acme', batchScope(payload));

  // Carried out once already: the first replay spent it. A second replay — a
  // settle path run twice, a retried webhook — gets no stand-in, so it cannot
  // run the payroll again without a code.
  const used = approvedProposal(store, { payload });
  assert.equal((await resolveApprovalClaim(claimRequest(used.id), 'acme', batchScope(payload))).approved, true);
  claims['an approval already used'] = await resolveApprovalClaim(claimRequest(used.id), 'acme', batchScope(payload));

  for (const [name, claim] of Object.entries(claims)) {
    assert.equal(claim.approved, false, name);
    assert.deepEqual(batchSecondFactor(claim, CODE), { by: 'request', whatsapp: false }, name);
    assert.deepEqual(batchSecondFactor(claim, WHATSAPP), { by: 'request', whatsapp: true }, name);
    // No second factor required, no WhatsApp approval spent.
    assert.deepEqual(batchSecondFactor(claim, OFF), { by: 'request', whatsapp: false }, name);
  }

  // Presenting another run's approval did not spend it: its own run still goes.
  assert.equal((await resolveApprovalClaim(claimRequest(other.id), 'acme', batchScope(payload))).approved, true);
});

test('a claim is only a stand-in when the store approved it for this request', () => {
  // The route never builds one of these; resolveApprovalClaim does. Anything
  // it did not approve — whatever else the object says — is not a stand-in.
  for (const claim of [
    { approved: false, proposalId: 'prop_x' },
    { approved: false, proposalId: null, reason: 'already used' },
    { approved: true, proposalId: null },
  ]) {
    assert.equal(batchSecondFactor(claim, CODE).by, 'request', JSON.stringify(claim));
    assert.equal(batchRunKey({ claim, headerKey: null, rowsKey: 'rows' }).key, 'rows', JSON.stringify(claim));
  }
});

// ── The run key ─────────────────────────────────────────────────────────────

test('an approved run is claimed under its approval, so identical payrolls approved apart are two runs', async () => {
  const store = freshStore();
  const payload = approvedPayload();
  const rowsKey = 'rows-digest-of-the-payroll';

  // September's payroll and October's: the same file, approved separately.
  const september = approvedProposal(store, { payload });
  const october = approvedProposal(store, { payload });
  const sep = batchRunKey({
    claim: await resolveApprovalClaim(claimRequest(september.id), 'acme', batchScope(payload)),
    headerKey: null,
    rowsKey,
  });
  const oct = batchRunKey({
    claim: await resolveApprovalClaim(claimRequest(october.id), 'acme', batchScope(payload)),
    headerKey: null,
    rowsKey,
  });

  assert.deepEqual(sep, { ok: true, key: `approval:${september.id}`, proposalId: september.id });
  assert.deepEqual(oct, { ok: true, key: `approval:${october.id}`, proposalId: october.id });
  // Keyed by the rows, October's approved run came back as September's run:
  // recorded as carried out, and nobody paid.
  assert.notEqual(sep.key, oct.key);
  assert.equal(APPROVAL_RUN_KEY_PREFIX, 'approval:');

  // A key the request carries does not displace the approval's.
  assert.equal(
    batchRunKey({ claim: { approved: true, proposalId: 'prop_nov' }, headerKey: 'client-key', rowsKey }).key,
    'approval:prop_nov',
  );
});

test("without an approval, the caller's key or the rows' — never an approval's", () => {
  const none = { approved: false, proposalId: null };
  const rowsKey = 'rows-digest';

  assert.deepEqual(batchRunKey({ claim: none, headerKey: 'payroll-2026-09', rowsKey }), {
    ok: true,
    key: 'payroll-2026-09',
    proposalId: null,
  });
  assert.deepEqual(batchRunKey({ claim: none, headerKey: '  payroll-2026-09  ', rowsKey }).key, 'payroll-2026-09');
  for (const absent of [null, undefined, '', '   ']) {
    assert.deepEqual(batchRunKey({ claim: none, headerKey: absent, rowsKey }), { ok: true, key: rowsKey, proposalId: null });
  }

  // Squatting an approval's run key would make the approved run come back as
  // the squatter's run. Refused, whether or not the request carried a claim.
  for (const [claim, headerKey] of [
    [none, 'approval:prop_123'],
    [none, '  approval:prop_123'],
    [none, 'approval:'],
    [{ approved: false, proposalId: null, reason: 'already used' }, 'approval:prop_123'],
  ]) {
    const refused = batchRunKey({ claim, headerKey, rowsKey });
    assert.equal(refused.ok, false, headerKey);
    assert.equal(refused.code, 'reserved_idempotency_key');
    assert.match(refused.error, /reserved/);
  }
});

