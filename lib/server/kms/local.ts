import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { kmsContextBytes, type Kms } from './types';

/**
 * The local key service (decision 15: "a local key for now, server environment only, never in git").
 *
 * Two 32-byte keys: one wraps data keys (AES-256-GCM, the company and recipient bound in as associated
 * data), the other makes fingerprints (HMAC-SHA256). They are separate so a fingerprint never says
 * anything about the wrapping key. AWS KMS in ap-southeast-1 replaces this before any real customer's
 * bank number is stored (`aws.ts`, docs/security/PII-STORAGE.md).
 */

const VERSION = 1;
const NONCE = 12;
const TAG = 16;

export function createLocalKms(keys: { wrapKey: Uint8Array; hmacKey: Uint8Array }): Kms {
  const wrapKey = Buffer.from(keys.wrapKey);
  const hmacKey = Buffer.from(keys.hmacKey);
  if (wrapKey.length !== 32 || hmacKey.length !== 32) throw new Error('PII_LOCAL_WRAP_KEY and PII_LOCAL_HMAC_KEY must each be 32 bytes (base64)');
  if (timingSafeEqual(wrapKey, hmacKey)) throw new Error('PII_LOCAL_WRAP_KEY and PII_LOCAL_HMAC_KEY must be different keys');
  // A name for the key, not the key: enough to tell which one wrapped a record.
  const id = `local:${createHash('sha256').update('splash:pii:local-key-id:v1\n').update(wrapKey).digest('hex').slice(0, 16)}`;
  return {
    kind: 'local',
    keyId: () => id,
    async wrap(dataKey, context) {
      if (dataKey.length !== 32) throw new Error('a data key is 32 bytes');
      const nonce = randomBytes(NONCE);
      const cipher = createCipheriv('aes-256-gcm', wrapKey, nonce);
      cipher.setAAD(kmsContextBytes(context));
      const body = Buffer.concat([cipher.update(dataKey), cipher.final()]);
      return new Uint8Array(Buffer.concat([Buffer.from([VERSION]), nonce, body, cipher.getAuthTag()]));
    },
    async unwrap(wrapped, context) {
      const w = Buffer.from(wrapped);
      if (w.length !== 1 + NONCE + 32 + TAG || w[0] !== VERSION) throw new Error('not a wrapped data key');
      const decipher = createDecipheriv('aes-256-gcm', wrapKey, w.subarray(1, 1 + NONCE));
      decipher.setAAD(kmsContextBytes(context));
      decipher.setAuthTag(w.subarray(w.length - TAG));
      return new Uint8Array(Buffer.concat([decipher.update(w.subarray(1 + NONCE, w.length - TAG)), decipher.final()]));
    },
    async hmac(message) {
      return new Uint8Array(createHmac('sha256', hmacKey).update(message).digest());
    },
  };
}

const G = globalThis as typeof globalThis & { __splashPiiLogged?: Set<string> };
function once(tag: string, log: () => void) {
  const seen = (G.__splashPiiLogged ??= new Set());
  if (seen.has(tag)) return;
  seen.add(tag);
  log();
}

function key32(name: string, value: string | undefined): Buffer | null {
  if (!value?.trim()) return null;
  const bytes = Buffer.from(value.trim(), 'base64');
  if (bytes.length !== 32) throw new Error(`${name} must be 32 bytes, base64-encoded (openssl rand -base64 32)`);
  return bytes;
}

/**
 * The local adapter from the environment:
 *   - production: refused unless PII_ALLOW_LOCAL_IN_PROD=1, and then a warning is logged;
 *   - offline simulator with no keys set: throwaway keys made in memory, logged once (the demo needs no
 *     setup, and a number stored with them cannot be read after a restart);
 *   - anything else needs both keys.
 */
export function localKmsFromEnv(source: NodeJS.ProcessEnv, mode: { production: boolean; offline: boolean }): Kms {
  if (mode.production) {
    if (source.PII_ALLOW_LOCAL_IN_PROD !== '1') {
      throw new Error('PII_KMS=local is refused in production: bank numbers need AWS KMS (PII_KMS=aws, ap-southeast-1). Set PII_ALLOW_LOCAL_IN_PROD=1 only for a deliberate, logged exception.');
    }
    once('local-in-prod', () => console.warn('[pii] WARNING: bank numbers are wrapped with the LOCAL key in production (PII_ALLOW_LOCAL_IN_PROD=1). Switch to PII_KMS=aws before any real customer’s number is stored.'));
  }
  const wrapKey = key32('PII_LOCAL_WRAP_KEY', source.PII_LOCAL_WRAP_KEY);
  const hmacKey = key32('PII_LOCAL_HMAC_KEY', source.PII_LOCAL_HMAC_KEY);
  if (wrapKey && hmacKey) return createLocalKms({ wrapKey, hmacKey });
  if (wrapKey || hmacKey) throw new Error('Set both PII_LOCAL_WRAP_KEY and PII_LOCAL_HMAC_KEY, or neither (offline demo only).');
  if (mode.offline && !mode.production) {
    once('throwaway', () => console.info('[pii] No PII_LOCAL_* keys: using throwaway keys for this process (offline demo). Bank numbers stored now cannot be read after a restart.'));
    return createLocalKms({ wrapKey: randomBytes(32), hmacKey: randomBytes(32) });
  }
  throw new Error('Bank numbers need PII_LOCAL_WRAP_KEY and PII_LOCAL_HMAC_KEY (base64, 32 bytes each), or PII_KMS=aws.');
}
