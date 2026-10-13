// Prompt 07 §5.1 and §5.4, through the service on the offline simulator: compare-and-set claims,
// idempotency keys, expiry and rebuild (never a resend), finality before evidence, resume, the
// refuse-service switch, the payee re-check, and a 2-of-N vault.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { Keypair, PublicKey, VersionedMessage } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import bs58 from 'bs58';

import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } from '../lib/solana/recovery-kit.ts';
import { getAssociatedTokenAddress } from '../lib/solana/payout.ts';
import { buildCreateVaultInstruction, buildSponsoredTransaction } from '../lib/solana/squads.ts';
import { resetRuntime, runtime, splashKeys } from '../lib/solana-app/runtime.ts';
import { resetStore, store } from '../lib/solana-app/store.ts';
import { toWire } from '../lib/solana-app/json.ts';
import { SAMPLE_INVOICE_TEXT } from '../lib/solana-zeke/fixtures/sample-invoice.ts';
import * as svc from '../lib/solana-app/service.ts';

const FIELDS = ['invoiceNumber', 'supplierName', 'supplierBank', 'supplierAccountLast4', 'amountPhpMinor', 'dueDate'];
const EXECUTE = Buffer.from(multisig.generated.vaultTransactionExecuteInstructionDiscriminator);

beforeEach(() => {
  delete process.env.SPLASH_SOLANA_MODE;
  process.env.SOLANA_PAYMENT_STORE = 'memory';
  resetStore();
  resetRuntime();
});

async function onboard() {
  const org = svc.createOrg({ companyName: 'Selangor Trading Sdn Bhd', personName: 'Aisyah' });
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
  const vault = await svc.createVault(org.id);
  await svc.fund(org.id);
  return { org, keys, device, vault, kit };
}

async function invoice(orgId, number = 'INV-0412') {
  const { invoice: inv } = await svc.readInvoiceDraft(orgId, { text: SAMPLE_INVOICE_TEXT.replace('INV-0412', number) });
  svc.verifyBank(orgId, inv.id, { by: 'Aisyah', method: 'call-back', bank: inv.draft.fields.supplierBank, accountLast4: inv.draft.fields.supplierAccountLast4 });
  svc.confirmInvoice(orgId, inv.id, { fields: toWire(inv.draft.fields), confirmed: [...FIELDS] });
  return inv;
}

async function chosen(orgId, number) {
  const inv = await invoice(orgId, number);
  const p = await svc.quote(orgId, inv.id);
  const direct = (await svc.paymentView(p.id)).cards.find((c) => c.kind === 'solana_direct');
  return svc.selectRoute(p.id, { quoteId: direct.quoteId });
}

async function sign(store, keyId, prepared) {
  const out = [];
  for (const m of prepared.messages) out.push({ id: m.id, signature: bs58.encode(await signWithDeviceKey(store, keyId, new Uint8Array(Buffer.from(m.messageBase64, 'base64')))) });
  return out;
}

const transfers = () => runtime().chain.events.filter((e) => e.kind === 'transfer').length;

