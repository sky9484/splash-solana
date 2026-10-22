import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * The other half of "this needs a second approver".
 *
 * Both money routes detected the case and neither did anything with it: a 409
 * saying "submit it through the approval queue", and nothing put in the
 * approval queue. A control that stops work without offering the sanctioned
 * path is one people route around — by splitting the payment under the
 * threshold, which is worse than having no threshold at all.
 */

async function source(file) {
  return readFile(new URL(`../${file}`, import.meta.url), 'utf8');
}

test('the proposal is simulated, because the submit route refuses one that is not', async () => {
  const submit = await source('app/api/proposals/[id]/submit/route.ts');
  assert.match(submit, /must be simulated before submission/);

  const text = await source('lib/server/dual-approval.ts');
  assert.match(text, /type: 'SIMULATION_COMPLETED'/);
  // Honest about what that simulation is: the gates already cleared and the
  // money movement, not a claim that a chain dry-run happened.
  assert.match(text, /not a chain dry-run|does not claim a chain dry-run/);
});

test('the submit route still enforces maker ≠ checker against the DB identity', async () => {
  const submit = await source('app/api/proposals/[id]/submit/route.ts');
  // The control this whole path exists to reach. Unchanged, and asserted here
  // because the proposals now arriving at it come from the money routes.
  assert.match(submit, /Maker cannot approve their own proposal/);
  assert.match(submit, /proposal\.createdBy === ctx\.userId/);
  assert.match(submit, /a second approver must sign from the queue/);
});

test('the compliance gate can actually open once the beneficiary is screened', async () => {
  // Before this, the COUNTERPARTY evidence ref was the beneficiary's NAME.
  // `resolveComplianceForProposal` reads those refs as ids and looks the
  // screening record up by them, so a prose ref could never resolve — the gate
  // blocked forever rather than failing closed once. A control nobody can pass
  // is the same dead end this change exists to close.
  delete process.env.DATABASE_URL;
  const { resolveComplianceForProposal } = await import(
    '../lib/compliance/proposal-screening.ts'
  );
  const { upsertOxwalCounterpartyFixture } = await import('../lib/agent/oxwal.ts');

  const proposal = {
    kind: 'PAYMENT',
    explain: {
      evidence: [{ source: 'COUNTERPARTY', ref: 'rcpt_unscreened_1', observedAt: '', trusted: true }],
    },
  };

  const before = resolveComplianceForProposal(proposal);
  assert.equal(before.kytPassed, false, 'an unscreened beneficiary is blocked');
  assert.ok(before.flags.includes('COUNTERPARTY_NOT_FOUND'));

  upsertOxwalCounterpartyFixture({
    id: 'rcpt_unscreened_1',
    name: 'Davao Freight Co',
    country: 'PH',
    kybStatus: 'VERIFIED',
    kytPassed: true,
    sanctionsClear: true,
  });

  const after = resolveComplianceForProposal(proposal);
  assert.equal(after.kytPassed, true);
  assert.equal(after.kybStatus, 'VERIFIED');
  assert.deepEqual(after.flags, [], 'and it opens once the record exists');
});

