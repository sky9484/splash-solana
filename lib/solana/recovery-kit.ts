/**
 * Recovery kit: 24 BIP39 words made in the browser, the Solana ed25519 key at m/44'/501'/0'/0'
 * derived with SLIP-0010, a 3-word confirmation check, and proof of possession (sign a server nonce).
 *
 * Verified vs unverified:
 *   - SLIP-0010 ed25519 derivation is tested against the official SLIP-0010 test vectors 1 and 2
 *     (satoshilabs/slips slip-0010.md), copied into tests/solana-chain-recovery.test.mjs.
 *   - Mnemonic -> seed is tested against the official BIP39 vector for the 24-word
 *     "abandon ... art" mnemonic with passphrase "TREZOR" (trezor/python-mnemonic vectors.json).
 *   - The path m/44'/501'/0'/0' is the one Phantom and Solflare document for the first account.
 *     That a kit restored into Phantom shows the same address is UNVERIFIED offline (no published
 *     address vector was found); check it once by hand on devnet.
 *
 * The words never leave the browser and are never sent to Splash. Only the public key and a
 * signature over a server nonce go to the server. Buffers holding seeds or private keys are zeroed
 * after use where JS lets us (strings from the wordlist cannot be wiped).
 */
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import bs58 from 'bs58';

export const RECOVERY_WORD_COUNT = 24;
export const SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'";
const HARDENED = 0x80000000;
const ED25519_SEED_KEY = new TextEncoder().encode('ed25519 seed');

/** 24 words, 256 bits of entropy, English wordlist. Uses the platform CSPRNG. */
export function generateRecoveryWords(): string[] {
  return generateMnemonic(wordlist, 256).split(' ');
}

export function normalizeWords(words: string[] | string): string[] {
  const list = Array.isArray(words) ? words : words.split(/\s+/);
  return list.map((w) => w.normalize('NFKD').trim().toLowerCase()).filter(Boolean);
}

export function isValidRecoveryWords(words: string[] | string): boolean {
  const list = normalizeWords(words);
  return list.length === RECOVERY_WORD_COUNT && validateMnemonic(list.join(' '), wordlist);
}

/** BIP39 seed (64 bytes). The caller owns the returned buffer and should zero it. */
export function recoveryWordsToSeed(words: string[] | string, passphrase = ''): Uint8Array {
  const list = normalizeWords(words);
  if (!validateMnemonic(list.join(' '), wordlist)) throw new Error('Recovery words are not a valid BIP39 mnemonic');
  return mnemonicToSeedSync(list.join(' '), passphrase);
}

/** Parse a fully hardened path. SLIP-0010 ed25519 supports hardened children only. */
export function parseHardenedPath(path: string): number[] {
  if (!/^m(\/\d+'?)*$/.test(path)) throw new Error(`Bad derivation path: ${path}`);
  return path
    .split('/')
    .slice(1)
    .map((part) => {
      if (!part.endsWith("'")) throw new Error(`ed25519 SLIP-0010 needs hardened indexes only: ${path}`);
      const n = Number(part.slice(0, -1));
      if (!Number.isInteger(n) || n < 0 || n >= HARDENED) throw new Error(`Bad index in path: ${path}`);
      return n + HARDENED;
    });
}

export interface Slip10Node {
  /** 32-byte private key (the ed25519 seed). */
  key: Uint8Array;
  chainCode: Uint8Array;
}

/** SLIP-0010 ed25519 derivation. Intermediate buffers are zeroed; the caller zeroes the result. */
export function slip10DeriveEd25519(seed: Uint8Array, path: string): Slip10Node {
  const indexes = parseHardenedPath(path);
  let I = hmac(sha512, ED25519_SEED_KEY, seed);
  let key = I.slice(0, 32);
  let chainCode = I.slice(32);
  I.fill(0);
  for (const index of indexes) {
    const data = new Uint8Array(37);
    data[0] = 0;
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, index, false);
    I = hmac(sha512, chainCode, data);
    data.fill(0);
    key.fill(0);
    chainCode.fill(0);
    key = I.slice(0, 32);
    chainCode = I.slice(32);
    I.fill(0);
  }
  return { key, chainCode };
}

/** SLIP-0010 prints ed25519 public keys with a 0x00 prefix; Solana uses the bare 32 bytes. */
export function slip10PublicKey(privateKey: Uint8Array): Uint8Array {
  const out = new Uint8Array(33);
  out.set(ed25519.getPublicKey(privateKey), 1);
  return out;
}

export interface RecoveryKey {
  /** base58 Solana address. */
  publicKey: string;
  publicKeyBytes: Uint8Array;
  sign(message: Uint8Array): Uint8Array;
  /** 64-byte secretKey in the web3.js Keypair layout (seed || pubkey). Caller must zero it. */
  exportSecretKeyForKeypair(): Uint8Array;
  /** Zero the private key. The object is unusable afterwards. */
  destroy(): void;
}

/** Derive the kit's Solana key. Zeroes the BIP39 seed before returning. */
export function deriveRecoveryKey(words: string[] | string, path: string = SOLANA_DERIVATION_PATH): RecoveryKey {
  const seed = recoveryWordsToSeed(words);
  const node = slip10DeriveEd25519(seed, path);
  seed.fill(0);
  node.chainCode.fill(0);
  const priv = node.key;
  const pub = ed25519.getPublicKey(priv);
  let destroyed = false;
  const alive = () => {
    if (destroyed) throw new Error('Recovery key was destroyed');
  };
  return {
    publicKey: bs58.encode(pub),
    publicKeyBytes: pub,
    sign(message) {
      alive();
      return ed25519.sign(message, priv);
    },
    exportSecretKeyForKeypair() {
      alive();
      const out = new Uint8Array(64);
      out.set(priv, 0);
      out.set(pub, 32);
      return out;
    },
    destroy() {
      priv.fill(0);
      destroyed = true;
    },
  };
}

/* ---------------------------------------------------------------- word confirmation */

function randomInt(maxExclusive: number): number {
  // Rejection sampling over a u32 so the pick is unbiased.
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0]! < limit) return buf[0]! % maxExclusive;
  }
}

