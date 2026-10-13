// Sky, 14 Oct: a payment nothing was sent for can be discarded, and a transfer's answers for the
// payout partner are frozen once it is sent. Offline, through the services.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import bs58 from 'bs58';

import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } from '../lib/solana/recovery-kit.ts';
import { canTransition, DISCARDABLE_STATES, isTerminal, PAYMENT_STATES } from '../lib/solana-app/payment-machine.ts';
import { resetRuntime, runtime } from '../lib/solana-app/runtime.ts';
import { resetStore } from '../lib/solana-app/store.ts';
import * as funding from '../lib/solana-app/funding-service.ts';
import * as svc from '../lib/solana-app/service.ts';
import * as details from '../lib/solana-app/transfer-details.ts';
import { giveDetails, SAMPLE_DETAILS } from './helpers/transfer-details.mjs';

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
  return { org, keys };
}

async function sign(env, prepared) {
  const out = [];
  for (const m of prepared.messages) out.push({ id: m.id, signature: bs58.encode(await signWithDeviceKey(env.keys, env.org.id, new Uint8Array(Buffer.from(m.messageBase64, 'base64')))) });
  return out;
}

const recipient = { name: 'Davao Packaging Corp.', bank: 'BPI', accountLast4: '0910' };
const callBack = { by: 'Aisyah', method: 'call-back' };

async function quoted(env) {
  const inv = svc.startTransfer(env.org.id, { recipient, amountPhpMinor: '5000000', verification: callBack, by: 'Aisyah' });
  giveDetails(env.org.id, inv.id);
  const p = await svc.quote(env.org.id, inv.id);
  const card = (await svc.paymentView(p.id)).cards.find((c) => c.kind === 'solana_direct');
  return { inv, p, card };
}

test('the machine: discarded is terminal, and only states where nothing was sent can reach it', () => {
  assert.ok(PAYMENT_STATES.includes('discarded'));
  assert.ok(isTerminal('discarded'));
  for (const s of PAYMENT_STATES) {
    assert.equal(canTransition(s, 'discarded'), DISCARDABLE_STATES.includes(s), `${s} → discarded`);
  }
  for (const sent of ['proposed', 'approved', 'executed', 'confirmed', 'partner_paid', 'evidenced', 'anchored', 'execute_failed', 'partner_failed']) {
    assert.ok(!DISCARDABLE_STATES.includes(sent), `${sent} cannot be discarded`);
  }
});

test('a quoted or checked transfer can be discarded: it leaves the lists, keeps its record, and takes nothing more', async () => {
  const env = await company();
  const a = await quoted(env);
  const b = await quoted(env);
  await svc.selectRoute(b.p.id, { quoteId: b.card.quoteId });
  const before = (await svc.orgSummary(env.org.id)).payments;
  assert.ok(before.every((x) => x.discardable), 'quoted and checked rows offer discard');

  const da = await svc.discardPayment(a.p.id, 'Aisyah');
  const db = await svc.discardPayment(b.p.id, 'Aisyah');
  assert.equal(da.state, 'discarded');
  assert.equal(db.state, 'discarded');
  assert.equal((await svc.discardPayment(a.p.id, 'Aisyah')).state, 'discarded', 'discarding twice is a no-op');

  const summary = await svc.orgSummary(env.org.id);
  assert.equal(summary.payments.length, 0, 'discarded payments leave the company lists');
  const stored = await runtime().payments.get(a.p.id);
  assert.equal(stored.state, 'discarded', 'the record itself stays');

  await assert.rejects(svc.selectRoute(a.p.id, { quoteId: a.card.quoteId }), (e) => e.code === 'wrong_state');
  await assert.rejects(svc.requote(a.p.id), () => true);
  await assert.rejects(
    funding.startFunding(env.org.id, a.p.id, { method: 'stripe', quoteId: a.card.quoteId, sourceOfFunds: 'business_revenue', declared: true, by: 'Aisyah' }),
    (e) => e.code === 'wrong_state' && /discarded/.test(e.message),
  );
});

test('a sent payment cannot be discarded, and its answers for the partner are frozen', async () => {
  const env = await company();
  const { inv, p, card } = await quoted(env);
  await details.assertDetailsEditable(env.org.id, inv.id); // before it is sent: editable
  await svc.selectRoute(p.id, { quoteId: card.quoteId });
  const sent = await svc.submitApproval(p.id, { signatures: await sign(env, await svc.prepareApproval(p.id)) });
  assert.equal(sent.state, 'confirmed');

  await assert.rejects(svc.discardPayment(p.id, 'Aisyah'), (e) => e.code === 'wrong_state' && /nothing was sent/.test(e.message));
  await assert.rejects(details.assertDetailsEditable(env.org.id, inv.id), (e) => e.code === 'wrong_state' && /part of its record/.test(e.message));
  assert.equal((await svc.orgSummary(env.org.id)).payments.find((x) => x.id === p.id).discardable, false);
});

test('a discarded transfer takes no new answers', async () => {
  const env = await company();
  const { inv, p } = await quoted(env);
  await svc.discardPayment(p.id, 'Aisyah');
  await assert.rejects(details.assertDetailsEditable(env.org.id, inv.id), (e) => e.code === 'wrong_state' && /discarded/.test(e.message));
  // The answers already saved for the recipient stay offered for the next transfer.
  const next = svc.startTransfer(env.org.id, { recipient, amountPhpMinor: '5000000', verification: callBack, by: 'Aisyah' });
  assert.equal(details.previousDetails(env.org.id, next.id).description, SAMPLE_DETAILS.description);
});
