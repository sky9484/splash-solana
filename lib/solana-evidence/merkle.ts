/**
 * Binary Merkle tree over evidence leaves (sha256, domain-separated).
 *
 * Construction (documented here because a verifier in another language must
 * reproduce it byte for byte):
 *
 *   leaf  = sha256( utf8("splash.evidence.leaf.v1") || 0x00 || payload )
 *   node  = sha256( utf8("splash.evidence.node.v1") || 0x01 || left || right )
 *
 *   - Pairs are EXPLICIT left/right in leaf order, not sorted. Order is part of
 *     the commitment, so a proof binds a leaf to its index.
 *   - An odd node at the end of a level is PROMOTED unchanged to the next
 *     level (it is not duplicated). Duplicating the last node makes two
 *     different leaf lists share a root (the CVE-2012-2459 shape); promotion
 *     does not, and `count` is anchored beside the root anyway.
 *   - A one-leaf tree's root is that leaf hash. An empty tree is an error.
 *   - Domain tags and the 0x00/0x01 bytes keep a leaf from ever being read as
 *     an internal node (second-preimage resistance).
 *
 * A proof carries `index`, `count` and the sibling hashes bottom-up. The
 * verifier DERIVES each sibling's side from index and count and rejects a
 * proof whose stated sides or length disagree, so a proof cannot be replayed
 * at another position.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export const LEAF_DOMAIN = 'splash.evidence.leaf.v1';
export const NODE_DOMAIN = 'splash.evidence.node.v1';

const LEAF_PREFIX = concatBytes(utf8ToBytes(LEAF_DOMAIN), Uint8Array.of(0x00));
const NODE_PREFIX = concatBytes(utf8ToBytes(NODE_DOMAIN), Uint8Array.of(0x01));

export class MerkleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MerkleError';
  }
}

export interface MerkleSibling {
  position: 'left' | 'right';
  hashHex: string;
}

export interface MerkleProof {
  index: number;
  count: number;
  /** Bottom-up. A promoted level contributes no sibling. */
  siblings: MerkleSibling[];
}

export function hashLeaf(payload: string | Uint8Array): Uint8Array {
  const bytes = typeof payload === 'string' ? utf8ToBytes(payload) : payload;
  return sha256(concatBytes(LEAF_PREFIX, bytes));
}

export function hashNode(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length !== 32 || right.length !== 32) throw new MerkleError('node children must be 32 bytes');
  return sha256(concatBytes(NODE_PREFIX, left, right));
}

/** All levels, leaves first, root level last (length 1). */
export function buildLevels(leaves: Uint8Array[]): Uint8Array[][] {
  if (leaves.length === 0) throw new MerkleError('cannot build a Merkle tree with no leaves');
  for (const leaf of leaves) if (leaf.length !== 32) throw new MerkleError('every leaf must be a 32-byte hash');
  const levels: Uint8Array[][] = [leaves.slice()];
  let level = leaves;
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? hashNode(level[i], level[i + 1]) : level[i]);
    }
    levels.push(next);
    level = next;
  }
  return levels;
}

export function merkleRoot(leaves: Uint8Array[]): Uint8Array {
  const levels = buildLevels(leaves);
  return levels[levels.length - 1][0];
}

export function merkleProof(levels: Uint8Array[][], index: number): MerkleProof {
  const count = levels[0].length;
  if (!Number.isInteger(index) || index < 0 || index >= count) throw new MerkleError(`leaf index ${index} out of range`);
  const siblings: MerkleSibling[] = [];
  let idx = index;
  for (let depth = 0; depth < levels.length - 1; depth++) {
    const level = levels[depth];
    const sib = idx ^ 1;
    if (sib < level.length) {
      siblings.push({ position: idx % 2 === 1 ? 'left' : 'right', hashHex: bytesToHex(level[sib]) });
    }
    idx >>= 1;
  }
  return { index, count, siblings };
}

/** Sibling sides a proof for (index, count) must have, bottom-up. */
export function expectedSiblingSides(index: number, count: number): Array<'left' | 'right'> {
  if (!Number.isInteger(count) || count < 1) throw new MerkleError('count must be a positive integer');
  if (!Number.isInteger(index) || index < 0 || index >= count) throw new MerkleError(`leaf index ${index} out of range for count ${count}`);
  const sides: Array<'left' | 'right'> = [];
  let idx = index;
  let n = count;
  while (n > 1) {
    if ((idx ^ 1) < n) sides.push(idx % 2 === 1 ? 'left' : 'right');
    idx >>= 1;
    n = Math.ceil(n / 2);
  }
  return sides;
}

/** Recompute the root from a leaf and a proof. Throws on a malformed proof. */
export function rootFromProof(leaf: Uint8Array, proof: MerkleProof): Uint8Array {
  if (leaf.length !== 32) throw new MerkleError('leaf must be 32 bytes');
  const sides = expectedSiblingSides(proof.index, proof.count);
  if (proof.siblings.length !== sides.length) {
    throw new MerkleError(`proof has ${proof.siblings.length} siblings; index ${proof.index} of ${proof.count} needs ${sides.length}`);
  }
  let acc = leaf;
  proof.siblings.forEach((s, i) => {
    if (s.position !== sides[i]) throw new MerkleError(`sibling ${i} is on the ${s.position}; index ${proof.index} requires ${sides[i]}`);
    if (!/^[0-9a-f]{64}$/.test(s.hashHex)) throw new MerkleError(`sibling ${i} is not 32-byte lowercase hex`);
    const sib = hexToBytes(s.hashHex);
    acc = s.position === 'left' ? hashNode(sib, acc) : hashNode(acc, sib);
  });
  return acc;
}
