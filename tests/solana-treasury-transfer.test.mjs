// Sky, 13 Oct: a transfer without an invoice, paid from the vault; and a treasury (operating cash)
// that funds the payments vault directly. Offline, through the services:
//   transfer   typed in by a person, the same quote, rules, device approval and proof as an invoice
//   treasury   vault #1 of the company's own multisig; a move to vault #0 is one device approval,
//              memo splash:move:v1:<id>, no Splash fee, and nothing reaches a Splash account
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';

import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } from '../lib/solana/recovery-kit.ts';
import { buildMoveMemo, isSplashMemo } from '../lib/solana/payout.ts';
import { TREASURY_VAULT_INDEX, vaultPdaAt } from '../lib/solana/squads.ts';
import { resetRuntime, runtime } from '../lib/solana-app/runtime.ts';
import { resetStore } from '../lib/solana-app/store.ts';
import * as svc from '../lib/solana-app/service.ts';
import * as treasury from '../lib/solana-app/treasury-service.ts';

beforeEach(() => {
  delete process.env.SPLASH_SOLANA_MODE;
  process.env.SOLANA_PAYMENT_STORE = 'memory';
  resetStore();
  resetRuntime();
});

async function company({ fund = true } = {}) {
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
  const vault = await svc.createVault(org.id);
  if (fund) await svc.fund(org.id);
  return { org, keys, device, vault };
}

async function sign(env, prepared) {
  const out = [];
  for (const m of prepared.messages) out.push({ id: m.id, signature: bs58.encode(await signWithDeviceKey(env.keys, env.org.id, new Uint8Array(Buffer.from(m.messageBase64, 'base64')))) });
  return out;
}

const recipient = { name: 'Davao Packaging Corp.', bank: 'BPI', accountLast4: '0910' };
const callBack = { by: 'Aisyah', method: 'call-back' };

/* ------------------------------------------------------------------ transfer */

test('a transfer with no invoice: typed in, confirmed, quoted, approved on the device, paid with proof', async () => {
  const env = await company();
  const inv = svc.startTransfer(env.org.id, { recipient, amountPhpMinor: '12000000', reference: 'PO-1182', verification: callBack, by: 'Aisyah' });
  assert.equal(inv.source, 'transfer');
  assert.equal(inv.draft.extractor, 'none', 'nothing was read');
  assert.equal(inv.confirmed.invoiceNumber, 'PO-1182', 'the reference stands where an invoice number would');
  assert.equal(inv.confirmed.amountPhpMinor, 12_000_000n);
  assert.equal(inv.confirmed.bankDetailsVerified.method, 'call-back');

  const p = await svc.quote(env.org.id, inv.id);
  const view = await svc.paymentView(p.id);
  const direct = view.cards.find((c) => c.kind === 'solana_direct');
  const checked = await svc.selectRoute(p.id, { quoteId: direct.quoteId });
  assert.equal(checked.approval.kind, 'transfer');
  assert.equal(checked.approval.draftedBy, 'Aisyah', 'a person typed it; Zeke drafted nothing');
  assert.ok(checked.approval.policy.checks.some((c) => c.label === 'Recipient bank details verified'), 'the rules speak about a recipient');
  assert.equal(checked.approval.policy.allowed, true);

  const sent = await svc.submitApproval(p.id, { signatures: await sign(env, await svc.prepareApproval(p.id)) });
  assert.equal(sent.state, 'confirmed');
  await svc.deliverPartnerEvents(p.id);
  const done = await svc.getPayment(p.id);
  assert.equal(done.state, 'anchored');
  assert.equal(svc.verifyReceipt(done.receiptId).ok, true, 'a transfer gets the same receipt and proof');

  const summary = await svc.orgSummary(env.org.id);
  const row = summary.payments.find((x) => x.id === p.id);
  assert.equal(row.kind, 'transfer');
  assert.equal(row.invoiceNumber, 'PO-1182');
  assert.equal(summary.invoices.read, 0, 'a transfer is not an invoice Zeke read');
});

test('a transfer to a new recipient without a call-back is blocked by the rules, not sent', async () => {
  const env = await company();
  const inv = svc.startTransfer(env.org.id, { recipient, amountPhpMinor: '500000', by: 'Aisyah' });
  assert.match(inv.confirmed.invoiceNumber, /^TRF-\d{8}-[0-9A-F]{4}$/, 'a reference is made when none is given');
  assert.equal(inv.confirmed.bankDetailsVerified, null);
  const p = await svc.quote(env.org.id, inv.id);
  const card = (await svc.paymentView(p.id)).cards.find((c) => c.kind === 'solana_direct');
  const checked = await svc.selectRoute(p.id, { quoteId: card.quoteId });
  assert.equal(checked.approval.policy.allowed, false);
  assert.equal(checked.approval.policy.checks.find((c) => c.name === 'bank_details_verified').passed, false);
  await assert.rejects(svc.prepareApproval(p.id), (e) => e.code === 'wrong_state');
});

