// Device key: non-extractable WebCrypto Ed25519, memory store, transaction signing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

import {
  createDeviceKey,
  createMemoryDeviceKeyStore,
  deviceKeySigner,
  isDeviceKeySupported,
  loadDeviceKey,
  signTransactionWith,
  signWithDeviceKey,
} from '../lib/solana/device-key.ts';
import { buildSponsoredTransaction } from '../lib/solana/squads.ts';

test('Node 22 WebCrypto supports non-extractable Ed25519', async () => {
  assert.equal(await isDeviceKeySupported(), true);
});

test('create, load, sign, verify; private key cannot be exported', async () => {
  const store = createMemoryDeviceKeyStore();
  const info = await createDeviceKey(store, 'org_1');
  assert.equal(info.publicKeyBytes.length, 32);
  assert.equal(new PublicKey(info.publicKey).toBase58(), info.publicKey);
  assert.deepEqual(await loadDeviceKey(store, 'org_1'), info);
  assert.equal(await loadDeviceKey(store, 'nobody'), null);
  await assert.rejects(createDeviceKey(store, 'org_1'), /already exists/);

  const pair = await store.get('org_1');
  assert.equal(pair.privateKey.extractable, false);
  for (const format of ['pkcs8', 'jwk', 'raw']) {
    await assert.rejects(crypto.subtle.exportKey(format, pair.privateKey), undefined, `export ${format} must fail`);
  }

  const msg = new TextEncoder().encode('splash message');
  const sig = await signWithDeviceKey(store, 'org_1', msg);
  assert.equal(sig.length, 64);
  assert.ok(ed25519.verify(sig, msg, info.publicKeyBytes), 'noble verifies a WebCrypto signature');
  assert.ok(await crypto.subtle.verify({ name: 'Ed25519' }, pair.publicKey, sig, msg));
});

test('signs a v0 transaction in its own slot, leaving the fee payer slot for Kora', async () => {
  const store = createMemoryDeviceKeyStore();
  await createDeviceKey(store, 'org_2');
  const signer = await deviceKeySigner(store, 'org_2');
  const feePayer = Keypair.generate().publicKey;
  const ix = new TransactionInstruction({
    programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
    keys: [{ pubkey: signer.publicKey, isSigner: true, isWritable: false }],
    data: Buffer.from('x'),
  });
  const tx = buildSponsoredTransaction(feePayer, [ix], PublicKey.default.toBase58());
  await signTransactionWith(signer, tx);
  const keys = tx.message.staticAccountKeys;
  const slot = keys.findIndex((k) => k.equals(signer.publicKey));
  assert.equal(slot, 1);
  assert.ok(tx.signatures[0].every((b) => b === 0), 'fee payer slot still empty');
  assert.ok(ed25519.verify(tx.signatures[1], tx.message.serialize(), signer.publicKey.toBytes()));

  const unrelated = buildSponsoredTransaction(feePayer, [SystemProgram.transfer({ fromPubkey: feePayer, toPubkey: feePayer, lamports: 1 })], PublicKey.default.toBase58());
  await assert.rejects(signTransactionWith(signer, unrelated), /not a required signer/);
});
