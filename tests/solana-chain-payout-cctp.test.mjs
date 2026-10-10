// Payout (ATA + transferChecked + reference + memo) and CCTP V2 deposit_for_burn layouts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey } from '@solana/web3.js';

import { PROGRAM_IDS, SOLANA_CONFIG } from '../lib/solana/config.ts';
import {
  buildMemoInstruction,
  buildPayoutInstructions,
  buildSplashMemo,
  decodeTransferChecked,
  getAssociatedTokenAddress,
} from '../lib/solana/payout.ts';
import {
  DEPOSIT_FOR_BURN_DISCRIMINATOR,
  buildDepositForBurnInstruction,
  bytes32ToEvmAddress,
  cctpAccounts,
  decodeDepositForBurn,
  evmAddressToBytes32,
  irisMessagesUrl,
} from '../lib/solana/cctp-v2-solana.ts';
import { deriveProposalAddresses, deriveVaultAddresses } from '../lib/solana/squads.ts';
import { createHash } from 'node:crypto';

const pk = () => Keypair.generate().publicKey;
const COMMIT = createHash('sha256').update('salt|{"invoice":"INV-1"}').digest('hex');

function payoutBase(overrides = {}) {
  const { vaultPda } = deriveVaultAddresses(pk());
  const feePayer = pk();
  const partner = pk().toBase58();
  return {
    cluster: 'devnet',
    vaultPda,
    feePayer,
    destination: partner,
    expectedDepositAddress: partner,
    amountMinor: 1_234_567n,
    commitmentHex: COMMIT,
    reference: pk(),
    splashKeys: [feePayer.toBase58()],
    ...overrides,
  };
}

test('payout: ATA createIdempotent (fee payer pays), transferChecked 6dp with reference, memo inside and outside', () => {
  const p = payoutBase();
  const plan = buildPayoutInstructions(p);
  const mint = new PublicKey(SOLANA_CONFIG.devnet.usdcMint);

  const [ata] = plan.preExecuteInstructions;
  assert.ok(ata.programId.equals(PROGRAM_IDS.associatedToken));
  assert.deepEqual(Array.from(ata.data), [1]);
  assert.ok(ata.keys[0].pubkey.equals(p.feePayer) && ata.keys[0].isSigner && ata.keys[0].isWritable);
  assert.ok(ata.keys[1].pubkey.equals(plan.destinationTokenAccount));
  assert.equal(ata.keys[2].pubkey.toBase58(), p.destination);
  assert.ok(ata.keys[3].pubkey.equals(mint));

  const [xfer, memoIn] = plan.vaultInstructions;
  assert.ok(xfer.programId.equals(PROGRAM_IDS.token));
  assert.deepEqual(decodeTransferChecked(xfer.data), { amount: 1_234_567n, decimals: 6 });
  assert.deepEqual(xfer.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), [
    [getAssociatedTokenAddress(mint, p.vaultPda).toBase58(), false, true],
    [mint.toBase58(), false, false],
    [getAssociatedTokenAddress(mint, new PublicKey(p.destination)).toBase58(), false, true],
    [p.vaultPda.toBase58(), true, false],
    [p.reference.toBase58(), false, false],
  ]);
  assert.ok(!xfer.keys.some((k) => k.pubkey.equals(p.feePayer)), 'fee payer never touches the transfer');
  assert.equal(Buffer.from(memoIn.data).toString(), `splash:v1:${COMMIT}`);
  assert.equal(memoIn.keys.length, 0);
  assert.equal(Buffer.from(plan.postExecuteInstructions[0].data).toString(), plan.memo);
});

test('I-5: memo carries only the salted commitment', () => {
  assert.equal(buildSplashMemo(COMMIT), `splash:v1:${COMMIT}`);
  for (const bad of ['INV-2026-001', 'Acme Supplies Inc', COMMIT.toUpperCase(), COMMIT.slice(0, 63), `${COMMIT}00`, '', `${COMMIT} INV-1`]) {
    assert.throws(() => buildSplashMemo(bad), /Memo refused/, bad);
  }
  assert.throws(() => buildMemoInstruction('splash:v1:INV-1'), /Memo refused/);
  assert.throws(() => buildMemoInstruction('Payment for invoice 42'), /Memo refused/);
  assert.throws(() => buildPayoutInstructions(payoutBase({ commitmentHex: 'INV-1' })), /Memo refused/);
});

test('I-2: payout destination must be the quoted partner deposit address and never Splash', () => {
  const p = payoutBase();
  assert.throws(() => buildPayoutInstructions({ ...p, destination: pk().toBase58() }), /I-2/);
  const splash = pk().toBase58();
  assert.throws(() => buildPayoutInstructions({ ...p, destination: splash, expectedDepositAddress: splash, splashKeys: [...p.splashKeys, splash] }), /Splash-controlled/);
  assert.throws(() => buildPayoutInstructions({ ...p, destination: p.feePayer.toBase58(), expectedDepositAddress: p.feePayer.toBase58() }), /I-2/);
  assert.throws(() => buildPayoutInstructions({ ...p, destination: p.vaultPda.toBase58(), expectedDepositAddress: p.vaultPda.toBase58() }), /I-2/);
  // A Splash token account given as the deposit address is refused too.
  const mint = new PublicKey(SOLANA_CONFIG.devnet.usdcMint);
  const splashAta = getAssociatedTokenAddress(mint, new PublicKey(splash)).toBase58();
  assert.throws(() => buildPayoutInstructions({ ...p, destination: splashAta, expectedDepositAddress: splashAta, splashKeys: [splash, splashAta] }), /I-2/);
  assert.throws(() => buildPayoutInstructions({ ...p, destination: 'not-an-address', expectedDepositAddress: 'not-an-address' }), /valid Solana address/);
  assert.throws(() => buildPayoutInstructions({ ...p, amountMinor: 0n }), /amount/);
  assert.throws(() => buildPayoutInstructions({ ...p, reference: p.vaultPda }), /Reference/);
});

