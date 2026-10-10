/**
 * Splash Solana devnet end-to-end run. Produces real devnet signatures for the Colosseum demo.
 *
 * Run on a laptop WITH internet (this was written in a container with no Solana RPC and has never
 * been executed):
 *
 *   solana-keygen new --no-bip39-passphrase -o ~/.config/solana/splash-e2e.json   # throwaway, devnet only
 *   solana airdrop 2 $(solana-keygen pubkey ~/.config/solana/splash-e2e.json) -u devnet  # or faucet.solana.com
 *   SPLASH_E2E_KEYPAIR=~/.config/solana/splash-e2e.json \
 *     node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types \
 *       --import ./scripts/alias-hook.mjs scripts/solana-devnet-e2e.ts
 *
 * Env:
 *   SPLASH_E2E_KEYPAIR          required. Path to a throwaway devnet keypair JSON. Pays fees when Kora
 *                               is not used, and sends the vault the SOL a CCTP burn needs for rent.
 *   SOLANA_RPC_URL              default https://api.devnet.solana.com (only the host is recorded).
 *   KORA_RPC_URL                optional. When set, Kora's fee payer sponsors every vault transaction.
 *   KORA_API_KEY                optional, sent as x-api-key to Kora.
 *   SPLASH_E2E_DEPOSIT_ADDRESS  optional Solana address standing in for the partner deposit address
 *                               (default: a fresh random address).
 *   SPLASH_E2E_AMOUNT_USDC      default 1.
 *   SPLASH_E2E_FUND_TIMEOUT_SEC default 900 (how long to wait for you to fund the vault).
 *   SPLASH_E2E_CCTP=1           also burn the same amount to Polygon Amoy (domain 7) via CCTP V2.
 *   SPLASH_E2E_EVM_RECIPIENT    required with SPLASH_E2E_CCTP: 0x address on Amoy that receives the mint.
 *   SPLASH_E2E_ALLOW_CREATION_FEE=1  continue even if Squads charges a multisig creation fee.
 *   SPLASH_E2E_CCTP_CHANGE      optional. One line naming what this CCTP attempt changed (A2 changes
 *                               one thing at a time); stored with the attempt in cctpAttempts[].
 *
 * Earlier runs in the output file are kept under previousRuns[], and every CCTP attempt (passed or
 * failed, with its program logs) under cctpAttempts[]. A later failure never erases an earlier proof.
 *
 * Output: docs/solana-build/devnet-run.json, rewritten after every step (so a failure leaves a
 * partial record). It holds public keys, signatures and explorer links only: no secrets, no words.
 *
 * What it proves, in order: autonomous vault creation (assertAutonomous on the real account), a
 * sponsored payout through Squads with the commitment memo and reference, and optionally the
 * UNVERIFIED part: a CCTP V2 burn executed by Squads with an ephemeral event account.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

import { clusterConfig, explorerAddressUrl, explorerTxUrl, usdcMint } from '../lib/solana/config.ts';
import { createDeviceKey, createMemoryDeviceKeyStore, deviceKeySigner, signTransactionWith, type MessageSigner } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords } from '../lib/solana/recovery-kit.ts';
import {
  assertAutonomous,
  buildCreateVaultInstruction,
  buildVaultExecuteInstructionFromChain,
  buildVaultProposal,
  deriveProposalAddresses,
  groupProposalTransactions,
  MAX_TRANSACTION_BYTES,
} from '../lib/solana/squads.ts';
import { buildCreateAtaIdempotentInstruction, buildMemoInstruction, buildPayoutInstructions, buildSplashMemo, getAssociatedTokenAddress } from '../lib/solana/payout.ts';
import { buildDepositForBurnInstruction, irisMessagesUrl } from '../lib/solana/cctp-v2-solana.ts';
import { createKoraClient, defaultSponsorPolicy, serializeForKora, validateSponsoredTransaction, type KoraClient } from '../lib/solana/kora.ts';

const CLUSTER = 'devnet' as const;
const OUT = path.join(process.cwd(), 'docs/solana-build/devnet-run.json');

/** Earlier runs in OUT are kept, never overwritten: a later failure must not erase an earlier proof. */
interface CctpAttempt {
  at: string;
  outcome: 'ok' | 'failed';
  /** What changed versus the previous attempt (A2 changes one thing at a time). */
  change: string;
  burnSignature?: string;
  attestationStatus?: string;
  attestationSec?: number;
  error?: string;
  /** Program logs of the failing transaction (public on-chain data, no secrets). */
  logs?: string[];
}
const prior = (() => {
  try {
    const p = JSON.parse(readFileSync(OUT, 'utf8')) as { previousRuns?: unknown[]; cctpAttempts?: CctpAttempt[] } & Record<string, unknown>;
    const { previousRuns = [], cctpAttempts = [], ...last } = p;
    return { previousRuns: [...previousRuns, last], cctpAttempts };
  } catch {
    return { previousRuns: [] as unknown[], cctpAttempts: [] as CctpAttempt[] };
  }
})();
/** Set while the CCTP section runs, so a failure there is recorded as an attempt. */
let cctpStage: string | null = null;

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  try {
    run.status = 'failed';
    run.error = message.split('\n')[0] ?? message;
    run.finishedAt = new Date().toISOString();
    if (cctpStage) {
      const lines = message.split('\n');
      prior.cctpAttempts.push({ at: run.finishedAt, outcome: 'failed', change: cctpChange(), error: `${cctpStage}: ${lines[0]}`, logs: lines.slice(1).filter(Boolean).slice(-40) });
    }
    save();
  } catch {
    /* the record is best effort; the console message above is the source of truth */
  }
  process.exit(1);
}

