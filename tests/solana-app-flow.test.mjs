// Solana app service, end to end offline: onboard → fund → invoice → quote → approve with a device
// key → partner paid → receipt verifies. Plus: no execute without the device signature (I-4).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';

import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } from '../lib/solana/recovery-kit.ts';
import { getAssociatedTokenAddress } from '../lib/solana/payout.ts';
import { SolanaSimulator } from '../lib/solana/simulator.ts';
import { usdcMint } from '../lib/solana/config.ts';
import { PublicKey } from '@solana/web3.js';
import { signWebhook } from '../lib/solana-partner/mock-partner.ts';
import { verifyBundle, anchoredRootFromMemo } from '../lib/solana-evidence/verify.ts';
import { resetRuntime, runtime } from '../lib/solana-app/runtime.ts';
import { resetStore, store } from '../lib/solana-app/store.ts';
import { toWire } from '../lib/solana-app/json.ts';
import * as svc from '../lib/solana-app/service.ts';

const FIELDS = ['invoiceNumber', 'supplierName', 'supplierBank', 'supplierAccountLast4', 'amountPhpMinor', 'dueDate'];

beforeEach(() => {
  delete process.env.SPLASH_SOLANA_MODE;
  resetStore();
  resetRuntime();
});

/** Everything the browser does in onboarding, with an in-memory device key store. */
async function onboard() {
  const org = svc.createOrg({ companyName: 'Selangor Trading Sdn Bhd', personName: 'Aisyah' });
  const words = generateRecoveryWords();
  const kit = deriveRecoveryKey(words);
  const keys = createMemoryDeviceKeyStore();
  const device = await createDeviceKey(keys, org.id);
  const challenges = svc.issueChallenges(org.id, [
    { role: 'device', publicKey: device.publicKey },
    { role: 'kit', publicKey: kit.publicKey },
  ]);
  const proofs = [];
  for (const c of challenges) {
    const signer = c.role === 'kit' ? kit : { sign: (m) => signWithDeviceKey(keys, org.id, m) };
    proofs.push({ role: c.role, publicKey: c.publicKey, nonce: c.nonce, signature: await signPossessionChallenge(signer, c) });
  }
  await svc.registerKeys(org.id, proofs);
  kit.destroy();
  const vault = await svc.createVault(org.id);
  return { org, keys, device, vault, words };
}

async function confirmSample(orgId, { verify = true } = {}) {
  const { invoice } = await svc.readInvoiceDraft(orgId, { sample: true });
  if (verify) svc.verifyBank(orgId, invoice.id, { by: 'Aisyah', method: 'call-back', bank: invoice.draft.fields.supplierBank, accountLast4: invoice.draft.fields.supplierAccountLast4 });
  const wire = toWire(invoice.draft.fields);
  svc.confirmInvoice(orgId, invoice.id, { fields: wire, confirmed: [...FIELDS] });
  return invoice;
}

async function signAll(keys, orgId, prepared) {
  const out = [];
  for (const m of prepared.messages) {
    const sig = await signWithDeviceKey(keys, orgId, new Uint8Array(Buffer.from(m.messageBase64, 'base64')));
    out.push({ id: m.id, signature: bs58.encode(sig) });
  }
  return out;
}

