// Offline simulator: the whole flow end to end, plus explicit invariant checks I-1..I-5 and I-7.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

import { PROGRAM_IDS, SOLANA_CONFIG } from '../lib/solana/config.ts';
import { createDeviceKey, createMemoryDeviceKeyStore, deviceKeySigner, signTransactionWith } from '../lib/solana/device-key.ts';
import { createMemoryNonceStore, createPossessionChallenge, deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge, verifyPossession } from '../lib/solana/recovery-kit.ts';
import { buildPayoutInstructions, buildTransferCheckedInstruction, getAssociatedTokenAddress } from '../lib/solana/payout.ts';
import * as multisig from '@sqds/multisig';
import { buildDepositForBurnInstruction } from '../lib/solana/cctp-v2-solana.ts';
import {
  buildCreateVaultInstruction,
  buildProposalApprove,
  buildSponsoredTransaction,
  buildVaultExecuteInstruction,
  buildVaultProposal,
  deriveProposalAddresses,
  groupProposalTransactions,
} from '../lib/solana/squads.ts';
import { DevnetChain, SIMULATED_FEE_PAYER, SolanaSimulator, chain, resetChain, simulatedSignature } from '../lib/solana/simulator.ts';

const MINT = new PublicKey(SOLANA_CONFIG.devnet.usdcMint);
const commit = (s) => createHash('sha256').update(`salt|${s}`).digest('hex');
const MEMO_RE = /^splash:v1:[0-9a-f]{64}$/;

/** Onboard a solo org in the simulator: device key + kit, autonomous vault. */
async function onboard(sim, orgId = 'org_demo') {
  const store = createMemoryDeviceKeyStore();
  const device = await createDeviceKey(store, orgId);
  const signer = await deviceKeySigner(store, orgId);
  const kit = deriveRecoveryKey(generateRecoveryWords());
  const feePayer = await sim.getFeePayer();
  const createKey = Keypair.generate();
  const plan = buildCreateVaultInstruction({
    mode: 'solo',
    members: [{ role: 'admin_device', publicKey: device.publicKey }, { role: 'recovery_kit_a', publicKey: kit.publicKey }],
    createKey: createKey.publicKey,
    feePayer,
    treasury: await sim.getSquadsTreasury(),
  });
  const tx = buildSponsoredTransaction(feePayer, [plan.instruction], await sim.getLatestBlockhash());
  tx.sign([createKey]);
  const receipt = await sim.sendSponsored(tx, { orgId });
  return { store, signer, kit, feePayer, plan, receipt, orgId };
}

async function propose(sim, org, inner, ephemeralSigners = 0, signers = [org.signer]) {
  const index = await sim.getNextTransactionIndex(org.plan.multisigPda);
  const p = buildVaultProposal({ multisigPda: org.plan.multisigPda, transactionIndex: index, member: signers[0].publicKey, feePayer: org.feePayer, innerInstructions: inner, ephemeralSigners });
  const receipts = [];
  for (const group of groupProposalTransactions(p, org.feePayer, await sim.getLatestBlockhash())) {
    const tx = buildSponsoredTransaction(org.feePayer, group, await sim.getLatestBlockhash());
    await signTransactionWith(signers[0], tx);
    receipts.push(await sim.sendSponsored(tx, { orgId: org.orgId }));
  }
  return { index, receipts };
}

async function execute(sim, org, index, inner, { pre = [], post = [], ephemeralSigners = 0, signer = org.signer } = {}) {
  const ex = await buildVaultExecuteInstruction({ multisigPda: org.plan.multisigPda, transactionIndex: index, member: signer.publicKey, innerInstructions: inner, ephemeralSigners });
  const tx = buildSponsoredTransaction(org.feePayer, [...pre, ex, ...post], await sim.getLatestBlockhash());
  await signTransactionWith(signer, tx);
  return sim.sendSponsored(tx, { orgId: org.orgId });
}

