// Sky, 13 Oct: Step 3 asks what the payout partner needs with a transfer. Purchase of goods or of
// services, what was bought, where the money comes from, the relationship; and, the first time a
// recipient is paid, who they are. The next transfer to them asks "Same details as before?".
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } from '../lib/solana/recovery-kit.ts';
import { resetRuntime } from '../lib/solana-app/runtime.ts';
import { resetStore } from '../lib/solana-app/store.ts';
import * as svc from '../lib/solana-app/service.ts';
import * as details from '../lib/solana-app/transfer-details.ts';
import { SAMPLE_DETAILS } from './helpers/transfer-details.mjs';

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
  return { org };
}

const recipient = { name: 'Davao Packaging Corp.', bank: 'BPI', accountLast4: '0910' };
const callBack = { by: 'Aisyah', method: 'call-back' };

async function quoted(env, r = recipient) {
  const inv = svc.startTransfer(env.org.id, { recipient: r, amountPhpMinor: '5000000', verification: callBack, by: 'Aisyah' });
  const p = await svc.quote(env.org.id, inv.id);
  const card = (await svc.paymentView(p.id)).cards.find((c) => c.kind === 'solana_direct');
  return { inv, p, card };
}

test('no route can be chosen for a transfer until the partner’s details are given, and the card says what is missing', async () => {
  const env = await company();
  const { p, card } = await quoted(env);
  await assert.rejects(svc.selectRoute(p.id, { quoteId: card.quoteId }), (e) => {
    assert.equal(e.code, 'details_required');
    assert.ok(e.detail.missing.includes('Purpose of payment'));
    return true;
  });
});

test('the first transfer to a recipient asks everything; the purpose rides on the approval card', async () => {
  const env = await company();
  const { inv, p, card } = await quoted(env);
  assert.equal(details.previousDetails(env.org.id, inv.id), null, 'nothing to offer the first time');
  const given = details.setTransferDetails(env.org.id, inv.id, { details: SAMPLE_DETAILS }, 'Aisyah');
  assert.equal(given.reused, false);
  assert.equal(given.recipient.idNumber, null, 'a business gives a registration number, not a personal ID');
  const checked = await svc.selectRoute(p.id, { quoteId: card.quoteId });
  assert.equal(checked.approval.purpose, 'Purchase of goods: Corrugated cartons, October order');
  const view = await svc.paymentView(p.id);
  assert.equal(view.invoice.details.purposeLabel, 'Purchase of goods');
  assert.equal(view.invoice.details.relationshipLabel, 'Supplier, not related to us');
});

test('the next transfer to the same recipient offers the same details; yes copies them', async () => {
  const env = await company();
  const first = await quoted(env);
  details.setTransferDetails(env.org.id, first.inv.id, { details: SAMPLE_DETAILS }, 'Aisyah');
  // The same recipient, typed with different spacing and case.
  const second = await quoted(env, { name: '  davao packaging   CORP. ', bank: 'bpi', accountLast4: '0910' });
  const offered = details.previousDetails(env.org.id, second.inv.id);
  assert.equal(offered.description, SAMPLE_DETAILS.description);
  const reused = details.setTransferDetails(env.org.id, second.inv.id, { reuse: true }, 'Hafiz');
  assert.equal(reused.reused, true);
  assert.equal(reused.givenBy, 'Hafiz', 'who said "yes, the same" is recorded');
  assert.deepEqual(reused.recipient, first.inv.paymentDetails.recipient);
  const checked = await svc.selectRoute(second.p.id, { quoteId: second.card.quoteId });
  assert.match(checked.approval.purpose, /^Purchase of goods/);

  const stranger = await quoted(env, { name: 'Cebu Logistics Inc.', bank: 'BDO', accountLast4: '7781' });
  assert.equal(details.previousDetails(env.org.id, stranger.inv.id), null, 'another recipient is asked afresh');
  assert.throws(() => details.setTransferDetails(env.org.id, stranger.inv.id, { reuse: true }, 'Aisyah'), (e) => e.code === 'bad_request');
});

test('no means every answer again: an individual needs a date of birth or ID number, a business its registration', async () => {
  const env = await company();
  const first = await quoted(env);
  details.setTransferDetails(env.org.id, first.inv.id, { details: SAMPLE_DETAILS }, 'Aisyah');
  const second = await quoted(env);
  const individual = { ...SAMPLE_DETAILS, purpose: 'services', description: 'Design work, October', relationship: 'contractor', recipient: { ...SAMPLE_DETAILS.recipient, type: 'individual', registrationNumber: null, idNumber: null, dateOfBirth: null } };
  assert.throws(() => details.setTransferDetails(env.org.id, second.inv.id, { details: individual }, 'Aisyah'), (e) => e.code === 'bad_request' && e.detail.missing.includes('Date of birth or ID number'));
  const given = details.setTransferDetails(env.org.id, second.inv.id, { details: { ...individual, recipient: { ...individual.recipient, dateOfBirth: '1990-04-12' } } }, 'Aisyah');
  assert.equal(given.recipient.registrationNumber, null);
  assert.equal(first.inv.paymentDetails.purpose, 'goods', 'the first transfer keeps what accompanied it');
  assert.equal(details.previousDetails(env.org.id, second.inv.id).purpose, 'services', 'the newest answers are offered next time');

  const noReg = { ...SAMPLE_DETAILS, recipient: { ...SAMPLE_DETAILS.recipient, registrationNumber: '' } };
  assert.deepEqual(details.missingDetails(noReg), ['Company registration number']);
  assert.deepEqual(details.missingDetails({ ...SAMPLE_DETAILS, purpose: 'gift' }), ['Purpose of payment'], 'only goods or services');
});

test('an owner can take a recipient off the saved list: its saved answers go too, and the next transfer starts with a call-back', async () => {
  const env = await company();
  const org = svc.getOrg(env.org.id);
  org.suppliers.push({ name: recipient.name, bank: recipient.bank, accountLast4: recipient.accountLast4, verified: { by: 'Aisyah', method: 'call-back', at: new Date().toISOString() } });
  org.suppliers.push({ name: 'Cebu Logistics Inc.', bank: 'BDO', accountLast4: '7781', verified: { by: 'Aisyah', method: 'call-back', at: new Date().toISOString() } });
  const first = await quoted(env);
  assert.equal(first.inv.bankStatus, 'known', 'a saved recipient is known');
  details.setTransferDetails(env.org.id, first.inv.id, { details: SAMPLE_DETAILS }, 'Aisyah');

  assert.equal(svc.removeSupplier(env.org.id, recipient), 1, 'one recipient left');
  assert.deepEqual(org.suppliers.map((s) => s.name), ['Cebu Logistics Inc.'], 'only that recipient is removed');
  assert.equal(first.inv.paymentDetails.purpose, 'goods', 'a transfer already made keeps what went with it');

  const again = svc.startTransfer(env.org.id, { recipient, amountPhpMinor: '5000000', by: 'Aisyah' });
  assert.equal(again.bankStatus, 'new', 'paying them again needs a new call-back');
  assert.equal(details.previousDetails(env.org.id, again.id), null, 'the partner’s questions are asked again');
  assert.throws(() => svc.removeSupplier(env.org.id, recipient), (e) => e.code === 'bad_request' && /not on your saved list/.test(e.message));
});