test('offline flow: onboard, fund, invoice, quote, approve with the device key, paid, receipt verifies', async () => {
  const { org, keys, device, vault } = await onboard();
  assert.equal(vault.configAuthority, null);
  assert.equal(vault.threshold, 1);
  assert.equal(vault.simulated, true);
  const splash = new Set([runtime().attester.publicKey.toBase58(), runtime().feeAccountOwner.toBase58(), (await runtime().chain.getFeePayer()).toBase58()]);
  assert.ok(vault.members.every((m) => !splash.has(m.publicKey)), 'I-1: no Splash key on the vault');
  assert.deepEqual(vault.members.map((m) => m.role).sort(), ['admin_device', 'recovery_kit_a']);

  const funded = await svc.fund(org.id);
  assert.equal(funded.receipt.simulated, true);
  assert.equal(funded.balanceMinor, svc.OFFLINE_FUND_MINOR);

  const invoice = await confirmSample(org.id);
  const conf = store().invoices.get(invoice.id).confirmed;
  assert.match(conf.commitmentHex, /^[0-9a-f]{64}$/);
  assert.equal(conf.bankDetailsVerified.method, 'call-back');

  const payment = await svc.quote(org.id, invoice.id);
  const view = await svc.paymentView(payment.id);
  // Prompt 10 §5.6: two lanes at most, labelled Cheapest and Fastest; a route winning both is one card,
  // and the best other route rides along as `compare` (was: up to three cards, one forced "Via Polygon").
  assert.ok(view.cards.length >= 1 && view.cards.length <= 2);
  for (const c of view.cards) assert.match(c.label, /^(Cheapest|Fastest|Cheapest and fastest)$/);
  assert.equal(view.zeke.suggests, 'Cheapest');
  const offered = [...view.cards, ...(view.compare ? [view.compare] : [])];
  const direct = offered.find((c) => c.kind === 'solana_direct');
  assert.ok(direct, 'the route straight to the partner is offered');
  assert.equal(direct.solNote, 'Splash pays the network fee');
  assert.equal(direct.steps, 2, 'two links on the map');
  const cctp = offered.find((c) => c.kind !== 'solana_direct');
  assert.ok(cctp, 'the lower-cost lane is offered, as a lane or as the route to compare');
  assert.equal(cctp.solNote, 'Your account pays a small network fee (test mode)');
  assert.equal(cctp.steps, 3, 'three links: it leaves one network and lands on another');
  assert.equal(cctp.lowerCostLane, true);

  const selected = await svc.selectRoute(payment.id, { quoteId: direct.quoteId });
  assert.equal(selected.state, 'checked');
  assert.equal(selected.approval.draftedBy, 'Zeke', 'the card says Zeke drafted this');
  assert.equal(selected.approval.depositAddress, selected.payout.deposits.find((d) => d.network === 'solana').address, 'the approver sees the payee');
  const card = selected.approval;
  assert.equal(card.supplierName, 'Manila Freight Services Inc.');
  assert.equal(card.accountLast4, '4471');
  assert.ok(card.receivePhpMinor >= 56_000_000n);
  assert.equal(card.invoiceMatched, true);
  assert.equal(card.policy.allowed, true);
  assert.equal(card.simulated, true);
  // I-6: the card is built from deterministic fields only; nothing from Zeke's text is inside it.
  assert.ok(!JSON.stringify(toWire(card)).includes(view.zeke.primary));

  const prepared = await svc.prepareApproval(payment.id);
  assert.equal(prepared.signer, device.publicKey);
  assert.ok(prepared.messages.some((m) => m.purpose === 'execute'));

  const before = await runtime().chain.getUsdcBalance(vault.vaultPda);
  const sent = await svc.submitApproval(payment.id, { signatures: await signAll(keys, org.id, prepared) });
  assert.equal(sent.state, 'confirmed');
  assert.ok(sent.execution.finalizedAt, 'offline: finalized at once');
  const after = await runtime().chain.getUsdcBalance(vault.vaultPda);
  assert.equal(before - after, card.youPayUsdcMinor, 'vault paid exactly what the card said');
  // I-2: the payout leg went to the partner deposit address; the fee leg to the Splash fee account.
  const deposit = (await svc.getPayment(payment.id)).executedRoute.depositAddress;
  assert.equal(deposit, (await svc.getPayment(payment.id)).payout.deposits.find((d) => d.network === 'solana').address);
  assert.equal(await runtime().chain.getUsdcBalance(deposit), sent.executedRoute.amountMinor);
  assert.equal(await runtime().chain.getUsdcBalance(runtime().feeAccountOwner), card.costs.splashMinor);
  const sim = runtime().chain;
  assert.ok(sim instanceof SolanaSimulator);
  const transfers = sim.events.filter((e) => e.kind === 'transfer');
  assert.equal(transfers.length, 2);
  assert.equal(transfers[0].detail.to, getAssociatedTokenAddress(usdcMint('devnet'), new PublicKey(deposit)).toBase58(), 'payout leg first, to the partner ATA');
  assert.ok(sent.signatures.every((s) => s.simulated === true), 'I-7');

  // Partner: received then paid, HMAC-verified; the receipt is built.
  const n = await svc.deliverPartnerEvents(payment.id);
  assert.equal(n, 2);
  const paid = await svc.getPayment(payment.id);
  assert.equal(paid.state, 'anchored', 'paid, then evidenced, then anchored (the execute was finalized first)');
  const path = (await runtime().payments.transitions(payment.id)).map((t) => t.to);
  assert.deepEqual(path, ['draft', 'quoted', 'checked', 'proposed', 'approved', 'executed', 'confirmed', 'partner_paid', 'evidenced', 'anchored']);
  const calls = await runtime().payments.listCalls(payment.id);
  assert.ok(calls.length >= 2 && calls.every((c) => c.key === `${payment.id}:${c.step}` && c.signature), 'every chain call is recorded under paymentId:step');
  assert.ok(calls.some((c) => c.step === 'execute:0' && c.status === 'finalized'));
  assert.ok(paid.receiptId);
  assert.match(paid.partnerEvents.find((e) => e.status === 'paid').bankReference, /^MOCK-PESONET-/);

  const verified = svc.verifyReceipt(paid.receiptId);
  assert.equal(verified.ok, true, JSON.stringify(verified.checks));
  assert.equal(verified.simulated, true);

  // The browser path: the wire form (bigint as strings) verifies the same; tampering fails.
  const rv = JSON.parse(JSON.stringify(toWire(await svc.receiptView(paid.receiptId))));
  assert.equal(rv.simulated, true);
  const anchor = anchoredRootFromMemo(rv.anchor.memo, { simulated: rv.anchor.simulated });
  assert.equal(verifyBundle({ bundle: rv.bundle, proof: rv.proof, anchor }).ok, true);
  const tampered = structuredClone(rv.bundle);
  tampered.bank.reference = 'MOCK-PESONET-20261011-FFFFFFFF';
  assert.equal(verifyBundle({ bundle: tampered, proof: rv.proof, anchor }).ok, false);

  // The evidence pack lets an auditor recompute the commitment, and holds no recovery words.
  const pack = await svc.evidencePack(paid.receiptId);
  assert.equal(pack.simulated, true);
  const { computeInvoiceCommitment } = await import('../lib/solana-evidence/bundle.ts');
  const salt = new Uint8Array(Buffer.from(pack.invoiceDisclosure.saltHex, 'hex'));
  assert.equal(computeInvoiceCommitment(pack.invoiceDisclosure.fields, salt), pack.bundle.invoice.commitmentHex);

  // The supplier is now in the verified directory: the next invoice from them needs no call-back.
  const summary = await svc.orgSummary(org.id);
  assert.equal(summary.balance.totalMinor, summary.balance.parts.reduce((a, p) => a + p.amountMinor, 0n));
});