function expandHome(p: string): string {
  return p.startsWith('~') ? path.join(homedir(), p.slice(1)) : p;
}

function loadKeypair(file: string): Keypair {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(expandHome(file), 'utf8'));
  } catch (e) {
    fail(`Cannot read SPLASH_E2E_KEYPAIR at ${file}: ${(e as Error).message}`);
  }
  if (!Array.isArray(raw) || raw.length !== 64) fail('SPLASH_E2E_KEYPAIR must be a solana-keygen JSON array of 64 numbers');
  return Keypair.fromSecretKey(Uint8Array.from(raw as number[]));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Step {
  name: string;
  signature: string;
  explorer: string;
  at: string;
}

const run = {
  startedAt: new Date().toISOString(),
  finishedAt: null as string | null,
  cluster: CLUSTER,
  rpcHost: '',
  feePayerMode: '' as 'kora' | 'local-keypair' | '',
  feePayer: '',
  squadsCreationFeeLamports: '',
  vault: null as null | { multisigPda: string; vaultPda: string; vaultUsdcAccount: string; threshold: number; members: Array<{ role: string; publicKey: string }>; explorer: string },
  payout: null as null | { destination: string; destinationUsdcAccount: string; amountMinor: string; memo: string; reference: string; balanceAfterMinor: string },
  cctp: null as null | { destinationDomain: number; mintRecipient: string; amountMinor: string; messageSentEventData: string; iris: string; attestationStatus?: string },
  steps: [] as Step[],
  status: 'running' as 'running' | 'ok' | 'failed',
  error: null as string | null,
  notes: [
    'Devnet only. Recovery kit words were generated in memory and discarded: this vault is throwaway.',
    'simulated: false for every signature in this file.',
  ],
};

function cctpChange(): string {
  return process.env.SPLASH_E2E_CCTP_CHANGE?.trim() || 'baseline: vault is event_rent_payer, event account = Squads ephemeral signer 0';
}

function save() {
  mkdirSync(path.dirname(OUT), { recursive: true });
  const out = { ...run, cctpAttempts: prior.cctpAttempts, previousRuns: prior.previousRuns };
  writeFileSync(OUT, `${JSON.stringify(out, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2)}\n`);
}

