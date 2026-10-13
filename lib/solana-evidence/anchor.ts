/**
 * Anchoring a batch root on Solana. Builds instructions and bytes only;
 * sending is the chain layer's job (lib/solana/*), through Kora or not.
 *
 * (a) SAS attestation (program 22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG)
 *     schema  splash.evidence.root.v2
 *             { root: bytes32, count: u32, period_start: i64, period_end: i64, walrus_blob_ids_root: string }
 *     walrus_blob_ids_root is 64 lowercase hex: sha256 over the batch's sorted
 *     Walrus blob ids (bundle.ts walrusBlobIdsRoot). v1 carried a digest from
 *     the earlier build in that slot; SAS schemas are immutable, so the field
 *     change is a new schema name, and v1 was never created on devnet.
 *     SAS has no fixed-size byte array type, so `root` uses VecU8 (layout 13)
 *     holding exactly 32 bytes; this module and verify.ts enforce the length.
 *     Signed by a Splash ATTESTER key that is the credential's authority and
 *     sole authorised signer. It pays fees and the attestation's rent and is
 *     never a member of any client vault, so it cannot move client funds
 *     (`assertAttesterIsolated` checks this against a VaultInfo).
 *
 * (b) SPL Memo fallback: `splash:root:v1:<rootHex>:<count>`, signed by the
 *     attester. Carries a hash and a count, never invoice data (I-5).
 *
 * Verification status (see the report in the PR, and tests):
 *   VERIFIED OFFLINE  instruction bytes round-trip through sas-lib 1.0.10's
 *                     own encoders/decoders; PDAs use sas-lib's derivations;
 *                     the attestation data passes a port of the program's
 *                     `validate_data`; expiry 0 = never expires and schema
 *                     version 1 are taken from the SAS program source (master).
 *   UNVERIFIED        acceptance by the DEPLOYED devnet program, rent amounts,
 *                     and whether the credential/schema accounts already exist.
 *                     Existence needs RPC: the chain layer must check
 *                     `credentialPda` / `schemaPda` and pass `setup` flags. No
 *                     function here reads the network.
 */
import {
  AccountRole,
  address,
  createNoopSigner,
  getAddressDecoder,
  type Address,
  type Instruction,
} from '@solana/kit';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
  deriveAttestationPda,
  deriveCredentialPda,
  deriveSchemaPda,
  getCreateAttestationInstruction,
  getCreateCredentialInstruction,
  getCreateSchemaInstruction,
  serializeAttestationData,
  type Schema,
} from 'sas-lib';

import type { VaultInfo } from '../solana/types.ts';
import type { EvidenceBatch } from './bundle.ts';
import { EvidenceError } from './bundle.ts';

export const SAS_PROGRAM_ID = '22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG';
export const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const DEFAULT_CREDENTIAL_NAME = 'splash-evidence';
export const ROOT_SCHEMA_NAME = 'splash.evidence.root.v2';
export const ROOT_SCHEMA_VERSION = 1;
export const ROOT_SCHEMA_DESCRIPTION = 'Splash evidence batch root over kind-3 bundles for a period, bound to its Walrus blobs';
/** SAS compact layout: VecU8, U32, I64, I64, String. */
export const ROOT_SCHEMA_LAYOUT = Uint8Array.from([13, 2, 8, 8, 12]);
export const ROOT_SCHEMA_FIELDS = ['root', 'count', 'period_start', 'period_end', 'walrus_blob_ids_root'] as const;
export const NONCE_DOMAIN = 'splash.evidence.nonce.v1';

if (SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS !== SAS_PROGRAM_ID) {
  throw new Error(`sas-lib program address changed: ${SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS}`);
}

export interface RootAttestationData {
  rootHex: string;
  count: number;
  periodStart: bigint;
  periodEnd: bigint;
  /** sha256 over the batch's sorted Walrus blob ids, lowercase hex. */
  walrusBlobIdsRoot: string;
}

function assertRootData(d: RootAttestationData): void {
  if (!/^[0-9a-f]{64}$/.test(d.rootHex)) throw new EvidenceError('root must be 32-byte lowercase hex');
  if (!Number.isInteger(d.count) || d.count < 1 || d.count > 0xffffffff) throw new EvidenceError('count must be a u32 ≥ 1');
  const I64 = 2n ** 63n;
  for (const v of [d.periodStart, d.periodEnd]) if (v < -I64 || v >= I64) throw new EvidenceError('period out of i64 range');
  if (d.periodEnd <= d.periodStart) throw new EvidenceError('period end must be after start');
  if (!/^[0-9a-f]{64}$/.test(d.walrusBlobIdsRoot)) throw new EvidenceError('walrus_blob_ids_root must be 32-byte lowercase hex');
}

function joinedVecs(items: readonly string[]): Uint8Array {
  return concatBytes(
    ...items.flatMap((s) => {
      const b = utf8ToBytes(s);
      const len = new Uint8Array(4);
      new DataView(len.buffer).setUint32(0, b.length, true);
      return [len, b];
    }),
  );
}