test('a transfer the payments vault cannot cover is refused at the quote, with the shortfall and the treasury balance', async () => {
  const env = await company({ fund: false });
  await treasury.fundTreasury(env.org.id);
  const inv = svc.startTransfer(env.org.id, { recipient, amountPhpMinor: '5740000', verification: callBack });
  await assert.rejects(svc.quote(env.org.id, inv.id), (e) => {
    assert.equal(e.code, 'insufficient_balance');
    assert.equal(e.detail.invoiceId, inv.id);
    assert.equal(e.detail.balanceUsdcMinor, '0');
    assert.ok(BigInt(e.detail.neededUsdcMinor) > 0n);
    assert.equal(e.detail.shortUsdcMinor, e.detail.neededUsdcMinor, 'short by all of it');
    assert.equal(e.detail.treasuryUsdcMinor, treasury.OFFLINE_TREASURY_FUND_MINOR.toString());
    assert.match(e.message, /Move USDC in from your treasury/);
    return true;
  });
});

test('a bad transfer is refused before anything is stored', async () => {
  const env = await company();
  assert.throws(() => svc.startTransfer(env.org.id, { recipient: { ...recipient, accountLast4: '12' }, amountPhpMinor: '100' }), (e) => e.code === 'bad_request' && /last four account digits/.test(e.message));
  assert.throws(() => svc.startTransfer(env.org.id, { recipient, amountPhpMinor: '0' }), (e) => e.code === 'bad_request' && /amount/.test(e.message));
  assert.throws(() => svc.startTransfer(env.org.id, { recipient, amountPhpMinor: '1.5' }), (e) => e.code === 'bad_request');
});

/* ------------------------------------------------------------------ treasury */

test('the treasury is vault #1 of the same multisig: no new account, no Splash key', async () => {
  const env = await company();
  const summary = await svc.orgSummary(env.org.id);
  const expected = vaultPdaAt(new PublicKey(env.vault.multisigPda), TREASURY_VAULT_INDEX).toBase58();
  assert.equal(summary.treasury.vaultPda, expected);
  assert.notEqual(summary.treasury.vaultPda, env.vault.vaultPda);
  assert.equal(summary.treasury.balanceMinor, 0n);
  const splash = new Set([runtime().attester.publicKey.toBase58(), runtime().feeAccountOwner.toBase58(), (await runtime().chain.getFeePayer()).toBase58()]);
  assert.ok(!splash.has(summary.treasury.vaultPda));
});

test('a move from treasury to payments: one device approval, exact amounts, its own memo, no fee', async () => {
  const env = await company({ fund: false });
  const rt = runtime();
  await treasury.fundTreasury(env.org.id);
  const t = treasury.vaultsOf(svc.getOrg(env.org.id));
  const feeBefore = await rt.chain.getUsdcBalance(rt.feeAccountOwner);
  const amount = 7_500_000_000n; // US$7,500

  const prepared = await treasury.prepareMove(env.org.id, { from: 'treasury', amountMinor: amount, signer: env.device.publicKey, by: 'Aisyah' });
  assert.ok(prepared.messages.some((m) => m.step === 'proposal') && prepared.messages.some((m) => m.step === 'execute'), 'one prompt: proposal and execute');
  const moved = await treasury.submitMove(env.org.id, prepared.move.id, { signatures: await sign(env, prepared), who: 'Aisyah' });
  assert.equal(moved.state, 'confirmed');
  assert.equal(await rt.chain.getUsdcBalance(t.treasury.toBase58()), treasury.OFFLINE_TREASURY_FUND_MINOR - amount);
  assert.equal(await rt.chain.getUsdcBalance(t.payments.toBase58()), amount, 'the payments vault got exactly the move');
  assert.equal(await rt.chain.getUsdcBalance(rt.feeAccountOwner), feeBefore, 'Splash takes no fee on a move');

  const memos = rt.chain.events.filter((e) => e.kind === 'memo').map((e) => e.detail.memo);
  assert.ok(memos.includes(buildMoveMemo(moved.id)), 'the move memo is on chain');
  assert.ok(isSplashMemo(moved.memo) && !moved.memo.startsWith('splash:pay:'), 'a move never reads as a payment');
  const transfers = rt.chain.events.filter((e) => e.kind === 'transfer');
  assert.equal(transfers.length, 1, 'one transfer, vault to vault');
  assert.ok(moved.calls.every((c) => c.signature), 'every signature recorded');

  await assert.rejects(treasury.submitMove(env.org.id, moved.id, { signatures: await sign(env, prepared), who: 'Aisyah' }), (e) => e.code === 'not_prepared', 'the same signatures cannot move twice');
  const summary = await svc.orgSummary(env.org.id);
  assert.equal(summary.treasury.moves[0].id, moved.id);
  assert.equal(summary.treasury.moves[0].state, 'confirmed');
  assert.equal(summary.balance.totalMinor, amount, 'the payments balance is what pays suppliers');
});

