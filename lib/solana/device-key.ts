/**
 * Device key: a non-extractable WebCrypto Ed25519 key that lives in this browser's IndexedDB and
 * signs Solana transaction messages. It is a Squads member, so it is the person's signature (I-4).
 *
 * Verified vs unverified:
 *   - generate / sign / verify and "the private key cannot be exported" are tested on Node 22's
 *     WebCrypto (tests/solana-chain-device-key.test.mjs). Ed25519 signatures are deterministic, and
 *     the test checks a WebCrypto signature against @noble/curves verification and web3.js
 *     transaction signature verification.
 *   - Browser support for WebCrypto Ed25519 (Chrome 137+, Safari 17+, Firefox 129+) and storing a
 *     CryptoKey in IndexedDB via structured clone is UNVERIFIED here (no browser in this container).
 *     `isDeviceKeySupported()` probes at runtime so the UI can show a clear fallback.
 *   - Losing the browser profile loses the key; that is what the recovery kit is for.
 */
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

/** Where CryptoKeyPairs are kept. IndexedDB in the browser, a Map in tests. */
export interface DeviceKeyStore {
  get(id: string): Promise<CryptoKeyPair | undefined>;
  put(id: string, pair: CryptoKeyPair): Promise<void>;
  delete(id: string): Promise<void>;
}

export function createMemoryDeviceKeyStore(): DeviceKeyStore {
  const keys = new Map<string, CryptoKeyPair>();
  return {
    async get(id) {
      return keys.get(id);
    },
    async put(id, pair) {
      keys.set(id, pair);
    },
    async delete(id) {
      keys.delete(id);
    },
  };
}

/** IndexedDB-backed store. CryptoKey objects are structured-cloneable; non-extractable stays non-extractable. */
export function createIndexedDbDeviceKeyStore(dbName = 'splash-device-keys', storeName = 'keys'): DeviceKeyStore {
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is not available'));
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(storeName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    });
  const run = async <T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> => {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const req = op(tx.objectStore(storeName));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
      });
    } finally {
      db.close();
    }
  };
  return {
    get: (id) => run<CryptoKeyPair | undefined>('readonly', (s) => s.get(id)),
    put: async (id, pair) => {
      await run('readwrite', (s) => s.put(pair, id));
    },
    delete: async (id) => {
      await run('readwrite', (s) => s.delete(id));
    },
  };
}

function subtleOf(subtle?: SubtleCrypto): SubtleCrypto {
  const s = subtle ?? globalThis.crypto?.subtle;
  if (!s) throw new Error('WebCrypto is not available');
  return s;
}

/** Runtime probe: can this browser make a non-extractable Ed25519 key? */
export async function isDeviceKeySupported(subtle?: SubtleCrypto): Promise<boolean> {
  try {
    const pair = (await subtleOf(subtle).generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])) as CryptoKeyPair;
    return pair.privateKey.extractable === false;
  } catch {
    return false;
  }
}

export interface DeviceKeyInfo {
  id: string;
  /** base58 Solana address of the device key. */
  publicKey: string;
  publicKeyBytes: Uint8Array;
}

async function infoFor(id: string, pair: CryptoKeyPair, subtle: SubtleCrypto): Promise<DeviceKeyInfo> {
  const raw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  if (raw.length !== 32) throw new Error('Unexpected Ed25519 public key length');
  return { id, publicKey: bs58.encode(raw), publicKeyBytes: raw };
}

/** Make a new non-extractable device key and store it. Refuses to overwrite an existing id. */
export async function createDeviceKey(store: DeviceKeyStore, id: string, subtle?: SubtleCrypto): Promise<DeviceKeyInfo> {
  const s = subtleOf(subtle);
  if (await store.get(id)) throw new Error(`A device key already exists for ${id}`);
  const pair = (await s.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])) as CryptoKeyPair;
  if (pair.privateKey.extractable) throw new Error('Device private key must be non-extractable');
  await store.put(id, pair);
  return infoFor(id, pair, s);
}

export async function loadDeviceKey(store: DeviceKeyStore, id: string, subtle?: SubtleCrypto): Promise<DeviceKeyInfo | null> {
  const pair = await store.get(id);
  return pair ? infoFor(id, pair, subtleOf(subtle)) : null;
}

/** Sign raw bytes (a serialized transaction message). Returns the 64-byte signature. */
export async function signWithDeviceKey(store: DeviceKeyStore, id: string, message: Uint8Array, subtle?: SubtleCrypto): Promise<Uint8Array> {
  const pair = await store.get(id);
  if (!pair) throw new Error(`No device key for ${id}`);
  const sig = new Uint8Array(await subtleOf(subtle).sign({ name: 'Ed25519' }, pair.privateKey, message as BufferSource));
  if (sig.length !== 64) throw new Error('Unexpected Ed25519 signature length');
  return sig;
}

/** A signer object other modules can take without knowing about WebCrypto. */
export interface MessageSigner {
  publicKey: PublicKey;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

export async function deviceKeySigner(store: DeviceKeyStore, id: string, subtle?: SubtleCrypto): Promise<MessageSigner> {
  const info = await loadDeviceKey(store, id, subtle);
  if (!info) throw new Error(`No device key for ${id}`);
  return {
    publicKey: new PublicKey(info.publicKeyBytes),
    signMessage: (m) => signWithDeviceKey(store, id, m, subtle),
  };
}

/**
 * Add the signer's signature to a legacy or v0 transaction. The signer must already be one of the
 * message's required signers; the fee payer slot is left for Kora.
 */
export async function signTransactionWith<T extends Transaction | VersionedTransaction>(signer: MessageSigner, tx: T): Promise<T> {
  if (tx instanceof VersionedTransaction) {
    const required = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
    if (!required.some((k) => k.equals(signer.publicKey))) throw new Error('Device key is not a required signer of this transaction');
    tx.addSignature(signer.publicKey, await signer.signMessage(tx.message.serialize()));
    return tx;
  }
  const legacy = tx as Transaction;
  const message = legacy.serializeMessage();
  legacy.addSignature(signer.publicKey, Buffer.from(await signer.signMessage(message)));
  return tx;
}
