// Prompt 07 §5.5: batch payouts, honest about Solana's limits. A 30-payee batch is chunked by measured
// size; every chunk serializes under 1,232 bytes; each chunk's fee is the sum of its payees' fees;
// all chunks run in one approval sequence; a failed chunk is retried alone.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

import { batchTotals, BatchPlanError, planBatchChunks } from '../lib/solana/batch.ts';
import { computeBudgetInstructions, DEFAULT_UNIT_LIMITS } from '../lib/solana/compute-budget.ts';
import { usdcMint } from '../lib/solana/config.ts';
import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { getAssociatedTokenAddress } from '../lib/solana/payout.ts';
import { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } from '../lib/solana/recovery-kit.ts';
import { buildSponsoredTransaction, buildVaultExecuteInstruction, buildVaultProposal, groupProposalTransactions, MAX_TRANSACTION_BYTES } from '../lib/solana/squads.ts';
import { computeSplashFee } from '../lib/route-engine/fees.ts';
import { resetRuntime, runtime, splashKeys } from '../lib/solana-app/runtime.ts';
import { resetStore } from '../lib/solana-app/store.ts';
import * as svc from '../lib/solana-app/service.ts';

const EXECUTE = Buffer.from(multisig.generated.vaultTransactionExecuteInstructionDiscriminator);
const BATCH = 'bat_00112233445566ff';

beforeEach(() => {
  delete process.env.SPLASH_SOLANA_MODE;
  process.env.SOLANA_PAYMENT_STORE = 'memory';
  resetStore();
  resetRuntime();
});

async function vault() {
  const org = svc.createOrg({ companyName: 'Batch Co' });
  const kit = deriveRecoveryKey(generateRecoveryWords());
  const keys = createMemoryDeviceKeyStore();
  const device = await createDeviceKey(keys, org.id);
  const proofs = [];
  for (const c of svc.issueChallenges(org.id, [{ role: 'device', publicKey: device.publicKey }, { role: 'kit', publicKey: kit.publicKey }])) {
    const signer = c.role === 'kit' ? kit : { sign: (m) => signWithDeviceKey(keys, org.id, m) };
    proofs.push({ role: c.role, publicKey: c.publicKey, nonce: c.nonce, signature: await signPossessionChallenge(signer, c) });
  }
  await svc.registerKeys(org.id, proofs);
  const v = await svc.createVault(org.id);
  await svc.fund(org.id);
  return { org, keys, device, v };
}

function payees(n) {
  return Array.from({ length: n }, (_, i) => {
    const amountMinor = BigInt(100 + i) * 1_000_000n + 123_456n; // US$100.12… upward, exact micro amounts
    return {
      id: `line-${i + 1}`,
      depositAddress: Keypair.generate().publicKey.toBase58(),
      amountMinor,
      splashFeeMinor: computeSplashFee({ policy: 'cheapest', ticketUsdcMinor: amountMinor, routeMinor: 0n, partnerMinor: 0n }).splashMinor,
    };
  });
}

async function plan(env, list) {
  const rt = runtime();
  return planBatchChunks({
    cluster: 'devnet',
    batchId: BATCH,
    multisigPda: new PublicKey(env.v.multisigPda),
    vaultPda: new PublicKey(env.v.vaultPda),
    member: new PublicKey(env.device.publicKey),
    feePayer: await rt.chain.getFeePayer(),
    feeAccountOwner: rt.feeAccountOwner,
    payees: list,
    splashKeys: await splashKeys(rt),
    firstTransactionIndex: await rt.chain.getNextTransactionIndex(new PublicKey(env.v.multisigPda)),
    sizingBlockhash: await rt.chain.getLatestBlockhash(),
  });
}

/** The approver's one prompt sequence: every chunk's proposal and execute, signed in order. */
async function chunkTransactions(env, chunk, blockhash) {
  const rt = runtime();
  const feePayer = await rt.chain.getFeePayer();
  const multisigPda = new PublicKey(env.v.multisigPda);
  const member = new PublicKey(env.device.publicKey);
  const proposal = buildVaultProposal({ multisigPda, transactionIndex: chunk.transactionIndex, member, feePayer, innerInstructions: chunk.vaultInstructions });
  const budget = computeBudgetInstructions({ unitLimit: DEFAULT_UNIT_LIMITS.proposal, microLamports: 1n });
  const groups = groupProposalTransactions(proposal, feePayer, blockhash, budget);
  const execute = await buildVaultExecuteInstruction({ multisigPda, transactionIndex: chunk.transactionIndex, member, innerInstructions: chunk.vaultInstructions });
  const txs = [
    ...groups.map((g) => buildSponsoredTransaction(feePayer, g, blockhash)),
    buildSponsoredTransaction(feePayer, [...computeBudgetInstructions({ unitLimit: DEFAULT_UNIT_LIMITS.execute + 40_000 * chunk.payees.length, microLamports: 1n }), ...chunk.preExecuteInstructions, execute], blockhash),
  ];
  for (const tx of txs) tx.addSignature(member, await signWithDeviceKey(env.keys, env.org.id, tx.message.serialize()));
  return txs;
}

