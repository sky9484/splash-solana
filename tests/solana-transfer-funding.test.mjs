// A transfer's Step 3, "Money comes from" (prompt 10 §5.6), offline, through the services:
//   covered / from your reserve   the Payments account, topped up from the reserve with a move
//   add money another way         a bank or card top-up, or a crypto wallet, into the company's own
//                                 Payments account, after a funds check and a declaration
// Either way the payout leaves the Payments account with one device approval, and nothing ever
// reaches a Splash account. Rewritten for prompt 10 Phase 3: the methods were named by provider
// ('stripe', 'airwallex', 'wallet_usdc', 'wallet_swap'); now they are routes ('bank_card',
// 'wallet:<asset>:<network>'), planned by lib/solana-app/funding-planner.ts.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

// Loaded first, as the funding routes load it: its imports must not read a constant still being defined.
import * as funding from '../lib/solana-app/funding-service.ts';
import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } from '../lib/solana/recovery-kit.ts';
import { resetRuntime, runtime } from '../lib/solana-app/runtime.ts';
import { resetStore } from '../lib/solana-app/store.ts';
import * as svc from '../lib/solana-app/service.ts';
import { giveDetails } from './helpers/transfer-details.mjs';
import * as treasury from '../lib/solana-app/treasury-service.ts';

beforeEach(() => {
  delete process.env.SPLASH_SOLANA_MODE;
  process.env.SOLANA_PAYMENT_STORE = 'memory';
  resetStore();
  resetRuntime();
});

async function company({ fund = false } = {}) {
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
  return { org, keys, vault };
}

async function sign(env, prepared) {
  const out = [];
  for (const m of prepared.messages) out.push({ id: m.id, signature: bs58.encode(await signWithDeviceKey(env.keys, env.org.id, new Uint8Array(Buffer.from(m.messageBase64, 'base64')))) });
  return out;
}

const recipient = { name: 'Davao Packaging Corp.', bank: 'BPI', accountLast4: '0910' };
const callBack = { by: 'Aisyah', method: 'call-back' };
const sender = () => Keypair.generate().publicKey.toBase58();
const later = (ms) => new Date(Date.now() + ms);

async function shortTransfer(env, amountPhpMinor = '5740000') {
  const inv = svc.startTransfer(env.org.id, { recipient, amountPhpMinor, verification: callBack, by: 'Aisyah' });
  giveDetails(env.org.id, inv.id);
  const p = await svc.quote(env.org.id, inv.id, { allowShort: true });
  const view = await svc.paymentView(p.id);
  const card = [...view.cards, ...(view.compare ? [view.compare] : [])].find((c) => c.kind === 'solana_direct');
  return { inv, p, card };
}

const fund = (env, p, card, extra) => funding.startFunding(env.org.id, p.id, { quoteId: card.quoteId, sourceOfFunds: 'owner_capital', declared: true, by: 'Aisyah', ...extra });

test('an empty payments vault still gets every route priced, and no route can be chosen until it holds the money', async () => {
  const env = await company();
  const { p, card } = await shortTransfer(env);
  assert.equal(p.state, 'quoted');
  assert.ok(BigInt(card.youPayUsdcMinor) > 0n, 'the person sees what it costs before funding');
  await assert.rejects(svc.selectRoute(p.id, { quoteId: card.quoteId }), (e) => {
    assert.equal(e.code, 'insufficient_balance');
    assert.equal(e.detail.balanceUsdcMinor, '0');
    assert.equal(e.detail.neededUsdcMinor, String(card.youPayUsdcMinor));
    return true;
  });
});

test('without allowShort the quote still refuses a vault that cannot pay (invoices are unchanged)', async () => {
  const env = await company();
  const inv = svc.startTransfer(env.org.id, { recipient, amountPhpMinor: '5740000', verification: callBack });
  giveDetails(env.org.id, inv.id);
  await assert.rejects(svc.quote(env.org.id, inv.id), (e) => e.code === 'insufficient_balance');
});