/** Three distinct random positions (0-based, sorted) the person must type back. */
export function pickConfirmationIndices(count = 3, total = RECOVERY_WORD_COUNT): number[] {
  if (count < 1 || count > total) throw new Error('Bad confirmation count');
  const picked = new Set<number>();
  while (picked.size < count) picked.add(randomInt(total));
  return [...picked].sort((a, b) => a - b);
}

export interface WordPick {
  /** 0-based position in the 24 words. */
  index: number;
  word: string;
}

function timingSafeEqualString(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/**
 * The 3-random-word check. Exactly three picks, distinct, in range, every one correct.
 * Runs in the browser against the words still in memory; never send the words to a server.
 */
export function confirmWords(words: string[] | string, picks: WordPick[], required = 3): boolean {
  const list = normalizeWords(words);
  if (list.length !== RECOVERY_WORD_COUNT) return false;
  if (!Array.isArray(picks) || picks.length !== required) return false;
  const seen = new Set<number>();
  let ok = true;
  for (const pick of picks) {
    if (!Number.isInteger(pick.index) || pick.index < 0 || pick.index >= list.length || seen.has(pick.index)) return false;
    seen.add(pick.index);
    const typed = normalizeWords([pick.word ?? ''])[0] ?? '';
    ok = timingSafeEqualString(typed, list[pick.index]!) && ok;
  }
  return ok;
}

/* ---------------------------------------------------------------- proof of possession */

export interface PossessionChallenge {
  orgId: string;
  /** base58 public key the client claims to hold. */
  publicKey: string;
  /** 32 random bytes, hex. Single use. */
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}

const POP_DOMAIN = 'splash:pop:v1';

/** Server side: issue a nonce bound to the org and the claimed key. */
export function createPossessionChallenge(orgId: string, publicKey: string, now = new Date(), ttlSec = 300): PossessionChallenge {
  if (!orgId || /[\n:]/.test(orgId)) throw new Error('orgId must be non-empty and contain no ":" or newline');
  const pk = bs58.decode(publicKey);
  if (pk.length !== 32) throw new Error('publicKey must be a 32-byte base58 key');
  const nonce = new Uint8Array(32);
  globalThis.crypto.getRandomValues(nonce);
  return {
    orgId,
    publicKey,
    nonce: Array.from(nonce, (b) => b.toString(16).padStart(2, '0')).join(''),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlSec * 1000).toISOString(),
  };
}

/** The exact bytes signed. Domain-separated so it can never be a valid Solana transaction message. */
export function possessionMessage(c: PossessionChallenge): Uint8Array {
  return new TextEncoder().encode(
    `${POP_DOMAIN}\norg:${c.orgId}\nkey:${c.publicKey}\nnonce:${c.nonce}\nexpires:${c.expiresAt}`,
  );
}

/** Client side: sign the challenge. Returns a base58 signature. */
export function signPossessionChallenge(signer: { sign(m: Uint8Array): Uint8Array | Promise<Uint8Array> }, c: PossessionChallenge): Promise<string> {
  return Promise.resolve(signer.sign(possessionMessage(c))).then((sig) => bs58.encode(sig));
}

/** Single-use nonce registry. The default in-memory one is for tests and the offline demo. */
export interface NonceStore {
  /** true the first time a nonce is consumed, false on every replay. */
  consume(nonce: string): boolean | Promise<boolean>;
}

export function createMemoryNonceStore(): NonceStore {
  const used = new Set<string>();
  return {
    consume(nonce) {
      if (used.has(nonce)) return false;
      used.add(nonce);
      return true;
    },
  };
}

export interface PossessionResult {
  ok: boolean;
  reason?: 'expired' | 'replayed' | 'bad_signature' | 'key_mismatch' | 'malformed';
}

/**
 * Server side: verify a proof of possession. Checks, in order: shape, the key matches the one the
 * challenge was issued for, expiry, the ed25519 signature, then consumes the nonce (so a failed
 * signature does not burn a legitimate nonce, and a replayed good one is refused).
 */
export async function verifyPossession(
  challenge: PossessionChallenge,
  publicKey: string,
  signatureB58: string,
  nonces: NonceStore,
  now = new Date(),
): Promise<PossessionResult> {
  let pk: Uint8Array;
  let sig: Uint8Array;
  try {
    pk = bs58.decode(publicKey);
    sig = bs58.decode(signatureB58);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (pk.length !== 32 || sig.length !== 64) return { ok: false, reason: 'malformed' };
  if (publicKey !== challenge.publicKey) return { ok: false, reason: 'key_mismatch' };
  if (now.getTime() > Date.parse(challenge.expiresAt)) return { ok: false, reason: 'expired' };
  let valid = false;
  try {
    valid = ed25519.verify(sig, possessionMessage(challenge), pk);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad_signature' };
  if (!(await nonces.consume(challenge.nonce))) return { ok: false, reason: 'replayed' };
  return { ok: true };
}
