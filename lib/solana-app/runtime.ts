/**
 * Process-wide pieces the Solana app needs, built once and kept on globalThis:
 *   - the chain client, from `chain()` (offline → the shared simulator,
 *     devnet → DevnetChain). One code path for both modes.
 *   - the mock payout partner ("Test payout partner") with a random webhook
 *     secret minted at startup;
 *   - the evidence attester key (Splash's, never a vault member: I-1), and the
 *     Splash fee account owner (receives the fee leg; never a payout target);
 *   - the single-use nonce store for proof of possession;
 *   - the evidence store and the key that seals bundles before storing;
 *   - the payment repository (prompt 07 §5.1): Postgres when DATABASE_URL is set (unless
 *     SOLANA_PAYMENT_STORE=memory), so payments survive a restart; memory otherwise;
 *   - the document store for companies, invoices, evidence and share links, chosen the same way.
 *
 * Env read here: `readSolanaEnv` (SPLASH_SOLANA_MODE and friends), DATABASE_URL and
 * SOLANA_PAYMENT_STORE.
 */
import { Keypair, PublicKey } from '@solana/web3.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

import { readSolanaEnv, type SolanaEnv } from '../solana/config.ts';
import { utcDay } from '../solana/kora.ts';
import { createMemoryNonceStore, type NonceStore } from '../solana/recovery-kit.ts';
import { chain, resetChain, type ChainClient } from '../solana/simulator.ts';
import { createMockPartner, type MockPayoutPartner } from '../solana-partner/mock-partner.ts';
import { InMemoryEvidenceStore } from '../solana-evidence/store.ts';
import { getDb } from '../db/client.ts';
import { createMemorySecretStore, createPostgresSecretStore, type SecretStore } from './bank-secret-store.ts';
import { createMemoryDocStore, createPostgresDocStore, type DocStore } from './doc-store.ts';
import { createMemoryPaymentRepo, createPostgresPaymentRepo, type PaymentRepo } from './payment-repo.ts';
import { createMemorySponsorLedger, createPostgresSponsorLedger, type SponsorLedger } from './sponsor-ledger.ts';
import { store } from './store.ts';

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
  payments: PaymentRepo;
  /** Per-org daily sponsored-transaction counter, checked before Kora (§5.6). Same store as payments. */
  sponsors: SponsorLedger;
  /** Companies, invoices, evidence and share links (solana_documents). Same store as payments. */
  docs: DocStore;
  /** Full bank account numbers, sealed, and the log of every attempt to see one (prompt 10 Phase S). Same store as payments. */
  secrets: SecretStore;
}

function wantsPostgres(source: NodeJS.ProcessEnv): boolean {
  const choice = (source.SOLANA_PAYMENT_STORE ?? '').trim();
  if (choice === 'memory' || (choice !== 'postgres' && !source.DATABASE_URL)) return false;
  if (!source.DATABASE_URL) throw new Error('SOLANA_PAYMENT_STORE=postgres needs DATABASE_URL');
  return true;
}

/** Postgres when a database is configured, unless told otherwise; memory for the offline demo and tests. */
export function paymentRepoFor(source: NodeJS.ProcessEnv): PaymentRepo {
  // getDb opens the pool on first use only, so the offline demo never connects.
  return wantsPostgres(source) ? createPostgresPaymentRepo(getDb()) : createMemoryPaymentRepo();
}

/** Bank numbers live where payments do: Postgres with a database, memory for the offline demo (nothing on disk). */
export function secretStoreFor(source: NodeJS.ProcessEnv): SecretStore {
  return wantsPostgres(source) ? createPostgresSecretStore(getDb()) : createMemorySecretStore();
}

export function sponsorLedgerFor(source: NodeJS.ProcessEnv): SponsorLedger {
  return wantsPostgres(source) ? createPostgresSponsorLedger(getDb()) : createMemorySponsorLedger();
}

export function docStoreFor(source: NodeJS.ProcessEnv): DocStore {
  return wantsPostgres(source) ? createPostgresDocStore(getDb()) : createMemoryDocStore();
}

const G = globalThis as typeof globalThis & { __splashSolanaRuntime?: SolanaAppRuntime };

/**
 * Every sponsored send goes through here, whichever service makes it (payments, batches, moves,
 * vault creation, anchors). Two rules sit at this one choke point, in front of Kora:
 *   - a company Splash has suspended gets no fee-payer signature, whatever code path asks
 *     (the services check too; this is the last word);
 *   - what each landed send cost the fee payer (its fee, exactly, and the rent of the accounts it
 *     created) goes to the sponsor ledger, for the admin console. A ledger write that fails never
 *     fails the send: the money already moved.
 * Everything else passes straight through to the chain client.
 */
export function sponsorAccountedChain(inner: ChainClient, ledger: () => SponsorLedger): ChainClient {
  return new Proxy(inner, {
    get(target, prop) {
      if (prop === 'sendSponsored') {
        return async (tx: Parameters<ChainClient['sendSponsored']>[0], ctx: Parameters<ChainClient['sendSponsored']>[1] = {}) => {
          const orgId = ctx.orgId;
          if (orgId && store().orgs.get(orgId)?.suspended) {
            throw new Error('Sponsorship refused: Splash has paused service for this company. Nothing was signed or sent.');
          }
          const receipt = await target.sendSponsored(tx, ctx);
          if (orgId && receipt.cost) {
            try {
              await ledger().addSpend(orgId, utcDay(ctx.now ?? new Date()), receipt.cost);
            } catch {
              /* the send landed; only the console's spend line is behind */
            }
          }
          return receipt;
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function envKey(env: SolanaEnv): string {
  return `${env.mode}|${env.cluster}|${env.rpcUrl}|${env.koraRpcUrl ?? ''}`;
}

export function runtime(source: NodeJS.ProcessEnv = process.env): SolanaAppRuntime {
  const env = readSolanaEnv(source);
  const key = `${envKey(env)}|${source.SOLANA_PAYMENT_STORE ?? ''}|${source.DATABASE_URL ? 'db' : 'nodb'}`;
  if (G.__splashSolanaRuntime && G.__splashSolanaRuntime.key === key) return G.__splashSolanaRuntime;
  const webhookSecret = new Uint8Array(32);
  globalThis.crypto.getRandomValues(webhookSecret);
  const rt: SolanaAppRuntime = {
    key,
    env,
    chain: sponsorAccountedChain(chain(source), () => rt.sponsors),
    partner: createMockPartner({ webhookSecret, seed: `splash-devnet-${Date.now()}` }),
    webhookSecret,
    attester: Keypair.generate(),
    feeAccountOwner: new PublicKey(sha256(utf8ToBytes('splash:solana:fee-account:v1'))),
    nonces: createMemoryNonceStore(),
    evidence: new InMemoryEvidenceStore(),
    sealKey: globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) as Promise<CryptoKey>,
    payments: paymentRepoFor(source),
    sponsors: sponsorLedgerFor(source),
    secrets: secretStoreFor(source),
    docs: docStoreFor(source),
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
