// Prompt 10 §5.3: saved bank recipients with full account numbers (stored as in Phase S).
//   - The number is typed twice; a mismatch blocks saving (the server checks too). Length per bank.
//   - A recipient saved "to check later" can't be paid; the call-back makes it payable.
//   - Paying a saved recipient by id: the partner's instruction gets the full number, read just in time;
//     the payment record keeps bank and last4 only.
//   - Only the payout path and a person's reveal ever open a number.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';

import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } from '../lib/solana/recovery-kit.ts';
import { resetKms } from '../lib/server/kms/index.ts';
import { createRecipient, listRecipients, verifyRecipient } from '../lib/server/bank-recipients.ts';
import { encodeRecord } from '../lib/solana-app/payment-repo.ts';
import { resetRuntime, runtime } from '../lib/solana-app/runtime.ts';
import * as svc from '../lib/solana-app/service.ts';
import { resetStore } from '../lib/solana-app/store.ts';
import { giveDetails } from './helpers/transfer-details.mjs';

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
const MAKER = { isOwner: false, role: 'maker', by: 'Ravi' };
const BDO = '0041 2207 4471';
const manila = (over = {}) => ({ name: 'Manila Freight Services', kind: 'business', registration: 'CS201912345', bankCode: 'BDO', accountNumber: BDO, accountNumberAgain: BDO, holderName: 'Manila Freight Services Inc.', addressLine: '12 Port Area', city: 'Manila', check: { when: 'now', by: 'Aisyah' }, ...over });

test('saving needs the number twice, matching, at a length the bank issues; a business needs its SEC or DTI number', async () => {
  const org = await company();
  await assert.rejects(createRecipient(org.id, manila({ accountNumberAgain: '0041 2207 4472' }), OWNER), (e) => e.status === 422 && /don’t match/.test(e.message) && e.detail.field === 'accountNumberAgain');
  await assert.rejects(createRecipient(org.id, manila({ accountNumber: '12345678901', accountNumberAgain: '12345678901' }), OWNER), (e) => /10 or 12 digits for BDO Unibank/.test(e.message));
  await assert.rejects(createRecipient(org.id, manila({ registration: '' }), OWNER), (e) => /SEC or DTI/.test(e.message));
  await assert.rejects(createRecipient(org.id, manila({ bankCode: 'XXX' }), OWNER), (e) => /bank/.test(e.message));
  await assert.rejects(createRecipient(org.id, manila(), { isOwner: false, role: 'viewer', by: 'V' }), (e) => e.status === 403);
  assert.equal(svc.getOrg(org.id).suppliers.length, 0, 'nothing saved by any of those');
  for (const e of [await createRecipient(org.id, manila({ accountNumberAgain: 'x' }), OWNER).catch((x) => x)]) {
    assert.doesNotMatch(`${e.message} ${JSON.stringify(e.detail ?? {})}`, /004122074471/, 'an error never carries the number');
  }
});

test('a recipient checked now is payable; the list shows last4, the check, and who may see the number', async () => {
  const org = await company();
  const r = await createRecipient(org.id, manila(), MAKER);
  assert.equal(r.payable, true);
  assert.match(r.status, /^Verified \d{1,2} \w{3} by call-back$/);
  assert.equal(r.accountLast4, '4471');
  assert.equal(r.bank, 'BDO Unibank');
  const s = svc.getOrg(org.id).suppliers[0];
  assert.ok(s.secretId, 'the number is in the vault');
  assert.doesNotMatch(JSON.stringify(s), /004122074471/, 'the recipient record never holds it');
  const ownerView = await listRecipients(org.id, OWNER);
  assert.equal(ownerView.recipients[0].canReveal, true);
  assert.equal(ownerView.recipients[0].lastPaid, 'Not paid yet');
  assert.equal((await listRecipients(org.id, MAKER)).recipients[0].canReveal, false, 'a maker sees no "Show number"');
  assert.ok(ownerView.banks.some((b) => b.code === 'BDO' && b.rails === 'InstaPay and PESONet' && b.hint === '10 or 12 digits for BDO Unibank'));
  await assert.rejects(createRecipient(org.id, manila({ name: 'Manila Freight (again)' }), OWNER), (e) => e.status === 409 && /already saved, as Manila Freight Services/.test(e.message), 'the same account twice is one recipient');
});

