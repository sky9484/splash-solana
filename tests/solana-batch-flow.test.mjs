// Prompt 07 §5.5 and §6.2, through the batch service on the offline simulator: a supplier file becomes
// chunks sized by measurement, one device prompt signs every chunk, each chunk pays all its suppliers or
// none, a failed chunk is retried alone with a fresh blockhash, and nobody is paid twice.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import bs58 from 'bs58';

import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } from '../lib/solana/recovery-kit.ts';
import { parseSupplierRows, pesosToCentavos, SAMPLE_BATCH_CSV } from '../lib/solana-app/batch-rows.ts';
import * as batch from '../lib/solana-app/batch-service.ts';
import { resetRuntime, runtime } from '../lib/solana-app/runtime.ts';
import { resetStore } from '../lib/solana-app/store.ts';
import * as svc from '../lib/solana-app/service.ts';

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

const sample = () => parseSupplierRows(SAMPLE_BATCH_CSV).rows;

test('the supplier file parses to integer centavos and keeps only the last four account digits', () => {
  const { rows, errors } = parseSupplierRows(SAMPLE_BATCH_CSV);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 12);
  assert.equal(rows[0].amountPhpMinor, 4_825_000n);
  assert.equal(rows[0].accountLast4, '4471');
  assert.equal(pesosToCentavos('₱36,980.50'), 3_698_050n);
  assert.equal(pesosToCentavos('1.234'), null, 'no fractions of a centavo');
  const bad = parseSupplierRows('supplier,bank,account,amount\nX,BDO,12,abc\nGood Co,BDO,1234,100');
  assert.equal(bad.rows.length, 1);
  assert.match(bad.errors[0].message, /Line 2 needs a supplier name, the account number .*, an amount in pesos/);
});

test('twelve suppliers: measured chunks, one device prompt, every supplier paid exactly once', async () => {
  const env = await company();
  const rt = runtime();
  const before = await rt.chain.getUsdcBalance(env.vault.vaultPda);
  const feeBefore = await rt.chain.getUsdcBalance(rt.feeAccountOwner);
  const b = await batch.createBatch(env.org.id, { rows: sample(), by: 'Aisyah' });
  assert.equal(b.state, 'quoted');
  assert.ok(b.chunks.length >= 2, 'twelve suppliers do not fit one Solana transaction');
  for (const c of b.chunks) for (const size of [...c.sizes.proposal, c.sizes.execute]) assert.ok(size <= 1232, `chunk ${c.index}: ${size} bytes`);
  assert.deepEqual(b.chunks.flatMap((c) => c.rowIds), b.rows.map((r) => r.id), 'every supplier once, in order');
  assert.equal(b.totals.youPayMinor, b.totals.transferMinor + b.totals.feeMinor);

  const prepared = await batch.prepareBatch(env.org.id, b.id, { signer: env.device.publicKey });
  assert.deepEqual([...new Set(prepared.messages.map((m) => m.chunkIndex))], b.chunks.map((c) => c.index), 'every chunk in the one prompt');
  const done = await batch.submitBatch(env.org.id, b.id, { signatures: await sign(env, prepared), who: 'Aisyah' });
  assert.equal(done.state, 'done');
  assert.ok(done.chunks.every((c) => c.state === 'confirmed'));
  for (const r of done.rows) {
    assert.equal(r.status, 'paid', `${r.supplierName} paid`);
    assert.match(r.bankReference, /^MOCK-/);
    assert.equal(await rt.chain.getUsdcBalance(r.depositAddress), r.transferMinor, `${r.supplierName}: exactly its transfer`);
  }
  assert.equal(before - (await rt.chain.getUsdcBalance(env.vault.vaultPda)), b.totals.youPayMinor, 'the vault paid exactly the batch');
  assert.equal((await rt.chain.getUsdcBalance(rt.feeAccountOwner)) - feeBefore, b.totals.feeMinor, 'the fee account got exactly the fees');
  const memos = new Set(rt.chain.events.filter((e) => e.kind === 'memo').map((e) => e.detail.memo));
  for (const c of done.chunks) assert.ok(memos.has(`splash:pay:v1:${b.id}.c${c.index}`), `chunk ${c.index} memo on chain`);
  await assert.rejects(batch.submitBatch(env.org.id, b.id, { signatures: await sign(env, prepared), who: 'Aisyah' }), (e) => e.code === 'not_prepared', 'the same signatures cannot send twice');
});

