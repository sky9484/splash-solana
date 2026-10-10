/**
 * Chain access with one interface and two implementations:
 *   - SolanaSimulator (SPLASH_SOLANA_MODE=offline, the default): no network. Interprets the same
 *     transactions the real path would send (Squads create / propose / approve / execute, ATA create,
 *     transferChecked, CCTP deposit_for_burn, Memo) against an in-memory USDC ledger, so the demo
 *     shows funding and payout moving. Every receipt has `simulated: true` (I-7) and a deterministic
 *     fake signature: base58(sha512(serialized transaction)), 64 bytes like a real one.
 *   - DevnetChain (SPLASH_SOLANA_MODE=devnet): web3.js Connection for reads, Kora for sponsored sends.
 *
 * Both run validateSponsoredTransaction (I-3) before "sending". The simulator also checks every
 * non-fee-payer signature with ed25519 and enforces Squads rules (member permissions, threshold,
 * no execute without approval: I-4), so a flow that passes offline has its signatures in order.
 *
 * Verified vs unverified: the simulator is tested offline. It models Squads/Token/CCTP semantics
 * from their sources but is NOT the real programs: CPI account checks, rent, compute and the
 * Squads creation fee are not modelled. DevnetChain has never run here (no RPC); it is exercised by
 * scripts/solana-devnet-e2e.ts on a laptop.
 */
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import bs58 from 'bs58';

import { PROGRAM_IDS, readSolanaEnv, usdcMint, type SolanaEnv } from './config.ts';
import { decodeDepositForBurn, bytes32ToEvmAddress } from './cctp-v2-solana.ts';
import { createKoraClient, createMemorySponsorUsage, defaultSponsorPolicy, serializeForKora, utcDay, validateSponsoredTransaction, type KoraClient, type SponsorPolicy, type SponsorUsage } from './kora.ts';
import { decodeTransferChecked, getAssociatedTokenAddress, isSplashMemo } from './payout.ts';
import { decodeMultisigAccount, MAX_TRANSACTION_BYTES, type MultisigSummary } from './squads.ts';
import type { ChainReceipt, Cluster, RunMode } from './types.ts';

export interface SendContext {
  orgId?: string;
  now?: Date;
}

export interface ChainClient {
  readonly mode: RunMode;
  readonly cluster: Cluster;
  getFeePayer(): Promise<PublicKey>;
  getLatestBlockhash(): Promise<string>;
  /** Squads ProgramConfig.treasury, needed by multisigCreateV2. */
  getSquadsTreasury(): Promise<PublicKey>;
  getMultisig(multisigPda: PublicKey): Promise<MultisigSummary | null>;
  /** multisig.transactionIndex + 1. */
  getNextTransactionIndex(multisigPda: PublicKey): Promise<bigint>;
  /** USDC minor units held in the owner's associated token account (0 if none). */
  getUsdcBalance(owner: PublicKey | string): Promise<bigint>;
  /** Validate (I-3), let Kora sign as fee payer, send. Throws on refusal or failure. */
  sendSponsored(tx: VersionedTransaction, ctx?: SendContext): Promise<ChainReceipt>;
}

function keyOf(seed: string): PublicKey {
  // 32 bytes from a hash: a valid address that nobody holds a private key for.
  return new PublicKey(sha256(new TextEncoder().encode(seed)));
}

/** Fee payer the simulator pretends Kora uses. No private key exists for it. */
export const SIMULATED_FEE_PAYER = keyOf('splash:simulator:kora-fee-payer:v1');
export const SIMULATED_SQUADS_TREASURY = keyOf('splash:simulator:squads-treasury:v1');

export function simulatedSignature(serializedTx: Uint8Array): string {
  return bs58.encode(sha512(serializedTx));
}

interface SimMultisig {
  threshold: number;
  members: Array<{ key: string; mask: number }>;
  transactionIndex: bigint;
  configAuthority: null;
}
interface SimInnerIx {
  programId: PublicKey;
  keys: PublicKey[];
  data: Uint8Array;
}
interface SimVaultTx {
  multisig: string;
  index: bigint;
  vaultIndex: number;
  instructions: SimInnerIx[];
}
interface SimProposal {
  multisig: string;
  index: bigint;
  approvals: Set<string>;
  status: 'draft' | 'active' | 'approved' | 'executed';
}

