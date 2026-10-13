// Prompt 07 §7, the admin console's read model and its one write (refuse service), offline:
//   orgs        the config authority as the CHAIN reports it, both vaults, the members
//   suspend     refused at the service AND at the one choke point in front of Kora; every change logged
//   fee payer   what each sponsored send cost, exactly: the ledger adds up to the fee payer's own balance
//   webhooks    every webhook logged with its signature check; a replay is a no-op; a forgery is refused
//   evidence    anchors with root, count and period; stored records and where they live
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import bs58 from 'bs58';
import { ComputeBudgetProgram, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';

import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { sponsoredFeeLamports, sponsoredRentLamports, TOKEN_ACCOUNT_RENT_LAMPORTS } from '../lib/solana/kora.ts';
import { buildCreateAtaIdempotentInstruction } from '../lib/solana/payout.ts';
import { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } from '../lib/solana/recovery-kit.ts';
import { SIMULATED_FEE_PAYER_START_LAMPORTS } from '../lib/solana/simulator.ts';
import { usdcMint } from '../lib/solana/config.ts';
import * as admin from '../lib/solana-app/admin-service.ts';
import { resetRuntime, runtime } from '../lib/solana-app/runtime.ts';
import { resetStore, store } from '../lib/solana-app/store.ts';
import * as svc from '../lib/solana-app/service.ts';
import { giveDetails } from './helpers/transfer-details.mjs';
import * as treasury from '../lib/solana-app/treasury-service.ts';

beforeEach(() => {
  delete process.env.SPLASH_SOLANA_MODE;
  process.env.SOLANA_PAYMENT_STORE = 'memory';
  resetStore();
  resetRuntime();
});

async function company(name = 'Selangor Trading Sdn Bhd') {
  const org = svc.createOrg({ companyName: name, personName: 'Aisyah' });
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
  await svc.fund(org.id);
  return { org, keys, device, vault };
}

async function sign(env, prepared) {
  const out = [];
  for (const m of prepared.messages) out.push({ id: m.id, signature: bs58.encode(await signWithDeviceKey(env.keys, env.org.id, new Uint8Array(Buffer.from(m.messageBase64, 'base64')))) });
  return out;
}

async function pay(env, { amount = '12000000', reference } = {}) {
  const inv = svc.startTransfer(env.org.id, { recipient: { name: 'Davao Packaging Corp.', bank: 'BPI', accountLast4: '0910' }, amountPhpMinor: amount, reference, verification: { by: 'Aisyah', method: 'call-back' } });
  giveDetails(env.org.id, inv.id);
  const p = await svc.quote(env.org.id, inv.id);
  const card = (await svc.paymentView(p.id)).cards.find((c) => c.kind === 'solana_direct');
  await svc.selectRoute(p.id, { quoteId: card.quoteId });
  await svc.submitApproval(p.id, { signatures: await sign(env, await svc.prepareApproval(p.id)) });
  await svc.deliverPartnerEvents(p.id);
  return svc.getPayment(p.id);
}

/* ------------------------------------------------------------------ the cost of a send */

test('a sponsored send costs 5,000 lamports a signature plus price × limit, and a new token account its rent', () => {
  const payer = Keypair.generate().publicKey;
  const owner = Keypair.generate().publicKey;
  const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }), buildCreateAtaIdempotentInstruction(payer, owner, usdcMint('devnet'))];
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: bs58.encode(new Uint8Array(32).fill(1)), instructions: ixs }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  assert.equal(sponsoredFeeLamports(tx), 5_000n + 200n, 'one signature, and 1,000 micro-lamports × 200,000 units = 200 lamports');
  assert.equal(sponsoredRentLamports(tx, { isNew: () => true }), TOKEN_ACCOUNT_RENT_LAMPORTS, 'a new token account: 2,039,280 lamports');
  assert.equal(sponsoredRentLamports(tx, { isNew: () => false }), 0n, 'an existing one costs nothing');
});

