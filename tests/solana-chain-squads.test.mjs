// Squads V4 vault: autonomous creation, proposals with ephemeral signers, execute, autonomy check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as multisig from '@sqds/multisig';
import { Keypair, PublicKey } from '@solana/web3.js';

import {
  MAX_TRANSACTION_BYTES,
  assertAutonomous,
  buildCreateVaultInstruction,
  buildSponsoredTransaction,
  buildVaultExecuteInstruction,
  buildVaultProposal,
  deriveProposalAddresses,
  deriveVaultAddresses,
  groupProposalTransactions,
  transactionSize,
  validateMembership,
} from '../lib/solana/squads.ts';
import { buildMemoInstruction, buildSplashMemo } from '../lib/solana/payout.ts';
import { buildDepositForBurnInstruction } from '../lib/solana/cctp-v2-solana.ts';

const g = multisig.generated;
const pk = () => Keypair.generate().publicKey;
const BH = PublicKey.default.toBase58();

function solo() {
  const device = pk();
  const kit = pk();
  return { device, kit, members: [{ role: 'admin_device', publicKey: device.toBase58() }, { role: 'recovery_kit_a', publicKey: kit.toBase58() }] };
}

test('multisigCreateV2: autonomous, threshold 1, device + kit with all permissions, fee payer pays', () => {
  const { device, kit, members } = solo();
  const feePayer = pk();
  const createKey = pk();
  const treasury = pk();
  const plan = buildCreateVaultInstruction({ mode: 'solo', members, createKey, feePayer, treasury });
  const ix = plan.instruction;
  assert.ok(ix.programId.equals(multisig.PROGRAM_ID));
  const [{ args }] = g.multisigCreateV2Struct.deserialize(ix.data);
  assert.equal(args.configAuthority, null);
  assert.equal(args.threshold, 1);
  assert.equal(args.timeLock, 0);
  assert.equal(args.rentCollector, null);
  assert.deepEqual(args.members.map((m) => [m.key.toBase58(), m.permissions.mask]), [[device.toBase58(), 7], [kit.toBase58(), 7]]);
  // Accounts: programConfig, treasury, multisig(w), createKey(s), creator(s,w), system.
  const flags = ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]);
  assert.deepEqual(flags[1], [treasury.toBase58(), false, true]);
  assert.deepEqual(flags[2], [plan.multisigPda.toBase58(), false, true]);
  assert.deepEqual(flags[3], [createKey.toBase58(), true, false]);
  assert.deepEqual(flags[4], [feePayer.toBase58(), true, true]);
  const { multisigPda, vaultPda } = deriveVaultAddresses(createKey);
  assert.ok(plan.multisigPda.equals(multisigPda) && plan.vaultPda.equals(vaultPda));
  assert.ok(vaultPda.equals(multisig.getVaultPda({ multisigPda, index: 0 })[0]));
  assert.equal(plan.vault.configAuthority, null);
  assert.ok(transactionSize(buildSponsoredTransaction(feePayer, [ix], BH)) <= MAX_TRANSACTION_BYTES);
});

test('dual mode: four members, threshold 2', () => {
  const members = ['admin_device', 'approver_device', 'recovery_kit_a', 'recovery_kit_b'].map((role) => ({ role, publicKey: pk().toBase58() }));
  const plan = buildCreateVaultInstruction({ mode: 'dual', members, createKey: pk(), feePayer: pk(), treasury: pk() });
  const [{ args }] = g.multisigCreateV2Struct.deserialize(plan.instruction.data);
  assert.equal(args.threshold, 2);
  assert.equal(args.members.length, 4);
});

