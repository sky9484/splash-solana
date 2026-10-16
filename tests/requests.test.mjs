// Prompt 10 §6.3: Get paid.
//   - A request to a business on Splash lands in its own "Pay an invoice" inbox, ready to pay, and is
//     paid with a `peer` payment into the requester's own account; then the request is paid, with a
//     receipt of kind 5 (`receivable`) that verifies.
//   - Someone else gets a link; the page shows the requester's own account and never a Splash-owned
//     address; a transfer with the reference and the exact amount pays it (test mode: the simulator).
//   - Lines are integers: quantity × unit price in US$ minor units.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import bs58 from 'bs58';

import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } from '../lib/solana/recovery-kit.ts';
import { resetKms } from '../lib/server/kms/index.ts';
import { balanceFor } from '../lib/solana-app/balance.ts';
import { billsView, payBill } from '../lib/solana-app/bills.ts';
import { cancelRequest, createRequest, overdueRequests, payLinkView, receiveIntoAccount, requestsView, sendRequest, simulateLinkPayment } from '../lib/solana-app/requests.ts';
import { resetRuntime, runtime, splashKeys } from '../lib/solana-app/runtime.ts';
import * as svc from '../lib/solana-app/service.ts';
import { resetStore, store } from '../lib/solana-app/store.ts';

beforeEach(() => {
  delete process.env.SPLASH_SOLANA_MODE;
  process.env.SOLANA_PAYMENT_STORE = 'memory';
  resetStore();
  resetRuntime();
  resetKms();
});

async function company(name) {
  const org = svc.createOrg({ companyName: name, personName: 'Aisyah Rahman' });
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
  const vault = await svc.createVault(org.id);
  return { org, keys, vault };
}

async function signAll(env, prepared) {
  const out = [];
  for (const m of prepared.messages) out.push({ id: m.id, signature: bs58.encode(await signWithDeviceKey(env.keys, env.org.id, new Uint8Array(Buffer.from(m.messageBase64, 'base64')))) });
  return out;
}

const LINES = [
  { description: 'Hardwood pallets', quantity: '250', unitMinor: '15000000' },
  { description: 'Delivery to Kota Kinabalu port', quantity: '1', unitMinor: '1000000000' },
];
const NOW = new Date('2026-10-14T03:00:00.000Z');
const text = (x) => JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

test('a request is integers: quantity × unit price; whole cents; a number used once; a due date ahead', async () => {
  const me = await company('Sabah Timber Works Sdn Bhd');
  const payer = { kind: 'external', name: 'Batam Trade Partners', email: 'accounts@example.com' };
  const r = createRequest(me.org.id, { payer, number: 'SEL-0096', dueDate: '2026-11-06', lines: LINES }, 'Aisyah', NOW);
  assert.deepEqual(r.lines.map((l) => l.amountMinor), [3_750_000_000n, 1_000_000_000n]);
  assert.equal(r.amountMinor, 4_750_000_000n, 'US$4,750.00');
  assert.equal(r.state, 'draft', 'nothing is sent until "Send request"');
  assert.throws(() => createRequest(me.org.id, { payer, number: 'sel-0096', dueDate: '2026-11-06', lines: LINES }, 'A', NOW), (e) => e.code === 'duplicate_number');
  assert.throws(() => createRequest(me.org.id, { payer, number: 'SEL-0097', dueDate: '2026-11-06', lines: [{ description: 'Half a cent', quantity: '1', unitMinor: '15000001' }] }, 'A', NOW), (e) => e.status === 422);
  assert.throws(() => createRequest(me.org.id, { payer, number: 'SEL-0098', dueDate: '2026-10-01', lines: LINES }, 'A', NOW), /past/);
  assert.throws(() => createRequest(me.org.id, { payer: { ...payer, email: 'nope' }, number: 'SEL-0099', dueDate: '2026-11-06', lines: LINES }, 'A', NOW), /email/);
});