/* ------------------------------------------------------------------ 1. orgs and vaults */

test('orgs: the config authority is read from the chain and is none; both vaults and the members are shown', async () => {
  const env = await company();
  const [row] = await admin.adminOrgs();
  assert.equal(row.orgId, env.org.id);
  assert.equal(row.chain.found, true, 'the multisig is on the (simulated) chain');
  assert.equal(row.chain.configAuthority, null);
  assert.equal(row.configAuthorityNone, true);
  assert.equal(row.vault.multisigPda, env.vault.multisigPda);
  assert.equal(row.vault.paymentsVault.address, env.vault.vaultPda);
  assert.equal(row.vault.treasuryVault.address, svc.treasuryVaultPda(env.vault.multisigPda));
  assert.equal(row.vault.threshold, 1);
  assert.equal(row.vault.memberCount, 2);
  assert.equal(row.chain.members, 2);
  assert.equal(row.suspended, null);
});

/* ------------------------------------------------------------------ 5. refuse service */

test('suspend: no proposal, no move, and no fee-payer signature from any path; both changes are logged', async () => {
  const env = await company();
  await treasury.fundTreasury(env.org.id);
  await admin.adminSuspend(env.org.id, 'compliance@splash.test', 'KYB documents expired');

  const inv = svc.startTransfer(env.org.id, { recipient: { name: 'Davao Packaging Corp.', bank: 'BPI', accountLast4: '0910' }, amountPhpMinor: '500000', verification: { by: 'Aisyah', method: 'call-back' } });
  giveDetails(env.org.id, inv.id);
  const p = await svc.quote(env.org.id, inv.id);
  const card = (await svc.paymentView(p.id)).cards.find((c) => c.kind === 'solana_direct');
  await svc.selectRoute(p.id, { quoteId: card.quoteId });
  await assert.rejects(svc.prepareApproval(p.id), (e) => e.code === 'org_suspended', 'no proposal');
  await assert.rejects(treasury.prepareMove(env.org.id, { from: 'treasury', amountMinor: 1_000_000n, signer: env.device.publicKey, by: 'Aisyah' }), (e) => e.code === 'org_suspended', 'no move');

  // The last word sits in front of Kora: a transaction that reached the chain client is still refused.
  const rt = runtime();
  const before = await rt.chain.getSolBalance(await rt.chain.getFeePayer());
  const blank = new VersionedTransaction(new TransactionMessage({ payerKey: await rt.chain.getFeePayer(), recentBlockhash: await rt.chain.getLatestBlockhash(), instructions: [] }).compileToV0Message());
  await assert.rejects(rt.chain.sendSponsored(blank, { orgId: env.org.id }), /Sponsorship refused: Splash has paused service/);
  assert.equal(await rt.chain.getSolBalance(await rt.chain.getFeePayer()), before, 'nothing was signed or paid');

  // The vault stays the company's: Splash froze and moved nothing.
  assert.equal(await rt.chain.getUsdcBalance(env.vault.vaultPda), svc.OFFLINE_FUND_MINOR);

  await assert.rejects(admin.adminUnsuspend(env.org.id, 'compliance@splash.test', ''), (e) => e.code === 'bad_request', 'a reason is required');
  await admin.adminUnsuspend(env.org.id, 'compliance@splash.test', 'New documents verified');
  const log = svc.getOrg(env.org.id).serviceLog;
  assert.deepEqual(log.map((l) => [l.action, l.by, l.reason]), [
    ['suspend', 'compliance@splash.test', 'KYB documents expired'],
    ['unsuspend', 'compliance@splash.test', 'New documents verified'],
  ]);
  const [row] = await admin.adminOrgs();
  assert.equal(row.suspended, null);
  assert.equal(row.serviceLog.length, 2);
  const prepared = await svc.prepareApproval(p.id);
  assert.ok(prepared.messages.length > 0, 'service is back');
});

/* ------------------------------------------------------------------ 3. fee payer */

