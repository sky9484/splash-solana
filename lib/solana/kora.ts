/**
 * Kora fee sponsorship: a local validator that enforces I-3 before a transaction is sent to Kora,
 * per-org daily caps, and a thin Kora JSON-RPC client.
 *
 * Rules (validateSponsoredTransaction, top-level instructions):
 *   1. The fee payer is account 0 and a signer. No address lookup tables (so every key is visible).
 *   2. Every program is on the allowlist: System, SPL Token, ATA, Memo, Squads V4, CCTP V2 (both),
 *      SAS, ComputeBudget. Kora itself checks the allowlist against inner (CPI) instructions too.
 *   3. The fee payer never sends SOL or tokens: no top-level System instruction at all (System is
 *      allowlisted only because ATA/Squads/CCTP reach it by CPI to create accounts); the fee payer
 *      never appears in any SPL Token, CCTP, Memo or Squads-execute instruction; its own USDC token
 *      account is never touched.
 *   4. The fee payer may appear only in rent-payer slots: ATA Create/CreateIdempotent `payer`,
 *      Squads multisigCreateV2 `creator`, vaultTransactionCreate / proposalCreate `rentPayer`, and SAS
 *      instructions (the evidence layer's own attestation). It may never be the wallet of an ATA.
 *   5. Squads: only multisigCreateV2 (autonomous: configAuthority null, fee payer not a member),
 *      vaultTransactionCreate (fee payer absent from the inner message), proposalCreate,
 *      proposalApprove and vaultTransactionExecute (fee payer absent from remaining accounts, since
 *      Squads forwards outer signer privileges into the inner instructions).
 *   6. ComputeBudget: limit, price, heap, loaded-data only; priority fee capped.
 *
 * DEVIATION from SPEC wording "System for ATA rent only": a Squads vault needs rent for its multisig,
 * transaction and proposal accounts and the vault holds no SOL, so the fee payer also pays that rent
 * (named Squads slots only). It still never transfers SOL or tokens to anyone. Squads
 * multisigCreateV2 additionally charges ProgramConfig.multisigCreationFee from the creator; that is a
 * real SOL transfer from the fee payer if non-zero. kora.toml sets system.allow_transfer = false so
 * Kora's simulation-based check refuses it; the e2e script also reads the fee first.
 *
 * Verified vs unverified:
 *   - Method names (signAndSendTransaction, signTransaction, getConfig, getPayerSigner), request
 *     fields (transaction, signer_key, sig_verify, user_id) and response fields (signature,
 *     signed_transaction, signer_pubkey) and auth headers (x-api-key, x-timestamp + x-hmac-signature
 *     = hex HMAC-SHA256(timestamp || body)) were read from solana-foundation/kora at commit cbef22d
 *     (9 Oct 2026): crates/lib/src/rpc_server/method/*.rs, sdks/ts/src/client.ts, constant.rs.
 *     Never called against a running Kora (no network here): UNVERIFIED end to end.
 *   - That Kora's fee_payer_policy catches a CPI System transfer out of the fee payer is read from
 *     source (it simulates and validates inner instructions), not observed.
 */
import { PublicKey, Transaction, VersionedTransaction, type MessageCompiledInstruction } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { SOLANA_PROGRAMS } from './config.ts';
import { getAssociatedTokenAddress } from './payout.ts';

export interface SponsorPolicy {
  allowedPrograms: string[];
  /** Max signatures per transaction (Kora: validation.max_signatures). */
  maxSignatures: number;
  /** Max priority fee per transaction in lamports. */
  maxPriorityFeeLamports: bigint;
  /** Sponsored transactions per org per UTC day. */
  perOrgDailyTxCap: number;
  /** Mints whose fee-payer token account must never be touched. */
  protectedMints: string[];
}

export const SPONSOR_ALLOWED_PROGRAMS: readonly string[] = [
  SOLANA_PROGRAMS.system,
  SOLANA_PROGRAMS.token,
  SOLANA_PROGRAMS.associatedToken,
  SOLANA_PROGRAMS.memo,
  SOLANA_PROGRAMS.squadsV4,
  SOLANA_PROGRAMS.cctpMessageTransmitterV2,
  SOLANA_PROGRAMS.cctpTokenMessengerMinterV2,
  SOLANA_PROGRAMS.sas,
  SOLANA_PROGRAMS.computeBudget,
];

