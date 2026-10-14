// Prompt 10 §5.10: Balance, through the services. Every figure is the server's (one read, integers);
// "Add money" lands only in the company's own Payments account, after a funds check and a
// declaration, with Splash's fee at US$0; money in and out is read from the company's own records.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';

import bs58 from 'bs58';

import * as funding from '../lib/solana-app/funding-service.ts';
import { balanceFor, fundingWords } from '../lib/solana-app/balance.ts';
import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } from '../lib/solana/recovery-kit.ts';
import { resetRuntime, runtime } from '../lib/solana-app/runtime.ts';
import * as svc from '../lib/solana-app/service.ts';
import { resetStore } from '../lib/solana-app/store.ts';
import * as treasury from '../lib/solana-app/treasury-service.ts';

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
  return { org, keys };
}

async function sign(env, prepared) {
  const out = [];
  for (const m of prepared.messages) out.push({ id: m.id, signature: bs58.encode(await signWithDeviceKey(env.keys, env.org.id, new Uint8Array(Buffer.from(m.messageBase64, 'base64')))) });
  return out;
}

const later = (ms) => new Date(Date.now() + ms);

test('an empty Payments account: nothing waiting, nothing free, no rows', async () => {
  const { org } = await company();
  const b = await balanceFor(org.id);
  assert.equal(b.paymentsMinor, 0n);
  assert.equal(b.freeMinor, 0n);
  assert.deepEqual(b.bar, { freePct: 0n, waitingPct: 0n });
  assert.deepEqual(b.rows, []);
  assert.equal(b.investmentsSetUp, false);
});

test('free and waiting: what is waiting for approval comes off what is free; the bar is whole percents that add to 100', async () => {
  const env = await company();
  await svc.fund(env.org.id);
  const inv = svc.startTransfer(env.org.id, { recipient: { name: 'Davao Packaging Corp.', bank: 'BPI', accountLast4: '0910' }, amountPhpMinor: '28700000', verification: { by: 'Aisyah', method: 'call-back' }, by: 'Aisyah' });
  const { giveDetails } = await import('./helpers/transfer-details.mjs');
  giveDetails(env.org.id, inv.id);
  const p = await svc.quote(env.org.id, inv.id);
  const card = (await svc.paymentView(p.id)).cards[0];
  const checked = await svc.selectRoute(p.id, { quoteId: card.quoteId });
  const b = await balanceFor(env.org.id);
  assert.equal(b.paymentsMinor, svc.OFFLINE_FUND_MINOR);
  assert.equal(b.waitingMinor, checked.approval.youPayUsdcMinor);
  assert.equal(b.freeMinor, b.paymentsMinor - b.waitingMinor);
  assert.equal(b.bar.freePct + b.bar.waitingPct, 100n);
  const waiting = b.rows.find((r) => r.id === p.id);
  assert.equal(waiting.tag.label, 'Not taken yet');
  assert.equal(waiting.amountMinor, -checked.approval.youPayUsdcMinor, 'money out is negative');
  const added = b.rows.find((r) => r.what === 'Added');
  assert.equal(added.amountMinor, svc.OFFLINE_FUND_MINOR);
  assert.equal(added.detail, 'test money · test mode');
  // Sent: the row turns into the payment, at what it cost.
  const sent = await svc.submitApproval(p.id, { signatures: await sign(env, await svc.prepareApproval(p.id)) });
  assert.equal(sent.state, 'confirmed');
  const after = await balanceFor(env.org.id);
  assert.equal(after.waitingMinor, 0n);
  assert.match(after.rows.find((r) => r.id === p.id).detail, /paid by (PESONet|InstaPay)$/);
  for (const r of after.rows) assert.equal(typeof r.amountMinor, 'bigint');
});