test('I-4: execute without the device signature is refused and nothing moves', async () => {
  const { org, keys, vault } = await onboard();
  await svc.fund(org.id);
  const invoice = await confirmSample(org.id);
  const payment = await svc.quote(org.id, invoice.id);
  const direct = (await svc.paymentView(payment.id)).cards.find((c) => c.kind === 'solana_direct');
  await svc.selectRoute(payment.id, { quoteId: direct.quoteId });
  const prepared = await svc.prepareApproval(payment.id);
  const balance = await runtime().chain.getUsdcBalance(vault.vaultPda);

  await assert.rejects(svc.submitApproval(payment.id, {}), (e) => e.code === 'signature_required' && e.status === 403);
  await assert.rejects(svc.submitApproval(payment.id, { signatures: [] }), (e) => e.code === 'signature_required');
  // Only some of the steps signed: refused.
  const all = await signAll(keys, org.id, prepared);
  await assert.rejects(svc.submitApproval(payment.id, { signatures: all.slice(0, 1) }), (e) => e.code === 'signature_required');
  // A signature from another key: refused.
  const strangerKeys = createMemoryDeviceKeyStore();
  await createDeviceKey(strangerKeys, 'stranger');
  const forged = [];
  for (const m of prepared.messages) forged.push({ id: m.id, signature: bs58.encode(await signWithDeviceKey(strangerKeys, 'stranger', new Uint8Array(Buffer.from(m.messageBase64, 'base64')))) });
  await assert.rejects(svc.submitApproval(payment.id, { signatures: forged }), (e) => e.code === 'signature_invalid');
  // The device signature over a different message: refused.
  const swapped = all.map((s, i) => ({ id: s.id, signature: all[(i + 1) % all.length].signature }));
  if (all.length > 1) await assert.rejects(svc.submitApproval(payment.id, { signatures: swapped }), (e) => e.code === 'signature_invalid');

  assert.equal(await runtime().chain.getUsdcBalance(vault.vaultPda), balance, 'nothing moved');
  assert.equal((await svc.getPayment(payment.id)).state, 'checked');
  assert.deepEqual(await runtime().payments.listCalls(payment.id), [], 'no refused attempt reached the chain call ledger');
  // No service function executes on its own: the only path to the chain is submitApproval with signatures.
  assert.equal(typeof svc.autoExecute, 'undefined');
  const sent = await svc.submitApproval(payment.id, { signatures: all });
  assert.equal(sent.state, 'confirmed');
  // The same signatures again: the payment moved on, so nothing is sent twice.
  await assert.rejects(svc.submitApproval(payment.id, { signatures: all }), (e) => e.code === 'wrong_state');
});

