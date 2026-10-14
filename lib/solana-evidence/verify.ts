/**
 * Receipt verification: recompute the leaf, walk the proof, compare the root
 * to the anchored value. Browser-safe: only @noble/hashes and pure modules,
 * no sas-lib, no web3.js, no network. The caller fetches the anchor (SAS
 * attestation data or memo text) and passes it in.
 */
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import { bundleLeaf, EVIDENCE_BUNDLE_VERSION, EVIDENCE_KIND_CORRIDOR_PAYOUT, EVIDENCE_KIND_PEER_TRANSFER, EVIDENCE_KIND_RECEIVABLE, EVIDENCE_KIND_TREASURY, PEER_MEMO_PREFIX, walrusBlobIdsRoot, type EvidenceBundle } from './bundle.ts';
import { rootFromProof, type MerkleProof } from './merkle.ts';

export interface AnchoredRoot {
  method: 'sas' | 'memo';
  rootHex: string;
  count: number;
  periodStart?: bigint;
  periodEnd?: bigint;
  /** SAS v2 only: sha256 over the batch's sorted Walrus blob ids. */
  walrusBlobIdsRoot?: string;
  /** Transaction signature of the anchor, if known. */
  signature?: string;
  /** true when the anchor came from the offline simulator (I-7). */
  simulated: boolean;
}

export interface VerifyCheck {
  name: 'bundle_shape' | 'leaf' | 'proof' | 'root_matches_anchor' | 'count_matches_anchor' | 'period' | 'blob_ids' | 'simulated_label';
  passed: boolean;
  detail: string;
}

export interface VerifyResult {
  ok: boolean;
  leafHex: string | null;
  computedRootHex: string | null;
  anchoredRootHex: string;
  simulated: boolean;
  checks: VerifyCheck[];
}

/** Decode SAS attestation data for splash.evidence.root.v2 (borsh: Vec<u8>, u32, i64, i64, String). */
export function decodeRootAttestationData(data: Uint8Array): { rootHex: string; count: number; periodStart: bigint; periodEnd: bigint; walrusBlobIdsRoot: string } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 0;
  const need = (n: number) => {
    if (o + n > data.length) throw new Error('attestation data truncated');
  };
  need(4);
  const rootLen = view.getUint32(o, true);
  o += 4;
  if (rootLen !== 32) throw new Error(`root must be 32 bytes, got ${rootLen}`);
  need(32);
  const rootHex = bytesToHex(data.slice(o, o + 32));
  o += 32;
  need(4);
  const count = view.getUint32(o, true);
  o += 4;
  need(16);
  const periodStart = view.getBigInt64(o, true);
  o += 8;
  const periodEnd = view.getBigInt64(o, true);
  o += 8;
  need(4);
  const sLen = view.getUint32(o, true);
  o += 4;
  need(sLen);
  const walrusBlobIdsRoot = new TextDecoder('utf-8', { fatal: true }).decode(data.slice(o, o + sLen));
  if (!/^[0-9a-f]{64}$/.test(walrusBlobIdsRoot)) throw new Error('walrus_blob_ids_root is not 32-byte hex');
  o += sLen;
  if (o !== data.length) throw new Error('trailing bytes in attestation data');
  return { rootHex, count, periodStart, periodEnd, walrusBlobIdsRoot };
}

export function anchoredRootFromSas(data: Uint8Array, meta: { signature?: string; simulated: boolean }): AnchoredRoot {
  const d = decodeRootAttestationData(data);
  return { method: 'sas', rootHex: d.rootHex, count: d.count, periodStart: d.periodStart, periodEnd: d.periodEnd, walrusBlobIdsRoot: d.walrusBlobIdsRoot, ...meta };
}

const MEMO = /^splash:root:v1:([0-9a-f]{64}):([1-9]\d{0,9})$/;

export function anchoredRootFromMemo(memo: string, meta: { signature?: string; simulated: boolean }): AnchoredRoot {
  const m = MEMO.exec(memo.trim());
  if (!m) throw new Error('not a splash root memo');
  return { method: 'memo', rootHex: m[1], count: Number(m[2]), ...meta };
}