test('saved to check later: it can’t be paid; after the call-back it pays, and the partner gets the number the payment never keeps', async () => {
  const org = await company();
  const r = await createRecipient(org.id, manila({ check: { when: 'later' } }), OWNER);
  assert.equal(r.payable, false);
  assert.equal(r.status, 'Not verified');

  const pay = async () => {
    const inv = svc.startTransfer(org.id, { recipientId: r.id, amountPhpMinor: '5000000', by: 'Aisyah' });
    giveDetails(org.id, inv.id);
    const p = await svc.quote(org.id, inv.id);
    const card = (await svc.paymentView(p.id)).cards[0];
    return { inv, p: await svc.selectRoute(p.id, { quoteId: card.quoteId }) };
  };
  const held = await pay();
  assert.equal(held.inv.bankStatus, 'changed');
  assert.equal(held.p.state, 'rejected_by_policy');
  assert.equal(held.p.problem.code, 'bank_unverified', 'an unchecked recipient can’t be paid');

  verifyRecipient(org.id, r.id, { by: 'Aisyah' }, OWNER);
  const requests = [];
  const partner = runtime().partner;
  const real = partner.createPayout.bind(partner);
  partner.createPayout = (req) => {
    requests.push(req);
    return real(req);
  };
  const ok = await pay();
  assert.equal(ok.inv.bankStatus, 'known');
  assert.equal(ok.p.state, 'checked', 'checked and unchanged: payable');
  assert.equal(requests.at(-1).beneficiary.accountNumber, '004122074471', 'the partner’s instruction carries the full number');
  const stored = JSON.stringify(encodeRecord(await svc.getPayment(ok.p.id)));
  assert.doesNotMatch(stored, /004122074471/, 'the payment record keeps bank and last4 only');
  assert.match(stored, /4471/);
});

test('only the payout path and a person’s reveal open a number', () => {
  const callers = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name) && /\bopenNumber\(/.test(readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''))) callers.push(full.replaceAll('\\', '/'));
    }
  };
  for (const root of ['app', 'components', 'lib']) walk(root);
  assert.deepEqual(callers.sort(), ['lib/server/bank-details.ts', 'lib/server/pii-vault.ts', 'lib/solana-app/payout-number.ts']);
});

test('the partner’s questions about the recipient are asked once, in the sheet: a transfer asks only about itself', async () => {
  const org = await company();
  const person = await createRecipient(org.id, manila({ name: 'Rosa Dela Cruz', kind: 'person', registration: null, personId: '1990-04-12', accountNumber: '0041 2207 5555', accountNumberAgain: '0041 2207 5555' }), OWNER);
  await assert.rejects(createRecipient(org.id, manila({ name: 'Ana Reyes', kind: 'person', registration: null, personId: '', accountNumber: '0041 2207 6666', accountNumberAgain: '0041 2207 6666' }), OWNER), (e) => /ID number or date of birth/.test(e.message));
  const saved = svc.getOrg(org.id).suppliers.find((s) => s.id === person.id);
  assert.deepEqual(saved.partnerRecipient, { type: 'individual', registrationNumber: null, idNumber: null, dateOfBirth: '1990-04-12', addressLine1: '12 Port Area', addressCity: 'Manila', addressCountry: 'PH', accountName: 'Manila Freight Services Inc.' });
  const { setTransferDetails } = await import('../lib/solana-app/transfer-details.ts');
  const inv = svc.startTransfer(org.id, { recipientId: person.id, amountPhpMinor: '5000000', by: 'Aisyah' });
  const d = setTransferDetails(org.id, inv.id, { details: { purpose: 'services', description: 'Design work, October', relationship: 'contractor', sourceOfFunds: 'business_revenue' } }, 'Aisyah');
  assert.equal(d.recipient.type, 'individual', 'from the saved recipient');
  assert.equal(d.recipient.dateOfBirth, '1990-04-12');
});