test('offline flow: onboard, prove kit possession, fund, pay partner on Solana, burn to Polygon', async () => {
  const sim = new SolanaSimulator('devnet');
  const org = await onboard(sim);
  assert.equal(org.receipt.simulated, true);

  // Proof of possession of the kit (server nonce).
  const nonces = createMemoryNonceStore();
  const ch = createPossessionChallenge(org.orgId, org.kit.publicKey);
  assert.deepEqual(await verifyPossession(ch, org.kit.publicKey, await signPossessionChallenge(org.kit, ch), nonces), { ok: true });

  // Fund.
  const fund = await sim.fundUsdc(org.plan.vaultPda, 10_000_000n);
  assert.equal(fund.simulated, true);
  assert.equal(await sim.getUsdcBalance(org.plan.vaultPda), 10_000_000n);

  // Pay the partner's Solana deposit address.
  const partner = Keypair.generate().publicKey.toBase58();
  const pay = buildPayoutInstructions({ cluster: 'devnet', vaultPda: org.plan.vaultPda, feePayer: org.feePayer, destination: partner, expectedDepositAddress: partner, amountMinor: 3_500_000n, commitmentHex: commit('INV-1'), reference: Keypair.generate().publicKey, splashKeys: [org.feePayer.toBase58()] });
  const { index } = await propose(sim, org, pay.vaultInstructions);
  const paid = await execute(sim, org, index, pay.vaultInstructions, { pre: pay.preExecuteInstructions, post: pay.postExecuteInstructions });
  assert.equal(paid.simulated, true);
  assert.equal(bs58.decode(paid.signature).length, 64);
  assert.equal(await sim.getUsdcBalance(org.plan.vaultPda), 6_500_000n);
  assert.equal(await sim.getUsdcBalance(partner), 3_500_000n);

  // Burn to Polygon via CCTP V2 (ephemeral event account).
  const evm = `0x${'ab'.repeat(20)}`;
  const nextIndex = await sim.getNextTransactionIndex(org.plan.multisigPda);
  const { transactionPda } = deriveProposalAddresses(org.plan.multisigPda, nextIndex, 1);
  const burn = buildDepositForBurnInstruction({ cluster: 'devnet', vaultPda: org.plan.vaultPda, transactionPda, amountMinor: 2_000_000n, mintRecipientEvm: evm, expectedMintRecipientEvm: evm, speed: 'standard', feePayer: org.feePayer });
  const inner = [burn.instruction, ...buildPayoutInstructions({ cluster: 'devnet', vaultPda: org.plan.vaultPda, feePayer: org.feePayer, destination: partner, expectedDepositAddress: partner, amountMinor: 1n, commitmentHex: commit('INV-2'), reference: Keypair.generate().publicKey, splashKeys: [] }).postExecuteInstructions];
  const prop = await propose(sim, org, inner, 1);
  assert.equal(prop.index, nextIndex);
  await execute(sim, org, nextIndex, inner, { ephemeralSigners: 1 });
  assert.equal(await sim.getUsdcBalance(org.plan.vaultPda), 4_500_000n);
  assert.equal(sim.burns.length, 1);
  assert.deepEqual({ ...sim.burns[0], signature: undefined }, { signature: undefined, amountMinor: 2_000_000n, destinationDomain: 7, mintRecipientEvm: evm, maxFeeMinor: 0n, minFinalityThreshold: 2000 });
  org.kit.destroy();
});