test('the plan: the reserve covers it, so move exactly what is missing first; no funds check, no declaration', async () => {
  const env = await company();
  await treasury.fundTreasury(env.org.id);
  const { p, card } = await shortTransfer(env);
  const opts = await funding.fundingOptions(env.org.id, p.id, card.quoteId);
  assert.equal(opts.vaults.paymentsMinor, '0');
  assert.equal(opts.vaults.treasuryMinor, treasury.OFFLINE_TREASURY_FUND_MINOR.toString());
  assert.equal(opts.neededMinor, String(card.youPayUsdcMinor));
  assert.equal(opts.plan.kind, 'reserve', 'the planner chooses the reserve');
  assert.equal(opts.plan.moveMinor, String(card.youPayUsdcMinor));

  const prepared = await treasury.prepareMove(env.org.id, { from: 'treasury', amountMinor: BigInt(opts.plan.moveMinor), signer: svc.getOrg(env.org.id).keys.device.publicKey, by: 'Aisyah' });
  const moved = await treasury.submitMove(env.org.id, prepared.move.id, { signatures: await sign(env, prepared), who: 'Aisyah' });
  assert.equal(moved.state, 'confirmed');
  assert.equal((await funding.fundingOptions(env.org.id, p.id, card.quoteId)).plan.kind, 'covered', 'now the Payments account covers it');

  const checked = await svc.selectRoute(p.id, { quoteId: card.quoteId });
  assert.equal(checked.state, 'checked');
  const sent = await svc.submitApproval(p.id, { signatures: await sign(env, await svc.prepareApproval(p.id)) });
  assert.equal(sent.state, 'confirmed');
  assert.deepEqual(opts.fundings, [], 'nothing was brought in from outside');
});

test('a reserve plan: the route can be chosen now, the approval card says what moves first, and the proposal waits for it', async () => {
  const env = await company();
  await treasury.fundTreasury(env.org.id);
  const { p, card } = await shortTransfer(env);
  const checked = await svc.selectRoute(p.id, { quoteId: card.quoteId });
  assert.equal(checked.state, 'checked', 'the reserve covers what is short, so the rules run now');
  assert.equal(checked.approval.reserveMoveMinor, BigInt(card.youPayUsdcMinor), 'the card says what moves from the reserve first');
  await assert.rejects(svc.prepareApproval(p.id), (e) => e.code === 'insufficient_balance', 'no proposal for money not yet in the Payments account');
  assert.equal((await svc.getPayment(p.id)).state, 'checked', 'refusing changed nothing');
  const move = await treasury.prepareMove(env.org.id, { from: 'treasury', amountMinor: checked.approval.reserveMoveMinor, signer: svc.getOrg(env.org.id).keys.device.publicKey, by: 'Aisyah' });
  assert.equal((await treasury.submitMove(env.org.id, move.move.id, { signatures: await sign(env, move), who: 'Aisyah' })).state, 'confirmed');
  const sent = await svc.submitApproval(p.id, { signatures: await sign(env, await svc.prepareApproval(p.id)) });
  assert.equal(sent.state, 'confirmed', 'the same approval sequence pays it');
});

test('add money another way is priced on the server for what the account is short of, even when the reserve could cover it', async () => {
  const env = await company();
  await treasury.fundTreasury(env.org.id);
  const { p, card } = await shortTransfer(env);
  const opts = await funding.fundingOptions(env.org.id, p.id, card.quoteId);
  assert.equal(opts.plan.kind, 'reserve');
  assert.equal(opts.shortMinor, String(card.youPayUsdcMinor));
  const top = opts.priced.find((o) => o.id === 'bank_card');
  assert.equal(top.chargeMinor, funding.chargeFor(BigInt(card.youPayUsdcMinor), 50).toString());
  assert.equal(BigInt(top.totalMinor), BigInt(top.amountMinor) + BigInt(top.chargeMinor));
  assert.ok(opts.priced.every((o) => /^\d+$/.test(o.totalMinor)), 'integers only');
});

