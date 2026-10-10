// Kora sponsorship (I-3): local validator, per-org caps, kora.toml parity, JSON-RPC client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

import { SOLANA_CONFIG } from '../lib/solana/config.ts';
import {
  SPONSOR_ALLOWED_PROGRAMS,
  createKoraClient,
  createMemorySponsorUsage,
  defaultSponsorPolicy,
  serializeForKora,
  utcDay,
  validateSponsoredTransaction,
} from '../lib/solana/kora.ts';
import { buildPayoutInstructions, buildTransferCheckedInstruction, getAssociatedTokenAddress } from '../lib/solana/payout.ts';
import { buildCreateVaultInstruction, buildSponsoredTransaction, buildVaultExecuteInstruction, buildVaultProposal } from '../lib/solana/squads.ts';

const pk = () => Keypair.generate().publicKey;
const BH = PublicKey.default.toBase58();
const MINT = new PublicKey(SOLANA_CONFIG.devnet.usdcMint);
const policy = defaultSponsorPolicy(MINT.toBase58());
const COMMIT = 'ab'.repeat(32);

function vaultSetup() {
  const feePayer = pk();
  const device = pk();
  const v = buildCreateVaultInstruction({
    mode: 'solo',
    members: [{ role: 'admin_device', publicKey: device.toBase58() }, { role: 'recovery_kit_a', publicKey: pk().toBase58() }],
    createKey: pk(),
    feePayer,
    treasury: pk(),
  });
  return { feePayer, device, v };
}

const check = (tx, feePayer, ctx) => validateSponsoredTransaction(tx, feePayer, policy, ctx);

test('refuses a SOL transfer from the fee payer', () => {
  const feePayer = pk();
  const tx = buildSponsoredTransaction(feePayer, [SystemProgram.transfer({ fromPubkey: feePayer, toPubkey: pk(), lamports: 1_000_000 })], BH);
  const r = check(tx, feePayer);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /System/.test(x)));
});

test('refuses a USDC transfer from the fee payer (and anything touching its token account)', () => {
  const feePayer = pk();
  const ix = buildTransferCheckedInstruction({ source: getAssociatedTokenAddress(MINT, feePayer), mint: MINT, destination: getAssociatedTokenAddress(MINT, pk()), owner: feePayer, amount: 1_000_000n, decimals: 6 });
  const r = check(buildSponsoredTransaction(feePayer, [ix], BH), feePayer);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /SPL Token/.test(x)));
  assert.ok(r.reasons.some((x) => /own token account/.test(x)));
});

test('refuses an unknown program', () => {
  const feePayer = pk();
  const ix = new TransactionInstruction({ programId: pk(), keys: [], data: Buffer.from([0]) });
  const r = check(buildSponsoredTransaction(feePayer, [ix], BH), feePayer);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /not allowlisted/.test(x)));
});

test('allows vault creation, a proposal, and a normal Squads execute with ATA create + memo', async () => {
  const { feePayer, device, v } = vaultSetup();
  assert.deepEqual(check(buildSponsoredTransaction(feePayer, [v.instruction], BH), feePayer), { ok: true, reasons: [] });
  const partner = pk().toBase58();
  const pay = buildPayoutInstructions({ cluster: 'devnet', vaultPda: v.vaultPda, feePayer, destination: partner, expectedDepositAddress: partner, amountMinor: 1_000_000n, commitmentHex: COMMIT, reference: pk(), splashKeys: [feePayer.toBase58()] });
  const p = buildVaultProposal({ multisigPda: v.multisigPda, transactionIndex: 1n, member: device, feePayer, innerInstructions: pay.vaultInstructions });
  assert.deepEqual(check(buildSponsoredTransaction(feePayer, [p.create, p.proposalCreate, p.approve], BH), feePayer), { ok: true, reasons: [] });
  const ex = await buildVaultExecuteInstruction({ multisigPda: v.multisigPda, transactionIndex: 1n, member: device, innerInstructions: pay.vaultInstructions });
  const tx = buildSponsoredTransaction(feePayer, [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }), ...pay.preExecuteInstructions, ex, ...pay.postExecuteInstructions], BH);
  assert.deepEqual(check(tx, feePayer), { ok: true, reasons: [] });
  assert.equal(typeof serializeForKora(tx), 'string');
});