test('fee payer: every sponsored send is in the ledger, and the ledger equals what the fee payer lost', async () => {
  const env = await company();
  await pay(env);
  await treasury.fundTreasury(env.org.id);
  const m = await treasury.prepareMove(env.org.id, { from: 'treasury', amountMinor: 5_000_000n, signer: env.device.publicKey, by: 'Aisyah' });
  await treasury.submitMove(env.org.id, m.move.id, { signatures: await sign(env, m), who: 'Aisyah' });

  const k = await admin.adminFeePayer();
  assert.equal(k.simulated, true);
  assert.ok(k.today.count >= 4, `vault, payment and move sends counted (${k.today.count})`);
  assert.ok(k.today.feeLamports >= 5_000n * BigInt(k.today.count), 'at least 5,000 lamports a send');
  assert.ok(k.today.rentLamports > 0n, 'the vault, its proposals and the new token accounts cost rent');
  assert.equal(SIMULATED_FEE_PAYER_START_LAMPORTS - k.solLamports, k.week.feeLamports + k.week.rentLamports, 'the ledger is exactly what the fee payer paid');
  assert.equal(k.rentLocked, k.week.rentLamports);
  assert.equal(k.perOrg.length, 1);
  assert.equal(k.perOrg[0].companyName, 'Selangor Trading Sdn Bhd');
  assert.equal(k.perOrg[0].today.count, k.today.count);
  assert.equal(k.perOrgCap, 50);
  assert.equal(k.low, false);

  runtime().chain.topUpFeePayer(-(k.solLamports - 1_000n));
  assert.equal((await admin.adminFeePayer()).low, true, 'below 0.5 SOL the console alerts');
});

test('fee payer: spend is split by company', async () => {
  const a = await company('Acme Manufacturing');
  const b = await company('Bukit Foods');
  await pay(a);
  const k = await admin.adminFeePayer();
  const byName = Object.fromEntries(k.perOrg.map((r) => [r.companyName, r]));
  assert.ok(byName['Acme Manufacturing'].today.count > byName['Bukit Foods'].today.count, 'the company that paid sent more');
  assert.equal(k.today.count, byName['Acme Manufacturing'].today.count + byName['Bukit Foods'].today.count);
  assert.equal(k.week.feeLamports, byName['Acme Manufacturing'].week.feeLamports + byName['Bukit Foods'].week.feeLamports);
  void b;
});

/* ------------------------------------------------------------------ 2. payments */

test('payments: state, amounts, the create / approve / execute transactions, the partner and the evidence', async () => {
  const env = await company();
  const paid = await pay(env, { reference: 'PO-1182' });
  const [row] = await admin.adminPayments();
  assert.equal(row.id, paid.id);
  assert.equal(row.companyName, 'Selangor Trading Sdn Bhd');
  assert.equal(row.kind, 'transfer');
  assert.equal(row.state, 'anchored');
  assert.equal(row.amountPhpMinor, 12_000_000n);
  assert.ok(row.youPayUsdcMinor > 0n);
  const steps = new Set(row.transactions.map((t) => t.step));
  assert.ok(steps.has('create') && steps.has('execute'), `create and execute on record: ${[...steps].join(', ')}`);
  assert.ok(row.transactions.every((t) => t.simulated && t.solscanUrl === null), 'offline: simulated, so no explorer link that would 404');
  assert.equal(row.partner.status, 'paid');
  assert.match(row.partner.bankReference, /^MOCK-/);
  assert.equal(row.evidence.anchor, 'anchored');
});

/* ------------------------------------------------------------------ 6. webhooks */