test('a request to a business on Splash: in its inbox ready to pay, paid into the requester’s own account, proof kind 5', async () => {
  const requester = await company('Kuching Marine Supply Sdn Bhd');
  const payer = await company('Selangor Trading Sdn Bhd');
  await svc.fund(payer.org.id);
  const chain = runtime().chain;
  const before = await chain.getUsdcBalance(requester.vault.vaultPda);

  const r = createRequest(requester.org.id, { payer: { kind: 'splash', orgId: payer.org.id, name: 'Selangor Trading Sdn Bhd', handle: null, country: 'MY' }, number: 'KMS-0094', dueDate: '2026-10-25', lines: [{ description: 'Mooring rope, 40 m', quantity: '3', unitMinor: '1150000000' }], note: 'October order' }, 'Aisyah', NOW);
  await sendRequest(requester.org.id, r.id, NOW);
  assert.equal(r.state, 'sent');
  assert.equal(r.slug, null, 'a Splash business pays in the app, not by link');

  const inbox = await billsView(payer.org.id, NOW);
  const row = inbox.rows.find((x) => x.id === r.billId);
  assert.ok(row, 'it is in the payer’s inbox');
  assert.deepEqual({ tab: row.tab, from: row.from, supplier: row.supplier, number: row.number, currency: row.amount.currency, minor: row.amount.minor, action: row.action.kind }, { tab: 'ready', from: 'splash', supplier: 'Kuching Marine Supply Sdn Bhd', number: 'KMS-0094', currency: 'USD', minor: 3_450_000_000n, action: 'pay' });
  assert.ok(store().requests.get(r.id).viewedAt, 'the requester sees it was viewed');
  assert.equal(requestsView(requester.org.id, NOW).requests[0].status.label.startsWith('Viewed'), true);

  const bill = store().invoices.get(r.billId);
  assert.equal(bill.peer.payeeVaultPda, requester.vault.vaultPda, 'it pays into the requester’s own Payments account');
  const p = await payBill(payer.org.id, bill.id, { by: 'Aisyah' });
  assert.equal(p.kind, 'peer');
  const view = await svc.paymentView(p.id);
  assert.equal(view.cards.length, 1);
  assert.equal(view.cards[0].allInBps, 0, 'no Splash fee between Splash businesses');
  await svc.selectRoute(p.id, { quoteId: view.cards[0].quoteId });
  const sent = await svc.submitApproval(p.id, { signatures: await signAll(payer, await svc.prepareApproval(p.id)) });
  assert.equal(sent.state, 'confirmed');
  const done = await svc.resumePayment(p.id, { timeoutMs: 2_000 });
  assert.ok(['evidenced', 'anchored'].includes(done.state), done.state);

  assert.equal(await chain.getUsdcBalance(requester.vault.vaultPda), before + 3_450_000_000n, 'the money is in the requester’s own account');
  const paid = store().requests.get(r.id);
  assert.equal(paid.state, 'paid');
  assert.equal(paid.paid.by, 'splash');
  assert.equal(paid.paid.paymentId, p.id);
  const ev = svc.getEvidence(paid.receiptId);
  assert.equal(ev.orgId, requester.org.id, 'the requester holds the receipt');
  assert.equal(ev.bundle.kindName, 'receivable');
  assert.deepEqual(ev.bundle.match, { method: 'splash_payment', paymentId: p.id });
  assert.deepEqual(ev.bundle.payer, { kind: 'splash', orgId: payer.org.id });
  assert.equal(ev.bundle.incoming.to, requester.vault.vaultPda);
  assert.equal(svc.verifyReceipt(paid.receiptId).ok, true, 'the receivable verifies like any receipt');
  const receipt = await svc.receiptView(paid.receiptId);
  assert.equal(receipt.summary.kind, 'receivable');
  assert.equal(receipt.summary.supplierName, 'Selangor Trading Sdn Bhd');

  const money = await balanceFor(requester.org.id);
  assert.ok(money.rows.some((x) => x.tag.label === 'Received' && x.amountMinor === 3_450_000_000n && /KMS-0094/.test(x.detail)), 'Balance shows the money in');
  assert.equal(requestsView(requester.org.id, NOW).requests[0].status.label, 'Paid · proof recorded');
  assert.equal((await billsView(payer.org.id)).rows.find((x) => x.id === bill.id).tab, 'paid');
});

