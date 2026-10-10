import assert from 'node:assert/strict';

import { SealClient, SessionKey } from '@mysten/seal';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { fromHex, toHex } from '@mysten/sui/utils';

import { getSealConfig } from '../lib/server/seal-config.ts';

const config = getSealConfig();
assert.equal(process.env.USE_MOCK_APIS, 'false', 'Set USE_MOCK_APIS=false for the live integration test.');
assert.ok(config.configured, 'Configure Seal endpoints, package ID, and policy object ID.');
assert.ok(process.env.WALRUS_PUBLISHER_URL && process.env.WALRUS_AGGREGATOR_URL, 'Configure live Walrus endpoints.');

const privateKey = process.env.OPERATOR_SUI_PRIVATE_KEY?.trim();
assert.ok(privateKey, 'Configure OPERATOR_SUI_PRIVATE_KEY for the policy allowlisted account.');
const decoded = decodeSuiPrivateKey(privateKey);
assert.equal(decoded.scheme, 'ED25519', 'The integration test requires an ED25519 operator key.');
const signer = Ed25519Keypair.fromSecretKey(decoded.secretKey);
const network = process.env.SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
const suiClient = new SuiGrpcClient({
  network,
  baseUrl: process.env.SUI_RPC_URL || `https://fullnode.${network}.sui.io:443`,
});

const client = new SealClient({
  suiClient,
  serverConfigs: config.serverConfigs,
  verifyKeyServers: config.mode !== 'decentralized',
  timeout: config.timeoutMs,
});
const id = toHex(new Uint8Array([...fromHex(config.policyObjectId), ...crypto.getRandomValues(new Uint8Array(5))]));
const source = new TextEncoder().encode(`Splash Seal-Walrus round trip ${new Date().toISOString()}`);
const { encryptedObject } = await client.encrypt({
  threshold: config.threshold,
  packageId: config.packageId,
  id,
  data: source,
});

const publisher = process.env.WALRUS_PUBLISHER_URL.replace(/\/$/, '');
const publishResponse = await fetch(`${publisher}/v1/blobs`, {
  method: 'PUT',
  headers: { 'Content-Type': 'text/plain' },
  body: Buffer.from(encryptedObject).toString('base64'),
});
assert.ok(publishResponse.ok, `Walrus publisher returned ${publishResponse.status}.`);
const published = await publishResponse.json();
const blobId = published.newlyCreated?.blobObject?.blobId
  ?? published.newlyCreated?.blobId
  ?? published.alreadyCertified?.blobId
  ?? published.blobId;
assert.ok(blobId, 'Walrus publisher response did not include a blob ID.');

const aggregator = process.env.WALRUS_AGGREGATOR_URL.replace(/\/$/, '');
const retrieveResponse = await fetch(`${aggregator}/v1/blobs/${encodeURIComponent(blobId)}`);
assert.ok(retrieveResponse.ok, `Walrus aggregator returned ${retrieveResponse.status}.`);
const loaded = await retrieveResponse.text();

const sessionKey = await SessionKey.create({
  address: signer.toSuiAddress(),
  packageId: config.packageId,
  ttlMin: 10,
  signer,
  suiClient,
});
const tx = new Transaction();
tx.moveCall({
  target: config.approveTarget,
  arguments: [tx.pure.vector('u8', fromHex(id)), tx.object(config.policyObjectId)],
});
const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });
const plaintext = await client.decrypt({
  data: Buffer.from(loaded, 'base64'),
  sessionKey,
  txBytes,
  checkShareConsistency: true,
});
assert.deepEqual(plaintext, source);
console.log(`Seal -> Walrus -> Seal round trip passed for ${blobId}.`);