test('webhooks: accepted, a replay is a no-op, a forged signature is refused, and each is logged', async () => {
  const env = await company();
  const paid = await pay(env);
  const w = admin.adminWebhooks();
  assert.ok(w.counts.accepted >= 2, 'received, then paid');
  assert.equal(w.counts.refused, 0);
  assert.equal(w.protection.maxAgeSec, 3600);

  const genuine = paid.partnerEvents.find((e) => e.status === 'paid');
  const raw = { ...genuine, amountPhpMinor: genuine.amountPhpMinor.toString() };
  const again = await svc.receivePartnerWebhook(raw);
  assert.equal(again.duplicate, true, 'the same payment and status again changes nothing');
  await assert.rejects(svc.receivePartnerWebhook({ ...raw, signature: 'ab'.repeat(32) }), (e) => e.code === 'webhook_invalid');
  await assert.rejects(svc.receivePartnerWebhook({ paymentId: 'x' }), (e) => e.code === 'webhook_invalid');

  const after = admin.adminWebhooks();
  assert.equal(after.counts.duplicate, 1);
  assert.equal(after.counts.refused, 2);
  assert.equal(after.counts.badSignature, 1);
  const [malformed, forged, replay] = after.log;
  assert.equal(replay.result, 'duplicate');
  assert.equal(forged.result, 'refused');
  assert.equal(forged.signatureOk, false);
  assert.match(forged.reason, /bad signature/);
  assert.equal(malformed.signatureOk, null, 'a malformed body never reached the signature check');
  assert.equal(store().webhookLog.length <= 200, true);

  // A forged webhook for a payment this server never had: the signature is checked first, and it is logged.
  await assert.rejects(svc.receivePartnerWebhook({ ...raw, paymentId: 'pay_0123456789abcdef', signature: '00'.repeat(32) }), (e) => e.code === 'webhook_invalid' && e.status === 401);
  const unknown = admin.adminWebhooks().log[0];
  assert.equal(unknown.paymentId, 'pay_0123456789abcdef');
  assert.equal(unknown.signatureOk, false);
  assert.equal(unknown.result, 'refused');
});

test('the webhook route checks the signature before it looks the payment up, so a forgery is never silent', async () => {
  const { readFile } = await import('node:fs/promises');
  const route = await readFile(new URL('../app/api/solana/partner/webhook/route.ts', import.meta.url), 'utf8');
  assert.match(route, /getPayment\(body\.paymentId\)\.catch\(\(\) => null\)/);
  assert.match(route, /if \(!p\) return await receivePartnerWebhook\(body\);/);
});

test('the refuse-service route is staff-only, compliance or operations, and needs a reason', async () => {
  const { readFile } = await import('node:fs/promises');
  const route = await readFile(new URL('../app/api/admin/solana/orgs/[orgId]/service/route.ts', import.meta.url), 'utf8');
  assert.match(route, /getAdminSession\(\)/);
  assert.match(route, /session\.role !== 'compliance' && session\.role !== 'operations'/);
  assert.match(route, /reason: z\.string\(\)\.trim\(\)\.min\(3\)/);
  const page = await readFile(new URL('../app/admin/(console)/compliance/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /Splash can refuse service\. Splash cannot freeze or move a customer&rsquo;s funds\./);
});

/* ------------------------------------------------------------------ 4. evidence */

test('evidence: each anchor with its root, count and period; where each record is stored', async () => {
  const env = await company();
  await pay(env);
  await pay(env, { amount: '7000000', reference: 'PO-1183' });
  const ev = await admin.adminEvidence();
  assert.ok(ev.anchors.length >= 1);
  const a = ev.anchors[0];
  assert.match(a.rootHex, /^[0-9a-f]{64}$/);
  assert.ok(a.count >= 1);
  assert.ok(a.periodEnd >= a.periodStart);
  assert.equal(a.status, 'anchored');
  assert.equal(a.attester, runtime().attester.publicKey.toBase58());
  assert.equal(ev.stored.length, 2);
  assert.equal(ev.walrus.offline, 2, 'offline the records are in the stand-in store, not on Walrus');
  assert.equal(ev.walrus.onWalrus, 0);
  assert.equal(ev.walrus.expiringSoon, 0);
  assert.equal(ev.sponsor, null, 'no Sui sponsor key offline');
  assert.ok(new PublicKey(ev.attester));
});