test('membership validator (I-1): no Splash member; dual needs distinct devices and exactly two kits', () => {
  const { members } = solo();
  assert.deepEqual(validateMembership('solo', members), { ok: true, errors: [] });
  const splashKey = pk().toBase58();
  assert.equal(validateMembership('solo', [members[0], { role: 'recovery_kit_a', publicKey: splashKey }], [splashKey]).ok, false);
  assert.equal(validateMembership('solo', [members[0], { ...members[1], splash: true }]).ok, false);
  assert.equal(validateMembership('solo', [members[0], { ...members[1], label: 'Splash backup' }]).ok, false);
  assert.equal(validateMembership('solo', [members[0], { ...members[1], publicKey: members[0].publicKey }]).ok, false, 'duplicate');
  assert.equal(validateMembership('solo', [members[0]]).ok, false, 'kit required');
  assert.equal(validateMembership('solo', [members[0], { role: 'recovery_kit_a', publicKey: PublicKey.default.toBase58() }]).ok, false, 'zero key');

  const d = () => pk().toBase58();
  const same = d();
  const dualSame = [
    { role: 'admin_device', publicKey: same },
    { role: 'approver_device', publicKey: same },
    { role: 'recovery_kit_a', publicKey: d() },
    { role: 'recovery_kit_b', publicKey: d() },
  ];
  const r = validateMembership('dual', dualSame);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /admin and approver must be different/.test(e)));
  const oneKit = [{ role: 'admin_device', publicKey: d() }, { role: 'approver_device', publicKey: d() }, { role: 'recovery_kit_a', publicKey: d() }];
  assert.equal(validateMembership('dual', oneKit).ok, false);
  const threeKits = [...oneKit, { role: 'recovery_kit_b', publicKey: d() }, { role: 'recovery_kit_b', publicKey: d() }];
  assert.equal(validateMembership('dual', threeKits).ok, false);

  // The fee payer is always on the deny list for creation.
  const feePayer = pk();
  assert.throws(
    () => buildCreateVaultInstruction({ mode: 'solo', members: [members[0], { role: 'recovery_kit_a', publicKey: feePayer.toBase58() }], createKey: pk(), feePayer, treasury: pk() }),
    /deny list/,
  );
});

test('proposal: vaultTransactionCreate + proposalCreate + approve decode; fee payer pays rent only', () => {
  const { device, members } = solo();
  const feePayer = pk();
  const v = buildCreateVaultInstruction({ mode: 'solo', members, createKey: pk(), feePayer, treasury: pk() });
  const inner = [buildMemoInstruction(buildSplashMemo('ab'.repeat(32)))];
  const p = buildVaultProposal({ multisigPda: v.multisigPda, transactionIndex: 1n, member: device, feePayer, innerInstructions: inner });

  const [{ args: c }] = g.vaultTransactionCreateStruct.deserialize(p.create.data);
  assert.equal(c.vaultIndex, 0);
  assert.equal(c.ephemeralSigners, 0);
  const [msg] = multisig.types.transactionMessageBeet.deserialize(Buffer.from(c.transactionMessage));
  assert.ok(msg.accountKeys[0].equals(v.vaultPda), 'vault is the inner payer');
  assert.ok(!msg.accountKeys.some((k) => k.equals(feePayer)), 'fee payer is absent from the inner message');
  assert.deepEqual(p.create.keys.slice(0, 4).map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), [
    [v.multisigPda.toBase58(), false, true],
    [p.transactionPda.toBase58(), false, true],
    [device.toBase58(), true, false],
    [feePayer.toBase58(), true, true],
  ]);
  const [{ args: pc }] = g.proposalCreateStruct.deserialize(p.proposalCreate.data);
  assert.equal(BigInt(pc.transactionIndex.toString()), 1n);
  assert.equal(pc.draft, false);
  assert.ok(p.proposalCreate.keys[3].pubkey.equals(feePayer));
  assert.deepEqual(Array.from(p.approve.data.subarray(0, 8)), Array.from(g.proposalApproveInstructionDiscriminator));
  assert.ok(p.approve.keys[1].pubkey.equals(device) && p.approve.keys[1].isSigner);
  assert.ok(!p.approve.keys.some((k) => k.pubkey.equals(feePayer)));

  assert.throws(
    () => buildVaultProposal({ multisigPda: v.multisigPda, transactionIndex: 1n, member: device, feePayer, innerInstructions: [{ ...inner[0], keys: [{ pubkey: feePayer, isSigner: true, isWritable: true }] }] }),
    /fee payer must not appear/,
  );
  assert.throws(() => buildVaultProposal({ multisigPda: v.multisigPda, transactionIndex: 0n, member: device, feePayer, innerInstructions: inner }), /starts at 1/);
});