/** The Schema account as SAS stores it, built locally (no RPC) for sas-lib's serializer. */
export function rootSchemaAccount(credential: string): Schema {
  return {
    discriminator: 1,
    credential: address(credential),
    name: utf8ToBytes(ROOT_SCHEMA_NAME),
    description: utf8ToBytes(ROOT_SCHEMA_DESCRIPTION),
    layout: ROOT_SCHEMA_LAYOUT,
    fieldNames: joinedVecs(ROOT_SCHEMA_FIELDS),
    isPaused: false,
    version: ROOT_SCHEMA_VERSION,
  };
}

/** Borsh bytes of the attestation data via sas-lib. */
export function encodeRootAttestationData(d: RootAttestationData, credential = '11111111111111111111111111111111'): Uint8Array {
  assertRootData(d);
  return serializeAttestationData(rootSchemaAccount(credential), {
    root: hexToBytes(d.rootHex),
    count: d.count,
    period_start: d.periodStart,
    period_end: d.periodEnd,
    walrus_blob_ids_root: d.walrusBlobIdsRoot,
  });
}

/**
 * Port of the SAS program's `Attestation::validate_data` for the layout types
 * this schema uses (and the fixed-size ones). Lets us check bytes offline the
 * way the program will.
 */
export function validateSasDataLayout(layout: Uint8Array, data: Uint8Array): boolean {
  const fixed: Record<number, number> = { 0: 1, 5: 1, 10: 1, 1: 2, 6: 2, 2: 4, 7: 4, 11: 4, 3: 8, 8: 8, 4: 16, 9: 16 };
  const vecElem: Record<number, number> = { 12: 1, 13: 1, 18: 1, 23: 1, 14: 2, 19: 2, 15: 4, 20: 4, 24: 4, 16: 8, 21: 8, 17: 16, 22: 16 };
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  for (const t of layout) {
    let size: number;
    if (t in fixed) size = fixed[t];
    else if (t in vecElem) {
      if (offset + 4 > data.length) return false;
      size = 4 + view.getUint32(offset, true) * vecElem[t];
    } else return false; // VecString not used here
    const end = offset + size;
    if (end > data.length) return false;
    if (t === 10 && data[offset] > 1) return false;
    if (t === 23 && data.slice(offset + 4, end).some((b) => b > 1)) return false;
    offset = end;
  }
  return offset === data.length;
}

/** Deterministic nonce per root: one attestation per root, a replay fails on the existing PDA. */
export function rootNonce(rootHex: string): Address {
  const bytes = sha256(concatBytes(utf8ToBytes(NONCE_DOMAIN), Uint8Array.of(0), hexToBytes(rootHex)));
  return getAddressDecoder().decode(bytes);
}

export interface SasAnchorParams {
  /** Splash attester public key (base58). */
  attester: string;
  /** Fee/rent payer. Defaults to the attester. */
  payer?: string;
  credentialName?: string;
  batch: Pick<EvidenceBatch, 'rootHex' | 'count' | 'periodStart' | 'periodEnd'>;
  /** walrusBlobIdsRoot(...) over the batch's stored blobs (bundle.ts). Required: an anchor binds its blobs. */
  walrusBlobIdsRoot: string;
  /** Which one-time setup instructions to include. The chain layer decides after checking accounts over RPC. */
  setup?: { createCredential?: boolean; createSchema?: boolean };
  /** Unix seconds; 0 = never expires. */
  expiry?: bigint;
}

export interface SasAnchorPlan {
  method: 'sas';
  programAddress: string;
  attester: string;
  payer: string;
  credentialPda: string;
  schemaPda: string;
  attestationPda: string;
  nonce: string;
  data: RootAttestationData;
  dataBytes: Uint8Array;
  /** In send order: [createCredential?, createSchema?, createAttestation]. @solana/kit Instructions. */
  instructions: Instruction[];
  verification: { offline: string[]; unverified: string[] };
}

