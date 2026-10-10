/**
 * Process-wide pieces the Solana app needs, built once and kept on globalThis:
 *   - the chain client, from `chain()` (offline → the shared simulator,
 *     devnet → DevnetChain). One code path for both modes.
 *   - the mock payout partner ("Mock partner · devnet") with a random webhook
 *     secret minted at startup;
 *   - the evidence attester key (Splash's, never a vault member: I-1), and the
 *     Splash fee account owner (receives the fee leg; never a payout target);
 *   - the single-use nonce store for proof of possession;
 *   - the evidence store and the key that seals bundles before storing.
 *
 * No env is read here beyond `readSolanaEnv` (SPLASH_SOLANA_MODE and friends).
 */
import { Keypair, PublicKey } from '@solana/web3.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

import { readSolanaEnv, type SolanaEnv } from '../solana/config.ts';
import { createMemoryNonceStore, type NonceStore } from '../solana/recovery-kit.ts';
import { chain, resetChain, type ChainClient } from '../solana/simulator.ts';
import { createMockPartner, type MockPayoutPartner } from '../solana-partner/mock-partner.ts';
import { InMemoryEvidenceStore } from '../solana-evidence/store.ts';

export interface SolanaAppRuntime {
  key: string;
  env: SolanaEnv;
  chain: ChainClient;
  partner: MockPayoutPartner;
  webhookSecret: Uint8Array;
  attester: Keypair;
  /**
   * Owner of the Splash fee token account. Derived from a fixed seed: an address nobody holds a key
   * for. Fine for the offline demo and devnet; a real fee account is configured before mainnet.
   */
  feeAccountOwner: PublicKey;
  nonces: NonceStore;
  evidence: InMemoryEvidenceStore;
  sealKey: Promise<CryptoKey>;
}

const G = globalThis as typeof globalThis & { __splashSolanaRuntime?: SolanaAppRuntime };

function envKey(env: SolanaEnv): string {
  return `${env.mode}|${env.cluster}|${env.rpcUrl}|${env.koraRpcUrl ?? ''}`;
}

export function runtime(source: NodeJS.ProcessEnv = process.env): SolanaAppRuntime {
  const env = readSolanaEnv(source);
  const key = envKey(env);
  if (G.__splashSolanaRuntime && G.__splashSolanaRuntime.key === key) return G.__splashSolanaRuntime;
  const webhookSecret = new Uint8Array(32);
  globalThis.crypto.getRandomValues(webhookSecret);
  const rt: SolanaAppRuntime = {
    key,
    env,
    chain: chain(source),
    partner: createMockPartner({ webhookSecret, seed: `splash-devnet-${Date.now()}` }),
    webhookSecret,
    attester: Keypair.generate(),
    feeAccountOwner: new PublicKey(sha256(utf8ToBytes('splash:solana:fee-account:v1'))),
    nonces: createMemoryNonceStore(),
    evidence: new InMemoryEvidenceStore(),
    sealKey: globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) as Promise<CryptoKey>,
  };
  G.__splashSolanaRuntime = rt;
  return rt;
}

/** Tests only: drop the runtime and the shared chain client. */
export function resetRuntime(): void {
  G.__splashSolanaRuntime = undefined;
  resetChain();
}

/** Every key Splash controls. None may be a vault member or a payout destination. */
export async function splashKeys(rt: SolanaAppRuntime = runtime()): Promise<string[]> {
  const feePayer = await rt.chain.getFeePayer();
  return [feePayer.toBase58(), rt.attester.publicKey.toBase58(), rt.feeAccountOwner.toBase58()];
}
