import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { SealClient } from '@mysten/seal';
import { fromHex, toHex } from '@mysten/sui/utils';

import { evidenceSuiClient } from '@/lib/evidence-sui/client';
import { getSealConfig } from '@/lib/evidence-sui/seal-config';
import { assertSealWritable } from '@/lib/evidence-sui/seal-health';
import { canUseDemoCrypto } from '@/lib/server/runtime-mode';

/**
 * Seal encryption for evidence (prompt 07 §4).
 *
 * The server ENCRYPTS: encrypting needs no secret, only the key servers'
 * public keys and the organisation's allowlist id. The server sees an
 * evidence bundle in plaintext once, when it builds it, then keeps only the
 * ciphertext. "Splash keeps no readable copy."
 *
 * The server does NOT decrypt in live mode, and holds no key that could. A
 * Seal session key is a personal message signed by an allowlisted address;
 * in the Solana build that address is the member's device key, which lives
 * non-extractable in their browser (lib/evidence-sui/device-sui-signer.ts),
 * so decryption happens there. The earlier build signed session keys with
 * the server's operator key; that path is gone.
 *
 * Demo mode keeps a server-side AES stand-in so the offline demo and tests can
 * round-trip. It is labelled `mode: 'demo'` everywhere and never runs live.
 */

export type SealPolicy = {
  policyId: string;
  allowlist: string[];
  createdAt: string;
  mode: 'demo' | 'live';
  sealId?: string;
  /** The Seal allowlist object the identity was prefixed with (live). */
  allowlistObjectId?: string;
};

export interface SealAdapter {
  encrypt(data: string, allowlist: string[], options?: { allowlistObjectId?: string }): Promise<{ ciphertext: string; policy: SealPolicy }>;
  canDecrypt(policyId: string, identity: string): Promise<boolean>;
  decrypt(ciphertext: string, policyId: string, identity: string): Promise<string | null>;
}

export class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotConfiguredError';
  }
}

/** Live evidence is decrypted in the member's browser, never on the server. */
export class BrowserDecryptOnlyError extends Error {
  constructor() {
    super('Evidence is decrypted in your browser with your device key. The server keeps no readable copy.');
    this.name = 'BrowserDecryptOnlyError';
  }
}

export function shouldUseMockSeal(env: NodeJS.ProcessEnv = process.env) {
  return canUseDemoCrypto(env);
}

const DATA_DIR = process.env.SPLASH_DATA_DIR ?? path.join(process.cwd(), 'data');
const POLICY_PATH = path.join(DATA_DIR, 'seal-policies.json');
const globalPolicies = globalThis as typeof globalThis & {
  splashSealPolicies?: Map<string, SealPolicy>;
  splashSealClient?: SealClient;
};

function readPolicies() {
  try {
    const parsed = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8')) as SealPolicy[];
    return new Map(parsed.filter((policy) => policy?.policyId).map((policy) => [policy.policyId, policy]));
  } catch {
    return new Map<string, SealPolicy>();
  }
}

const policies = globalPolicies.splashSealPolicies ?? readPolicies();
globalPolicies.splashSealPolicies = policies;

