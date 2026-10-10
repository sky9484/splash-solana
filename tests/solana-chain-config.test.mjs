// Config: program ids match the libraries they came from; env reader is strict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as multisig from '@sqds/multisig';
import { PublicKey } from '@solana/web3.js';

import { CCTP_DOMAINS, CCTP_FINALITY, SOLANA_CONFIG, SOLANA_PROGRAMS, explorerTxUrl, readSolanaEnv } from '../lib/solana/config.ts';

test('program ids are valid and match their sources', () => {
  for (const id of Object.values(SOLANA_PROGRAMS)) assert.equal(new PublicKey(id).toBase58(), id);
  assert.equal(SOLANA_PROGRAMS.squadsV4, multisig.PROGRAM_ID.toBase58());
  assert.equal(SOLANA_PROGRAMS.cctpMessageTransmitterV2, 'CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC');
  assert.equal(SOLANA_PROGRAMS.cctpTokenMessengerMinterV2, 'CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe');
  assert.equal(SOLANA_CONFIG['mainnet-beta'].usdcMint, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  assert.equal(SOLANA_CONFIG.devnet.usdcMint, '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
  assert.deepEqual(CCTP_DOMAINS, { solana: 5, polygon: 7 });
  assert.deepEqual(CCTP_FINALITY, { standard: 2000, fast: 1000 });
});

test('env reader: offline + devnet by default, strict on typos, no mainnet', () => {
  assert.deepEqual(readSolanaEnv({}), { mode: 'offline', cluster: 'devnet', rpcUrl: 'https://api.devnet.solana.com', koraRpcUrl: null });
  const env = readSolanaEnv({ SPLASH_SOLANA_MODE: 'devnet', SOLANA_RPC_URL: 'https://rpc.example', KORA_RPC_URL: 'http://localhost:8080' });
  assert.equal(env.mode, 'devnet');
  assert.equal(env.koraRpcUrl, 'http://localhost:8080');
  assert.throws(() => readSolanaEnv({ SPLASH_SOLANA_MODE: 'mainnet' }), /SPLASH_SOLANA_MODE/);
  assert.throws(() => readSolanaEnv({ SOLANA_CLUSTER: 'testnet' }), /SOLANA_CLUSTER/);
  assert.throws(() => readSolanaEnv({ SOLANA_CLUSTER: 'mainnet-beta' }), /not enabled/);
  assert.throws(() => readSolanaEnv({ SOLANA_RPC_URL: 'ftp://x' }), /http/);
  assert.equal(explorerTxUrl('abc', 'devnet'), 'https://explorer.solana.com/tx/abc?cluster=devnet');
});
