/**
 * Where encrypted evidence bundles live.
 *
 * `EvidenceStore` takes CIPHERTEXT only: the bundle is encrypted (Seal, or
 * whatever the chain/server layer uses) before it reaches a store, and a
 * store refuses anything that looks like plaintext JSON. The Merkle leaf is
 * computed over the plaintext canonical bundle; the store holds the sealed
 * copy that a permitted reader decrypts to re-derive the leaf.
 *
 *   InMemoryEvidenceStore   offline / tests
 *   createWalrusEvidenceStore()  placeholder over lib/evidence-sui/walrus.ts, loaded
 *                           lazily so importing this module reads no env and
 *                           pulls in no server code. Not exercised offline.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import { EvidenceError } from './bundle.ts';

export interface StoredEvidence {
  blobId: string;
  mode: 'memory' | 'walrus-demo' | 'walrus-live';
  sizeBytes: number;
  /** sha256 of the stored ciphertext, for integrity checks on read. */
  ciphertextSha256Hex: string;
}

export interface EvidenceStore {
  put(bundleId: string, ciphertext: string): Promise<StoredEvidence>;
  get(blobId: string): Promise<string | null>;
}

export function assertCiphertext(payload: string): void {
  const t = payload.trim();
  if (t.length === 0) throw new EvidenceError('empty evidence payload');
  if (t.startsWith('{') || t.startsWith('[')) throw new EvidenceError('evidence store accepts ciphertext only, not plaintext JSON');
  if (/corridor_payout|commitmentHex|bankReference/.test(t)) throw new EvidenceError('payload contains plaintext bundle fields');
}

export class InMemoryEvidenceStore implements EvidenceStore {
  private readonly blobs = new Map<string, string>();

  async put(bundleId: string, ciphertext: string): Promise<StoredEvidence> {
    assertCiphertext(ciphertext);
    const digest = bytesToHex(sha256(utf8ToBytes(ciphertext)));
    const blobId = `mem_${digest.slice(0, 32)}`;
    this.blobs.set(blobId, ciphertext);
    void bundleId;
    return { blobId, mode: 'memory', sizeBytes: utf8ToBytes(ciphertext).length, ciphertextSha256Hex: digest };
  }

  async get(blobId: string): Promise<string | null> {
    return this.blobs.get(blobId) ?? null;
  }
}

/** Placeholder adapter over the existing Walrus module. Server-side only. */
export function createWalrusEvidenceStore(): EvidenceStore {
  const load = () => import('../evidence-sui/walrus.ts');
  return {
    async put(_bundleId, ciphertext) {
      assertCiphertext(ciphertext);
      const walrus = await load();
      const blob = await walrus.storeEncryptedInvoice(ciphertext);
      return {
        blobId: blob.blobId,
        mode: blob.mode === 'live' ? 'walrus-live' : 'walrus-demo',
        sizeBytes: blob.sizeBytes,
        ciphertextSha256Hex: bytesToHex(sha256(utf8ToBytes(ciphertext))),
      };
    },
    async get(blobId) {
      const walrus = await load();
      const blob = await walrus.retrieveBlob(blobId);
      return blob?.encryptedData ?? null;
    },
  };
}