function persistPolicies() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tempPath = `${POLICY_PATH}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify([...policies.values()], null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, POLICY_PATH);
}

function rememberPolicy(policy: SealPolicy) {
  policies.set(policy.policyId, policy);
  persistPolicies();
}

function secretKey() {
  return createHash('sha256').update(process.env.ADMIN_SESSION_SECRET || 'splash-seal-mock-development-key').digest();
}

function normalizedAllowlist(allowlist: string[]) {
  return [...new Set(allowlist.map((identity) => identity.trim().toLowerCase()).filter(Boolean))].sort();
}

/** Demo only: AES-GCM under a server key, so the offline demo can round-trip. Never live. */
export const mockSealAdapter: SealAdapter = {
  async encrypt(data, allowlist) {
    const createdAt = new Date().toISOString();
    const normalized = normalizedAllowlist(allowlist);
    const policyId = `DEMO_SEAL_${createHash('sha256').update(`${normalized.join('|')}:${createdAt}`).digest('hex').slice(0, 16)}`;
    const policy: SealPolicy = { policyId, allowlist: normalized, createdAt, mode: 'demo' };
    rememberPolicy(policy);

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
    const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: Buffer.concat([iv, tag, encrypted]).toString('base64'),
      policy,
    };
  },
  async canDecrypt(policyId, identity) {
    return policies.get(policyId)?.allowlist.includes(identity.trim().toLowerCase()) ?? false;
  },
  async decrypt(ciphertext, policyId, identity) {
    if (!(await this.canDecrypt(policyId, identity))) return null;
    const payload = Buffer.from(ciphertext, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', secretKey(), payload.subarray(0, 12));
    decipher.setAuthTag(payload.subarray(12, 28));
    return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8');
  },
};

function liveClient() {
  if (globalPolicies.splashSealClient) return globalPolicies.splashSealClient;
  const config = getSealConfig();
  if (!config.configured) {
    throw new NotConfiguredError('Live Seal package, policy object, or key-server committee is not configured.');
  }
  globalPolicies.splashSealClient = new SealClient({
    suiClient: evidenceSuiClient(),
    serverConfigs: config.serverConfigs,
    verifyKeyServers: config.mode !== 'decentralized',
    timeout: config.timeoutMs,
  });
  return globalPolicies.splashSealClient;
}

/**
 * The Seal identity: the allowlist object id followed by a random nonce, so
 * `seal_approve` can check the identity belongs to that allowlist.
 */
export function sealIdentity(allowlistObjectId: string, nonce: Uint8Array = randomBytes(5)): string {
  return toHex(new Uint8Array([...fromHex(allowlistObjectId), ...nonce]));
}

export const liveSealAdapter: SealAdapter = {
  async encrypt(data, allowlist, options = {}) {
    await assertSealWritable();
    const config = getSealConfig();
    const allowlistObjectId = options.allowlistObjectId ?? config.policyObjectId;
    const sealId = sealIdentity(allowlistObjectId);
    const { encryptedObject } = await liveClient().encrypt({
      threshold: config.threshold,
      packageId: config.packageId,
      id: sealId,
      data: new TextEncoder().encode(data),
    });
    const policy: SealPolicy = {
      policyId: `SEAL:${sealId}`,
      allowlist: normalizedAllowlist(allowlist),
      createdAt: new Date().toISOString(),
      mode: 'live',
      sealId,
      allowlistObjectId,
    };
    rememberPolicy(policy);
    return { ciphertext: Buffer.from(encryptedObject).toString('base64'), policy };
  },
  async canDecrypt(policyId, identity) {
    const policy = policies.get(policyId);
    if (!policy?.sealId) return false;
    return policy.allowlist.includes(identity.trim().toLowerCase());
  },
  async decrypt() {
    throw new BrowserDecryptOnlyError();
  },
};

export const sealAdapter: SealAdapter = {
  encrypt(data, allowlist, options) {
    return shouldUseMockSeal()
      ? mockSealAdapter.encrypt(data, allowlist, options)
      : liveSealAdapter.encrypt(data, allowlist, options);
  },
  async canDecrypt(policyId, identity) {
    if (policyId.startsWith('DEMO_SEAL_')) {
      return shouldUseMockSeal() ? mockSealAdapter.canDecrypt(policyId, identity) : false;
    }
    return liveSealAdapter.canDecrypt(policyId, identity);
  },
  async decrypt(ciphertext, policyId, identity) {
    if (policyId.startsWith('DEMO_SEAL_')) {
      return shouldUseMockSeal() ? mockSealAdapter.decrypt(ciphertext, policyId, identity) : null;
    }
    return liveSealAdapter.decrypt(ciphertext, policyId, identity);
  },
};

export function readSealPolicy(policyId: string) {
  return policies.get(policyId) ?? null;
}