function record(name: string, signature: string) {
  const step = { name, signature, explorer: explorerTxUrl(signature, CLUSTER), at: new Date().toISOString() };
  run.steps.push(step);
  save();
  console.log(`  ✓ ${name}\n    ${step.explorer}`);
}

async function main() {
  const keypairPath = process.env.SPLASH_E2E_KEYPAIR;
  if (!keypairPath) fail('Set SPLASH_E2E_KEYPAIR to a throwaway devnet keypair file (solana-keygen new -o …)');
  const local = loadKeypair(keypairPath);
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || clusterConfig(CLUSTER).defaultRpcUrl;
  run.rpcHost = new URL(rpcUrl).host;
  if (/mainnet/i.test(rpcUrl)) fail('SOLANA_RPC_URL looks like mainnet. This script is devnet only.');
  const connection = new Connection(rpcUrl, 'confirmed');
  const genesis = await connection.getGenesisHash().catch((e) => fail(`RPC unreachable at ${run.rpcHost}: ${e.message}`));
  // Devnet genesis hash (Solana docs). SPLASH_E2E_SKIP_GENESIS_CHECK=1 bypasses it if it ever differs.
  if (genesis !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' && process.env.SPLASH_E2E_SKIP_GENESIS_CHECK !== '1') {
    fail(`RPC does not look like devnet (genesis ${genesis}). Set SPLASH_E2E_SKIP_GENESIS_CHECK=1 only if you are sure it is devnet.`);
  }

  const amountUsdc = Number(process.env.SPLASH_E2E_AMOUNT_USDC ?? '1');
  if (!(amountUsdc > 0 && amountUsdc <= 100)) fail('SPLASH_E2E_AMOUNT_USDC must be in (0, 100]');
  const amountMinor = BigInt(Math.round(amountUsdc * 1_000_000));
  const wantCctp = process.env.SPLASH_E2E_CCTP === '1';
  const evmRecipient = process.env.SPLASH_E2E_EVM_RECIPIENT?.trim() ?? '';
  if (wantCctp && !/^0x[0-9a-fA-F]{40}$/.test(evmRecipient)) fail('SPLASH_E2E_CCTP=1 needs SPLASH_E2E_EVM_RECIPIENT=0x… (your Polygon Amoy address)');

  // Fee payer: Kora when configured, else the local keypair.
  const koraUrl = process.env.KORA_RPC_URL?.trim();
  const kora: KoraClient | null = koraUrl ? createKoraClient({ rpcUrl: koraUrl, apiKey: process.env.KORA_API_KEY }) : null;
  const feePayer = kora
    ? new PublicKey((await kora.getPayerSigner().catch((e) => fail(`Kora getPayerSigner failed at ${koraUrl}: ${e.message}`))).signer_address)
    : local.publicKey;
  run.feePayerMode = kora ? 'kora' : 'local-keypair';
  run.feePayer = feePayer.toBase58();
  const policy = defaultSponsorPolicy(usdcMint(CLUSTER).toBase58());
  console.log(`Splash devnet e2e · RPC ${run.rpcHost} · fee payer ${run.feePayer} (${run.feePayerMode})`);

  const solBalance = await connection.getBalance(local.publicKey);
  if (solBalance < 0.05 * LAMPORTS_PER_SOL) {
    fail(`Local keypair ${local.publicKey.toBase58()} has ${solBalance / LAMPORTS_PER_SOL} SOL. Get devnet SOL: solana airdrop 2 ${local.publicKey.toBase58()} -u devnet, or https://faucet.solana.com`);
  }

  /** Send a transaction: validate as Kora would, size-check, sign with extra signers, send, confirm. */
  async function send(name: string, ixs: TransactionInstruction[], signers: { keypairs?: Keypair[]; devices?: MessageSigner[] } = {}, sponsored = true) {
    const payer = sponsored ? feePayer : local.publicKey;
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
    if (sponsored) {
      const chk = validateSponsoredTransaction(tx, payer, policy);
      if (!chk.ok) fail(`${name}: local sponsor check refused: ${chk.reasons.join('; ')}`);
    }
    const size = tx.serialize().length;
    if (size > MAX_TRANSACTION_BYTES) fail(`${name}: transaction is ${size} bytes (> ${MAX_TRANSACTION_BYTES})`);
    const extra = [...(signers.keypairs ?? [])];
    if (!kora || !sponsored) extra.unshift(local);
    if (extra.length) tx.sign(extra);
    for (const d of signers.devices ?? []) await signTransactionWith(d, tx);
    let signature: string;
    try {
      if (kora && sponsored) {
        signature = (await kora.signAndSendTransaction({ transaction: serializeForKora(tx), user_id: 'e2e-devnet' })).signature;
      } else {
        signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
      }
    } catch (e) {
      const logs = (e as { logs?: string[] }).logs;
      fail(`${name}: send failed: ${(e as Error).message}${logs ? `\n${logs.join('\n')}` : ''}`);
    }
    const conf = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    if (conf.value.err) {
      const failed = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null);
      const logs = failed?.meta?.logMessages ?? [];
      fail(`${name}: transaction ${signature} failed on chain: ${JSON.stringify(conf.value.err)} ${explorerTxUrl(signature, CLUSTER)}\n${logs.join('\n')}`);
    }
    record(name, signature);
    return signature;
  }

  // 1. Squads ProgramConfig: treasury and creation fee.
  const [programConfigPda] = multisig.getProgramConfigPda({});
  const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(connection, programConfigPda).catch((e) => fail(`Cannot read Squads ProgramConfig: ${e.message}`));
  const creationFee = BigInt(programConfig.multisigCreationFee.toString());
  run.squadsCreationFeeLamports = creationFee.toString();
  save();
  console.log(`Squads multisig creation fee: ${creationFee} lamports`);
  if (creationFee > 0n && process.env.SPLASH_E2E_ALLOW_CREATION_FEE !== '1') {
    fail('Squads charges a creation fee: that is a SOL transfer from the fee payer (I-3). Set SPLASH_E2E_ALLOW_CREATION_FEE=1 to continue with the local keypair, and raise it with the coordinator.');
  }
  if (creationFee > 0n && kora) fail('Kora mode with a non-zero creation fee will be refused by kora.toml (system.allow_transfer = false). Run without KORA_RPC_URL.');

  // 2. Keys: device key (non-extractable WebCrypto) and a throwaway recovery kit.
  const store = createMemoryDeviceKeyStore();
  await createDeviceKey(store, 'e2e');
  const device = await deviceKeySigner(store, 'e2e');
  const kit = deriveRecoveryKey(generateRecoveryWords());
  const kitPub = kit.publicKey;
  kit.destroy();

  // 3. Create the autonomous vault.
  const createKey = Keypair.generate();
  const plan = buildCreateVaultInstruction({
    mode: 'solo',
    members: [{ role: 'admin_device', publicKey: device.publicKey.toBase58() }, { role: 'recovery_kit_a', publicKey: kitPub }],
    createKey: createKey.publicKey,
    feePayer,
    treasury: programConfig.treasury,
    splashKeys: [feePayer.toBase58()],
  });
  console.log('\n1/4 Creating the autonomous Squads vault');
  await send('multisig_create_v2', [plan.instruction], { keypairs: [createKey] });
  const msInfo = await connection.getAccountInfo(plan.multisigPda, 'confirmed');
  if (!msInfo) fail('Multisig account not found after creation');
  assertAutonomous(msInfo.data, { splashKeys: [feePayer.toBase58(), local.publicKey.toBase58()], expectedMembers: [device.publicKey.toBase58(), kitPub], expectedThreshold: 1 });
  const mint = usdcMint(CLUSTER);
  const vaultAta = getAssociatedTokenAddress(mint, plan.vaultPda);
  run.vault = { ...plan.vault, vaultUsdcAccount: vaultAta.toBase58(), explorer: explorerAddressUrl(plan.multisigPda.toBase58(), CLUSTER) };
  save();
  console.log('  ✓ assertAutonomous: configAuthority null, members = device + kit, threshold 1');

  // 4. Fund.
  console.log('\n2/4 Fund the vault with devnet USDC');
  await send('vault_usdc_ata_create', [buildCreateAtaIdempotentInstruction(feePayer, plan.vaultPda, mint)]);
  console.log(`  Vault (owner) address: ${plan.vaultPda.toBase58()}`);
  console.log(`  Vault USDC account:    ${vaultAta.toBase58()}`);
  console.log(`  Get ${amountUsdc * (wantCctp ? 2 : 1)} devnet USDC at https://faucet.circle.com (network: Solana Devnet).`);
  console.log('  If the faucet will not take the vault address (it is a PDA), send devnet USDC from your own wallet to the vault address.');
  const need = amountMinor * (wantCctp ? 2n : 1n);
  const timeoutSec = Number(process.env.SPLASH_E2E_FUND_TIMEOUT_SEC ?? '900');
  const deadline = Date.now() + timeoutSec * 1000;
  let balance = 0n;
  for (;;) {
    try {
      balance = BigInt((await connection.getTokenAccountBalance(vaultAta, 'confirmed')).value.amount);
    } catch {
      balance = 0n;
    }
    if (balance >= need) break;
    if (Date.now() > deadline) fail(`Timed out after ${timeoutSec}s waiting for ${need} USDC minor units in ${vaultAta.toBase58()} (have ${balance})`);
    process.stdout.write(`  waiting… vault holds ${balance} / ${need} USDC minor units\r`);
    await sleep(5000);
  }
  console.log(`\n  ✓ vault funded: ${balance} USDC minor units`);

  // 5. Payout through Squads.
  console.log('\n3/4 Payout: propose, approve (device key), execute (sponsored)');
  const destination = process.env.SPLASH_E2E_DEPOSIT_ADDRESS?.trim() || Keypair.generate().publicKey.toBase58();
  const commitmentHex = createHash('sha256').update(randomBytes(32)).update('splash-e2e-test-invoice').digest('hex');
  const reference = Keypair.generate().publicKey;
  const pay = buildPayoutInstructions({ cluster: CLUSTER, vaultPda: plan.vaultPda, feePayer, destination, expectedDepositAddress: destination, amountMinor, commitmentHex, reference, splashKeys: [feePayer.toBase58(), local.publicKey.toBase58()] });
  let index = BigInt((await multisig.accounts.Multisig.fromAccountAddress(connection, plan.multisigPda)).transactionIndex.toString()) + 1n;
  const proposal = buildVaultProposal({ multisigPda: plan.multisigPda, transactionIndex: index, member: device.publicKey, feePayer, innerInstructions: pay.vaultInstructions });
  const groups = groupProposalTransactions(proposal, feePayer, PublicKey.default.toBase58());
  for (const [i, g] of groups.entries()) await send(`payout_propose_${i + 1}_of_${groups.length}`, g, { devices: [device] });
  const exec = await buildVaultExecuteInstructionFromChain(connection, plan.multisigPda, index, device.publicKey);
  await send('payout_execute', [...pay.preExecuteInstructions, exec.instruction, ...pay.postExecuteInstructions], { devices: [device] });
  const destBal = BigInt((await connection.getTokenAccountBalance(pay.destinationTokenAccount, 'confirmed')).value.amount);
  if (destBal < amountMinor) fail(`Destination holds ${destBal}, expected at least ${amountMinor}`);
  run.payout = { destination, destinationUsdcAccount: pay.destinationTokenAccount.toBase58(), amountMinor: amountMinor.toString(), memo: pay.memo, reference: reference.toBase58(), balanceAfterMinor: destBal.toString() };
  save();
  console.log(`  ✓ partner deposit account holds ${destBal} USDC minor units`);

  // 6. Optional CCTP V2 burn to Polygon Amoy.
  if (wantCctp) {
    console.log('\n4/4 CCTP V2 burn from the vault to Polygon Amoy (UNVERIFIED path: Squads + ephemeral event account)');
    console.log(`  Attempt change: ${cctpChange()}`);
    cctpStage = 'cctp_setup';
    // The vault is event_rent_payer: it needs SOL for the MessageSent account rent. Funded by the
    // local keypair, never by Kora (I-3). This is the open "you don't need SOL" gap for this lane.
    await send('vault_sol_for_cctp_event_rent', [SystemProgram.transfer({ fromPubkey: local.publicKey, toPubkey: plan.vaultPda, lamports: Math.round(0.01 * LAMPORTS_PER_SOL) })], {}, false);
    index = BigInt((await multisig.accounts.Multisig.fromAccountAddress(connection, plan.multisigPda)).transactionIndex.toString()) + 1n;
    const { transactionPda } = deriveProposalAddresses(plan.multisigPda, index, 1);
    const burn = buildDepositForBurnInstruction({ cluster: CLUSTER, vaultPda: plan.vaultPda, transactionPda, amountMinor, mintRecipientEvm: evmRecipient, expectedMintRecipientEvm: evmRecipient, speed: 'standard', feePayer });
    const burnCommitment = createHash('sha256').update(randomBytes(32)).update('splash-e2e-test-invoice-cctp').digest('hex');
    const inner = [burn.instruction, buildMemoInstruction(buildSplashMemo(burnCommitment))];
    const burnProposal = buildVaultProposal({ multisigPda: plan.multisigPda, transactionIndex: index, member: device.publicKey, feePayer, innerInstructions: inner, ephemeralSigners: 1 });
    const bgroups = groupProposalTransactions(burnProposal, feePayer, PublicKey.default.toBase58());
    cctpStage = 'cctp_propose';
    for (const [i, g] of bgroups.entries()) await send(`cctp_propose_${i + 1}_of_${bgroups.length}`, g, { devices: [device] });
    cctpStage = 'cctp_execute';
    const bexec = await buildVaultExecuteInstructionFromChain(connection, plan.multisigPda, index, device.publicKey);
    const burnSig = await send('cctp_deposit_for_burn_execute', [bexec.instruction], { devices: [device] });
    run.cctp = { destinationDomain: 7, mintRecipient: evmRecipient, amountMinor: amountMinor.toString(), messageSentEventData: burn.messageSentEventData.toBase58(), iris: irisMessagesUrl(CLUSTER, burnSig) };
    save();
    console.log(`  Attestation: ${run.cctp.iris}`);
    cctpStage = null;
    const burnAt = Date.now();
    let attestationSec: number | undefined;
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(run.cctp.iris);
        if (res.ok) {
          const body = (await res.json()) as { messages?: Array<{ status?: string }> };
          const status = body.messages?.[0]?.status;
          if (status) run.cctp.attestationStatus = status;
          if (status === 'complete') {
            attestationSec = Math.round((Date.now() - burnAt) / 1000);
            break;
          }
        }
      } catch {
        /* keep polling */
      }
      await sleep(10_000);
    }
    prior.cctpAttempts.push({ at: new Date().toISOString(), outcome: 'ok', change: cctpChange(), burnSignature: burnSig, attestationStatus: run.cctp.attestationStatus, attestationSec });
    save();
    console.log(`  Iris status: ${run.cctp.attestationStatus ?? 'unknown'}. Mint on Amoy with receiveMessage (message + attestation from Iris) from any wallet.`);
  } else {
    console.log('\n4/4 CCTP burn skipped (set SPLASH_E2E_CCTP=1 and SPLASH_E2E_EVM_RECIPIENT=0x… to run it)');
  }

  run.status = 'ok';
  run.finishedAt = new Date().toISOString();
  save();
  console.log(`\nDone. Signatures written to ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => fail((e as Error).stack ?? String(e)));