export interface SimBurn {
  signature: string;
  amountMinor: bigint;
  destinationDomain: number;
  mintRecipientEvm: string;
  maxFeeMinor: bigint;
  minFinalityThreshold: number;
}

export interface SimEvent {
  signature: string;
  kind: 'fund' | 'multisig_create' | 'propose' | 'approve' | 'execute' | 'transfer' | 'burn' | 'memo' | 'ata_create';
  detail: Record<string, string>;
}

interface SimState {
  balances: Map<string, bigint>;
  accounts: Set<string>;
  multisigs: Map<string, SimMultisig>;
  vaultTxs: Map<string, SimVaultTx>;
  proposals: Map<string, SimProposal>;
}

function cloneState(s: SimState): SimState {
  return {
    balances: new Map(s.balances),
    accounts: new Set(s.accounts),
    multisigs: new Map([...s.multisigs].map(([k, v]) => [k, { ...v, members: [...v.members] }])),
    vaultTxs: new Map(s.vaultTxs),
    proposals: new Map([...s.proposals].map(([k, v]) => [k, { ...v, approvals: new Set(v.approvals) }])),
  };
}

const SQ = multisig.generated;
const DISC = {
  create: Buffer.from(SQ.multisigCreateV2InstructionDiscriminator),
  vtCreate: Buffer.from(SQ.vaultTransactionCreateInstructionDiscriminator),
  propCreate: Buffer.from(SQ.proposalCreateInstructionDiscriminator),
  approve: Buffer.from(SQ.proposalApproveInstructionDiscriminator),
  execute: Buffer.from(SQ.vaultTransactionExecuteInstructionDiscriminator),
};
const PERM = multisig.types.Permission;

export class SolanaSimulator implements ChainClient {
  readonly mode = 'offline' as const;
  readonly events: SimEvent[] = [];
  readonly burns: SimBurn[] = [];
  private state: SimState = { balances: new Map(), accounts: new Set(), multisigs: new Map(), vaultTxs: new Map(), proposals: new Map() };
  private blockhashCounter = 0;
  private readonly mint: PublicKey;
  readonly policy: SponsorPolicy;
  readonly usage: SponsorUsage;

  readonly cluster: Cluster;

  constructor(cluster: Cluster = 'devnet', opts: { policy?: SponsorPolicy; usage?: SponsorUsage } = {}) {
    this.cluster = cluster;
    this.mint = usdcMint(cluster);
    this.policy = opts.policy ?? defaultSponsorPolicy(this.mint.toBase58());
    this.usage = opts.usage ?? createMemorySponsorUsage();
  }

  async getFeePayer() {
    return SIMULATED_FEE_PAYER;
  }

  async getLatestBlockhash() {
    return bs58.encode(sha256(new TextEncoder().encode(`splash:simulator:blockhash:${++this.blockhashCounter}`)));
  }

  async getSquadsTreasury() {
    return SIMULATED_SQUADS_TREASURY;
  }

  async getMultisig(multisigPda: PublicKey): Promise<MultisigSummary | null> {
    const m = this.state.multisigs.get(multisigPda.toBase58());
    if (!m) return null;
    return {
      configAuthority: null,
      threshold: m.threshold,
      timeLock: 0,
      transactionIndex: m.transactionIndex,
      members: m.members.map((x) => ({ publicKey: x.key, mask: x.mask })),
    };
  }

  async getNextTransactionIndex(multisigPda: PublicKey) {
    const m = this.state.multisigs.get(multisigPda.toBase58());
    if (!m) throw new Error('Simulator: unknown multisig');
    return m.transactionIndex + 1n;
  }

  async getUsdcBalance(owner: PublicKey | string) {
    const ata = getAssociatedTokenAddress(this.mint, typeof owner === 'string' ? new PublicKey(owner) : owner);
    return this.state.balances.get(ata.toBase58()) ?? 0n;
  }

  /** Simulated faucet: credit USDC to an owner's ATA (the demo's "fund the vault" step). */
  async fundUsdc(owner: PublicKey | string, amountMinor: bigint): Promise<ChainReceipt> {
    if (amountMinor <= 0n) throw new Error('Simulator: fund amount must be positive');
    const ata = getAssociatedTokenAddress(this.mint, typeof owner === 'string' ? new PublicKey(owner) : owner).toBase58();
    this.state.accounts.add(ata);
    this.state.balances.set(ata, (this.state.balances.get(ata) ?? 0n) + amountMinor);
    const signature = simulatedSignature(new TextEncoder().encode(`fund:${ata}:${amountMinor}:${this.events.length}`));
    this.events.push({ signature, kind: 'fund', detail: { tokenAccount: ata, amountMinor: amountMinor.toString() } });
    return { signature, cluster: this.cluster, simulated: true };
  }