test('a 30-payee batch: chunked by measured size, every chunk under the limit, fees per chunk exact', async () => {
  const env = await vault();
  const list = payees(30);
  const chunks = await plan(env, list);
  assert.ok(chunks.length > 1, `30 payees cannot fit one transaction; got ${chunks.length} chunk(s)`);
  for (const c of chunks) {
    assert.ok(c.payees.length >= 1);
    for (const size of [...c.sizes.proposal, c.sizes.execute]) assert.ok(size <= MAX_TRANSACTION_BYTES, `chunk ${c.index}: ${size} bytes`);
    assert.equal(c.feeMinor, c.payees.reduce((a, p) => a + p.splashFeeMinor, 0n), `chunk ${c.index}: its fee is its payees' fees`);
    assert.equal(c.memo, `splash:pay:v1:${BATCH}.c${c.index}`);
  }
  assert.deepEqual(chunks.flatMap((c) => c.payees.map((p) => p.id)), list.map((p) => p.id), 'every payee once, in order');
  const totals = batchTotals(chunks);
  assert.equal(totals.payees, 30);
  assert.equal(totals.payoutMinor, list.reduce((a, p) => a + p.amountMinor, 0n));
  assert.equal(totals.feeMinor, list.reduce((a, p) => a + p.splashFeeMinor, 0n));
  // Size-driven, not a fixed count: each full chunk is as large as it can be — one more payee does not fit.
  for (let i = 0; i < chunks.length - 1; i++) {
    const withNext = await plan(env, [...chunks[i].payees, chunks[i + 1].payees[0]]);
    assert.equal(withNext.length, 2, `chunk ${i} plus one more payee splits again`);
  }
  // Fewer payees per chunk when each line is heavier: zero-fee lines skip the fee legs and fit at least as many.
  const noFee = await plan(env, list.map((p) => ({ ...p, splashFeeMinor: 0n })));
  assert.ok(noFee[0].payees.length >= chunks[0].payees.length);
});

test('all chunks run in one approval sequence; payees and the fee account get exact integer amounts', async () => {
  const env = await vault();
  const sim = runtime().chain;
  const list = payees(30);
  const chunks = await plan(env, list);
  const mint = usdcMint('devnet');
  const before = await sim.getUsdcBalance(env.v.vaultPda);
  const blockhash = await sim.getLatestBlockhash();
  const signed = [];
  for (const chunk of chunks) signed.push(...(await chunkTransactions(env, chunk, blockhash)));
  for (const tx of signed) await sim.sendSponsored(tx, { orgId: env.org.id });
  for (const p of list) assert.equal(await sim.getUsdcBalance(p.depositAddress), p.amountMinor, `${p.id} received exactly its amount`);
  const totals = batchTotals(chunks);
  assert.equal(await sim.getUsdcBalance(runtime().feeAccountOwner), totals.feeMinor);
  assert.equal(before - (await sim.getUsdcBalance(env.v.vaultPda)), totals.payoutMinor + totals.feeMinor, 'vault debited exactly payouts + fees');
  void getAssociatedTokenAddress(mint, new PublicKey(list[0].depositAddress));
});

test('each chunk is all-or-none and the batch is not: a failed chunk is retried alone, nothing pays twice', async () => {
  const env = await vault();
  const sim = runtime().chain;
  const list = payees(30);
  const chunks = await plan(env, list);
  assert.ok(chunks.length >= 3);
  const failing = chunks[1];
  const blockhash = await sim.getLatestBlockhash();
  const all = [];
  for (const chunk of chunks) all.push({ chunk, txs: await chunkTransactions(env, chunk, blockhash) });
  const executeOf = (txs) => txs[txs.length - 1];
  const failingExecute = executeOf(all[1].txs);
  sim.dropIf = (tx) => tx === failingExecute; // that one execute never lands
  for (const { txs } of all) for (const tx of txs) await sim.sendSponsored(tx, { orgId: env.org.id });
  sim.dropIf = null;
  // The other chunks paid; the failed chunk's payees got nothing.
  for (const p of failing.payees) assert.equal(await sim.getUsdcBalance(p.depositAddress), 0n, `${p.id} not paid yet`);
  for (const c of chunks.filter((c) => c !== failing)) for (const p of c.payees) assert.equal(await sim.getUsdcBalance(p.depositAddress), p.amountMinor);
  // Retry the failed chunk only: its proposal is approved on chain; rebuild its execute with a fresh blockhash.
  sim.advanceBlocks(200);
  await assert.rejects(sim.sendSponsored(failingExecute, { orgId: env.org.id }), /blockhash not found or expired/, 'the old bytes are dead');
  const fresh = await sim.getLatestBlockhash();
  const retry = executeOf(await chunkTransactions(env, failing, fresh));
  assert.ok(Buffer.from(retry.message.compiledInstructions.at(-1).data.subarray(0, 8)).equals(EXECUTE));
  await sim.sendSponsored(retry, { orgId: env.org.id });
  for (const p of list) assert.equal(await sim.getUsdcBalance(p.depositAddress), p.amountMinor, `${p.id} paid exactly once`);
  assert.equal(await sim.getUsdcBalance(runtime().feeAccountOwner), batchTotals(chunks).feeMinor);
  void VersionedTransaction;
});

test('the planner refuses what cannot be paid: a Splash key, a repeated deposit, a bad batch id', async () => {
  const env = await vault();
  const list = payees(3);
  const rt = runtime();
  await assert.rejects(plan(env, [...list, { ...list[0], id: 'dup' }]), BatchPlanError);
  await assert.rejects(plan(env, [{ ...list[0], depositAddress: rt.feeAccountOwner.toBase58() }]), /Splash/);
  await assert.rejects(plan(env, [{ ...list[0], amountMinor: 0n }]), /positive/);
  await assert.rejects(planBatchChunks({ cluster: 'devnet', batchId: 'INV-0412', payees: list }), /batch id/);
  await assert.rejects(plan(env, []), /at least one payee/);
});