test('the plan: nothing in either account, so every way in, cheapest first, each test mode and free of Splash fees', async () => {
  const env = await company();
  const { p, card } = await shortTransfer(env);
  const opts = await funding.fundingOptions(env.org.id, p.id, card.quoteId);
  assert.equal(opts.plan.kind, 'external');
  assert.equal(opts.plan.shortMinor, String(card.youPayUsdcMinor));
  assert.equal(opts.plan.options[0].id, 'wallet:USDC:solana');
  assert.ok(opts.plan.options.every((o) => o.testMode && o.splashFeeBps === 0));
  assert.ok(opts.routes.some((r) => r.id === 'wallet:USDC:sui' && !r.available), 'Sui: not available yet');
  assert.doesNotMatch(JSON.stringify(opts), /Stripe|Airwallex/, 'no provider name');
});

test('add money another way: a bank or card top-up brings what is missing in after the funds check, then the same approval pays it', async () => {
  const env = await company();
  const { p, card } = await shortTransfer(env);
  const vault = svc.getOrg(env.org.id).vault;
  const f = await fund(env, p, card, { source: 'bank_card', sourceOfFunds: 'business_revenue' });
  assert.equal(f.state, 'checking', 'the check comes first');
  assert.equal(f.method, 'bank_card');
  assert.equal(f.asset, 'USD');
  assert.equal(f.amountMinor, BigInt(card.youPayUsdcMinor), 'what is missing: here, the route’s full cost');
  assert.equal(f.chargeMinor, funding.chargeFor(f.amountMinor, 50), 'the top-up provider’s charge, on top (test-mode estimate)');
  assert.equal(f.declaredBy, 'Aisyah');
  assert.equal(funding.fundingView(f).methodLabel, 'Bank or card top-up · test mode');
  assert.equal(await runtime().chain.getUsdcBalance(vault.vaultPda), 0n, 'nothing counts before the check');

  const early = await funding.refreshFunding(env.org.id, f.id);
  assert.equal(early.state, 'checking', 'reading early changes nothing');
  const done = await funding.refreshFunding(env.org.id, f.id, later(funding.OFFLINE_FUNDS_CHECK_MS + 10));
  assert.equal(done.state, 'in_vault');
  assert.ok(done.signature);
  assert.equal(await runtime().chain.getUsdcBalance(vault.vaultPda), f.amountMinor, 'the money is in the company’s own account');
  const again = await funding.refreshFunding(env.org.id, f.id, later(funding.OFFLINE_FUNDS_CHECK_MS + 20));
  assert.equal(again.signature, done.signature, 'reading twice never credits twice');
  assert.equal(await runtime().chain.getUsdcBalance(vault.vaultPda), f.amountMinor);

  const checked = await svc.selectRoute(p.id, { quoteId: card.quoteId });
  const sent = await svc.submitApproval(checked.id, { signatures: await sign(env, await svc.prepareApproval(p.id)) });
  assert.equal(sent.state, 'confirmed', 'the payout leaves the Payments account with the device approval, as always');
});

test('two reads at once credit once (FUNDING-AUDIT.md §8 step 9)', async () => {
  const env = await company();
  const { p, card } = await shortTransfer(env);
  const vault = svc.getOrg(env.org.id).vault;
  const f = await fund(env, p, card, { source: 'bank_card' });
  const at = later(funding.OFFLINE_FUNDS_CHECK_MS + 10);
  const [a, b] = await Promise.all([funding.refreshFunding(env.org.id, f.id, at), funding.refreshFunding(env.org.id, f.id, at)]);
  assert.equal(await runtime().chain.getUsdcBalance(vault.vaultPda), f.amountMinor, 'one credit');
  assert.ok([a.state, b.state].includes('in_vault'));
  assert.equal(svc.getOrg(env.org.id).fundings.filter((x) => x.note.includes(p.id)).length, 1, 'one funding record');
});