test('policy: bank details must be verified; a duplicate invoice is blocked; quotes expire', async () => {
  const { org, keys } = await onboard();
  await svc.fund(org.id);
  const unverified = await confirmSample(org.id, { verify: false });
  let p = await svc.quote(org.id, unverified.id);
  let card = (await svc.paymentView(p.id)).cards[0];
  p = await svc.selectRoute(p.id, { quoteId: card.quoteId });
  assert.equal(p.state, 'rejected_by_policy');
  assert.equal(p.problem.code, 'bank_unverified');
  await assert.rejects(svc.prepareApproval(p.id), (e) => e.code === 'wrong_state');

  // Pay it properly once.
  const first = await confirmSample(org.id);
  p = await svc.quote(org.id, first.id);
  card = (await svc.paymentView(p.id)).cards.find((c) => c.kind === 'solana_direct');
  await svc.selectRoute(p.id, { quoteId: card.quoteId });
  await svc.submitApproval(p.id, { signatures: await signAll(keys, org.id, await svc.prepareApproval(p.id)) });
  await svc.deliverPartnerEvents(p.id);
  assert.equal((await svc.getPayment(p.id)).state, 'anchored');

  // Same invoice again: the supplier is known now (no call-back needed) but it is a duplicate.
  const again = await svc.readInvoiceDraft(org.id, { sample: true });
  assert.equal(again.invoice.bankStatus, 'known');
  svc.confirmInvoice(org.id, again.invoice.id, { fields: toWire(again.invoice.draft.fields), confirmed: [...FIELDS] });
  const dup = await svc.quote(org.id, again.invoice.id);
  const dupSel = await svc.selectRoute(dup.id, { quoteId: (await svc.paymentView(dup.id)).cards[0].quoteId });
  assert.equal(dupSel.state, 'rejected_by_policy');
  assert.equal(dupSel.problem.code, 'duplicate_invoice');

  // Expiry: a quote older than its TTL cannot be approved.
  const fresh = svc.createOrg({ companyName: 'Second Co' });
  void fresh;
  const exp = await svc.quote(org.id, unverified.id);
  const later = new Date(Date.now() + 120_000);
  const sel = await svc.selectRoute(exp.id, { quoteId: (await svc.paymentView(exp.id)).cards[0].quoteId }, later);
  assert.equal(sel.state, 'quote_expired');
  // An expired quote is re-quoted, never approved.
  assert.equal((await svc.requote(exp.id)).state, 'quoted');
});

test('webhooks: HMAC checked, replays deduped, foreign signatures refused', async () => {
  const { org, keys } = await onboard();
  await svc.fund(org.id);
  const inv = await confirmSample(org.id);
  const p = await svc.quote(org.id, inv.id);
  await svc.selectRoute(p.id, { quoteId: (await svc.paymentView(p.id)).cards.find((c) => c.kind === 'solana_direct').quoteId });
  await svc.submitApproval(p.id, { signatures: await signAll(keys, org.id, await svc.prepareApproval(p.id)) });
  const events = await svc.observeDeposit(p.id);
  const wire = events.map((e) => JSON.parse(JSON.stringify(toWire(e))));
  const forged = { ...wire[0], signature: signWebhook({ ...events[0], signature: undefined }, 'some-other-secret-0123456789').signature };
  await assert.rejects(svc.receivePartnerWebhook(forged), (e) => e.code === 'webhook_invalid');
  assert.deepEqual(await svc.receivePartnerWebhook(wire[0]), { duplicate: false, state: 'confirmed' });
  assert.deepEqual(await svc.receivePartnerWebhook(wire[0]), { duplicate: true, state: 'confirmed' });
  assert.deepEqual(await svc.receivePartnerWebhook(wire[1]), { duplicate: false, state: 'anchored' });
  assert.deepEqual(await svc.receivePartnerWebhook(wire[1]), { duplicate: true, state: 'anchored' });
});