test('someone else pays by link: the page shows the requester’s own account, never a Splash address; matched by reference and amount', async () => {
  const requester = await company('Sabah Timber Works Sdn Bhd');
  const r = createRequest(requester.org.id, { payer: { kind: 'external', name: 'Batam Trade Partners', email: 'accounts@example.com' }, number: 'SEL-0096', dueDate: '2026-11-06', lines: LINES, myInvoisRef: 'MYINV-2026-0001' }, 'Aisyah', NOW);
  await sendRequest(requester.org.id, r.id, NOW);
  assert.match(r.slug, /^[A-Za-z0-9_-]{22}$/, '128 random bits');

  const view = await payLinkView(r.slug, { now: NOW });
  assert.equal(view.account.address, requester.vault.vaultPda, 'the requester’s own Payments account');
  assert.equal(view.reference, 'SEL-0096');
  assert.equal(view.amountMinor, 4_750_000_000n);
  assert.equal(view.bankTransfer, null, '"Pay by bank transfer" stays hidden without a collection partner');
  const page = text(view);
  for (const key of await splashKeys()) assert.ok(!page.includes(key), `no Splash-owned address on the page (${key.slice(0, 6)}…)`);
  // Splash's collection account (lib/server/pay-link.ts), shown by the older pay page only once custody is on: never here.
  assert.doesNotMatch(page, /CLIENT-USD-SETTLEMENT|Splash Labuan|MBBEMYKL/, 'nor Splash’s collection account');
  assert.doesNotMatch(page, /accounts@example\.com/, 'the payer’s email is not on the page');
  assert.equal(store().requests.get(r.id).viewedAt, null, 'reading the view alone is not a view');
  await payLinkView(r.slug, { markViewed: true, now: NOW });
  assert.ok(store().requests.get(r.id).viewedAt, 'opening the page is');

  const chain = runtime().chain;
  const before = await chain.getUsdcBalance(requester.vault.vaultPda);
  const out = await simulateLinkPayment(r.slug, NOW);
  assert.deepEqual(out, { matched: true, requestId: r.id });
  assert.equal(await chain.getUsdcBalance(requester.vault.vaultPda), before + 4_750_000_000n);
  const paid = store().requests.get(r.id);
  assert.equal(paid.state, 'paid');
  assert.equal(paid.paid.by, 'link');
  const ev = svc.getEvidence(paid.receiptId);
  assert.equal(ev.bundle.kindName, 'receivable');
  assert.deepEqual(ev.bundle.match, { method: 'reference_and_amount', reference: 'SEL-0096' });
  assert.equal(ev.bundle.payer.kind, 'external');
  assert.match(ev.bundle.payer.commitmentHex, /^[0-9a-f]{64}$/, 'the payer only as a commitment');
  assert.doesNotMatch(text(ev.bundle), /Batam|accounts@example\.com/, 'no name or email on the record');
  assert.equal(ev.bundle.request.einvoiceRef, 'MYINV-2026-0001');
  assert.equal(svc.verifyReceipt(paid.receiptId).ok, true);
  const pack = await svc.evidencePack(paid.receiptId);
  assert.equal(pack.requestDisclosure.fields.number, 'SEL-0096', 'the pack lets an auditor recompute the commitment');
  await assert.rejects(simulateLinkPayment(r.slug, NOW), (e) => e.status === 409, 'paid once');
  assert.equal((await payLinkView(r.slug, { now: NOW })).paid, true);
});

test('a transfer that isn’t the exact amount, or has no reference, is money in but pays no request', async () => {
  const requester = await company('Sabah Timber Works Sdn Bhd');
  const r = createRequest(requester.org.id, { payer: { kind: 'external', name: 'Batam Trade Partners', email: 'accounts@example.com' }, number: 'SEL-0100', dueDate: '2026-11-06', lines: LINES }, 'Aisyah', NOW);
  await sendRequest(requester.org.id, r.id, NOW);
  const short = await receiveIntoAccount(requester.org.id, { amountMinor: r.amountMinor - 10_000n, memo: 'SEL-0100', signature: 'sig_short', simulated: true, from: { kind: 'link', name: 'Batam Trade Partners' } }, NOW);
  assert.equal(short, null);
  const noRef = await receiveIntoAccount(requester.org.id, { amountMinor: r.amountMinor, memo: null, signature: 'sig_noref', simulated: true, from: { kind: 'link', name: 'Batam Trade Partners' } }, NOW);
  assert.equal(noRef, null);
  assert.equal(store().requests.get(r.id).state, 'sent');
  assert.deepEqual(svc.getOrg(requester.org.id).received.map((x) => x.requestId), [null, null], 'both recorded, neither matched');
  assert.equal(await receiveIntoAccount(requester.org.id, { amountMinor: 1n, memo: 'x', signature: 'sig_short', simulated: true, from: { kind: 'link', name: 'x' } }, NOW), null, 'the same transfer twice is one record');
  assert.equal(svc.getOrg(requester.org.id).received.length, 2);
});

