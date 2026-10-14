// Prompt 10 Phase S §S.1.7 and §S.2: changed bank details block payment until the call-back passes.
// A saved recipient pays as "known"; after new details are stored it reads as "changed", so the rules
// refuse the quote (bank_unverified), the same refusal as a new supplier; a call-back makes it payable.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } from '../lib/solana/recovery-kit.ts';
import { resetKms } from '../lib/server/kms/index.ts';
import { markBankDetailsVerified, saveBankNumber } from '../lib/server/bank-details.ts';
import { resetRuntime } from '../lib/solana-app/runtime.ts';
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

/** A transfer to the saved recipient, as far as the rules: the payment's state and problem. */
async function tryToPay(orgId, last4) {
  const inv = svc.startTransfer(orgId, { recipient: { name: 'Manila Freight', bank: 'BPI', accountLast4: last4 }, amountPhpMinor: '5000000', by: 'Aisyah' });
  giveDetails(orgId, inv.id);
  const p = await svc.quote(orgId, inv.id);
  const card = (await svc.paymentView(p.id)).cards[0];
  const chosen = await svc.selectRoute(p.id, { quoteId: card.quoteId });
  return { bankStatus: svc.getInvoice(orgId, inv.id).bankStatus, state: chosen.state, problem: chosen.problem?.code ?? null };
}

test('a saved, verified recipient pays; new details hold it until a call-back passes', async () => {
  const org = await company();
  org.suppliers.push({ id: 'sup_manila', name: 'Manila Freight', bank: 'BPI', accountLast4: '4471', verified: { by: 'Aisyah', method: 'call-back', at: '2026-10-01T00:00:00.000Z' } });
  await saveBankNumber(org.id, 'sup_manila', { bankCode: 'BPI', accountNumber: '123456784471' });

  const before = await tryToPay(org.id, '4471');
  assert.equal(before.bankStatus, 'known');
  assert.notEqual(before.state, 'rejected_by_policy');

  await saveBankNumber(org.id, 'sup_manila', { bankCode: 'BPI', accountNumber: '999900002290' });
  const held = await tryToPay(org.id, '2290');
  assert.equal(held.bankStatus, 'changed', 'new details read as changed, even though the recipient is saved');
  assert.equal(held.state, 'rejected_by_policy');
  assert.equal(held.problem, 'bank_unverified');

  markBankDetailsVerified(org.id, 'sup_manila', 'Aisyah', 'call-back');
  const after = await tryToPay(org.id, '2290');
  assert.equal(after.bankStatus, 'known');
  assert.notEqual(after.state, 'rejected_by_policy', 'payable once the call-back passed');
});