export async function buildSasAnchor(params: SasAnchorParams): Promise<SasAnchorPlan> {
  const attesterAddr = address(params.attester);
  const payerAddr = address(params.payer ?? params.attester);
  const credentialName = params.credentialName ?? DEFAULT_CREDENTIAL_NAME;
  if (utf8ToBytes(credentialName).length > 32 || utf8ToBytes(ROOT_SCHEMA_NAME).length > 32) throw new EvidenceError('SAS seed names must be ≤ 32 bytes');
  const data: RootAttestationData = {
    rootHex: params.batch.rootHex,
    count: params.batch.count,
    periodStart: params.batch.periodStart,
    periodEnd: params.batch.periodEnd,
    walrusBlobIdsRoot: params.walrusBlobIdsRoot,
  };
  assertRootData(data);
  const expiry = params.expiry ?? 0n;
  if (expiry < 0n) throw new EvidenceError('expiry must be ≥ 0');

  // Noop signers: the instruction marks the account as a signer; the chain layer signs with the real key.
  const attester = createNoopSigner(attesterAddr);
  const payer = payerAddr === attesterAddr ? attester : createNoopSigner(payerAddr);

  const [credentialPda] = await deriveCredentialPda({ authority: attesterAddr, name: credentialName });
  const [schemaPda] = await deriveSchemaPda({ credential: credentialPda, name: ROOT_SCHEMA_NAME, version: ROOT_SCHEMA_VERSION });
  const nonce = rootNonce(data.rootHex);
  const [attestationPda] = await deriveAttestationPda({ credential: credentialPda, schema: schemaPda, nonce });
  const dataBytes = encodeRootAttestationData(data, credentialPda);
  if (!validateSasDataLayout(ROOT_SCHEMA_LAYOUT, dataBytes)) throw new EvidenceError('attestation data does not match the schema layout');

  const instructions: Instruction[] = [];
  if (params.setup?.createCredential) {
    instructions.push(getCreateCredentialInstruction({ payer, credential: credentialPda, authority: attester, name: credentialName, signers: [attesterAddr] }));
  }
  if (params.setup?.createSchema) {
    instructions.push(
      getCreateSchemaInstruction({
        payer,
        authority: attester,
        credential: credentialPda,
        schema: schemaPda,
        name: ROOT_SCHEMA_NAME,
        description: ROOT_SCHEMA_DESCRIPTION,
        layout: ROOT_SCHEMA_LAYOUT,
        fieldNames: [...ROOT_SCHEMA_FIELDS],
      }),
    );
  }
  instructions.push(
    getCreateAttestationInstruction({ payer, authority: attester, credential: credentialPda, schema: schemaPda, attestation: attestationPda, nonce, data: dataBytes, expiry }),
  );

  return {
    method: 'sas',
    programAddress: SAS_PROGRAM_ID,
    attester: attesterAddr,
    payer: payerAddr,
    credentialPda,
    schemaPda,
    attestationPda,
    nonce,
    data,
    dataBytes,
    instructions,
    verification: {
      offline: ['sas-lib encoders/decoders round-trip', 'PDAs from sas-lib', 'data passes ported validate_data', 'expiry 0 = never (program source)'],
      unverified: ['accepted by the deployed devnet SAS program', 'credential/schema existence (needs RPC)', 'rent and fee amounts'],
    },
  };
}

/** Convert a @solana/kit instruction to a web3.js v1 TransactionInstruction for the chain layer. */
export function toWeb3Instruction(ix: Instruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress),
    keys: (ix.accounts ?? []).map((a) => ({
      pubkey: new PublicKey(a.address),
      isSigner: a.role === AccountRole.READONLY_SIGNER || a.role === AccountRole.WRITABLE_SIGNER,
      isWritable: a.role === AccountRole.WRITABLE || a.role === AccountRole.WRITABLE_SIGNER,
    })),
    data: Buffer.from(ix.data ?? new Uint8Array()),
  });
}

/** I-1: the attester must not be able to move client money. */
export function assertAttesterIsolated(attester: string, vaults: VaultInfo[]): void {
  for (const v of vaults) {
    if (v.configAuthority !== null) throw new EvidenceError(`vault ${v.vaultPda} has a config authority`);
    if (v.members.some((m) => m.publicKey === attester)) throw new EvidenceError(`attester is a member of vault ${v.vaultPda}`);
    if (v.multisigPda === attester || v.vaultPda === attester) throw new EvidenceError('attester is a vault address');
  }
}

// ---------------------------------------------------------------------------
// SPL Memo fallback

export const MEMO_ANCHOR_PATTERN = /^splash:root:v1:([0-9a-f]{64}):([1-9]\d{0,9})$/;

export interface MemoAnchorPlan {
  method: 'memo';
  programId: string;
  memo: string;
  data: Uint8Array;
  instruction: TransactionInstruction;
}

export function memoAnchorText(rootHex: string, count: number): string {
  const memo = `splash:root:v1:${rootHex}:${count}`;
  if (!MEMO_ANCHOR_PATTERN.test(memo) || count > 0xffffffff) throw new EvidenceError('memo anchor needs a 32-byte hex root and a u32 count ≥ 1');
  return memo;
}

export function buildMemoAnchor(params: { attester: string; rootHex: string; count: number }): MemoAnchorPlan {
  const memo = memoAnchorText(params.rootHex, params.count);
  const data = utf8ToBytes(memo);
  return {
    method: 'memo',
    programId: MEMO_PROGRAM_ID,
    memo,
    data,
    instruction: new TransactionInstruction({
      programId: new PublicKey(MEMO_PROGRAM_ID),
      keys: [{ pubkey: new PublicKey(params.attester), isSigner: true, isWritable: false }],
      data: Buffer.from(data),
    }),
  };
}

export function parseMemoAnchor(memo: string): { rootHex: string; count: number } | null {
  const m = MEMO_ANCHOR_PATTERN.exec(memo.trim());
  return m ? { rootHex: m[1], count: Number(m[2]) } : null;
}

