// Prompt 10 §5.7 acceptance: the approval moment's back end.
//   - The re-check before the device prompt blocks, with the reason, when the quote ran out or the
//     payee changed; a re-quote then gives a fresh quote that can be approved (a test for each).
//   - Approvals given to a quote that was abandoned don't carry over: they start again, and the card
//     says why ("The rate moved" when You pay changed, else "The quote ran out").
//   - Joint control: "1 of 2 approved" with who approved and who is still to; "Remind" sends one notice.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import * as multisig from '@sqds/multisig';
import bs58 from 'bs58';

import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } from '../lib/solana/recovery-kit.ts';
import { resetRuntime, runtime } from '../lib/solana-app/runtime.ts';
import { resetStore } from '../lib/solana-app/store.ts';
import * as svc from '../lib/solana-app/service.ts';
import { giveDetails } from './helpers/transfer-details.mjs';

beforeEach(() => {
  delete process.env.SPLASH_SOLANA_MODE;
  process.env.SOLANA_PAYMENT_STORE = 'memory';
  resetStore();
  resetRuntime();
});

async function company() {
  const org = svc.createOrg({ companyName: 'Selangor Trading Sdn Bhd', personName: 'Aisyah' });
  const kit = deriveRecoveryKey(generateRecoveryWords());
  const keys = createMemoryDeviceKeyStore();
  const device = await createDeviceKey(keys, org.id);
  const proofs = [];
  for (const c of svc.issueChallenges(org.id, [{ role: 'device', publicKey: device.publicKey }, { role: 'kit', publicKey: kit.publicKey }])) {
    const signer = c.role === 'kit' ? kit : { sign: (m) => signWithDeviceKey(keys, org.id, m) };
    proofs.push({ role: c.role, publicKey: c.publicKey, nonce: c.nonce, signature: await signPossessionChallenge(signer, c) });
  }
  await svc.registerKeys(org.id, proofs);
  kit.destroy();
  await svc.createVault(org.id);
  await svc.fund(org.id);
  return { org, keys, device };
}

/** A second approver's device and threshold 2, the rule Squads itself enforces on chain. */
async function makeJoint(env) {
  const keys2 = createMemoryDeviceKeyStore();
  const device2 = await createDeviceKey(keys2, env.org.id);
  const org = svc.getOrg(env.org.id);
  org.vault.members.push({ role: 'approver_device', publicKey: device2.publicKey });
  org.vault.threshold = 2;
  org.memberNames = { [env.device.publicKey]: 'Aisyah', [device2.publicKey]: 'Daniel' };
  const onChain = runtime().chain.state.multisigs.get(org.vault.multisigPda);
  onChain.threshold = 2;
  onChain.members.push({ key: device2.publicKey, mask: multisig.types.Permissions.all().mask });
  return { keys2, device2 };
}

async function signAs(keys, orgId, prepared) {
  const out = [];
  for (const m of prepared.messages) out.push({ id: m.id, signature: bs58.encode(await signWithDeviceKey(keys, orgId, new Uint8Array(Buffer.from(m.messageBase64, 'base64')))) });
  return out;
}

async function chosen(env, amountPhpMinor = '5000000') {
  const inv = svc.startTransfer(env.org.id, { recipient: { name: 'Manila Freight', bank: 'BDO', accountLast4: '4471' }, amountPhpMinor, verification: { by: 'Aisyah', method: 'call-back' }, by: 'Aisyah' });
  giveDetails(env.org.id, inv.id);
  const p = await svc.quote(env.org.id, inv.id);
  const card = (await svc.paymentView(p.id)).cards[0];
  const checked = await svc.selectRoute(p.id, { quoteId: card.quoteId });
  assert.equal(checked.state, 'checked');
  return { inv, p: checked, card };
}

const QUOTE_GONE = (q) => new Date(Date.parse(q.expiresAt) + 1_000);

test('the re-check blocks when the quote ran out, says so, and a re-quote gives one that can be approved', async () => {
  const env = await company();
  const { p, card } = await chosen(env);
  await assert.rejects(svc.prepareApproval(p.id, {}, QUOTE_GONE(card)), (e) => e.code === 'quote_expired' && /Quote expired/.test(e.message));
  const blocked = await svc.getPayment(p.id);
  assert.equal(blocked.state, 'quote_expired');
  assert.equal(blocked.problem.code, 'quote_expired');

  const fresh = await svc.requote(p.id);
  assert.equal(fresh.state, 'quoted');
  const card2 = (await svc.paymentView(fresh.id)).cards[0];
  assert.notEqual(card2.quoteId, card.quoteId, 'a new quote');
  await svc.selectRoute(fresh.id, { quoteId: card2.quoteId });
  const sent = await svc.submitApproval(fresh.id, { signatures: await signAs(env.keys, env.org.id, await svc.prepareApproval(fresh.id)) });
  assert.equal(sent.state, 'confirmed');
});