  async sendSponsored(tx: VersionedTransaction, ctx: SendContext = {}): Promise<ChainReceipt> {
    const now = ctx.now ?? new Date();
    const check = validateSponsoredTransaction(tx, SIMULATED_FEE_PAYER, this.policy, { orgId: ctx.orgId ?? 'offline-demo', usage: this.usage, now });
    if (!check.ok) throw new Error(`Sponsorship refused: ${check.reasons.join('; ')}`);
    const bytes = tx.serialize();
    if (bytes.length > MAX_TRANSACTION_BYTES) throw new Error(`Simulator: transaction is ${bytes.length} bytes (> ${MAX_TRANSACTION_BYTES})`);

    const m = tx.message;
    const keys = m.staticAccountKeys;
    const nSig = m.header.numRequiredSignatures;
    const msgBytes = m.serialize();
    const signed = new Set<string>();
    for (let i = 0; i < nSig; i++) {
      const key = keys[i]!;
      if (key.equals(SIMULATED_FEE_PAYER)) {
        signed.add(key.toBase58()); // Kora's slot
        continue;
      }
      const sig = tx.signatures[i]!;
      if (sig.every((b) => b === 0)) throw new Error(`Simulator: missing signature for ${key.toBase58()}`);
      if (!ed25519.verify(sig, msgBytes, key.toBytes())) throw new Error(`Simulator: bad signature for ${key.toBase58()}`);
      signed.add(key.toBase58());
    }

    const signature = simulatedSignature(bytes);
    const next = cloneState(this.state);
    const events: SimEvent[] = [];
    const burns: SimBurn[] = [];
    for (const ci of m.compiledInstructions) {
      const ix: SimInnerIx = { programId: keys[ci.programIdIndex]!, keys: ci.accountKeyIndexes.map((i) => keys[i]!), data: ci.data };
      this.applyTopLevel(next, ix, signed, signature, events, burns);
    }
    this.state = next;
    this.events.push(...events);
    this.burns.push(...burns);
    this.usage.record(ctx.orgId ?? 'offline-demo', utcDay(now));
    return { signature, cluster: this.cluster, simulated: true };
  }

  private memberOf(ms: SimMultisig, key: PublicKey, perm: number) {
    const m = ms.members.find((x) => x.key === key.toBase58());
    return !!m && (m.mask & perm) !== 0;
  }