test('a cancelled request: its link stops, and a Splash payer can’t pay its bill', async () => {
  const requester = await company('Kuching Marine Supply Sdn Bhd');
  const payer = await company('Selangor Trading Sdn Bhd');
  const link = createRequest(requester.org.id, { payer: { kind: 'external', name: 'Batam Trade Partners', email: 'accounts@example.com' }, number: 'KMS-1', dueDate: '2026-11-06', lines: LINES }, 'A', NOW);
  await sendRequest(requester.org.id, link.id, NOW);
  await cancelRequest(requester.org.id, link.id, NOW);
  assert.equal(await payLinkView(link.slug, { now: NOW }), null);

  const inApp = createRequest(requester.org.id, { payer: { kind: 'splash', orgId: payer.org.id, name: 'Selangor Trading Sdn Bhd', handle: null, country: 'MY' }, number: 'KMS-2', dueDate: '2026-11-06', lines: LINES }, 'A', NOW);
  await sendRequest(requester.org.id, inApp.id, NOW);
  await cancelRequest(requester.org.id, inApp.id, NOW);
  assert.equal((await billsView(payer.org.id, NOW)).rows.length, 0, 'it leaves their inbox');
  await assert.rejects(payBill(payer.org.id, inApp.billId, { by: 'A' }), (e) => e.status >= 400);
});

test('overdue requests: the list counts them, and Overview’s "Needs you" gets each one', async () => {
  const requester = await company('Sabah Timber Works Sdn Bhd');
  const r = createRequest(requester.org.id, { payer: { kind: 'external', name: 'Penang Components Sdn Bhd', email: 'ap@example.com' }, number: 'SEL-0091', dueDate: '2026-10-20', lines: LINES }, 'A', NOW);
  await sendRequest(requester.org.id, r.id, NOW);
  const later = new Date('2026-10-25T03:00:00.000Z');
  const list = requestsView(requester.org.id, later);
  assert.deepEqual({ unpaid: list.unpaidCount, overdue: list.overdueCount, minor: list.unpaidMinor }, { unpaid: 1, overdue: 1, minor: 4_750_000_000n });
  assert.deepEqual(list.requests[0].status, { key: 'overdue', tone: 'amber', label: 'Overdue · 5 days' });
  assert.deepEqual(overdueRequests(requester.org.id, later), [{ payer: 'Penang Components Sdn Bhd', amount: 'US$4,750.00', daysOverdue: 5, reference: 'SEL-0091', href: `/dashboard/invoices/get?request=${r.id}` }]);
});

test('a request cancelled after the payer quoted it: the old payment can no longer be approved (review finding, 16 Oct)', async () => {
  const requester = await company('Kuching Marine Supply Sdn Bhd');
  const payer = await company('Selangor Trading Sdn Bhd');
  await svc.fund(payer.org.id);
  const r = createRequest(requester.org.id, { payer: { kind: 'splash', orgId: payer.org.id, name: 'Selangor Trading Sdn Bhd', handle: null, country: 'MY' }, number: 'KMS-3', dueDate: '2026-11-06', lines: LINES }, 'A', NOW);
  await sendRequest(requester.org.id, r.id, NOW);
  const p = await payBill(payer.org.id, r.billId, { by: 'A' });
  const view = await svc.paymentView(p.id);
  await svc.selectRoute(p.id, { quoteId: view.cards[0].quoteId });
  await cancelRequest(requester.org.id, r.id, NOW);
  await assert.rejects(svc.prepareApproval(p.id), (e) => e.code === 'wrong_state' && /cancelled this request/.test(e.message));
});