test('two windows approve the same payment at once: exactly one reaches the chain', async () => {
  const { org, keys, vault } = await onboard();
  const p = await chosen(org.id);
  const sigs = await sign(keys, org.id, await svc.prepareApproval(p.id));
  const before = await runtime().chain.getUsdcBalance(vault.vaultPda);
  const results = await Promise.allSettled([svc.submitApproval(p.id, { signatures: sigs }), svc.submitApproval(p.id, { signatures: sigs })]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const lost = results.find((r) => r.status === 'rejected');
  assert.equal(lost.reason.code, 'wrong_state');
  assert.equal(transfers(), 2, 'one payout leg and one fee leg, once');
  const after = await runtime().chain.getUsdcBalance(vault.vaultPda);
  assert.equal(before - after, p.approval.youPayUsdcMinor, 'debited once');
  assert.equal((await svc.getPayment(p.id)).state, 'confirmed');
  assert.ok(store().orgs.get(org.id).seenCommitments.length === 1, 'the winner kept its reservation');
});

test('a dropped execute is never resent: it expires, is rebuilt with a fresh blockhash, signed again, and lands once', async () => {
  const { org, keys, vault } = await onboard();
  const sim = runtime().chain;
  const p = await chosen(org.id);
  const before = await sim.getUsdcBalance(vault.vaultPda);
  sim.dropIf = (tx) => tx.message.compiledInstructions.some((ix) => Buffer.from(ix.data.subarray(0, 8)).equals(EXECUTE));
  await assert.rejects(svc.submitApproval(p.id, { signatures: await sign(keys, org.id, await svc.prepareApproval(p.id)) }), (e) => e.code === 'uncertain' && e.status === 504);
  let now = await svc.getPayment(p.id);
  assert.equal(now.state, 'executed', 'signed and recorded; whether it landed is not known yet');
  const firstSig = now.execution.signature;
  assert.ok(firstSig);

  // Still inside the blockhash's life: resume only polls, and nothing changes.
  assert.equal((await svc.resumePayment(p.id)).state, 'executed');
  // Past its last valid block height, a worker after a restart finds it expired.
  sim.advanceBlocks(200);
  assert.deepEqual(await svc.resumeAll(), [{ id: p.id, state: 'execute_failed' }]);
  now = await svc.getPayment(p.id);
  assert.equal(now.problem.code, 'blockhash_expired');
  assert.equal(now.execution.attempt, 1);
  assert.equal(await sim.getUsdcBalance(vault.vaultPda), before, 'nothing moved');

  sim.dropIf = null;
  const again = await svc.prepareApproval(p.id);
  assert.deepEqual(again.messages.map((m) => m.purpose), ['execute'], 'only the execute is rebuilt');
  const sent = await svc.submitApproval(p.id, { signatures: await sign(keys, org.id, again) });
  assert.equal(sent.state, 'confirmed');
  assert.notEqual(sent.execution.signature, firstSig, 'new bytes, new signature');
  const calls = await runtime().payments.listCalls(p.id);
  assert.deepEqual(calls.filter((c) => c.step.startsWith('execute')).map((c) => [c.step, c.status]), [['execute:0', 'expired'], ['execute:1', 'finalized']]);
  assert.equal(before - (await sim.getUsdcBalance(vault.vaultPda)), p.approval.youPayUsdcMinor, 'debited exactly once');
  assert.equal((await sim.getSignatureStatus(firstSig)).confirmationStatus, null, 'the old bytes never landed');
});

test('evidence waits for finality: confirmed and paid is not yet proof', async () => {
  const { org, keys } = await onboard();
  const sim = runtime().chain;
  sim.finalityDepth = 32;
  const p = await chosen(org.id);
  const sent = await svc.submitApproval(p.id, { signatures: await sign(keys, org.id, await svc.prepareApproval(p.id)) });
  assert.equal(sent.state, 'confirmed');
  assert.equal(sent.execution.finalizedAt, null);
  await svc.deliverPartnerEvents(p.id);
  let now = await svc.getPayment(p.id);
  assert.equal(now.state, 'partner_paid');
  assert.equal(now.receiptId, null, 'no receipt before the execute is final');
  sim.advanceBlocks(32);
  now = await svc.resumePayment(p.id);
  assert.equal(now.state, 'anchored');
  assert.ok(now.execution.finalizedAt);
  assert.equal(svc.verifyReceipt(now.receiptId).ok, true);
});

test('refuse service: a suspended company gets no fee-payer signature and no proposal; the vault stays its own', async () => {
  const { org, keys, vault } = await onboard();
  const p = await chosen(org.id);
  svc.suspendOrg(org.id, { by: 'compliance@splash', reason: 'KYB review' });
  await assert.rejects(svc.prepareApproval(p.id), (e) => e.code === 'org_suspended' && e.status === 403);
  svc.unsuspendOrg(org.id);
  const prepared = await svc.prepareApproval(p.id);
  const sigs = await sign(keys, org.id, prepared);
  svc.suspendOrg(org.id, { by: 'compliance@splash', reason: 'KYB review' });
  const events = runtime().chain.events.length;
  await assert.rejects(svc.submitApproval(p.id, { signatures: sigs }), (e) => e.code === 'org_suspended');
  assert.equal(runtime().chain.events.length, events, 'nothing reached the chain');
  assert.deepEqual(await runtime().payments.listCalls(p.id), []);
  assert.equal((await svc.getPayment(p.id)).state, 'checked');
  assert.throws(() => svc.suspendOrg(org.id, { by: 'x', reason: '' }), /reason/);
  // Splash pausing service is not Splash moving money: the balance is untouched.
  assert.equal(await runtime().chain.getUsdcBalance(vault.vaultPda), svc.OFFLINE_FUND_MINOR);
});

test('the payee is re-checked before the device prompt: a changed deposit address blocks and asks for a new quote', async () => {
  const { org } = await onboard();
  const p = await chosen(org.id);
  await runtime().payments.update(p.id, { version: p.version }, (d) => {
    d.payout.deposits = d.payout.deposits.map((x) => (x.network === 'solana' ? { ...x, address: Keypair.generate().publicKey.toBase58() } : x));
  });
  await assert.rejects(svc.prepareApproval(p.id), (e) => e.code === 'payee_changed');
  const now = await svc.getPayment(p.id);
  assert.equal(now.state, 'rejected_by_policy');
  assert.equal(now.problem.code, 'payee_changed');
});

test('simulate before every send: an execute that would fail is refused unsigned, with its logs', async () => {
  const { org, keys } = await onboard();
  // Three invoices quoted on one balance that can pay two.
  const a = await chosen(org.id, 'INV-0501');
  const b = await chosen(org.id, 'INV-0502');
  const c = await chosen(org.id, 'INV-0503');
  for (const p of [a, b]) {
    const sent = await svc.submitApproval(p.id, { signatures: await sign(keys, org.id, await svc.prepareApproval(p.id)) });
    assert.equal(sent.state, 'confirmed');
  }
  // Prompt 10 §5.6: the third is refused before any device is asked, because the Payments account no
  // longer holds it (a planned move from the reserve lands first; here there is none).
  await assert.rejects(svc.prepareApproval(c.id), (e) => e.code === 'insufficient_balance');
  // Money can still leave by another path between the approval and the send: simulation catches that.
  await svc.fund(org.id);
  const prepared = await svc.prepareApproval(c.id);
  const sim = runtime().chain;
  sim.state.balances.set(getAssociatedTokenAddress(sim.mint, new PublicKey(store().orgs.get(org.id).vault.vaultPda)).toBase58(), 0n);
  const third = await svc.submitApproval(c.id, { signatures: await sign(keys, org.id, prepared) });
  assert.equal(third.state, 'execute_failed');
  assert.match(third.problem.message, /insufficient USDC/);
  assert.ok(third.execution.lastLogs?.some((l) => /insufficient USDC/.test(l)), 'the simulation logs are kept');
  const calls = await runtime().payments.listCalls(c.id);
  // Prompt 10 Phase 3 keys proposal steps by the on-chain index (was: 'proposal:0'), so a re-proposal
  // after a re-quote is a new call while a resend of the same one is still refused.
  assert.ok(calls.some((x) => /^proposal:tx\d+\.0$/.test(x.step)));
  assert.ok(!calls.some((x) => x.step.startsWith('execute')), 'the failing execute was never signed by the fee payer');
});

test('a 2-of-N vault: the first approver proposes, the second approves and executes; nobody approves twice', async () => {
  const { org, keys, device, kit } = await onboard();
  const rt = runtime();
  const keys2 = createMemoryDeviceKeyStore();
  const device2 = await createDeviceKey(keys2, 'approver-2');
  const kitB = deriveRecoveryKey(generateRecoveryWords());
  const feePayer = await rt.chain.getFeePayer();
  const createKey = Keypair.generate();
  const plan = buildCreateVaultInstruction({
    mode: 'dual',
    members: [
      { role: 'admin_device', publicKey: device.publicKey },
      { role: 'approver_device', publicKey: device2.publicKey },
      { role: 'recovery_kit_a', publicKey: kit.publicKey },
      { role: 'recovery_kit_b', publicKey: kitB.publicKey },
    ],
    createKey: createKey.publicKey,
    feePayer,
    treasury: await rt.chain.getSquadsTreasury(),
    splashKeys: await splashKeys(rt),
  });
  const tx = buildSponsoredTransaction(feePayer, [plan.instruction], await rt.chain.getLatestBlockhash());
  tx.sign([createKey]);
  const receipt = await rt.chain.sendSponsored(tx, { orgId: org.id });
  store().orgs.get(org.id).vault = { ...plan.vault, configAuthority: null, createdAt: new Date().toISOString(), signature: receipt.signature, simulated: true, cluster: 'devnet' };
  await svc.fund(org.id);

  const p = await chosen(org.id);
  assert.equal(p.threshold, 2);
  const first = await svc.prepareApproval(p.id);
  assert.ok(!first.messages.some((m) => m.purpose === 'execute'), 'one approval of two: no execute yet');
  let now = await svc.submitApproval(p.id, { signatures: await sign(keys, org.id, first) });
  assert.equal(now.state, 'proposed');
  assert.deepEqual(now.approvedBy, [device.publicKey]);
  assert.equal(transfers(), 0, 'nothing moved on one approval');
  await assert.rejects(svc.prepareApproval(p.id), (e) => e.code === 'already_approved');
  await assert.rejects(svc.prepareApproval(p.id, { signer: kit.publicKey }), (e) => e.code === 'not_an_approver', 'the recovery kit does not approve payments');

  const second = await svc.prepareApproval(p.id, { signer: device2.publicKey });
  assert.deepEqual(second.messages.map((m) => m.purpose), ['approve', 'execute']);
  now = await svc.submitApproval(p.id, { signatures: await sign(keys2, 'approver-2', second) });
  assert.equal(now.state, 'confirmed');
  assert.deepEqual(now.approvedBy, [device.publicKey, device2.publicKey]);
  assert.equal(transfers(), 2);
  const path = (await rt.payments.transitions(p.id)).map((t) => t.to);
  // Each approval is two compare-and-sets: the claim before sending, then its confirmation.
  assert.deepEqual(path, ['draft', 'quoted', 'checked', 'proposed', 'proposed', 'proposed', 'approved', 'executed', 'confirmed']);
});

test('every money-path transaction leads with a compute budget (limit, then price) within the fee-payer cap', async () => {
  const { org } = await onboard();
  runtime().chain.priorityFeeMicroLamports = 10_000_000; // a congested network: the cap must bite
  const p = await chosen(org.id);
  const prepared = await svc.prepareApproval(p.id);
  const stored = (await svc.getPayment(p.id)).prepared;
  const { VersionedTransaction, ComputeBudgetProgram } = await import('@solana/web3.js');
  for (const m of stored.messages) {
    const tx = VersionedTransaction.deserialize(Buffer.from(m.txBase64, 'base64'));
    const keys = tx.message.staticAccountKeys;
    const [a, b] = tx.message.compiledInstructions;
    assert.ok(keys[a.programIdIndex].equals(ComputeBudgetProgram.programId) && a.data[0] === 2, `${m.step}: limit first`);
    assert.ok(keys[b.programIdIndex].equals(ComputeBudgetProgram.programId) && b.data[0] === 3, `${m.step}: price second`);
    const price = Buffer.from(b.data).readBigUInt64LE(1);
    assert.ok((price * BigInt(m.unitLimit) + 999_999n) / 1_000_000n <= 100_000n, `${m.step}: priority within 100,000 lamports`);
  }
  assert.equal(prepared.messages.length, stored.messages.length);
});

test('the money-path memo is the payment id, inside the vault transaction and nothing else', async () => {
  const { org, keys } = await onboard();
  const p = await chosen(org.id);
  await svc.submitApproval(p.id, { signatures: await sign(keys, org.id, await svc.prepareApproval(p.id)) });
  const memos = runtime().chain.events.filter((e) => e.kind === 'memo').map((e) => e.detail.memo);
  assert.ok(memos.length >= 1);
  for (const memo of memos) assert.equal(memo, `splash:pay:v1:${p.id}`);
});

test('traceable on Solscan: every transaction of a payment carries its memo at the top level, and the view lists what to open', async () => {
  const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
  const { org, keys, vault } = await onboard();
  const p = await chosen(org.id);
  const prepared = await svc.prepareApproval(p.id);
  assert.deepEqual([...new Set(prepared.messages.map((m) => m.purpose))], ['proposal', 'execute'], 'threshold 1: the proposal and the execute in one prompt');
  for (const m of prepared.messages) {
    const msg = VersionedMessage.deserialize(new Uint8Array(Buffer.from(m.messageBase64, 'base64')));
    const keysOf = msg.staticAccountKeys.map((k) => k.toBase58());
    const memos = msg.compiledInstructions.filter((ix) => keysOf[ix.programIdIndex] === MEMO).map((ix) => Buffer.from(ix.data).toString('utf8'));
    assert.deepEqual(memos, [`splash:pay:v1:${p.id}`], `${m.purpose} carries the payment memo once at the top level`);
  }
  const done = await svc.submitApproval(p.id, { signatures: await sign(keys, org.id, prepared) });
  const view = await svc.paymentView(done.id);
  assert.equal(view.trace.memo, `splash:pay:v1:${p.id}`);
  assert.deepEqual(view.trace.accounts.map((a) => a.label), ['Your vault', 'Your vault’s USDC account', 'Payout partner deposit']);
  assert.equal(view.trace.accounts[0].address, vault.vaultPda);
  // Offline every signature is simulated: no link to a transaction that exists on no network.
  assert.ok(view.signatures.length >= 2);
  for (const s of view.signatures) assert.equal(s.solscanUrl, null);
  for (const a of view.trace.accounts) assert.equal(a.solscanUrl, null);
});
