import { Signer, type SignatureScheme } from '@mysten/sui/cryptography';
import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519';

import type { DeviceKeyStore } from '../solana/device-key.ts';

/**
 * One device key, two addresses (prompt 07 §4.3).
 *
 * The member's device key is a non-extractable WebCrypto Ed25519 key. The
 * same 32-byte public key is
 *   - a Solana address:  base58(pubkey)               (the Squads member)
 *   - a Sui address:     blake2b256(0x00 ‖ pubkey)    (the Seal identity)
 * Seal identifies a requester by Sui address and asks only for a signed
 * personal message to start a session, so decrypting evidence needs no SUI
 * and no server secret. This class lets the Sui SDK use the device key for
 * that, without the key ever leaving WebCrypto.
 *
 * Why reusing the key is safe — the three things it ever signs can never be
 * the same bytes:
 *   - Sui:    always a 32-byte blake2b digest of intent ‖ message (enforced
 *             below: `sign` refuses anything that is not exactly 32 bytes);
 *   - Solana: a transaction message, which is longer than 32 bytes (a header
 *             plus at least one 32-byte key plus a 32-byte blockhash);
 *   - Splash: the setup challenge, text that starts `splash:challenge:v1:`
 *             (lib/solana/recovery-kit.ts possessionMessage), far longer than
 *             32 bytes, and whose first byte is neither a Sui intent scope
 *             nor a versioned Solana message prefix.
 * An Ed25519 signature is valid for exactly one message, so a signature made
 * for one of these can never be replayed as another. Gate G2: Sebastian
 * confirms this reuse in writing; if not, a second non-extractable key is
 * generated for evidence alone and the recovery kit holds both.
 */

/** The only length this signer will sign: a Sui intent digest. */
export const SUI_DIGEST_BYTES = 32;

function subtleOf(subtle?: SubtleCrypto): SubtleCrypto {
  const s = subtle ?? globalThis.crypto?.subtle;
  if (!s) throw new Error('WebCrypto is not available');
  return s;
}

export class DeviceSuiSigner extends Signer {
  readonly #privateKey: CryptoKey;
  readonly #publicKey: Ed25519PublicKey;
  readonly #subtle: SubtleCrypto;

  private constructor(privateKey: CryptoKey, publicKey: Uint8Array, subtle: SubtleCrypto) {
    super();
    this.#privateKey = privateKey;
    this.#publicKey = new Ed25519PublicKey(publicKey);
    this.#subtle = subtle;
  }

  /** Wrap a WebCrypto Ed25519 key pair. The private key may be (and should be) non-extractable. */
  static async fromCryptoKeyPair(pair: CryptoKeyPair, subtle?: SubtleCrypto): Promise<DeviceSuiSigner> {
    const s = subtleOf(subtle);
    if (pair.privateKey.algorithm.name !== 'Ed25519') throw new Error('the device key must be Ed25519');
    const raw = new Uint8Array(await s.exportKey('raw', pair.publicKey));
    if (raw.length !== 32) throw new Error('an Ed25519 public key is 32 bytes');
    return new DeviceSuiSigner(pair.privateKey, raw, s);
  }

  /** The member's device key from this browser's store, as a Sui signer for Seal. */
  static async fromStore(store: DeviceKeyStore, id: string, subtle?: SubtleCrypto): Promise<DeviceSuiSigner> {
    const pair = await store.get(id);
    if (!pair) throw new Error('no device key on this device');
    return DeviceSuiSigner.fromCryptoKeyPair(pair, subtle);
  }

  /**
   * Ed25519 over a Sui intent digest. The base class calls this with
   * blake2b256(intent ‖ message); anything else is refused, which is what
   * keeps the key's Sui signatures apart from its Solana ones.
   */
  async sign(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    if (bytes.length !== SUI_DIGEST_BYTES) {
      throw new Error(`the device key signs only ${SUI_DIGEST_BYTES}-byte Sui intent digests here, not ${bytes.length} bytes`);
    }
    return new Uint8Array(await this.#subtle.sign({ name: 'Ed25519' }, this.#privateKey, bytes as BufferSource));
  }

  getKeyScheme(): SignatureScheme {
    return 'ED25519';
  }

  getPublicKey(): Ed25519PublicKey {
    return this.#publicKey;
  }
}

/** The Sui address (Seal identity) of a device key, from its raw 32-byte public key. */
export function suiAddressOfDeviceKey(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error('an Ed25519 public key is 32 bytes');
  return new Ed25519PublicKey(publicKey).toSuiAddress();
}
