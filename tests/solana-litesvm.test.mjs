// Prompt 07 §5.7: the money path against the REAL Squads V4 program in LiteSVM — no RPC.
//
//   vault (autonomous) → proposal whose vault transaction holds the payout, the Splash fee leg and
//   the memo, with compute budget and the ATA creates at the top level → approve (threshold 1 and 2)
//   → execute → the payee and fee accounts change by the exact integer amounts.
//
// Needs two things this repo cannot ship by itself:
//   1. litesvm's native binding (published for macOS and Linux; there is no Windows build), and
//   2. tests/fixtures/programs/squads_v4.so + squads_program_config.json, dumped once from devnet by
//      Sky or Sebastian with scripts/dump-programs.ts.
// When either is missing the suite SKIPS and says why, loudly. It never passes silently.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

import { computeBudgetInstructions, DEFAULT_UNIT_LIMITS } from '../lib/solana/compute-budget.ts';
import { PROGRAM_IDS, usdcMint } from '../lib/solana/config.ts';
import { buildPayoutInstructions, getAssociatedTokenAddress } from '../lib/solana/payout.ts';
import { assertAutonomous, buildCreateVaultInstruction, buildVaultExecuteInstruction, buildVaultProposal, groupProposalTransactions } from '../lib/solana/squads.ts';

const SO = new URL('./fixtures/programs/squads_v4.so', import.meta.url);
const CONFIG = new URL('./fixtures/programs/squads_program_config.json', import.meta.url);

let litesvm = null;
let skipReason = null;
try {
  litesvm = await import('litesvm');
  // The JS wrapper loads lazily; constructing proves the native binding is there.
  new litesvm.LiteSVM();
} catch (e) {
  skipReason = `litesvm's native binding is not available on ${process.platform}/${process.arch} (${String(e?.message ?? e).split('\n')[0]}). It is published for macOS and Linux only.`;
}
if (!skipReason && (!existsSync(SO) || !existsSync(CONFIG))) {
  skipReason = 'tests/fixtures/programs/squads_v4.so (and squads_program_config.json) are missing. Run scripts/dump-programs.ts once with devnet RPC (Sky or Sebastian) and commit the output.';
}
if (skipReason) {
  console.warn(`\n⚠⚠⚠ LiteSVM SUITE SKIPPED — ${skipReason}\n⚠⚠⚠ The Squads path below is NOT verified on this machine.\n`);
}

const USDC = usdcMint('devnet');
const TOKEN = PROGRAM_IDS.token;

/** SPL Mint, 82 bytes: authority, supply, decimals 6, initialized, no freeze authority. */
function mintData(authority, supply) {
  const b = Buffer.alloc(82);
  b.writeUInt32LE(1, 0);
  authority.toBuffer().copy(b, 4);
  b.writeBigUInt64LE(supply, 36);
  b.writeUInt8(6, 44);
  b.writeUInt8(1, 45);
  return b;
}

/** SPL token account, 165 bytes: mint, owner, amount, initialized. */
function tokenAccountData(mint, owner, amount) {
  const b = Buffer.alloc(165);
  mint.toBuffer().copy(b, 0);
  owner.toBuffer().copy(b, 32);
  b.writeBigUInt64LE(amount, 64);
  b.writeUInt8(1, 108);
  return b;
}

const amountOf = (data) => Buffer.from(data).readBigUInt64LE(64);