test('a move from the Reserve shows as money in; the Reserve and its floor are read too', async () => {
  const env = await company();
  await treasury.fundTreasury(env.org.id);
  const move = await treasury.prepareMove(env.org.id, { from: 'treasury', amountMinor: 1_000_000_000n, signer: svc.getOrg(env.org.id).keys.device.publicKey, by: 'Aisyah' });
  assert.equal((await treasury.submitMove(env.org.id, move.move.id, { signatures: await sign(env, move), who: 'Aisyah' })).state, 'confirmed');
  const b = await balanceFor(env.org.id);
  assert.equal(b.paymentsMinor, 1_000_000_000n);
  assert.equal(b.reserveMinor, treasury.OFFLINE_TREASURY_FUND_MINOR - 1_000_000_000n);
  const row = b.rows.find((r) => r.what === 'Moved from your Reserve');
  assert.equal(row.amountMinor, 1_000_000_000n);
});

test('add money from Balance: the funds check first, then the company’s own Payments account; US$1 minimum, whole cents', async () => {
  const { org } = await company();
  const vault = svc.getOrg(org.id).vault;
  const ask = (over = {}) => funding.startTopUp(org.id, { source: 'bank_card', amountMinor: 250_000_000n, sourceOfFunds: 'business_revenue', declared: true, by: 'Aisyah', ...over });
  await assert.rejects(ask({ amountMinor: 999_999n }), (e) => /at least US\$1\.00/.test(e.message));
  await assert.rejects(ask({ amountMinor: 1_000_001n }), (e) => /whole cents/.test(e.message));
  await assert.rejects(ask({ declared: false }), (e) => e.code === 'declaration_required');
  await assert.rejects(ask({ source: 'wallet:PYUSD:solana' }), (e) => /Only USDC and USDT/.test(e.message));
  const f = await ask();
  assert.equal(f.paymentId, null, 'no payment attached');
  assert.equal(f.state, 'checking');
  assert.equal(f.chargeMinor, funding.chargeFor(250_000_000n, 50), 'the provider’s charge, on top; Splash adds nothing');
  assert.equal((await ask()).id, f.id, 'one top-up under its check at a time');
  assert.equal(await runtime().chain.getUsdcBalance(vault.vaultPda), 0n, 'nothing counts before the check');
  const done = await funding.refreshFunding(org.id, f.id, later(funding.OFFLINE_FUNDS_CHECK_MS + 1));
  assert.equal(done.state, 'in_vault');
  assert.equal(await runtime().chain.getUsdcBalance(vault.vaultPda), 250_000_000n);
  const b = await balanceFor(org.id);
  assert.equal(b.rows[0].detail, 'bank or card top-up · test mode');
  assert.equal(b.rows[0].amountMinor, 250_000_000n);
});

test('the top-up options are priced on the server for the amount asked, cheapest first, integers, and land only in the company’s own account', async () => {
  const { org } = await company();
  const o = await funding.topUpOptions(org.id, 500_000_000n);
  assert.equal(o.shortMinor, '500000000');
  assert.equal(o.plan, null);
  assert.ok(o.priced.length > 0);
  for (const p of o.priced) {
    assert.match(p.totalMinor, /^\d+$/);
    assert.equal(BigInt(p.totalMinor), BigInt(p.amountMinor) + BigInt(p.chargeMinor));
  }
  const totals = o.priced.map((p) => BigInt(p.totalMinor));
  assert.deepEqual([...totals].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), totals, 'cheapest first');
  assert.ok(o.routes.every((r) => r.splashFeeBps === 0));
});

test('stored notes read in plain words on Balance', () => {
  assert.deepEqual(fundingWords('Test USDC (simulated)', true), { what: 'Added', detail: 'test money · test mode' });
  assert.deepEqual(fundingWords('Returned by mock partner (simulated)', true), { what: 'Returned', detail: 'a payment the bank sent back' });
  assert.equal(fundingWords('Bank or card top-up · test mode for pay_0123456789abcdef', true).detail, 'bank or card top-up, for a payment · test mode');
  assert.equal(fundingWords('From a crypto wallet · top-up', true).detail, 'from a crypto wallet · test mode');
});

test('the Balance screen does no sums of its own', () => {
  const src = readFileSync('components/solana/Balance.tsx', 'utf8');
  assert.doesNotMatch(src, /treasury\/reserve/, 'the money rules are the server’s');
  assert.doesNotMatch(src, /BigInt\([^)]*\)\s*[-+*/]\s*/, 'no arithmetic on amounts');
});
