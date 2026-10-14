// Prompt 10 §5.6 and §5.8, through the services: what Transfer's Step 3 reads, and "Save as template".
//   - Two lanes labelled "Cheapest" and "Fastest" only (never a network, never a time); the map's link
//     count is stepCount; the cost card's lines add up to "You pay", in integers.
//   - "Passed 8 of 8 rules" is a read: it changes nothing.
//   - A template keeps who and how much, never a bank number; the same one twice is one template.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } from '../lib/solana/recovery-kit.ts';
import { resetKms } from '../lib/server/kms/index.ts';
import { createRecipient } from '../lib/server/bank-recipients.ts';
import { resetRuntime } from '../lib/solana-app/runtime.ts';
import * as svc from '../lib/solana-app/service.ts';
import { resetStore } from '../lib/solana-app/store.ts';
import { deleteTemplate, listTemplates, saveTemplate } from '../lib/solana-app/templates.ts';
import { setTransferDetails } from '../lib/solana-app/transfer-details.ts';

beforeEach(() => {
  delete process.env.SPLASH_SOLANA_MODE;
  process.env.SOLANA_PAYMENT_STORE = 'memory';
  resetStore();
  resetRuntime();
  resetKms();
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
  return org;
}

const OWNER = { isOwner: true, role: 'admin', by: 'Aisyah' };
const BDO = '0041 2207 4471';
const manila = { name: 'Manila Freight Services', kind: 'business', registration: 'CS201912345', bankCode: 'BDO', accountNumber: BDO, accountNumberAgain: BDO, holderName: 'Manila Freight Services Inc.', addressLine: '12 Port Area', city: 'Manila', check: { when: 'now', by: 'Aisyah' } };
const ANSWERS = { purpose: 'services', description: 'Sea freight, October', relationship: 'supplier', sourceOfFunds: 'business_revenue' };

async function quoted(orgId, amountPhpMinor = '28700000', saved = null) {
  const r = saved ?? (await createRecipient(orgId, manila, OWNER));
  const inv = svc.startTransfer(orgId, { recipientId: r.id, amountPhpMinor, by: 'Aisyah' });
  setTransferDetails(orgId, inv.id, { details: ANSWERS }, 'Aisyah');
  const p = await svc.quote(orgId, inv.id);
  return { r, inv, p, view: await svc.paymentView(p.id) };
}

test('two lanes, "Cheapest" and "Fastest" only; links on the map are stepCount; the cost lines add up', async () => {
  const org = await company();
  const { view } = await quoted(org.id);
  assert.deepEqual(view.laneNames, { cheapest: 'Cheapest', fastest: 'Fastest' });
  const routes = [...view.cards, ...(view.compare ? [view.compare] : [])];
  assert.ok(routes.length >= 2, 'a route to choose and one to compare');
  for (const c of view.cards) {
    assert.ok(c.labels.length > 0 && c.labels.every((l) => l === 'Cheapest' || l === 'Fastest'), `labels: ${c.labels}`);
  }
  assert.deepEqual(new Set(view.cards.flatMap((c) => c.labels)), new Set(['Cheapest', 'Fastest']), 'both labels are on the lanes');
  for (const c of routes) {
    assert.equal(c.steps, c.lowerCostLane ? 3 : 2, 'the map draws exactly stepCount links');
    assert.equal(c.costs.amountMinor + c.costs.routeMinor + c.costs.partnerMinor + c.costs.splashMinor, c.youPayUsdcMinor, 'the cost card adds up to You pay');
    for (const v of [c.costs.amountMinor, c.costs.partnerMinor, c.costs.splashMinor, c.youPayUsdcMinor]) assert.equal(typeof v, 'bigint');
    const words = JSON.stringify({ labels: c.labels, label: c.label, laneLine: c.laneLine, solNote: c.solNote, arrives: c.arrives });
    assert.doesNotMatch(words, /\b(Polygon|Solana|CCTP|bridge)\b/i, 'never a network on a lane');
    assert.doesNotMatch(words, /\b(seconds?|minutes?|hours?|same day|arrives? by|instant)\b/i, 'never a time');
  }
});

test('"Passed 8 of 8 rules" is a read: the payment is exactly as it was', async () => {
  const org = await company();
  const { p, view } = await quoted(org.id);
  const before = await svc.getPayment(p.id);
  const checks = await svc.previewChecks(p.id, view.cards[0].quoteId);
  assert.equal(checks.passed, checks.total, 'a checked recipient within the limits passes every rule');
  assert.ok(checks.total >= 6);
  assert.ok(checks.checks.every((c) => typeof c.label === 'string' && c.label.length > 0));
  const after = await svc.getPayment(p.id);
  assert.equal(after.state, before.state);
  assert.equal(after.version, before.version, 'no transition was written');
  assert.equal(after.policy, before.policy);
  await assert.rejects(svc.previewChecks(p.id, 'rq_nope'), (e) => e.status === 400);
});

test('save as template: who and how much, never the number; the same one twice is one template', async () => {
  const org = await company();
  const { r, p } = await quoted(org.id);
  const t = await saveTemplate(org.id, p.id, 'Aisyah');
  assert.equal(t.to, 'bank');
  assert.equal(t.recipientId, r.id);
  assert.equal(t.amountPhpMinor, 28_700_000n);
  assert.equal(t.purpose, 'services');
  assert.equal(t.description, 'Sea freight, October');
  assert.doesNotMatch(JSON.stringify(t, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)), /004122074471/, 'a template never holds the account number');
  assert.equal((await saveTemplate(org.id, p.id, 'Aisyah')).id, t.id, 'the same recipient and amount is one template');
  const other = await quoted(org.id, '1000000', r);
  const t2 = await saveTemplate(org.id, other.p.id, 'Aisyah');
  assert.notEqual(t2.id, t.id);
  assert.deepEqual(listTemplates(org.id).map((x) => x.id), [t2.id, t.id], 'newest first');
  deleteTemplate(org.id, t.id);
  assert.deepEqual(listTemplates(org.id).map((x) => x.id), [t2.id]);
  assert.throws(() => deleteTemplate(org.id, t.id), (e) => e.status === 404);
});