function harness() {
  const { LiteSVM, FailedTransactionMetadata } = litesvm;
  const svm = new LiteSVM();
  const kit = globalThis.__kit;
  svm.addProgramFromFile(kit.address(PROGRAM_IDS.squadsV4.toBase58()), fileURLToPath(SO));
  const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
  const cfgData = Buffer.from(cfg.dataBase64, 'base64');
  svm.setAccount({ address: kit.address(cfg.address), data: cfgData, executable: false, lamports: kit.lamports(BigInt(cfg.lamports)), programAddress: kit.address(cfg.owner), space: BigInt(cfgData.length) });
  const [programConfig] = multisig.accounts.ProgramConfig.fromAccountInfo({ data: cfgData, executable: false, lamports: cfg.lamports, owner: new PublicKey(cfg.owner) });

  const feePayer = Keypair.generate(); // stands in for Kora
  svm.airdrop(kit.address(feePayer.publicKey.toBase58()), kit.lamports(10_000_000_000n));

  const put = (pubkey, data, owner) => svm.setAccount({ address: kit.address(pubkey.toBase58()), data, executable: false, lamports: svm.minimumBalanceForRentExemption(BigInt(data.length)), programAddress: kit.address(owner.toBase58()), space: BigInt(data.length) });
  const read = (pubkey) => svm.getAccount(kit.address(pubkey.toBase58()));

  function send(instructions, signers) {
    const message = new TransactionMessage({ payerKey: feePayer.publicKey, recentBlockhash: svm.latestBlockhash(), instructions }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([feePayer, ...signers]);
    const result = svm.sendTransaction(kit.getTransactionDecoder().decode(tx.serialize()));
    svm.expireBlockhash();
    if (result instanceof FailedTransactionMetadata) throw new Error(`transaction failed: ${result.toString()}\n${result.meta().logs().join('\n')}`);
    return result;
  }

  return { svm, feePayer, programConfig, put, read, send };
}

async function vaultWith(h, mode, members) {
  const createKey = Keypair.generate();
  const plan = buildCreateVaultInstruction({ mode, members, createKey: createKey.publicKey, feePayer: h.feePayer.publicKey, treasury: h.programConfig.treasury, splashKeys: [] });
  h.send([plan.instruction], [createKey]);
  const account = h.read(plan.multisigPda);
  assert.ok(account.exists, 'the multisig account exists');
  assertAutonomous(account.data, { splashKeys: [h.feePayer.publicKey.toBase58()], expectedMembers: members.map((m) => m.publicKey), expectedThreshold: mode === 'solo' ? 1 : 2 });
  // Fund the vault's USDC account directly (the mint and the account, as the token program lays them out).
  const funding = 1_000_000_000n; // US$1,000
  h.put(USDC, mintData(Keypair.generate().publicKey, funding), TOKEN);
  h.put(getAssociatedTokenAddress(USDC, plan.vaultPda), tokenAccountData(USDC, plan.vaultPda, funding), TOKEN);
  return { plan, funding };
}

function payout(h, plan) {
  const deposit = Keypair.generate().publicKey;
  const feeOwner = Keypair.generate().publicKey;
  const pay = buildPayoutInstructions({
    cluster: 'devnet',
    vaultPda: plan.vaultPda,
    feePayer: h.feePayer.publicKey,
    destination: deposit.toBase58(),
    expectedDepositAddress: deposit.toBase58(),
    amountMinor: 250_000_000n,
    paymentId: 'pay_0123456789abcdef',
    reference: Keypair.generate().publicKey,
    splashKeys: [h.feePayer.publicKey.toBase58()],
    splashFee: { feeAccountOwner: feeOwner.toBase58(), amountMinor: 2_000_000n },
  });
  return { pay, deposit, feeOwner };
}

const budget = (limit) => computeBudgetInstructions({ unitLimit: limit, microLamports: 1n });

test('LiteSVM: threshold 1 — propose, approve, execute; exact amounts move', { skip: skipReason ?? false }, async () => {
  globalThis.__kit = await import('@solana/kit');
  const h = harness();
  const device = Keypair.generate();
  const kitKey = Keypair.generate();
  const { plan, funding } = await vaultWith(h, 'solo', [{ role: 'admin_device', publicKey: device.publicKey.toBase58() }, { role: 'recovery_kit_a', publicKey: kitKey.publicKey.toBase58() }]);
  const { pay, deposit, feeOwner } = payout(h, plan);
  const proposal = buildVaultProposal({ multisigPda: plan.multisigPda, transactionIndex: 1n, member: device.publicKey, feePayer: h.feePayer.publicKey, innerInstructions: pay.vaultInstructions });
  for (const group of groupProposalTransactions(proposal, h.feePayer.publicKey, '11111111111111111111111111111111', budget(DEFAULT_UNIT_LIMITS.proposal))) h.send(group, [device]);
  const execute = await buildVaultExecuteInstruction({ multisigPda: plan.multisigPda, transactionIndex: 1n, member: device.publicKey, innerInstructions: pay.vaultInstructions });
  h.send([...budget(DEFAULT_UNIT_LIMITS.execute), ...pay.preExecuteInstructions, execute, ...pay.postExecuteInstructions], [device]);
  assert.equal(amountOf(h.read(getAssociatedTokenAddress(USDC, deposit)).data), 250_000_000n, 'the payee deposit received exactly the payout');
  assert.equal(amountOf(h.read(getAssociatedTokenAddress(USDC, feeOwner)).data), 2_000_000n, 'the fee account received exactly the fee');
  assert.equal(amountOf(h.read(getAssociatedTokenAddress(USDC, plan.vaultPda)).data), funding - 252_000_000n, 'the vault paid exactly both');
});

test('LiteSVM: threshold 2 — one approval cannot execute; the second can', { skip: skipReason ?? false }, async () => {
  globalThis.__kit = await import('@solana/kit');
  const h = harness();
  const [d1, d2, k1, k2] = [Keypair.generate(), Keypair.generate(), Keypair.generate(), Keypair.generate()];
  const { plan } = await vaultWith(h, 'dual', [
    { role: 'admin_device', publicKey: d1.publicKey.toBase58() },
    { role: 'approver_device', publicKey: d2.publicKey.toBase58() },
    { role: 'recovery_kit_a', publicKey: k1.publicKey.toBase58() },
    { role: 'recovery_kit_b', publicKey: k2.publicKey.toBase58() },
  ]);
  const { pay, deposit } = payout(h, plan);
  const proposal = buildVaultProposal({ multisigPda: plan.multisigPda, transactionIndex: 1n, member: d1.publicKey, feePayer: h.feePayer.publicKey, innerInstructions: pay.vaultInstructions });
  for (const group of groupProposalTransactions(proposal, h.feePayer.publicKey, '11111111111111111111111111111111', budget(DEFAULT_UNIT_LIMITS.proposal))) h.send(group, [d1]);
  const executeBy = async (member) => buildVaultExecuteInstruction({ multisigPda: plan.multisigPda, transactionIndex: 1n, member: member.publicKey, innerInstructions: pay.vaultInstructions });
  await assert.rejects(async () => h.send([...budget(DEFAULT_UNIT_LIMITS.execute), ...pay.preExecuteInstructions, await executeBy(d1)], [d1]), /failed/, 'one approval of two cannot execute');
  h.send([...budget(DEFAULT_UNIT_LIMITS.proposal), multisig.instructions.proposalApprove({ multisigPda: plan.multisigPda, transactionIndex: 1n, member: d2.publicKey })], [d2]);
  h.send([...budget(DEFAULT_UNIT_LIMITS.execute), ...pay.preExecuteInstructions, await executeBy(d2), ...pay.postExecuteInstructions], [d2]);
  assert.equal(amountOf(h.read(getAssociatedTokenAddress(USDC, deposit)).data), 250_000_000n);
});
