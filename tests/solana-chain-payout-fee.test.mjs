// Splash fee leg: split inside the same vault transaction as the payout; I-2 still holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';

import { SOLANA_CONFIG } from '../lib/solana/config.ts';
import { createDeviceKey, createMemoryDeviceKeyStore, deviceKeySigner, signTransactionWith } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords } from '../lib/solana/recovery-kit.ts';
import { buildPayoutInstructions, buildSplashFeeInstructions, decodeTransferChecked, getAssociatedTokenAddress } from '../lib/solana/payout.ts';
import { buildCreateVaultInstruction, buildSponsoredTransaction, buildVaultExecuteInstruction, buildVaultProposal, groupProposalTransactions } from '../lib/solana/squads.ts';
import { SIMULATED_FEE_PAYER, SolanaSimulator } from '../lib/solana/simulator.ts';
import { PROGRAM_IDS } from '../lib/solana/config.ts';

const MINT = new PublicKey(SOLANA_CONFIG.devnet.usdcMint);
const commit = (s) => createHash('sha256').update(`salt|${s}`).digest('hex');

async function onboard(sim) {
  const store = createMemoryDeviceKeyStore();
  const device = await createDeviceKey(store, 'org');
  const signer = await deviceKeySigner(store, 'org');
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
  await sim.sendSponsored(tx, { orgId: 'org' });
  kit.destroy();
  return { signer, feePayer, plan };
}

test('fee leg: payout to the partner and the Splash fee are split inside the same vault transaction', async () => {
  const sim = new SolanaSimulator('devnet');
  const org = await onboard(sim);
  await sim.fundUsdc(org.plan.vaultPda, 10_000_000n);
  const partner = Keypair.generate().publicKey.toBase58();
  const feeOwner = Keypair.generate().publicKey.toBase58();
  const pay = buildPayoutInstructions({
    cluster: 'devnet', vaultPda: org.plan.vaultPda, feePayer: org.feePayer, destination: partner, expectedDepositAddress: partner,
    amountMinor: 4_000_000n, commitmentHex: commit('INV-F'), reference: Keypair.generate().publicKey, splashKeys: [org.feePayer.toBase58()],
    splashFee: { feeAccountOwner: feeOwner, amountMinor: 10_000n },
  });
  // Shape: [payout transfer, fee transfer, memo] inside the vault; payout leg first and to the partner ATA.
  assert.equal(pay.vaultInstructions.length, 3);
  const [payoutIx, feeIx] = pay.vaultInstructions;
  assert.ok(payoutIx.keys[2].pubkey.equals(getAssociatedTokenAddress(MINT, new PublicKey(partner))));
  assert.equal(decodeTransferChecked(payoutIx.data).amount, 4_000_000n);
  assert.ok(feeIx.keys[2].pubkey.equals(getAssociatedTokenAddress(MINT, new PublicKey(feeOwner))));
  assert.equal(decodeTransferChecked(feeIx.data).amount, 10_000n);
  assert.ok(pay.vaultInstructions[2].programId.equals(PROGRAM_IDS.memo));
  assert.equal(pay.preExecuteInstructions.length, 2, 'ATA create for the partner and the fee account');

  const index = await sim.getNextTransactionIndex(org.plan.multisigPda);
  const p = buildVaultProposal({ multisigPda: org.plan.multisigPda, transactionIndex: index, member: org.signer.publicKey, feePayer: org.feePayer, innerInstructions: pay.vaultInstructions });
  for (const group of groupProposalTransactions(p, org.feePayer, await sim.getLatestBlockhash())) {
    const tx = buildSponsoredTransaction(org.feePayer, group, await sim.getLatestBlockhash());
    await signTransactionWith(org.signer, tx);
    await sim.sendSponsored(tx, { orgId: 'org' });
  }
  const ex = await buildVaultExecuteInstruction({ multisigPda: org.plan.multisigPda, transactionIndex: index, member: org.signer.publicKey, innerInstructions: pay.vaultInstructions });
  const tx = buildSponsoredTransaction(org.feePayer, [...pay.preExecuteInstructions, ex, ...pay.postExecuteInstructions], await sim.getLatestBlockhash());
  await signTransactionWith(org.signer, tx);
  const receipt = await sim.sendSponsored(tx, { orgId: 'org' });

  const transfers = sim.events.filter((e) => e.kind === 'transfer');
  assert.equal(transfers.length, 2);
  assert.ok(transfers.every((t) => t.signature === receipt.signature), 'both legs in one transaction');
  assert.equal(await sim.getUsdcBalance(partner), 4_000_000n);
  assert.equal(await sim.getUsdcBalance(feeOwner), 10_000n);
  assert.equal(await sim.getUsdcBalance(org.plan.vaultPda), 10_000_000n - 4_010_000n);
  assert.equal(await sim.getUsdcBalance(SIMULATED_FEE_PAYER), 0n, 'the fee payer receives nothing');
});

test('fee leg: I-2 still holds and bad fee legs are refused', () => {
  const vaultPda = Keypair.generate().publicKey;
  const feePayer = Keypair.generate().publicKey;
  const partner = Keypair.generate().publicKey.toBase58();
  const feeOwner = Keypair.generate().publicKey.toBase58();
  const base = { cluster: 'devnet', vaultPda, feePayer, destination: partner, expectedDepositAddress: partner, amountMinor: 1_000_000n, commitmentHex: commit('x'), reference: Keypair.generate().publicKey, splashKeys: [feePayer.toBase58()] };
  // The payout destination can never be the Splash fee account.
  assert.throws(() => buildPayoutInstructions({ ...base, destination: feeOwner, expectedDepositAddress: feeOwner, splashFee: { feeAccountOwner: feeOwner, amountMinor: 1n } }), /I-2/);
  // Fee account cannot be the partner, the vault or the fee payer.
  assert.throws(() => buildPayoutInstructions({ ...base, splashFee: { feeAccountOwner: partner, amountMinor: 1n } }), /I-2/);
  assert.throws(() => buildPayoutInstructions({ ...base, splashFee: { feeAccountOwner: vaultPda.toBase58(), amountMinor: 1n } }), /vault/);
  assert.throws(() => buildPayoutInstructions({ ...base, splashFee: { feeAccountOwner: feePayer.toBase58(), amountMinor: 1n } }), /fee payer/);
  // Fee must be positive and smaller than the payout.
  assert.throws(() => buildPayoutInstructions({ ...base, splashFee: { feeAccountOwner: feeOwner, amountMinor: 0n } }), /1\.\.u64/);
  assert.throws(() => buildPayoutInstructions({ ...base, splashFee: { feeAccountOwner: feeOwner, amountMinor: 1_000_000n } }), /smaller than the payout/);
  // The standalone builder (used beside a CCTP burn) applies the same rules.
  assert.throws(() => buildSplashFeeInstructions({ cluster: 'devnet', vaultPda, feePayer, fee: { feeAccountOwner: feePayer.toBase58(), amountMinor: 5n }, payoutAmountMinor: 100n }), /fee payer/);
  const ok = buildSplashFeeInstructions({ cluster: 'devnet', vaultPda, feePayer, fee: { feeAccountOwner: feeOwner, amountMinor: 5n }, payoutAmountMinor: 100n });
  assert.equal(ok.vaultInstructions.length, 1);
  // Without a fee leg the payout is unchanged: one transfer, then the memo.
  const plain = buildPayoutInstructions(base);
  assert.equal(plain.vaultInstructions.length, 2);
  assert.equal(plain.fee, undefined);
});
