import assert from 'node:assert/strict';
import test from 'node:test';

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { Keypair, Message, VersionedMessage } from '@solana/web3.js';
import bs58 from 'bs58';

import { DeviceSuiSigner, SUI_DIGEST_BYTES, suiAddressOfDeviceKey } from '../lib/evidence-sui/device-sui-signer.ts';
import { CHALLENGE_PREFIX, createPossessionChallenge, possessionMessage } from '../lib/solana/recovery-kit.ts';

/**
 * Prompt 07 §4.3 (gate G2): one device key, a Solana address and a Sui
 * address. The vectors below were produced by the chains' own SDKs
 * (web3.js Keypair.fromSeed, @mysten/sui Ed25519Keypair.fromSecretKey) from a
 * fixed seed; the device key here is that seed imported into WebCrypto as a
 * NON-extractable key, the way the browser holds it.
 */

const SEED = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const VECTOR = {
  solanaAddress: '9C6hybhQ6Aycep9jaUnP6uL9ZYvDjUp1aSkFWPUFJtpj',
  suiAddress: '0x7573c697fa68450f04fa0dee2d39dcdc8a5ccf5db547f3e47638a6f8eeeec110',
  message: 'splash:seal-session:v1',
  personalMessageSignature:
    'ALAbpFpuksG9LxbcMOj9UTdkOpFGG+pdhrHZAyicxIUAdMdBwmb+7RvqOmUjdyDe6hX81c4Lf7eXKaddi89baQt5tVYuj+ZU+UB4sRLoqYunkB+FOuaVvtfg45ELrQSWZA==',
};

/** PKCS#8 wrapper for a raw Ed25519 seed (RFC 8410). */
const PKCS8_ED25519_PREFIX = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);

async function deviceKeyFromSeed(seed) {
  const { subtle } = globalThis.crypto;
  const pkcs8 = new Uint8Array([...PKCS8_ED25519_PREFIX, ...seed]);
  const privateKey = await subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
  const raw = Keypair.fromSeed(seed).publicKey.toBytes();
  const publicKey = await subtle.importKey('raw', raw, { name: 'Ed25519' }, true, ['verify']);
  return { privateKey, publicKey };
}

test('the vectors match the chains’ own SDKs', () => {
  assert.equal(Keypair.fromSeed(SEED).publicKey.toBase58(), VECTOR.solanaAddress);
  assert.equal(Ed25519Keypair.fromSecretKey(SEED).toSuiAddress(), VECTOR.suiAddress);
});

test('one device key: its Solana address and its Sui address both match the vectors', async () => {
  const pair = await deviceKeyFromSeed(SEED);
  const signer = await DeviceSuiSigner.fromCryptoKeyPair(pair);
  const raw = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', pair.publicKey));
  assert.equal(bs58.encode(raw), VECTOR.solanaAddress, 'base58(pubkey)');
  assert.equal(signer.toSuiAddress(), VECTOR.suiAddress, 'blake2b256(0x00 ‖ pubkey)');
  assert.equal(suiAddressOfDeviceKey(raw), VECTOR.suiAddress);
  assert.equal(signer.getKeyScheme(), 'ED25519');
});

test('a Seal personal message signed by the device key is the SDK’s exact signature, and verifies', async () => {
  const signer = await DeviceSuiSigner.fromCryptoKeyPair(await deviceKeyFromSeed(SEED));
  const message = new TextEncoder().encode(VECTOR.message);
  const { signature } = await signer.signPersonalMessage(message);
  // Ed25519 is deterministic: same key, same message, same bytes as Ed25519Keypair.
  assert.equal(signature, VECTOR.personalMessageSignature);
  const verified = await verifyPersonalMessageSignature(message, signature, { address: VECTOR.suiAddress });
  assert.equal(verified.toSuiAddress(), VECTOR.suiAddress);
  // Sui serialized signature: flag 0x00 (Ed25519) ‖ 64-byte signature ‖ 32-byte public key.
  const bytes = Buffer.from(signature, 'base64');
  assert.equal(bytes.length, 1 + 64 + 32);
  assert.equal(bytes[0], 0x00);
  assert.equal(bs58.encode(bytes.subarray(65)), VECTOR.solanaAddress, 'the same public key');
  await assert.rejects(() => verifyPersonalMessageSignature(new TextEncoder().encode('something else'), signature, { address: VECTOR.suiAddress }));
});

test('the private key never leaves WebCrypto', async () => {
  const pair = await deviceKeyFromSeed(SEED);
  await DeviceSuiSigner.fromCryptoKeyPair(pair);
  assert.equal(pair.privateKey.extractable, false);
  await assert.rejects(() => globalThis.crypto.subtle.exportKey('pkcs8', pair.privateKey));
});

test('the Sui signer signs only 32-byte intent digests, so it can never sign a Solana transaction', async () => {
  const signer = await DeviceSuiSigner.fromCryptoKeyPair(await deviceKeyFromSeed(SEED));
  assert.equal(SUI_DIGEST_BYTES, 32);
  const payer = Keypair.fromSeed(SEED).publicKey;
  const message = new Message({
    header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 },
    accountKeys: [payer.toBase58()],
    recentBlockhash: bs58.encode(new Uint8Array(32).fill(7)),
    instructions: [],
  }).serialize();
  assert.ok(message.length > 32, 'a Solana message is always longer than a digest');
  await assert.rejects(() => signer.sign(message), /only 32-byte Sui intent digests/);
  await assert.rejects(() => signer.sign(new Uint8Array(31)), /only 32-byte/);
});

test('the setup challenge is domain-separated from both chains', () => {
  const challenge = createPossessionChallenge('org_acme', VECTOR.solanaAddress);
  const bytes = possessionMessage(challenge);
  assert.equal(CHALLENGE_PREFIX, 'splash:challenge:v1:');
  assert.ok(new TextDecoder().decode(bytes).startsWith(CHALLENGE_PREFIX));
  // Not a Sui digest: the Sui signer would refuse it, and Sui signs only 32 bytes.
  assert.ok(bytes.length > 32);
  // Not a Sui intent: an intent starts [scope, version 0, app 0] with a small scope.
  assert.ok(bytes[0] > 0x10 && bytes[1] !== 0, 'first bytes are text, not an intent prefix');
  // Not a Solana message: no versioned-message bit, and it does not parse as either form.
  assert.equal(bytes[0] & 0x80, 0);
  assert.throws(() => VersionedMessage.deserialize(bytes));
  assert.throws(() => Message.from(bytes));
});