  private applyTopLevel(s: SimState, ix: SimInnerIx, signed: Set<string>, sig: string, events: SimEvent[], burns: SimBurn[]) {
    const pid = ix.programId;
    if (pid.equals(PROGRAM_IDS.computeBudget)) return;
    if (pid.equals(PROGRAM_IDS.memo)) return this.applyMemo(ix, sig, events);
    if (pid.equals(PROGRAM_IDS.associatedToken)) {
      const [, ata, owner, mint] = ix.keys;
      if (!mint!.equals(this.mint)) throw new Error('Simulator: only USDC ATAs are modelled');
      if (!getAssociatedTokenAddress(mint!, owner!).equals(ata!)) throw new Error('Simulator: ATA address mismatch');
      if (!s.accounts.has(ata!.toBase58())) {
        s.accounts.add(ata!.toBase58());
        events.push({ signature: sig, kind: 'ata_create', detail: { tokenAccount: ata!.toBase58(), owner: owner!.toBase58() } });
      }
      return;
    }
    if (!pid.equals(PROGRAM_IDS.squadsV4)) throw new Error(`Simulator: top-level program ${pid.toBase58()} is not modelled`);

    const head = Buffer.from(ix.data.subarray(0, 8));
    const data = Buffer.from(ix.data);
    if (head.equals(DISC.create)) {
      const [{ args }] = SQ.multisigCreateV2Struct.deserialize(data);
      const msPda = ix.keys[2]!;
      const createKey = ix.keys[3]!;
      if (!signed.has(createKey.toBase58())) throw new Error('Simulator: createKey must sign');
      if (args.configAuthority !== null) throw new Error('Simulator: only autonomous multisigs are modelled');
      if (!multisig.getMultisigPda({ createKey })[0].equals(msPda)) throw new Error('Simulator: multisig PDA mismatch');
      if (s.multisigs.has(msPda.toBase58())) throw new Error('Simulator: multisig already exists');
      s.multisigs.set(msPda.toBase58(), {
        threshold: args.threshold,
        members: args.members.map((x) => ({ key: x.key.toBase58(), mask: x.permissions.mask })),
        transactionIndex: 0n,
        configAuthority: null,
      });
      events.push({ signature: sig, kind: 'multisig_create', detail: { multisig: msPda.toBase58(), threshold: String(args.threshold) } });
      return;
    }
    if (head.equals(DISC.vtCreate)) {
      const [{ args }] = SQ.vaultTransactionCreateStruct.deserialize(data);
      const [msKey, txPda, creator] = ix.keys;
      const ms = s.multisigs.get(msKey!.toBase58());
      if (!ms) throw new Error('Simulator: unknown multisig');
      if (!signed.has(creator!.toBase58()) || !this.memberOf(ms, creator!, PERM.Initiate)) throw new Error('Simulator: creator must be a signing member with Initiate');
      const index = ms.transactionIndex + 1n;
      if (!multisig.getTransactionPda({ multisigPda: msKey!, index })[0].equals(txPda!)) throw new Error('Simulator: transaction PDA / index mismatch');
      const [msg] = multisig.types.transactionMessageBeet.deserialize(Buffer.from(args.transactionMessage));
      const ak: PublicKey[] = msg.accountKeys;
      const instructions = msg.instructions.map((c: { programIdIndex: number; accountIndexes: number[]; data: number[] }) => ({
        programId: ak[c.programIdIndex]!,
        keys: c.accountIndexes.map((i) => ak[i]!),
        data: Uint8Array.from(c.data),
      }));
      ms.transactionIndex = index;
      s.vaultTxs.set(txPda!.toBase58(), { multisig: msKey!.toBase58(), index, vaultIndex: args.vaultIndex, instructions });
      events.push({ signature: sig, kind: 'propose', detail: { transaction: txPda!.toBase58(), index: index.toString() } });
      return;
    }
    if (head.equals(DISC.propCreate)) {
      const [{ args }] = SQ.proposalCreateStruct.deserialize(data);
      const [msKey, propPda, creator] = ix.keys;
      const ms = s.multisigs.get(msKey!.toBase58());
      if (!ms) throw new Error('Simulator: unknown multisig');
      if (!signed.has(creator!.toBase58()) || !ms.members.some((x) => x.key === creator!.toBase58())) throw new Error('Simulator: proposal creator must be a signing member');
      const index = BigInt(args.transactionIndex.toString());
      if (!multisig.getProposalPda({ multisigPda: msKey!, transactionIndex: index })[0].equals(propPda!)) throw new Error('Simulator: proposal PDA mismatch');
      if (s.proposals.has(propPda!.toBase58())) throw new Error('Simulator: proposal exists');
      s.proposals.set(propPda!.toBase58(), { multisig: msKey!.toBase58(), index, approvals: new Set(), status: args.draft ? 'draft' : 'active' });
      return;
    }
    if (head.equals(DISC.approve)) {
      const [msKey, member, propPda] = ix.keys;
      const ms = s.multisigs.get(msKey!.toBase58());
      const prop = s.proposals.get(propPda!.toBase58());
      if (!ms || !prop) throw new Error('Simulator: unknown multisig or proposal');
      if (!signed.has(member!.toBase58()) || !this.memberOf(ms, member!, PERM.Vote)) throw new Error('Simulator: approver must be a signing member with Vote');
      if (prop.status === 'executed' || prop.status === 'draft') throw new Error(`Simulator: proposal is ${prop.status}`);
      prop.approvals.add(member!.toBase58());
      if (prop.approvals.size >= ms.threshold) prop.status = 'approved';
      events.push({ signature: sig, kind: 'approve', detail: { proposal: propPda!.toBase58(), approvals: String(prop.approvals.size), threshold: String(ms.threshold) } });
      return;
    }
    if (head.equals(DISC.execute)) {
      const [msKey, propPda, txPda, member] = ix.keys;
      const ms = s.multisigs.get(msKey!.toBase58());
      const prop = s.proposals.get(propPda!.toBase58());
      const vt = s.vaultTxs.get(txPda!.toBase58());
      if (!ms || !prop || !vt) throw new Error('Simulator: unknown multisig, proposal or transaction');
      if (!signed.has(member!.toBase58()) || !this.memberOf(ms, member!, PERM.Execute)) throw new Error('Simulator: executor must be a signing member with Execute');
      if (prop.status !== 'approved') throw new Error('Simulator: proposal is not approved (I-4: a person must approve)');
      if (prop.index !== vt.index) throw new Error('Simulator: proposal / transaction mismatch');
      const [vaultPda] = multisig.getVaultPda({ multisigPda: msKey!, index: vt.vaultIndex });
      for (const inner of vt.instructions) this.applyInner(s, inner, vaultPda, sig, events, burns);
      prop.status = 'executed';
      events.push({ signature: sig, kind: 'execute', detail: { transaction: txPda!.toBase58() } });
      return;
    }
    throw new Error('Simulator: Squads instruction not modelled');
  }

