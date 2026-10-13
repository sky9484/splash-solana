// Sky, 13 Oct: a transfer's Step 3, "Quote & Send". Two ways to pay, offline, through the services:
//   from your vaults        the payments vault (topped up from the treasury); checked when it arrived
//   fund it another way     USD (Stripe, Airwallex) or a stablecoin from another wallet, into the
//                           company's own payments vault, after a funds check and a declaration
// Either way the payout leaves the payments vault with one device approval, and nothing ever reaches
// a Splash account.
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
  const card = (await svc.paymentView(p.id)).cards.find((c) => c.kind === 'solana_direct');
  return { inv, p, card };
}

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

test('pay from your vaults: a move from the treasury covers it, with no funds check and no declaration', async () => {
  const env = await company();
  await treasury.fundTreasury(env.org.id);
  const { p, card } = await shortTransfer(env);
  const opts = await funding.fundingOptions(env.org.id, p.id, card.quoteId);
  assert.equal(opts.vaults.paymentsMinor, '0');
  assert.equal(opts.vaults.treasuryMinor, treasury.OFFLINE_TREASURY_FUND_MINOR.toString());
  assert.equal(opts.neededMinor, String(card.youPayUsdcMinor));

  const prepared = await treasury.prepareMove(env.org.id, { from: 'treasury', amountMinor: BigInt(card.youPayUsdcMinor), signer: svc.getOrg(env.org.id).keys.device.publicKey, by: 'Aisyah' });
  const moved = await treasury.submitMove(env.org.id, prepared.move.id, { signatures: await sign(env, prepared), who: 'Aisyah' });
  assert.equal(moved.state, 'confirmed');

  const checked = await svc.selectRoute(p.id, { quoteId: card.quoteId });
  assert.equal(checked.state, 'checked');
  const sent = await svc.submitApproval(p.id, { signatures: await sign(env, await svc.prepareApproval(p.id)) });
  assert.equal(sent.state, 'confirmed');
  assert.deepEqual(opts.fundings, [], 'nothing was brought in from outside');
});

test('fund it another way: Stripe brings the full cost into the payments vault after the funds check, then the same approval pays it', async () => {
  const env = await company();
  const { p, card } = await shortTransfer(env);
  const vault = env.org.vault ?? svc.getOrg(env.org.id).vault;
  const f = await funding.startFunding(env.org.id, p.id, { method: 'stripe', quoteId: card.quoteId, sourceOfFunds: 'business_revenue', declared: true, by: 'Aisyah' });
  assert.equal(f.state, 'checking', 'the check comes first');
  assert.equal(f.asset, 'USD');
  assert.equal(f.amountMinor, BigInt(card.youPayUsdcMinor), 'the route’s full cost');
  assert.equal(f.chargeMinor, funding.chargeFor(f.amountMinor, funding.FUNDING_METHODS.stripe.chargeBps), 'the provider’s charge, on top');
  assert.equal(f.declaredBy, 'Aisyah');
  assert.equal(await runtime().chain.getUsdcBalance(vault.vaultPda), 0n, 'nothing counts before the check');

  const early = await funding.refreshFunding(env.org.id, f.id);
  assert.equal(early.state, 'checking', 'reading early changes nothing');
  const done = await funding.refreshFunding(env.org.id, f.id, later(funding.OFFLINE_FUNDS_CHECK_MS + 10));
  assert.equal(done.state, 'in_vault');
  assert.ok(done.signature);
  assert.equal(await runtime().chain.getUsdcBalance(vault.vaultPda), f.amountMinor, 'the money is in the company’s own vault');
  const again = await funding.refreshFunding(env.org.id, f.id, later(funding.OFFLINE_FUNDS_CHECK_MS + 20));
  assert.equal(again.signature, done.signature, 'reading twice never credits twice');
  assert.equal(await runtime().chain.getUsdcBalance(vault.vaultPda), f.amountMinor);

  const checked = await svc.selectRoute(p.id, { quoteId: card.quoteId });
  const sent = await svc.submitApproval(checked.id, { signatures: await sign(env, await svc.prepareApproval(p.id)) });
  assert.equal(sent.state, 'confirmed', 'the payout leaves the payments vault with the device approval, as always');
});