test('refuses Squads abuses: fee payer inside the vault message, in execute accounts, as member, non-autonomous', async () => {
  const { feePayer, device, v } = vaultSetup();
  // Fee payer smuggled into a vault message (bypassing buildVaultProposal's own guard).
  const sneaky = SystemProgram.transfer({ fromPubkey: feePayer, toPubkey: pk(), lamports: 1 });
  const create = multisig.instructions.vaultTransactionCreate({
    multisigPda: v.multisigPda, transactionIndex: 1n, creator: device, rentPayer: feePayer, vaultIndex: 0, ephemeralSigners: 0,
    transactionMessage: new (await import('@solana/web3.js')).TransactionMessage({ payerKey: v.vaultPda, recentBlockhash: BH, instructions: [sneaky] }),
  });
  let r = check(buildSponsoredTransaction(feePayer, [create], BH), feePayer);
  assert.ok(r.reasons.some((x) => /inside the vault transaction/.test(x)), r.reasons.join());
  // Execute whose remaining accounts include the fee payer (would forward its signature).
  const ex = await buildVaultExecuteInstruction({ multisigPda: v.multisigPda, transactionIndex: 1n, member: device, innerInstructions: [sneaky] });
  r = check(buildSponsoredTransaction(feePayer, [ex], BH), feePayer);
  assert.ok(r.reasons.some((x) => /non-rent slot/.test(x)), r.reasons.join());
  // multisigCreateV2 with the fee payer as a member, or with a config authority.
  const bad = multisig.instructions.multisigCreateV2({
    treasury: pk(), creator: feePayer, multisigPda: multisig.getMultisigPda({ createKey: pk() })[0], configAuthority: pk(), threshold: 1,
    members: [{ key: feePayer, permissions: multisig.types.Permissions.all() }], timeLock: 0, createKey: pk(), rentCollector: null,
  });
  r = check(buildSponsoredTransaction(feePayer, [bad], BH), feePayer);
  assert.ok(r.reasons.some((x) => /autonomous/.test(x)));
  assert.ok(r.reasons.some((x) => /member \(I-1\)/.test(x)));
  // Fee payer as proposal approver.
  const approve = multisig.instructions.proposalApprove({ multisigPda: v.multisigPda, transactionIndex: 1n, member: feePayer });
  assert.equal(check(buildSponsoredTransaction(feePayer, [approve], BH), feePayer).ok, false);
});

test('refuses wrong fee payer, legacy-tx SOL drain, ATA owned by fee payer, high priority fee', () => {
  const feePayer = pk();
  const other = pk();
  const ix = new TransactionInstruction({ programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), keys: [], data: Buffer.from(`splash:v1:${COMMIT}`) });
  assert.ok(check(buildSponsoredTransaction(other, [ix], BH), feePayer).reasons.some((x) => /account 0/.test(x)));

  const legacy = new Transaction({ feePayer, recentBlockhash: BH }).add(SystemProgram.transfer({ fromPubkey: feePayer, toPubkey: other, lamports: 5 }));
  assert.equal(check(legacy, feePayer).ok, false);

  const ataForFeePayer = new TransactionInstruction({
    programId: new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
    keys: [feePayer, getAssociatedTokenAddress(MINT, feePayer), feePayer, MINT, SystemProgram.programId, new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')].map((k, i) => ({ pubkey: k, isSigner: i === 0, isWritable: i < 2 })),
    data: Buffer.from([1]),
  });
  assert.equal(check(buildSponsoredTransaction(feePayer, [ataForFeePayer], BH), feePayer).ok, false);

  const pricey = buildSponsoredTransaction(feePayer, [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }), ix], BH);
  assert.ok(check(pricey, feePayer).reasons.some((x) => /priority fee/.test(x)));
});