  private applyMemo(ix: SimInnerIx, sig: string, events: SimEvent[]) {
    const memo = Buffer.from(ix.data).toString('utf8');
    if (!isSplashMemo(memo)) throw new Error('Simulator: memo is not a Splash commitment memo (I-5)');
    events.push({ signature: sig, kind: 'memo', detail: { memo } });
  }

  private applyInner(s: SimState, ix: SimInnerIx, vaultPda: PublicKey, sig: string, events: SimEvent[], burns: SimBurn[]) {
    const pid = ix.programId;
    if (pid.equals(PROGRAM_IDS.memo)) return this.applyMemo(ix, sig, events);
    if (pid.equals(PROGRAM_IDS.token)) {
      const { amount, decimals } = decodeTransferChecked(ix.data);
      const [src, mint, dst, owner] = ix.keys;
      if (!mint!.equals(this.mint) || decimals !== 6) throw new Error('Simulator: only USDC transferChecked is modelled');
      if (!owner!.equals(vaultPda)) throw new Error('Simulator: transfer owner must be the vault');
      if (!getAssociatedTokenAddress(this.mint, vaultPda).equals(src!)) throw new Error('Simulator: source must be the vault ATA');
      if (!s.accounts.has(dst!.toBase58())) throw new Error('Simulator: destination token account does not exist');
      const bal = s.balances.get(src!.toBase58()) ?? 0n;
      if (bal < amount) throw new Error('Simulator: insufficient USDC in the vault');
      s.balances.set(src!.toBase58(), bal - amount);
      s.balances.set(dst!.toBase58(), (s.balances.get(dst!.toBase58()) ?? 0n) + amount);
      events.push({ signature: sig, kind: 'transfer', detail: { from: src!.toBase58(), to: dst!.toBase58(), amountMinor: amount.toString() } });
      return;
    }
    if (pid.equals(PROGRAM_IDS.cctpTokenMessengerMinterV2)) {
      const d = decodeDepositForBurn(ix.data);
      const owner = ix.keys[0]!;
      const burnAccount = ix.keys[3]!;
      if (!owner.equals(vaultPda) || !ix.keys[1]!.equals(vaultPda)) throw new Error('Simulator: burn owner and event rent payer must be the vault');
      const bal = s.balances.get(burnAccount.toBase58()) ?? 0n;
      if (bal < d.amount) throw new Error('Simulator: insufficient USDC to burn');
      s.balances.set(burnAccount.toBase58(), bal - d.amount);
      const burn: SimBurn = {
        signature: sig,
        amountMinor: d.amount,
        destinationDomain: d.destinationDomain,
        mintRecipientEvm: bytes32ToEvmAddress(d.mintRecipient),
        maxFeeMinor: d.maxFee,
        minFinalityThreshold: d.minFinalityThreshold,
      };
      burns.push(burn);
      events.push({ signature: sig, kind: 'burn', detail: { amountMinor: d.amount.toString(), destinationDomain: String(d.destinationDomain), mintRecipient: burn.mintRecipientEvm } });
      return;
    }
    throw new Error(`Simulator: inner program ${pid.toBase58()} is not modelled`);
  }
}

/* ---------------------------------------------------------------- devnet */