export function defaultSponsorPolicy(usdcMint: string): SponsorPolicy {
  return {
    allowedPrograms: [...SPONSOR_ALLOWED_PROGRAMS],
    maxSignatures: 4,
    maxPriorityFeeLamports: 100_000n,
    perOrgDailyTxCap: 50,
    protectedMints: [usdcMint],
  };
}

export interface SponsorCheck {
  ok: boolean;
  reasons: string[];
}

/** Per-org daily counter. In-memory; production should back this with the app database. */
export interface SponsorUsage {
  count(orgId: string, day: string): number;
  record(orgId: string, day: string): void;
}

export function createMemorySponsorUsage(): SponsorUsage {
  const counts = new Map<string, number>();
  return {
    count: (orgId, day) => counts.get(`${orgId}|${day}`) ?? 0,
    record: (orgId, day) => {
      const k = `${orgId}|${day}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    },
  };
}

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export interface SponsorContext {
  orgId?: string;
  usage?: SponsorUsage;
  now?: Date;
}

const SQUADS = {
  multisigCreateV2: Buffer.from(multisig.generated.multisigCreateV2InstructionDiscriminator),
  vaultTransactionCreate: Buffer.from(multisig.generated.vaultTransactionCreateInstructionDiscriminator),
  proposalCreate: Buffer.from(multisig.generated.proposalCreateInstructionDiscriminator),
  proposalApprove: Buffer.from(multisig.generated.proposalApproveInstructionDiscriminator),
  vaultTransactionExecute: Buffer.from(multisig.generated.vaultTransactionExecuteInstructionDiscriminator),
};
/** Account index where the fee payer may sit, per Squads instruction (from the generated builders). */
const SQUADS_FEE_PAYER_SLOT: Record<string, number | null> = {
  multisigCreateV2: 4, // creator
  vaultTransactionCreate: 3, // rentPayer
  proposalCreate: 3, // rentPayer
  proposalApprove: null,
  vaultTransactionExecute: null,
};

function squadsKind(data: Uint8Array): keyof typeof SQUADS | null {
  const head = Buffer.from(data.subarray(0, 8));
  for (const [k, d] of Object.entries(SQUADS)) if (head.equals(d)) return k as keyof typeof SQUADS;
  return null;
}

interface FlatIx {
  programId: PublicKey;
  keys: PublicKey[];
  data: Uint8Array;
}

function flatten(tx: VersionedTransaction | Transaction): { feePayer: PublicKey | null; signerCount: number; lookups: number; ixs: FlatIx[]; signerKeys: PublicKey[] } {
  if (tx instanceof VersionedTransaction) {
    const m = tx.message;
    const keys = m.staticAccountKeys;
    const ixs = m.compiledInstructions.map((ci: MessageCompiledInstruction) => ({
      programId: keys[ci.programIdIndex]!,
      keys: ci.accountKeyIndexes.map((i) => keys[i] ?? PublicKey.default),
      data: ci.data,
    }));
    return {
      feePayer: keys[0] ?? null,
      signerCount: m.header.numRequiredSignatures,
      lookups: m.addressTableLookups.length,
      ixs,
      signerKeys: keys.slice(0, m.header.numRequiredSignatures),
    };
  }
  const legacy = tx as Transaction;
  const compiled = legacy.compileMessage();
  return {
    feePayer: compiled.accountKeys[0] ?? null,
    signerCount: compiled.header.numRequiredSignatures,
    lookups: 0,
    ixs: legacy.instructions.map((ix) => ({ programId: ix.programId, keys: ix.keys.map((k) => k.pubkey), data: ix.data })),
    signerKeys: compiled.accountKeys.slice(0, compiled.header.numRequiredSignatures),
  };
}

/**
 * Enforce I-3 locally. Returns every reason it refuses, not just the first, so a log line explains
 * the whole problem. A transaction this refuses is never sent to Kora.
 */
export function validateSponsoredTransaction(
  tx: VersionedTransaction | Transaction,
  feePayerInput: PublicKey | string,
  policy: SponsorPolicy,
  ctx: SponsorContext = {},
): SponsorCheck {
  const reasons: string[] = [];
  const feePayer = typeof feePayerInput === 'string' ? new PublicKey(feePayerInput) : feePayerInput;
  const f = flatten(tx);
  const allowed = new Set(policy.allowedPrograms);
  const protectedAccounts = policy.protectedMints.map((m) => getAssociatedTokenAddress(new PublicKey(m), feePayer));

  if (!f.feePayer || !f.feePayer.equals(feePayer)) reasons.push('fee payer is not account 0');
  if (f.lookups > 0) reasons.push('address lookup tables are not allowed in sponsored transactions');
  if (f.signerCount > policy.maxSignatures) reasons.push(`too many signatures (${f.signerCount} > ${policy.maxSignatures})`);
  if (f.ixs.length === 0) reasons.push('empty transaction');

  let cuLimit: bigint | null = null;
  let cuPrice = 0n;

  f.ixs.forEach((ix, n) => {
    const pid = ix.programId.toBase58();
    const where = `ix ${n} (${pid.slice(0, 8)}…)`;
    if (!allowed.has(pid)) {
      reasons.push(`${where}: program not allowlisted`);
      return;
    }
    const feePayerSlots = ix.keys.map((k, i) => (k.equals(feePayer) ? i : -1)).filter((i) => i >= 0);
    if (ix.keys.some((k) => protectedAccounts.some((p) => p.equals(k)))) reasons.push(`${where}: touches the fee payer's own token account`);

    switch (pid) {
      case SOLANA_PROGRAMS.system:
        reasons.push(`${where}: top-level System instructions are not sponsored (the fee payer never sends SOL)`);
        break;
      case SOLANA_PROGRAMS.token:
        if (feePayerSlots.length) reasons.push(`${where}: fee payer appears in an SPL Token instruction`);
        break;
      case SOLANA_PROGRAMS.associatedToken: {
        const tag = ix.data.length === 0 ? 0 : ix.data[0]!;
        if (tag !== 0 && tag !== 1) reasons.push(`${where}: only ATA Create/CreateIdempotent is sponsored`);
        if (ix.keys[2]?.equals(feePayer)) reasons.push(`${where}: fee payer cannot own a sponsored ATA`);
        if (feePayerSlots.some((i) => i !== 0)) reasons.push(`${where}: fee payer may only be the ATA rent payer`);
        break;
      }
      case SOLANA_PROGRAMS.memo:
        if (feePayerSlots.length) reasons.push(`${where}: fee payer cannot sign a memo`);
        break;
      case SOLANA_PROGRAMS.cctpMessageTransmitterV2:
      case SOLANA_PROGRAMS.cctpTokenMessengerMinterV2:
        if (feePayerSlots.length) reasons.push(`${where}: fee payer appears in a CCTP instruction`);
        break;
      case SOLANA_PROGRAMS.sas:
        // The evidence layer's attestation: the fee payer may pay its rent. Not position-checked.
        break;
      case SOLANA_PROGRAMS.computeBudget: {
        const tag = ix.data[0];
        const b = Buffer.from(ix.data);
        if (tag === 2 && b.length >= 5) cuLimit = BigInt(b.readUInt32LE(1));
        else if (tag === 3 && b.length >= 9) cuPrice = b.readBigUInt64LE(1);
        else if (tag !== 1 && tag !== 4) reasons.push(`${where}: compute budget instruction ${String(tag)} not allowed`);
        break;
      }
      case SOLANA_PROGRAMS.squadsV4: {
        const kind = squadsKind(ix.data);
        if (!kind) {
          reasons.push(`${where}: Squads instruction not sponsored`);
          break;
        }
        const slot = SQUADS_FEE_PAYER_SLOT[kind];
        if (feePayerSlots.some((i) => i !== slot)) reasons.push(`${where}: fee payer in a non-rent slot of Squads ${kind}`);
        try {
          if (kind === 'multisigCreateV2') {
            const [{ args }] = multisig.generated.multisigCreateV2Struct.deserialize(Buffer.from(ix.data));
            if (args.configAuthority !== null) reasons.push(`${where}: multisig must be autonomous (configAuthority null)`);
            if (args.members.some((m) => m.key.equals(feePayer))) reasons.push(`${where}: fee payer cannot be a vault member (I-1)`);
          } else if (kind === 'vaultTransactionCreate') {
            const [{ args }] = multisig.generated.vaultTransactionCreateStruct.deserialize(Buffer.from(ix.data));
            const [inner] = multisig.types.transactionMessageBeet.deserialize(Buffer.from(args.transactionMessage));
            if (inner.accountKeys.some((k: PublicKey) => k.equals(feePayer))) reasons.push(`${where}: fee payer appears inside the vault transaction`);
          }
        } catch {
          reasons.push(`${where}: could not decode Squads ${kind}`);
        }
        break;
      }
    }
  });

  if (cuPrice > 0n) {
    const limit = cuLimit ?? 200_000n * BigInt(f.ixs.length);
    const lamports = (cuPrice * limit + 999_999n) / 1_000_000n;
    if (lamports > policy.maxPriorityFeeLamports) reasons.push(`priority fee ${lamports} lamports exceeds cap ${policy.maxPriorityFeeLamports}`);
  }

  if (ctx.usage) {
    if (!ctx.orgId) reasons.push('orgId is required for capped sponsorship');
    else if (ctx.usage.count(ctx.orgId, utcDay(ctx.now ?? new Date())) >= policy.perOrgDailyTxCap) {
      reasons.push(`org ${ctx.orgId} reached its daily sponsored-transaction cap (${policy.perOrgDailyTxCap})`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export function assertSponsorable(tx: VersionedTransaction | Transaction, feePayer: PublicKey | string, policy: SponsorPolicy, ctx: SponsorContext = {}): void {
  const r = validateSponsoredTransaction(tx, feePayer, policy, ctx);
  if (!r.ok) throw new Error(`Sponsorship refused: ${r.reasons.join('; ')}`);
}

/* ---------------------------------------------------------------- JSON-RPC client */

export interface KoraClientOptions {
  rpcUrl: string;
  apiKey?: string;
  hmacSecret?: string;
  fetchImpl?: typeof fetch;
}

export class KoraRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(`Kora error ${code}: ${message}`);
    this.code = code;
    this.data = data;
  }
}

export interface KoraSignRequest {
  /** base64 serialized transaction (partially signed). */
  transaction: string;
  signer_key?: string;
  sig_verify?: boolean;
  /** Org id for Kora's own usage limits. */
  user_id?: string;
}

export interface KoraSignAndSendResponse {
  signature: string;
  signed_transaction: string;
  signer_pubkey: string;
}

export interface KoraSignResponse {
  signed_transaction: string;
  signer_pubkey: string;
  lighthouse_assertion_added?: boolean;
}

export interface KoraClient {
  getConfig(): Promise<Record<string, unknown>>;
  getPayerSigner(): Promise<{ signer_address: string; payment_address: string }>;
  signTransaction(req: KoraSignRequest): Promise<KoraSignResponse>;
  signAndSendTransaction(req: KoraSignRequest): Promise<KoraSignAndSendResponse>;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createKoraClient(opts: KoraClientOptions): KoraClient {
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  let id = 0;
  async function call<T>(method: string, params?: unknown): Promise<T> {
    const body = JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.apiKey) headers['x-api-key'] = opts.apiKey;
    if (opts.hmacSecret) {
      const ts = Math.floor(Date.now() / 1000).toString();
      headers['x-timestamp'] = ts;
      headers['x-hmac-signature'] = hex(hmac(sha256, new TextEncoder().encode(opts.hmacSecret), new TextEncoder().encode(ts + body)));
    }
    const res = await doFetch(opts.rpcUrl, { method: 'POST', headers, body });
    if (!res.ok) throw new KoraRpcError(res.status, `HTTP ${res.status}`);
    const json = (await res.json()) as { result?: T; error?: { code: number; message: string; data?: unknown } };
    if (json.error) throw new KoraRpcError(json.error.code, json.error.message, json.error.data);
    if (json.result === undefined) throw new KoraRpcError(-32603, 'empty result');
    return json.result;
  }
  return {
    getConfig: () => call('getConfig'),
    getPayerSigner: () => call('getPayerSigner'),
    signTransaction: (req) => call('signTransaction', req),
    signAndSendTransaction: (req) => call('signAndSendTransaction', req),
  };
}

export function serializeForKora(tx: VersionedTransaction | Transaction): string {
  const bytes = tx instanceof VersionedTransaction ? tx.serialize() : (tx as Transaction).serialize({ requireAllSignatures: false, verifySignatures: false });
  return Buffer.from(bytes).toString('base64');
}