test('a crypto wallet: the sending address is required and checked by network, screened, and a flagged one is held out', async () => {
  const env = await company();
  const { p, card } = await shortTransfer(env);
  await assert.rejects(fund(env, p, card, { source: 'wallet:USDC:solana', fromAddress: 'not-an-address' }), (e) => e.code === 'bad_request' && /address of the wallet/.test(e.message));
  await assert.rejects(fund(env, p, card, { source: 'wallet:USDC:base', fromAddress: sender() }), (e) => e.code === 'bad_request' && /0x/.test(e.message), 'a Base wallet has a 0x address');
  const vault = svc.getOrg(env.org.id).vault;
  await assert.rejects(fund(env, p, card, { source: 'wallet:USDC:solana', fromAddress: vault.vaultPda }), (e) => e.code === 'bad_request' && /your own accounts/.test(e.message));
  await assert.rejects(fund(env, p, card, { source: 'wallet:PYUSD:solana', fromAddress: sender() }), (e) => e.status === 422 && /Only USDC and USDT/.test(e.message));

  const flagged = await fund(env, p, card, { source: 'wallet:USDT:solana', fromAddress: sender(), rehearsal: 'kyt_flag' });
  assert.equal(flagged.check.flagged, true);
  assert.ok(flagged.chargeMinor > 0n, 'the swap is charged by the venue, shown up front');
  const held = await funding.refreshFunding(env.org.id, flagged.id, later(funding.OFFLINE_FUNDS_CHECK_MS + 10));
  assert.equal(held.state, 'held');
  assert.equal(await runtime().chain.getUsdcBalance(vault.vaultPda), 0n, 'held money never reaches the account');

  const clean = await fund(env, p, card, { source: 'wallet:USDC:base', fromAddress: '0x' + 'ab'.repeat(20) });
  assert.notEqual(clean.id, flagged.id, 'a held funding does not block another source');
  assert.equal(clean.chargeMinor, 0n, 'USDC needs no swap');
  assert.equal(clean.network, 'base');
});

test('screening fails closed: when it can’t answer, the money is held', async () => {
  const env = await company();
  const { p, card } = await shortTransfer(env);
  const f = await fund(env, p, card, { source: 'wallet:USDC:solana', fromAddress: sender(), rehearsal: 'kyt_unavailable' });
  assert.equal(f.check.unknown, true);
  assert.equal(f.check.flagged, false);
  const after = await funding.refreshFunding(env.org.id, f.id, later(funding.OFFLINE_FUNDS_CHECK_MS + 10));
  assert.equal(after.state, 'held');
  assert.equal(await runtime().chain.getUsdcBalance(svc.getOrg(env.org.id).vault.vaultPda), 0n);
});

test('the declaration is required, one funding runs per payment, and a paid payment takes no more', async () => {
  const env = await company();
  const { p, card } = await shortTransfer(env);
  await assert.rejects(fund(env, p, card, { source: 'bank_card', declared: false }), (e) => e.code === 'declaration_required');
  const a = await fund(env, p, card, { source: 'bank_card' });
  const b = await fund(env, p, card, { source: 'wallet:USDC:solana', fromAddress: sender() });
  assert.equal(b.id, a.id, 'a second request returns the funding under way');
  await funding.refreshFunding(env.org.id, a.id, later(funding.OFFLINE_FUNDS_CHECK_MS + 10));
  await svc.selectRoute(p.id, { quoteId: card.quoteId });
  await svc.submitApproval(p.id, { signatures: await sign(env, await svc.prepareApproval(p.id)) });
  await assert.rejects(fund(env, p, card, { source: 'bank_card' }), (e) => e.code === 'wrong_state');
});

test('charges are integers, rounded up, and Splash adds none; old records read without provider names', () => {
  assert.equal(funding.chargeFor(1_000_000n, 150), 15_000n);
  assert.equal(funding.chargeFor(1n, 150), 1n, 'rounded up, never down to nothing');
  assert.equal(funding.chargeFor(5_000_000n, 0), 0n);
  for (const [id, m] of Object.entries(funding.FUNDING_METHODS)) assert.doesNotMatch(m.label, /Stripe|Airwallex/, id);
  assert.equal(funding.FUNDING_METHODS.stripe.label, 'Bank or card top-up · test mode', 'a record saved before prompt 10');
});

test('offline every outside source runs as a labelled test-mode simulation', async () => {
  const env = await company();
  const { p, card } = await shortTransfer(env);
  const opts = await funding.fundingOptions(env.org.id, p.id, card.quoteId);
  assert.ok(opts.routes.filter((r) => r.asset === 'USDC' && r.network !== 'sui').every((r) => r.available), 'offline, every USDC route runs, as a simulation');
  assert.ok(opts.routes.every((r) => r.testMode), 'every outside source is labelled test mode');
});