test('a stablecoin from another wallet: the sending address is required, screened, and a flagged one is held out of the vault', async () => {
  const env = await company();
  const { p, card } = await shortTransfer(env);
  await assert.rejects(
    funding.startFunding(env.org.id, p.id, { method: 'wallet_usdc', quoteId: card.quoteId, fromAddress: 'not-an-address', sourceOfFunds: 'owner_capital', declared: true, by: 'Aisyah' }),
    (e) => e.code === 'bad_request' && /Solana address/.test(e.message),
  );
  const vault = svc.getOrg(env.org.id).vault;
  await assert.rejects(
    funding.startFunding(env.org.id, p.id, { method: 'wallet_usdc', quoteId: card.quoteId, fromAddress: vault.vaultPda, sourceOfFunds: 'owner_capital', declared: true, by: 'Aisyah' }),
    (e) => e.code === 'bad_request' && /your own vaults/.test(e.message),
  );
  const flagged = await funding.startFunding(env.org.id, p.id, { method: 'wallet_swap', asset: 'USDT', quoteId: card.quoteId, fromAddress: sender(), sourceOfFunds: 'owner_capital', declared: true, by: 'Aisyah', rehearsal: 'kyt_flag' });
  assert.equal(flagged.check.flagged, true);
  assert.ok(flagged.chargeMinor > 0n, 'the swap is charged by the venue, shown up front');
  const held = await funding.refreshFunding(env.org.id, flagged.id, later(funding.OFFLINE_FUNDS_CHECK_MS + 10));
  assert.equal(held.state, 'held');
  assert.equal(await runtime().chain.getUsdcBalance(vault.vaultPda), 0n, 'held money never reaches the vault');

  const clean = await funding.startFunding(env.org.id, p.id, { method: 'wallet_usdc', quoteId: card.quoteId, fromAddress: sender(), sourceOfFunds: 'owner_capital', declared: true, by: 'Aisyah' });
  assert.notEqual(clean.id, flagged.id, 'a held funding does not block another source');
  assert.equal(clean.chargeMinor, 0n, 'USDC needs no swap');
});

test('the declaration is required, one funding runs per payment, and a paid payment takes no more', async () => {
  const env = await company();
  const { p, card } = await shortTransfer(env);
  await assert.rejects(
    funding.startFunding(env.org.id, p.id, { method: 'airwallex', quoteId: card.quoteId, sourceOfFunds: 'business_revenue', declared: false, by: 'Aisyah' }),
    (e) => e.code === 'declaration_required',
  );
  const a = await funding.startFunding(env.org.id, p.id, { method: 'airwallex', quoteId: card.quoteId, sourceOfFunds: 'business_revenue', declared: true, by: 'Aisyah' });
  const b = await funding.startFunding(env.org.id, p.id, { method: 'stripe', quoteId: card.quoteId, sourceOfFunds: 'business_revenue', declared: true, by: 'Aisyah' });
  assert.equal(b.id, a.id, 'a second request returns the funding under way');
  await funding.refreshFunding(env.org.id, a.id, later(funding.OFFLINE_FUNDS_CHECK_MS + 10));
  await svc.selectRoute(p.id, { quoteId: card.quoteId });
  await svc.submitApproval(p.id, { signatures: await sign(env, await svc.prepareApproval(p.id)) });
  await assert.rejects(
    funding.startFunding(env.org.id, p.id, { method: 'stripe', quoteId: card.quoteId, sourceOfFunds: 'business_revenue', declared: true, by: 'Aisyah' }),
    (e) => e.code === 'wrong_state',
  );
});

test('charges are integers, rounded up, and Splash adds none', () => {
  assert.equal(funding.chargeFor(1_000_000n, 150), 15_000n);
  assert.equal(funding.chargeFor(1n, 150), 1n, 'rounded up, never down to nothing');
  assert.equal(funding.chargeFor(5_000_000n, 0), 0n);
  for (const m of Object.values(funding.FUNDING_METHODS)) assert.ok(Number.isInteger(m.chargeBps));
  assert.equal(funding.FUNDING_METHODS.wallet_usdc.chargeBps, 0);
});

test('on devnet the sandbox providers are refused, and a wallet deposit is sent by the person to the vault', async () => {
  const env = await company();
  const { p, card } = await shortTransfer(env);
  const opts = await funding.fundingOptions(env.org.id, p.id, card.quoteId);
  assert.ok(opts.methods.every((m) => m.available), 'offline, every method is available, as a simulation');
  assert.ok(opts.methods.filter((m) => m.id !== 'wallet_usdc').every((m) => m.sandbox), 'Stripe, Airwallex and the swap are labelled sandbox');
});