test('I-1: no Splash key on the vault; configAuthority null; simulator refuses non-autonomous', async () => {
  const sim = new SolanaSimulator('devnet');
  const org = await onboard(sim);
  const ms = await sim.getMultisig(org.plan.multisigPda);
  assert.equal(ms.configAuthority, null);
  assert.deepEqual(ms.members.map((m) => m.publicKey).sort(), [org.signer.publicKey.toBase58(), org.kit.publicKey].sort());
  assert.ok(!ms.members.some((m) => m.publicKey === SIMULATED_FEE_PAYER.toBase58()));
  assert.equal(org.plan.vault.configAuthority, null);
  // Building a vault with the fee payer as a member is refused before anything is sent.
  assert.throws(
    () => buildCreateVaultInstruction({ mode: 'solo', members: [{ role: 'admin_device', publicKey: org.signer.publicKey.toBase58() }, { role: 'recovery_kit_a', publicKey: SIMULATED_FEE_PAYER.toBase58() }], createKey: Keypair.generate().publicKey, feePayer: SIMULATED_FEE_PAYER, treasury: PublicKey.default }),
    /deny list/,
  );
  // A non-autonomous multisig (config authority set) is refused by the sponsor check before execution.
  const ck = Keypair.generate();
  const rogue = multisig.instructions.multisigCreateV2({
    treasury: await sim.getSquadsTreasury(), creator: org.feePayer, multisigPda: multisig.getMultisigPda({ createKey: ck.publicKey })[0],
    configAuthority: Keypair.generate().publicKey, threshold: 1, members: [{ key: org.signer.publicKey, permissions: multisig.types.Permissions.all() }],
    timeLock: 0, createKey: ck.publicKey, rentCollector: null,
  });
  const rtx = buildSponsoredTransaction(org.feePayer, [rogue], await sim.getLatestBlockhash());
  rtx.sign([ck]);
  await assert.rejects(sim.sendSponsored(rtx), /autonomous/);
});

test('I-2: only the vault and the partner deposit account ever hold USDC; never a Splash account', async () => {
  const sim = new SolanaSimulator('devnet');
  const org = await onboard(sim);
  await sim.fundUsdc(org.plan.vaultPda, 5_000_000n);
  const partner = Keypair.generate().publicKey.toBase58();
  const pay = buildPayoutInstructions({ cluster: 'devnet', vaultPda: org.plan.vaultPda, feePayer: org.feePayer, destination: partner, expectedDepositAddress: partner, amountMinor: 5_000_000n, commitmentHex: commit('INV-9'), reference: Keypair.generate().publicKey, splashKeys: [org.feePayer.toBase58()] });
  const { index } = await propose(sim, org, pay.vaultInstructions);
  await execute(sim, org, index, pay.vaultInstructions, { pre: pay.preExecuteInstructions, post: pay.postExecuteInstructions });
  const transfers = sim.events.filter((e) => e.kind === 'transfer');
  assert.equal(transfers.length, 1);
  assert.equal(transfers[0].detail.to, getAssociatedTokenAddress(MINT, new PublicKey(partner)).toBase58());
  assert.equal(await sim.getUsdcBalance(SIMULATED_FEE_PAYER), 0n);
  // A payout to a Splash address cannot even be built.
  assert.throws(() => buildPayoutInstructions({ ...pay, cluster: 'devnet', vaultPda: org.plan.vaultPda, feePayer: org.feePayer, destination: SIMULATED_FEE_PAYER.toBase58(), expectedDepositAddress: SIMULATED_FEE_PAYER.toBase58(), amountMinor: 1n, commitmentHex: commit('x'), reference: Keypair.generate().publicKey, splashKeys: [] }), /I-2/);
});

test('I-3: the simulator (as Kora) refuses SOL or USDC leaving the fee payer, and unknown programs', async () => {
  const sim = new SolanaSimulator('devnet');
  const fp = await sim.getFeePayer();
  const sol = buildSponsoredTransaction(fp, [SystemProgram.transfer({ fromPubkey: fp, toPubkey: Keypair.generate().publicKey, lamports: 1 })], await sim.getLatestBlockhash());
  await assert.rejects(sim.sendSponsored(sol), /Sponsorship refused/);
  const usdc = buildSponsoredTransaction(fp, [buildTransferCheckedInstruction({ source: getAssociatedTokenAddress(MINT, fp), mint: MINT, destination: getAssociatedTokenAddress(MINT, Keypair.generate().publicKey), owner: fp, amount: 1n, decimals: 6 })], await sim.getLatestBlockhash());
  await assert.rejects(sim.sendSponsored(usdc), /SPL Token/);
  const unknown = buildSponsoredTransaction(fp, [new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(0) })], await sim.getLatestBlockhash());
  await assert.rejects(sim.sendSponsored(unknown), /not allowlisted/);
});

