// Prompt 10 §7A (frame Flow-Zeke, §10's e2e list): "What's due this week?" is answered from the
// company's own bills. The offline planner lists what is due in the next 7 days, and a drafted payment
// becomes a ticket that opens on Transfer, where a person approves it on a device. Nothing is drafted,
// approved or moved by the answer itself.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } from '../lib/solana/recovery-kit.ts';
import { resetKms } from '../lib/server/kms/index.ts';
import { payBill, recordCallBack } from '../lib/solana-app/bills.ts';
import { resetRuntime } from '../lib/solana-app/runtime.ts';
import * as svc from '../lib/solana-app/service.ts';
import { resetStore } from '../lib/solana-app/store.ts';
import { dueThisWeek } from '../lib/solana-app/due-this-week.ts';
import { runOxwalAgent } from '../lib/agent/oxwal.ts';

beforeEach(() => {
  delete process.env.SPLASH_SOLANA_MODE;
  process.env.SOLANA_PAYMENT_STORE = 'memory';
  resetStore();
  resetRuntime();
  resetKms();
});

async function company() {
  const org = svc.createOrg({ companyName: 'Selangor Trading Sdn Bhd', personName: 'Aisyah Rahman' });
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

/** The sample invoice is due 30 Oct 2026. */
const DUE = '2026-10-30';
const daysBefore = (n) => new Date(Date.parse(`${DUE}T02:00:00Z`) - n * 86_400_000);

test('nothing due: says so, names the next bill, and offers no draft', async () => {
  const org = await company();
  assert.deepEqual(await dueThisWeek(org.id, daysBefore(20)), { text: 'Nothing is due this week, and no unpaid bills are waiting.', handoff: null });
  await svc.readInvoiceDraft(org.id, { sample: true });
  const a = await dueThisWeek(org.id, daysBefore(20));
  assert.match(a.text, /^Nothing is due this week\. The next bill is .+'s .+, ₱[\d,]+\.\d\d, due 30 Oct\.$/);
  assert.equal(a.handoff, null);
});

test('a bill due this week: listed; before it is checked, the ticket opens Check the invoice', async () => {
  const org = await company();
  const { invoice } = await svc.readInvoiceDraft(org.id, { sample: true });
  const a = await dueThisWeek(org.id, daysBefore(3));
  assert.match(a.text, /^One bill is due this week:\n• .+, .+, ₱[\d,]+\.\d\d, due 30 Oct\nCheck the first one before it can be paid\.$/);
  assert.equal(a.handoff.href, `/dashboard/invoices/pay?invoice=${invoice.id}`);
  assert.equal(a.handoff.cta, 'Open to review');
});

test('a drafted payment: the ticket opens it on Transfer, not approved', async () => {
  const org = await company();
  const { invoice } = await svc.readInvoiceDraft(org.id, { sample: true });
  recordCallBack(org.id, invoice.id, { by: 'Aisyah', spokeTo: 'Rhea', numberCalled: '+63 2 8700 1100' });
  const fields = Object.fromEntries(Object.entries(invoice.draft.fields).map(([k, v]) => [k, String(v)]));
  const p = await payBill(org.id, invoice.id, { by: 'Aisyah', fields, confirmed: invoice.draft.needsConfirmation });
  const view = await svc.paymentView(p.id);
  await svc.selectRoute(p.id, { quoteId: view.cards[0].quoteId });
  const a = await dueThisWeek(org.id, daysBefore(2));
  assert.match(a.text, /It's not approved: you approve it in Transfer, on your device\.$/);
  assert.equal(a.handoff.href, `/dashboard/transfer?payment=${p.id}&step=quote`);
  assert.match(a.handoff.lines[0], /^You pay about US\$[\d,]+\.\d\d · due 30 Oct$/);
  // Reading changed nothing: the payment is still where it was.
  assert.equal((await svc.paymentView(p.id)).state, 'checked');
});

test('the offline planner answers "What\'s due this week?" from the bills, with the ticket as a handoff', async () => {
  const org = await company();
  await svc.readInvoiceDraft(org.id, { sample: true });
  const events = [];
  for await (const e of runOxwalAgent({ forceLocal: true, orgId: org.id, message: 'What’s due this week?' })) events.push(e);
  const said = events.filter((e) => e.type === 'delta').map((e) => e.text).join('');
  assert.match(said, /due this week/);
  assert.equal(events.some((e) => e.type === 'proposal'), false, 'no proposal: the answer drafts nothing');
});