test('a chunk whose transfer is dropped fails alone; its retry rebuilds only the execute; nobody is paid twice', async () => {
  const env = await company();
  const rt = runtime();
  const b = await batch.createBatch(env.org.id, { rows: sample(), by: 'Aisyah' });
  const prepared = await batch.prepareBatch(env.org.id, b.id, { signer: env.device.publicKey, rehearsal: 'drop_chunk' });
  const after = await batch.submitBatch(env.org.id, b.id, { signatures: await sign(env, prepared), who: 'Aisyah' });
  assert.equal(after.state, 'partial');
  const failed = after.chunks.find((c) => c.state === 'failed');
  assert.equal(failed.index, 1);
  assert.equal(failed.problem.code, 'expired');
  for (const r of after.rows) {
    const inFailed = failed.rowIds.includes(r.id);
    assert.equal(r.status, inFailed ? 'not_sent' : 'paid');
    assert.equal(await rt.chain.getUsdcBalance(r.depositAddress), inFailed ? 0n : r.transferMinor);
  }
  await assert.rejects(batch.prepareBatch(env.org.id, b.id, { signer: env.device.publicKey, chunk: 0 }), (e) => e.code === 'wrong_state', 'a chunk that landed cannot be retried');
  const retry = await batch.prepareBatch(env.org.id, b.id, { signer: env.device.publicKey, chunk: 1 });
  assert.deepEqual(retry.messages.map((m) => m.step), ['execute'], 'the proposal is on chain: only the execute is rebuilt');
  const final = await batch.submitBatch(env.org.id, b.id, { signatures: await sign(env, retry), who: 'Aisyah' });
  assert.equal(final.state, 'done');
  for (const r of final.rows) {
    assert.equal(r.status, 'paid');
    assert.equal(await rt.chain.getUsdcBalance(r.depositAddress), r.transferMinor, `${r.supplierName} paid exactly once`);
  }
});

test('the rules run on the whole batch: too little in the vault blocks it before any device prompt', async () => {
  const env = await company({ fund: false });
  await runtime().chain.fundUsdc(env.vault.vaultPda, 1_500_000_000n); // US$1,500: enough for any one line, not all twelve
  const b = await batch.createBatch(env.org.id, { rows: sample(), by: 'Aisyah' });
  assert.equal(b.state, 'blocked');
  assert.equal(b.checks.find((c) => c.name === 'balance').passed, false);
  await assert.rejects(batch.prepareBatch(env.org.id, b.id, { signer: env.device.publicKey }), (e) => e.code === 'rejected_by_policy');
});

test('expired quotes refuse the prompt; a signature from another key sends nothing', async () => {
  const env = await company();
  const rt = runtime();
  const b = await batch.createBatch(env.org.id, { rows: sample().slice(0, 3), by: 'Aisyah' });
  await assert.rejects(batch.prepareBatch(env.org.id, b.id, { signer: env.device.publicKey }, new Date(Date.now() + 10 * 60_000)), (e) => e.code === 'quote_expired');

  const b2 = await batch.createBatch(env.org.id, { rows: sample().slice(0, 3), by: 'Aisyah' });
  const prepared = await batch.prepareBatch(env.org.id, b2.id, { signer: env.device.publicKey });
  const other = createMemoryDeviceKeyStore();
  await createDeviceKey(other, 'mallory');
  const forged = [];
  for (const m of prepared.messages) forged.push({ id: m.id, signature: bs58.encode(await signWithDeviceKey(other, 'mallory', new Uint8Array(Buffer.from(m.messageBase64, 'base64')))) });
  const transfers = rt.chain.events.filter((e) => e.kind === 'transfer').length;
  await assert.rejects(batch.submitBatch(env.org.id, b2.id, { signatures: forged, who: 'Mallory' }), (e) => e.code === 'signature_invalid');
  assert.equal(rt.chain.events.filter((e) => e.kind === 'transfer').length, transfers, 'nothing moved');
});