test('per-org daily cap', () => {
  const feePayer = pk();
  const ix = new TransactionInstruction({ programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), keys: [], data: Buffer.from(`splash:v1:${COMMIT}`) });
  const tx = buildSponsoredTransaction(feePayer, [ix], BH);
  const usage = createMemorySponsorUsage();
  const now = new Date('2026-10-11T10:00:00Z');
  const capped = { ...policy, perOrgDailyTxCap: 2 };
  for (let i = 0; i < 2; i++) {
    assert.equal(validateSponsoredTransaction(tx, feePayer, capped, { orgId: 'org_a', usage, now }).ok, true);
    usage.record('org_a', utcDay(now));
  }
  assert.ok(validateSponsoredTransaction(tx, feePayer, capped, { orgId: 'org_a', usage, now }).reasons.some((x) => /daily/.test(x)));
  assert.equal(validateSponsoredTransaction(tx, feePayer, capped, { orgId: 'org_b', usage, now }).ok, true, 'other orgs unaffected');
  assert.equal(validateSponsoredTransaction(tx, feePayer, capped, { orgId: 'org_a', usage, now: new Date('2026-10-12T00:00:01Z') }).ok, true, 'resets next UTC day');
  assert.equal(validateSponsoredTransaction(tx, feePayer, capped, { usage, now }).ok, false, 'orgId required when capped');
});

test('kora.toml allowlist and fee-payer policy match the TS validator', () => {
  const toml = readFileSync(new URL('../lib/solana/kora.toml', import.meta.url), 'utf8');
  const block = toml.match(/allowed_programs = \[([\s\S]*?)\]/)[1];
  const ids = [...block.matchAll(/"([1-9A-HJ-NP-Za-km-z]{32,44})"/g)].map((m) => m[1]);
  assert.deepEqual([...ids].sort(), [...SPONSOR_ALLOWED_PROGRAMS].sort());
  const section = (name) => toml.split(`[${name}]`)[1].split('\n[')[0];
  assert.match(section('validation.fee_payer_policy.system'), /allow_transfer = false/);
  assert.match(section('validation.fee_payer_policy.system'), /allow_create_account = true/);
  assert.doesNotMatch(section('validation.fee_payer_policy.spl_token'), /= true/);
  assert.doesNotMatch(section('validation.fee_payer_policy.token_2022'), /= true/);
  assert.match(section('kora.enabled_methods'), /transfer_transaction = false/);
  assert.match(toml, /allowed_tokens = \["4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"\]/);
  assert.doesNotMatch(toml, /api_keys = \["[^<]/, 'no real API key committed');
});

test('Kora JSON-RPC client: method names, params, auth headers, errors', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    if (body.method === 'signAndSendTransaction') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { signature: 'sig1', signed_transaction: 'b64', signer_pubkey: 'fp' } }));
    if (body.method === 'getPayerSigner') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { signer_address: 'fp', payment_address: 'fp' } }));
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'nope' } }));
  };
  const kora = createKoraClient({ rpcUrl: 'http://kora.test', apiKey: 'test-key', hmacSecret: 'test-secret', fetchImpl });
  assert.equal((await kora.signAndSendTransaction({ transaction: 'AAA', user_id: 'org_1' })).signature, 'sig1');
  assert.equal((await kora.getPayerSigner()).signer_address, 'fp');
  await assert.rejects(kora.getConfig(), /Kora error -32000: nope/);
  assert.deepEqual(calls.map((c) => c.body.method), ['signAndSendTransaction', 'getPayerSigner', 'getConfig']);
  assert.deepEqual(calls[0].body.params, { transaction: 'AAA', user_id: 'org_1' });
  assert.equal(calls[0].body.jsonrpc, '2.0');
  assert.equal(calls[0].headers['x-api-key'], 'test-key');
  assert.match(calls[0].headers['x-hmac-signature'], /^[0-9a-f]{64}$/);
  const { createHmac } = await import('node:crypto');
  const expected = createHmac('sha256', 'test-secret').update(calls[0].headers['x-timestamp'] + JSON.stringify(calls[0].body)).digest('hex');
  assert.equal(calls[0].headers['x-hmac-signature'], expected, 'HMAC matches Kora SDK: hex(HMAC-SHA256(timestamp || body))');
});