test('I-4: no execute without a person approving; signatures are checked; dual needs two approvals', async () => {
  const sim = new SolanaSimulator('devnet');
  const org = await onboard(sim);
  await sim.fundUsdc(org.plan.vaultPda, 2_000_000n);
  const partner = Keypair.generate().publicKey.toBase58();
  const pay = buildPayoutInstructions({ cluster: 'devnet', vaultPda: org.plan.vaultPda, feePayer: org.feePayer, destination: partner, expectedDepositAddress: partner, amountMinor: 1_000_000n, commitmentHex: commit('INV-4'), reference: Keypair.generate().publicKey, splashKeys: [] });
  // Create + proposalCreate WITHOUT approve.
  const index = await sim.getNextTransactionIndex(org.plan.multisigPda);
  const p = buildVaultProposal({ multisigPda: org.plan.multisigPda, transactionIndex: index, member: org.signer.publicKey, feePayer: org.feePayer, innerInstructions: pay.vaultInstructions });
  let tx = buildSponsoredTransaction(org.feePayer, [p.create, p.proposalCreate], await sim.getLatestBlockhash());
  await signTransactionWith(org.signer, tx);
  await sim.sendSponsored(tx);
  await assert.rejects(execute(sim, org, index, pay.vaultInstructions, { pre: pay.preExecuteInstructions }), /not approved/);
  assert.equal(await sim.getUsdcBalance(org.plan.vaultPda), 2_000_000n, 'failed tx changed nothing');

  // Unsigned approve is refused.
  tx = buildSponsoredTransaction(org.feePayer, [buildProposalApprove(org.plan.multisigPda, index, org.signer.publicKey)], await sim.getLatestBlockhash());
  await assert.rejects(sim.sendSponsored(tx), /missing signature/);
  // A stranger cannot approve or execute.
  const strangerStore = createMemoryDeviceKeyStore();
  await createDeviceKey(strangerStore, 'x');
  const stranger = await deviceKeySigner(strangerStore, 'x');
  tx = buildSponsoredTransaction(org.feePayer, [buildProposalApprove(org.plan.multisigPda, index, stranger.publicKey)], await sim.getLatestBlockhash());
  await signTransactionWith(stranger, tx);
  await assert.rejects(sim.sendSponsored(tx), /signing member/);
  // A forged signature is refused.
  tx = buildSponsoredTransaction(org.feePayer, [buildProposalApprove(org.plan.multisigPda, index, org.signer.publicKey)], await sim.getLatestBlockhash());
  tx.addSignature(org.signer.publicKey, new Uint8Array(64).fill(7));
  await assert.rejects(sim.sendSponsored(tx), /bad signature/);
  // The person approves; now execute works.
  tx = buildSponsoredTransaction(org.feePayer, [buildProposalApprove(org.plan.multisigPda, index, org.signer.publicKey)], await sim.getLatestBlockhash());
  await signTransactionWith(org.signer, tx);
  await sim.sendSponsored(tx);
  await execute(sim, org, index, pay.vaultInstructions, { pre: pay.preExecuteInstructions });
  assert.equal(await sim.getUsdcBalance(partner), 1_000_000n);
  await assert.rejects(execute(sim, org, index, pay.vaultInstructions), /not approved|executed/, 'no double execute');

  // Dual mode: one approval is not enough.
  const devices = [];
  for (const id of ['admin', 'approver']) {
    const st = createMemoryDeviceKeyStore();
    await createDeviceKey(st, id);
    devices.push(await deviceKeySigner(st, id));
  }
  const createKey = Keypair.generate();
  const dual = buildCreateVaultInstruction({
    mode: 'dual',
    members: [
      { role: 'admin_device', publicKey: devices[0].publicKey.toBase58() },
      { role: 'approver_device', publicKey: devices[1].publicKey.toBase58() },
      { role: 'recovery_kit_a', publicKey: Keypair.generate().publicKey.toBase58() },
      { role: 'recovery_kit_b', publicKey: Keypair.generate().publicKey.toBase58() },
    ],
    createKey: createKey.publicKey,
    feePayer: org.feePayer,
    treasury: await sim.getSquadsTreasury(),
  });
  tx = buildSponsoredTransaction(org.feePayer, [dual.instruction], await sim.getLatestBlockhash());
  tx.sign([createKey]);
  await sim.sendSponsored(tx);
  await sim.fundUsdc(dual.vaultPda, 1_000_000n);
  const dorg = { ...org, plan: dual, signer: devices[0] };
  const dpay = buildPayoutInstructions({ cluster: 'devnet', vaultPda: dual.vaultPda, feePayer: org.feePayer, destination: partner, expectedDepositAddress: partner, amountMinor: 1_000_000n, commitmentHex: commit('INV-D'), reference: Keypair.generate().publicKey, splashKeys: [] });
  const { index: di } = await propose(sim, dorg, dpay.vaultInstructions);
  await assert.rejects(execute(sim, dorg, di, dpay.vaultInstructions, { pre: dpay.preExecuteInstructions }), /not approved/);
  tx = buildSponsoredTransaction(org.feePayer, [buildProposalApprove(dual.multisigPda, di, devices[1].publicKey)], await sim.getLatestBlockhash());
  await signTransactionWith(devices[1], tx);
  await sim.sendSponsored(tx);
  await execute(sim, dorg, di, dpay.vaultInstructions, { pre: dpay.preExecuteInstructions });
  assert.equal(await sim.getUsdcBalance(dual.vaultPda), 0n);
});