export class DevnetChain implements ChainClient {
  readonly mode = 'devnet' as const;
  readonly connection: Connection;
  private readonly kora: KoraClient | null;
  private feePayer: PublicKey | null = null;
  private readonly mint: PublicKey;
  readonly policy: SponsorPolicy;
  readonly usage: SponsorUsage;

  readonly cluster: Cluster;

  constructor(
    cluster: Cluster,
    rpcUrl: string,
    koraRpcUrl: string | null,
    opts: { kora?: KoraClient; policy?: SponsorPolicy; usage?: SponsorUsage; koraApiKey?: string } = {},
  ) {
    this.cluster = cluster;
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.kora = opts.kora ?? (koraRpcUrl ? createKoraClient({ rpcUrl: koraRpcUrl, apiKey: opts.koraApiKey }) : null);
    this.mint = usdcMint(cluster);
    this.policy = opts.policy ?? defaultSponsorPolicy(this.mint.toBase58());
    this.usage = opts.usage ?? createMemorySponsorUsage();
  }

  private requireKora(): KoraClient {
    if (!this.kora) throw new Error('KORA_RPC_URL is not set: devnet mode cannot sponsor transactions');
    return this.kora;
  }

  async getFeePayer() {
    if (!this.feePayer) this.feePayer = new PublicKey((await this.requireKora().getPayerSigner()).signer_address);
    return this.feePayer;
  }

  async getLatestBlockhash() {
    return (await this.connection.getLatestBlockhash('confirmed')).blockhash;
  }

  async getSquadsTreasury() {
    const [pda] = multisig.getProgramConfigPda({});
    const cfg = await multisig.accounts.ProgramConfig.fromAccountAddress(this.connection, pda);
    return cfg.treasury;
  }

  async getMultisig(multisigPda: PublicKey) {
    const info = await this.connection.getAccountInfo(multisigPda, 'confirmed');
    return info ? decodeMultisigAccount(info.data) : null;
  }

  async getNextTransactionIndex(multisigPda: PublicKey) {
    const ms = await this.getMultisig(multisigPda);
    if (!ms) throw new Error(`Multisig ${multisigPda.toBase58()} not found`);
    return ms.transactionIndex + 1n;
  }

  async getUsdcBalance(owner: PublicKey | string) {
    const ata = getAssociatedTokenAddress(this.mint, typeof owner === 'string' ? new PublicKey(owner) : owner);
    try {
      const r = await this.connection.getTokenAccountBalance(ata, 'confirmed');
      return BigInt(r.value.amount);
    } catch (e) {
      if (/could not find account|Invalid param/i.test(String(e))) return 0n;
      throw e;
    }
  }

  async sendSponsored(tx: VersionedTransaction, ctx: SendContext = {}): Promise<ChainReceipt> {
    const feePayer = await this.getFeePayer();
    const now = ctx.now ?? new Date();
    const orgId = ctx.orgId;
    if (!orgId) throw new Error('orgId is required to send a sponsored transaction');
    const check = validateSponsoredTransaction(tx, feePayer, this.policy, { orgId, usage: this.usage, now });
    if (!check.ok) throw new Error(`Sponsorship refused: ${check.reasons.join('; ')}`);
    const res = await this.requireKora().signAndSendTransaction({ transaction: serializeForKora(tx), user_id: orgId });
    this.usage.record(orgId, utcDay(now));
    return { signature: res.signature, cluster: this.cluster, simulated: false };
  }
}

/* ---------------------------------------------------------------- factory */

let singleton: { key: string; client: ChainClient } | null = null;

export function createChain(env: SolanaEnv): ChainClient {
  return env.mode === 'offline' ? new SolanaSimulator(env.cluster) : new DevnetChain(env.cluster, env.rpcUrl, env.koraRpcUrl);
}

/** Process-wide chain client for the current env. Offline returns one shared simulator (one ledger). */
export function chain(envSource: NodeJS.ProcessEnv = process.env): ChainClient {
  const env = readSolanaEnv(envSource);
  const key = `${env.mode}|${env.cluster}|${env.rpcUrl}|${env.koraRpcUrl ?? ''}`;
  if (!singleton || singleton.key !== key) singleton = { key, client: createChain(env) };
  return singleton.client;
}

/** Tests only: drop the shared client (and the offline ledger). */
export function resetChain(): void {
  singleton = null;
}