test('CCTP route (offline) and the problem rehearsals: screening flag, partner return', async () => {
  const { org, keys, vault } = await onboard();
  await svc.fund(org.id);

  // CCTP V2 to Polygon, if the engine offers it.
  const inv = await confirmSample(org.id);
  const p = await svc.quote(org.id, inv.id);
  const all = (await svc.getPayment(p.id)).engine;
  const cctpQuote = ['cheapest', 'fastest', 'safest'].flatMap((k) => all.ranked[k]).find((q) => q.target.network === 'polygon');
  assert.ok(cctpQuote, 'the engine offers a CCTP V2 route');
  {
    await svc.selectRoute(p.id, { quoteId: cctpQuote.id });
    const sent = await svc.submitApproval(p.id, { signatures: await signAll(keys, org.id, await svc.prepareApproval(p.id)) });
    assert.ok(sent.signatures.some((s) => s.purpose === 'cctp_burn'));
    await svc.deliverPartnerEvents(p.id);
    assert.equal((await svc.getPayment(p.id)).state, 'anchored');
    assert.equal(svc.verifyReceipt((await svc.getPayment(p.id)).receiptId).ok, true);
  }

  // Screening flag rehearsal: the KYT stub flags the deposit address; payment blocked.
  const inv2 = await svc.readInvoiceDraft(org.id, { text: (await import('../lib/solana-zeke/fixtures/sample-invoice.ts')).SAMPLE_INVOICE_TEXT.replace('INV-0412', 'INV-0413') });
  svc.confirmInvoice(org.id, inv2.invoice.id, { fields: toWire(inv2.invoice.draft.fields), confirmed: [...FIELDS] });
  const k = await svc.quote(org.id, inv2.invoice.id);
  const ks = await svc.selectRoute(k.id, { quoteId: (await svc.paymentView(k.id)).cards[0].quoteId, rehearsal: 'kyt_flag' });
  assert.equal(ks.state, 'rejected_by_policy');
  assert.equal(ks.problem.code, 'kyt_flagged');
  // Prompt 10 §5.8 (was /Screening flagged this supplier's wallet/): the rule is named, with who can act.
  assert.match(ks.problem.message, /The screening rule stopped it: screening flagged where this payment goes.*owner can ask support/);

  // Partner return rehearsal: returned webhook, money back in the vault (simulated), invoice free again.
  const r = await svc.selectRoute(k.id, { quoteId: (await svc.paymentView(k.id)).cards.find((c) => c.kind === 'solana_direct').quoteId, rehearsal: 'partner_return' });
  assert.equal(r.state, 'checked');
  const before = await runtime().chain.getUsdcBalance(vault.vaultPda);
  await svc.submitApproval(k.id, { signatures: await signAll(keys, org.id, await svc.prepareApproval(k.id)) });
  await svc.deliverPartnerEvents(k.id);
  const returned = await svc.getPayment(k.id);
  assert.equal(returned.state, 'partner_failed');
  assert.match(returned.problem.message, /Money is back in your Solana balance/);
  const back = await runtime().chain.getUsdcBalance(vault.vaultPda);
  assert.equal(before - back, returned.approval.costs.splashMinor, 'the payout came back; the fee leg did not');
});

test('devnet mode uses the same service path through chain(): no Kora configured means a clear refusal, no network call', async () => {
  process.env.SPLASH_SOLANA_MODE = 'devnet';
  process.env.SOLANA_RPC_URL = 'http://127.0.0.1:1';
  try {
    resetRuntime();
    assert.equal(runtime().chain.mode, 'devnet');
    const org = svc.createOrg({ companyName: 'Devnet Co' });
    const kit = deriveRecoveryKey(generateRecoveryWords());
    const keys = createMemoryDeviceKeyStore();
    const device = await createDeviceKey(keys, org.id);
    const challenges = svc.issueChallenges(org.id, [{ role: 'device', publicKey: device.publicKey }, { role: 'kit', publicKey: kit.publicKey }]);
    const proofs = [];
    for (const c of challenges) {
      const signer = c.role === 'kit' ? kit : { sign: (m) => signWithDeviceKey(keys, org.id, m) };
      proofs.push({ role: c.role, publicKey: c.publicKey, nonce: c.nonce, signature: await signPossessionChallenge(signer, c) });
    }
    await svc.registerKeys(org.id, proofs);
    kit.destroy();
    await assert.rejects(svc.createVault(org.id), /KORA_RPC_URL/);
  } finally {
    delete process.env.SPLASH_SOLANA_MODE;
    delete process.env.SOLANA_RPC_URL;
    resetRuntime();
  }
});