test('I-5: every memo on the ledger is a salted commitment; a plain memo is refused', async () => {
  const sim = new SolanaSimulator('devnet');
  const org = await onboard(sim);
  await sim.fundUsdc(org.plan.vaultPda, 1_000_000n);
  const partner = Keypair.generate().publicKey.toBase58();
  const pay = buildPayoutInstructions({ cluster: 'devnet', vaultPda: org.plan.vaultPda, feePayer: org.feePayer, destination: partner, expectedDepositAddress: partner, amountMinor: 1_000_000n, commitmentHex: commit('INV-5'), reference: Keypair.generate().publicKey, splashKeys: [] });
  const { index } = await propose(sim, org, pay.vaultInstructions);
  await execute(sim, org, index, pay.vaultInstructions, { pre: pay.preExecuteInstructions, post: pay.postExecuteInstructions });
  const memos = sim.events.filter((e) => e.kind === 'memo').map((e) => e.detail.memo);
  assert.equal(memos.length, 2, 'inner (approved) memo + top-level indexing copy');
  for (const m of memos) {
    assert.match(m, MEMO_RE);
    assert.doesNotMatch(m, /INV|Acme/i);
  }
  const raw = new TransactionInstruction({ programId: PROGRAM_IDS.memo, keys: [], data: Buffer.from('Invoice INV-5 for Acme') });
  await assert.rejects(sim.sendSponsored(buildSponsoredTransaction(org.feePayer, [raw], await sim.getLatestBlockhash())), /I-5/);
});

test('I-7: receipts are simulated: true with deterministic 64-byte signatures', async () => {
  const sim = new SolanaSimulator('devnet');
  const fp = await sim.getFeePayer();
  const memo = new TransactionInstruction({ programId: PROGRAM_IDS.memo, keys: [], data: Buffer.from(`splash:v1:${commit('a')}`) });
  const tx = buildSponsoredTransaction(fp, [memo], PublicKey.default.toBase58());
  const r1 = await sim.sendSponsored(tx);
  const r2 = await sim.sendSponsored(tx);
  assert.equal(r1.simulated, true);
  assert.equal(r1.cluster, 'devnet');
  assert.equal(r1.signature, r2.signature, 'deterministic');
  assert.equal(r1.signature, simulatedSignature(tx.serialize()));
  assert.equal(bs58.decode(r1.signature).length, 64);
});

test('chain() factory: offline -> shared simulator; devnet -> DevnetChain (no network at construction)', async () => {
  resetChain();
  const a = chain({});
  const b = chain({ SPLASH_SOLANA_MODE: 'offline' });
  assert.ok(a instanceof SolanaSimulator);
  assert.equal(a, b, 'one shared ledger');
  const d = chain({ SPLASH_SOLANA_MODE: 'devnet', SOLANA_RPC_URL: 'http://127.0.0.1:1' });
  assert.ok(d instanceof DevnetChain);
  assert.equal(d.mode, 'devnet');
  await assert.rejects(d.getFeePayer(), /KORA_RPC_URL/);
  resetChain();
});