export function verifyBundle(params: {
  bundle: EvidenceBundle;
  proof: MerkleProof;
  anchor: AnchoredRoot;
  /** The batch's Walrus blob ids, when the verifier has them: checked against a v2 anchor. */
  blobIds?: readonly string[];
}): VerifyResult {
  const { bundle, proof, anchor, blobIds } = params;
  const checks: VerifyCheck[] = [];
  let leafHex: string | null = null;
  let computedRootHex: string | null = null;

  // Kind 3, a bank payout; kind 4, a payment into another business's Splash account (its memo names it).
  const corridor = bundle?.version === EVIDENCE_BUNDLE_VERSION && bundle?.kind === EVIDENCE_KIND_CORRIDOR_PAYOUT && bundle?.kindName === 'corridor_payout';
  const peer = bundle?.version === EVIDENCE_BUNDLE_VERSION && bundle?.kind === EVIDENCE_KIND_PEER_TRANSFER && bundle?.kindName === 'peer_transfer' && bundle.memo === `${PEER_MEMO_PREFIX}${bundle.paymentId}`;
  // Kind 5, money received against a request: it landed in the requester's own account.
  const receivable = bundle?.version === EVIDENCE_BUNDLE_VERSION && bundle?.kind === EVIDENCE_KIND_RECEIVABLE && bundle?.kindName === 'receivable' && bundle.incoming?.to === bundle.payee?.account;
  // Kind 6, a treasury order: a device approved it; Ondo's redemption goes by wire, never into Payments.
  const treasury = bundle?.version === EVIDENCE_BUNDLE_VERSION && bundle?.kind === EVIDENCE_KIND_TREASURY && bundle?.kindName === 'treasury' && Boolean(bundle.approval?.signature) && (bundle.order?.landsIn === 'bank_wire') === Boolean(bundle.wire);
  const shapeOk = corridor || peer || receivable || treasury;
  checks.push({ name: 'bundle_shape', passed: shapeOk, detail: corridor ? 'kind 3 corridor payout, v1' : peer ? 'kind 4 payment to a Splash business, v1' : receivable ? 'kind 5 money received against a request, v1' : treasury ? 'kind 6 treasury order, v1' : 'not a v1 kind-3, 4, 5 or 6 bundle' });

  let leaf: Uint8Array | null = null;
  try {
    leaf = bundleLeaf(bundle);
    leafHex = bytesToHex(leaf);
    checks.push({ name: 'leaf', passed: true, detail: leafHex });
  } catch (e) {
    checks.push({ name: 'leaf', passed: false, detail: `cannot canonicalise bundle: ${(e as Error).message}` });
  }

  if (leaf) {
    try {
      const root = rootFromProof(leaf, proof);
      computedRootHex = bytesToHex(root);
      checks.push({ name: 'proof', passed: true, detail: `index ${proof.index} of ${proof.count}` });
    } catch (e) {
      checks.push({ name: 'proof', passed: false, detail: (e as Error).message });
    }
  }

  let anchorOk = false;
  try {
    anchorOk = computedRootHex !== null && /^[0-9a-f]{64}$/.test(anchor.rootHex) && constantTimeEqual(hexToBytes(computedRootHex), hexToBytes(anchor.rootHex));
  } catch {
    anchorOk = false;
  }
  checks.push({ name: 'root_matches_anchor', passed: anchorOk, detail: anchorOk ? `${anchor.method} anchor matches` : 'recomputed root differs from the anchored root' });
  checks.push({ name: 'count_matches_anchor', passed: proof.count === anchor.count, detail: `proof count ${proof.count}, anchor count ${anchor.count}` });

  if (anchor.periodStart !== undefined && anchor.periodEnd !== undefined) {
    const ms = Date.parse(bundle?.createdAt);
    const t = Number.isFinite(ms) ? BigInt(Math.floor(ms / 1000)) : null;
    const inPeriod = t !== null && t >= anchor.periodStart && t < anchor.periodEnd;
    checks.push({ name: 'period', passed: inPeriod, detail: inPeriod ? 'bundle inside the anchored period' : 'bundle outside the anchored period' });
  }

  if (anchor.walrusBlobIdsRoot !== undefined && blobIds !== undefined) {
    let blobsOk = false;
    try {
      blobsOk = walrusBlobIdsRoot(blobIds) === anchor.walrusBlobIdsRoot;
    } catch {
      blobsOk = false;
    }
    checks.push({ name: 'blob_ids', passed: blobsOk, detail: blobsOk ? 'the anchor binds exactly these Walrus blobs' : 'the Walrus blob ids differ from the anchored set' });
  }

  // I-7: a simulated receipt must say so; a simulated anchor cannot back a receipt claiming to be real.
  const simulated = anchor.simulated || bundle.receipt?.simulated === true;
  const labelOk = !anchor.simulated || bundle.receipt?.simulated === true;
  checks.push({ name: 'simulated_label', passed: labelOk, detail: simulated ? 'Simulated' : 'on-chain anchor' });

  return { ok: checks.every((c) => c.passed), leafHex, computedRootHex, anchoredRootHex: anchor.rootHex, simulated, checks };
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