test('moves are refused for more than the source holds, from a stranger key, or with a forged signature', async () => {
  const env = await company();
  await treasury.fundTreasury(env.org.id);
  await assert.rejects(
    treasury.prepareMove(env.org.id, { from: 'treasury', amountMinor: treasury.OFFLINE_TREASURY_FUND_MINOR + 1n, signer: env.device.publicKey, by: 'Aisyah' }),
    (e) => e.code === 'insufficient_balance' && e.detail.availableMinor === treasury.OFFLINE_TREASURY_FUND_MINOR.toString(),
  );
  await assert.rejects(treasury.prepareMove(env.org.id, { from: 'treasury', amountMinor: 0n, signer: env.device.publicKey, by: 'Aisyah' }), (e) => e.code === 'bad_request');
  const stranger = createMemoryDeviceKeyStore();
  const other = await createDeviceKey(stranger, 'x');
  await assert.rejects(treasury.prepareMove(env.org.id, { from: 'treasury', amountMinor: 1n, signer: other.publicKey, by: 'Mallory' }), (e) => e.code === 'not_an_approver');

  const prepared = await treasury.prepareMove(env.org.id, { from: 'treasury', amountMinor: 1_000_000n, signer: env.device.publicKey, by: 'Aisyah' });
  const forged = [];
  for (const m of prepared.messages) forged.push({ id: m.id, signature: bs58.encode(await signWithDeviceKey(stranger, 'x', new Uint8Array(Buffer.from(m.messageBase64, 'base64')))) });
  await assert.rejects(treasury.submitMove(env.org.id, prepared.move.id, { signatures: forged, who: 'Mallory' }), (e) => e.code === 'signature_invalid');
  await assert.rejects(treasury.submitMove(env.org.id, prepared.move.id, { signatures: [], who: 'Aisyah' }), (e) => e.code === 'signature_required');
  const ok = await treasury.submitMove(env.org.id, prepared.move.id, { signatures: await sign(env, prepared), who: 'Aisyah' });
  assert.equal(ok.state, 'confirmed', 'the refusals sent nothing; the real signatures still work');
});

test('a move back to the treasury, and a payment funded by a move', async () => {
  const env = await company({ fund: false });
  const rt = runtime();
  await treasury.fundTreasury(env.org.id);
  const t = treasury.vaultsOf(svc.getOrg(env.org.id));
  const p1 = await treasury.prepareMove(env.org.id, { from: 'treasury', amountMinor: 20_000_000_000n, signer: env.device.publicKey, by: 'Aisyah' });
  await treasury.submitMove(env.org.id, p1.move.id, { signatures: await sign(env, p1), who: 'Aisyah' });

  const inv = svc.startTransfer(env.org.id, { recipient, amountPhpMinor: '57400000', verification: callBack });
  const p = await svc.quote(env.org.id, inv.id);
  const card = (await svc.paymentView(p.id)).cards.find((c) => c.kind === 'solana_direct');
  await svc.selectRoute(p.id, { quoteId: card.quoteId });
  const sent = await svc.submitApproval(p.id, { signatures: await sign(env, await svc.prepareApproval(p.id)) });
  assert.equal(sent.state, 'confirmed', 'the moved USDC paid the transfer');

  const left = await rt.chain.getUsdcBalance(t.payments.toBase58());
  const p2 = await treasury.prepareMove(env.org.id, { from: 'payments', amountMinor: left, signer: env.device.publicKey, by: 'Aisyah' });
  const back = await treasury.submitMove(env.org.id, p2.move.id, { signatures: await sign(env, p2), who: 'Aisyah' });
  assert.equal(back.state, 'confirmed');
  assert.equal(back.to, 'treasury');
  assert.equal(await rt.chain.getUsdcBalance(t.payments.toBase58()), 0n);
  assert.equal(await rt.chain.getUsdcBalance(t.treasury.toBase58()), treasury.OFFLINE_TREASURY_FUND_MINOR - 20_000_000_000n + left);
});

test('a newer move replaces one nobody signed, and an unsigned move cannot be sent', async () => {
  const env = await company();
  await treasury.fundTreasury(env.org.id);
  const a = await treasury.prepareMove(env.org.id, { from: 'treasury', amountMinor: 1_000_000n, signer: env.device.publicKey, by: 'Aisyah' });
  const b = await treasury.prepareMove(env.org.id, { from: 'treasury', amountMinor: 2_000_000n, signer: env.device.publicKey, by: 'Aisyah' });
  assert.equal(treasury.getMove(env.org.id, a.move.id).state, 'failed');
  assert.equal(treasury.getMove(env.org.id, a.move.id).problem.code, 'replaced');
  await assert.rejects(treasury.submitMove(env.org.id, a.move.id, { signatures: await sign(env, a), who: 'Aisyah' }), (e) => e.code === 'not_prepared');
  const ok = await treasury.submitMove(env.org.id, b.move.id, { signatures: await sign(env, b), who: 'Aisyah' });
  assert.equal(ok.state, 'confirmed');
});