test('ephemeral signers: CCTP event account is Squads ephemeral PDA 0, not a signer in execute', async () => {
  const { device, members } = solo();
  const feePayer = pk();
  const v = buildCreateVaultInstruction({ mode: 'solo', members, createKey: pk(), feePayer, treasury: pk() });
  const { transactionPda, ephemeralSigners } = deriveProposalAddresses(v.multisigPda, 1n, 1);
  assert.ok(ephemeralSigners[0].equals(multisig.getEphemeralSignerPda({ transactionPda, ephemeralSignerIndex: 0 })[0]));
  const evm = `0x${'22'.repeat(20)}`;
  const burn = buildDepositForBurnInstruction({ cluster: 'devnet', vaultPda: v.vaultPda, transactionPda, amountMinor: 1_000_000n, mintRecipientEvm: evm, expectedMintRecipientEvm: evm, speed: 'standard', feePayer });
  assert.ok(burn.messageSentEventData.equals(ephemeralSigners[0]));
  const inner = [burn.instruction];
  const p = buildVaultProposal({ multisigPda: v.multisigPda, transactionIndex: 1n, member: device, feePayer, innerInstructions: inner, ephemeralSigners: 1 });
  const [{ args }] = g.vaultTransactionCreateStruct.deserialize(p.create.data);
  assert.equal(args.ephemeralSigners, 1);
  const groups = groupProposalTransactions(p, feePayer, BH);
  for (const grp of groups) assert.ok(transactionSize(buildSponsoredTransaction(feePayer, grp, BH)) <= MAX_TRANSACTION_BYTES);

  const ex = await buildVaultExecuteInstruction({ multisigPda: v.multisigPda, transactionIndex: 1n, member: device, innerInstructions: inner, ephemeralSigners: 1 });
  assert.deepEqual(Array.from(ex.data), Array.from(g.vaultTransactionExecuteInstructionDiscriminator));
  const metaFor = (key) => ex.keys.find((k) => k.pubkey.equals(key));
  assert.equal(metaFor(burn.messageSentEventData).isSigner, false, 'ephemeral PDA is signed by Squads, not the outer tx');
  assert.equal(metaFor(burn.messageSentEventData).isWritable, true);
  assert.equal(metaFor(v.vaultPda).isSigner, false);
  assert.ok(ex.keys[3].pubkey.equals(device) && ex.keys[3].isSigner, 'member signs execute');
  assert.deepEqual(ex.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58()), [device.toBase58()]);
  assert.ok(!ex.keys.some((k) => k.pubkey.equals(feePayer)));
  assert.ok(transactionSize(buildSponsoredTransaction(feePayer, [ex], BH)) <= MAX_TRANSACTION_BYTES);
});

function multisigAccount({ configAuthority = PublicKey.default, members, threshold = 1, timeLock = 0 }) {
  const [buf] = g.Multisig.fromArgs({
    createKey: pk(),
    configAuthority,
    threshold,
    timeLock,
    transactionIndex: 3,
    staleTransactionIndex: 0,
    rentCollector: null,
    bump: 255,
    members: members.map((k) => ({ key: k, permissions: { mask: 7 } })),
  }).serialize();
  return buf;
}

test('assertAutonomous: accepts configAuthority = default key, refuses anything else (I-1)', () => {
  const a = pk();
  const b = pk();
  const s = assertAutonomous(multisigAccount({ members: [a, b] }), { expectedMembers: [a.toBase58(), b.toBase58()], expectedThreshold: 1 });
  assert.equal(s.configAuthority, null);
  assert.equal(s.transactionIndex, 3n);
  assert.throws(() => assertAutonomous(multisigAccount({ members: [a, b], configAuthority: pk() })), /not autonomous/);
  assert.throws(() => assertAutonomous(multisigAccount({ members: [a, b] }), { splashKeys: [b.toBase58()] }), /Splash key/);
  assert.throws(() => assertAutonomous(multisigAccount({ members: [a, b], threshold: 3 })), /Threshold/);
  assert.throws(() => assertAutonomous(multisigAccount({ members: [a, b], timeLock: 60 })), /timeLock/);
  assert.throws(() => assertAutonomous(multisigAccount({ members: [a, b] }), { expectedMembers: [a.toBase58()] }), /differ/);
});