test('the re-check blocks when the payee changed, says so, and a re-quote prices the new payee', async () => {
  const env = await company();
  const { inv, p } = await chosen(env);
  // Someone changed where the money goes after the route was chosen.
  svc.getInvoice(env.org.id, inv.id).confirmed.supplierAccountLast4 = '9999';
  await assert.rejects(svc.prepareApproval(p.id), (e) => e.code === 'payee_changed' && /payee or amount changed/.test(e.message));
  const blocked = await svc.getPayment(p.id);
  assert.equal(blocked.state, 'rejected_by_policy');
  assert.equal(blocked.problem.code, 'payee_changed');

  const fresh = await svc.requote(p.id);
  const card = (await svc.paymentView(fresh.id)).cards[0];
  const again = await svc.selectRoute(fresh.id, { quoteId: card.quoteId });
  assert.ok(again.payeeHash && again.payeeHash !== p.payeeHash, 'the new payee is what the approval will cover');
  assert.ok((await svc.prepareApproval(fresh.id)).messages.length > 0);
});

test('joint control: "1 of 2 approved" with who approved and who is still to; Remind sends one notice', async () => {
  const env = await company();
  await makeJoint(env);
  const { p } = await chosen(env);
  const first = await svc.submitApproval(p.id, { signatures: await signAs(env.keys, env.org.id, await svc.prepareApproval(p.id)) });
  assert.equal(first.state, 'proposed', 'one approval of two: nothing moves yet');
  const view = await svc.paymentView(p.id);
  assert.equal(view.approvals.approved, 1);
  assert.equal(view.approvals.threshold, 2);
  assert.deepEqual(view.approvals.approvedBy.map((a) => a.name), ['Aisyah']);
  assert.deepEqual(view.approvals.waitingFor.map((a) => a.name), ['Daniel']);

  const now = new Date();
  const sent = await svc.remindApprover(env.org.id, p.id, 'Aisyah', now);
  assert.equal(sent.sent, true);
  assert.deepEqual(sent.to, ['Daniel']);
  const twice = await svc.remindApprover(env.org.id, p.id, 'Aisyah', new Date(now.getTime() + 60_000));
  assert.equal(twice.sent, false, 'pressing it again within ten minutes sends nothing more');
  const notices = svc.getOrg(env.org.id).notifications.filter((n) => n.paymentId === p.id);
  assert.equal(notices.length, 1, 'one notification');
  assert.equal(notices[0].kind, 'approval_reminder');
  assert.equal(svc.getPayment, svc.getPayment);
  assert.equal((await svc.getPayment(p.id)).state, 'proposed', 'a reminder approves nothing');
});

test('approvals given to an abandoned quote start again after the re-quote, and the card says why', async () => {
  const env = await company();
  const { keys2, device2 } = await makeJoint(env);
  const { p, card } = await chosen(env);
  await svc.submitApproval(p.id, { signatures: await signAs(env.keys, env.org.id, await svc.prepareApproval(p.id)) });
  // Daniel opens it after the quote ran out: the proposal is abandoned, nothing moved.
  await assert.rejects(svc.prepareApproval(p.id, { signer: device2.publicKey }, QUOTE_GONE(card)), (e) => e.code === 'quote_expired');
  assert.equal((await svc.getPayment(p.id)).state, 'proposal_failed');

  const fresh = await svc.requote(p.id);
  assert.deepEqual(fresh.approvedBy, [], 'Aisyah’s approval belonged to the old quote');
  assert.deepEqual(fresh.approvals, [], 'and is not in the new approval chain');
  assert.equal(fresh.transactionIndex, null, 'a new proposal will be made');
  assert.equal(fresh.approvalsReset.previous, 1);
  const card2 = (await svc.paymentView(fresh.id)).cards[0];
  await svc.selectRoute(fresh.id, { quoteId: card2.quoteId });
  const view = await svc.paymentView(fresh.id);
  assert.equal(view.approvals.approved, 0);
  assert.equal(view.approvals.resetNote, card2.youPayUsdcMinor === card.youPayUsdcMinor ? 'The quote ran out; approvals start again.' : 'The rate moved; approvals start again.');

  // Both approve the new quote: only now does the money move.
  const one = await svc.submitApproval(fresh.id, { signatures: await signAs(env.keys, env.org.id, await svc.prepareApproval(fresh.id)) });
  assert.equal(one.state, 'proposed');
  const two = await svc.submitApproval(fresh.id, { signatures: await signAs(keys2, env.org.id, await svc.prepareApproval(fresh.id, { signer: device2.publicKey })) });
  assert.equal(two.state, 'confirmed', 'two approvals on the new quote');
});

test('the reset note: "The rate moved" when You pay changed, else "The quote ran out"', () => {
  assert.equal(svc.resetNoteFor(null, 5n), null);
  assert.equal(svc.resetNoteFor({ at: 'x', previous: 0, previousYouPayMinor: 5n }, 6n), null, 'nothing was approved, nothing to say');
  assert.equal(svc.resetNoteFor({ at: 'x', previous: 1, previousYouPayMinor: 5_012_500_000n }, 5_013_100_000n), 'The rate moved; approvals start again.');
  assert.equal(svc.resetNoteFor({ at: 'x', previous: 1, previousYouPayMinor: 5_012_500_000n }, 5_012_500_000n), 'The quote ran out; approvals start again.');
  assert.equal(svc.resetNoteFor({ at: 'x', previous: 2, previousYouPayMinor: null }, 1n), 'The quote ran out; approvals start again.');
});