test('CCTP V2 deposit_for_burn: discriminator, Borsh layout, 18 accounts with cctp-kit / IDL flags', () => {
  const { multisigPda, vaultPda } = deriveVaultAddresses(pk());
  const { transactionPda, ephemeralSigners } = deriveProposalAddresses(multisigPda, 7n, 1);
  const evm = '0x12000000000000000000000000000000000000Ab'; // mixed case: comparison is case-insensitive
  const feePayer = pk();
  const plan = buildDepositForBurnInstruction({ cluster: 'devnet', vaultPda, transactionPda, amountMinor: 5_000_000n, mintRecipientEvm: evm, expectedMintRecipientEvm: evm.toLowerCase(), speed: 'standard', feePayer });
  const ix = plan.instruction;
  assert.ok(ix.programId.equals(PROGRAM_IDS.cctpTokenMessengerMinterV2));
  assert.deepEqual(Array.from(ix.data.subarray(0, 8)), Array.from(DEPOSIT_FOR_BURN_DISCRIMINATOR));
  assert.deepEqual(Array.from(DEPOSIT_FOR_BURN_DISCRIMINATOR), [215, 60, 61, 46, 114, 55, 128, 176]);
  const d = decodeDepositForBurn(ix.data);
  assert.equal(d.amount, 5_000_000n);
  assert.equal(d.destinationDomain, 7);
  assert.equal(bytes32ToEvmAddress(d.mintRecipient), evm.toLowerCase());
  assert.ok(d.destinationCaller.every((b) => b === 0));
  assert.equal(d.maxFee, 0n);
  assert.equal(d.minFinalityThreshold, 2000);

  const a = cctpAccounts('devnet', vaultPda, 7);
  const expected = [
    [vaultPda, true, false], [vaultPda, true, true], [a.senderAuthority, false, false], [a.burnTokenAccount, false, true],
    [a.denylist, false, false], [a.messageTransmitter, false, true], [a.tokenMessenger, false, false], [a.remoteTokenMessenger, false, false],
    [a.tokenMinter, false, false], [a.localToken, false, true], [a.mint, false, true], [ephemeralSigners[0], true, true],
    [PROGRAM_IDS.cctpMessageTransmitterV2, false, false], [PROGRAM_IDS.cctpTokenMessengerMinterV2, false, false], [PROGRAM_IDS.token, false, false],
    [PROGRAM_IDS.system, false, false], [a.eventAuthority, false, false], [PROGRAM_IDS.cctpTokenMessengerMinterV2, false, false],
  ];
  assert.equal(ix.keys.length, 18);
  ix.keys.forEach((k, i) => assert.deepEqual([k.pubkey.toBase58(), k.isSigner, k.isWritable], [expected[i][0].toBase58(), expected[i][1], expected[i][2]], `account ${i}`));
  // remote_token_messenger seed is the decimal domain string.
  assert.ok(a.remoteTokenMessenger.equals(PublicKey.findProgramAddressSync([Buffer.from('remote_token_messenger'), Buffer.from('7')], PROGRAM_IDS.cctpTokenMessengerMinterV2)[0]));
  assert.ok(!ix.keys.some((k) => k.pubkey.equals(feePayer)), 'I-3: fee payer is not the event rent payer');
  assert.match(irisMessagesUrl('devnet', 'sig'), /^https:\/\/iris-api-sandbox\.circle\.com\/v2\/messages\/5\?transactionHash=sig$/);
});

test('CCTP fees, finality and I-2 for mintRecipient', () => {
  const { multisigPda, vaultPda } = deriveVaultAddresses(pk());
  const { transactionPda } = deriveProposalAddresses(multisigPda, 1n, 1);
  const evm = `0x${'ab'.repeat(20)}`;
  const base = { cluster: 'devnet', vaultPda, transactionPda, amountMinor: 10_000_000n, mintRecipientEvm: evm, expectedMintRecipientEvm: evm, feePayer: pk() };
  const fast = buildDepositForBurnInstruction({ ...base, speed: 'fast', maxFeeMinor: 1_300n });
  assert.equal(decodeDepositForBurn(fast.instruction.data).minFinalityThreshold, 1000);
  assert.equal(decodeDepositForBurn(fast.instruction.data).maxFee, 1_300n);
  assert.throws(() => buildDepositForBurnInstruction({ ...base, speed: 'fast' }), /Fast transfer/);
  assert.throws(() => buildDepositForBurnInstruction({ ...base, speed: 'standard', maxFeeMinor: 5n }), /Standard/);
  assert.throws(() => buildDepositForBurnInstruction({ ...base, speed: 'standard', mintRecipientEvm: `0x${'cd'.repeat(20)}` }), /I-2/);
  assert.throws(() => buildDepositForBurnInstruction({ ...base, speed: 'standard', splashEvmAddresses: [evm.toUpperCase().replace('0X', '0x')] }), /Splash-controlled/);
  assert.throws(() => buildDepositForBurnInstruction({ ...base, speed: 'standard', destinationDomain: 0 }), /not allowed/);
  assert.throws(() => evmAddressToBytes32(`0x${'00'.repeat(20)}`), /zero/);
  assert.throws(() => evmAddressToBytes32('0x1234'), /20-byte/);
  const b = evmAddressToBytes32(evm);
  assert.equal(b.length, 32);
  assert.ok(b.slice(0, 12).every((x) => x === 0));
});
