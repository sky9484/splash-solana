import { readSolanaEnv } from '@/lib/solana/config';

import { awsKmsFromEnv } from './aws';
import { localKmsFromEnv } from './local';
import type { Kms } from './types';

export type { Kms, KmsContext } from './types';
export { kmsContextBytes } from './types';

/**
 * The key service for bank-number storage (prompt 10 Phase S, decision 15), chosen by `PII_KMS`:
 *
 *   local  (now)     keys from PII_LOCAL_WRAP_KEY and PII_LOCAL_HMAC_KEY, server environment only.
 *                    Refused in production unless PII_ALLOW_LOCAL_IN_PROD=1, which is logged.
 *   aws    (target)  AWS KMS in ap-southeast-1: PII_AWS_KMS_KEY_ARN wraps, PII_AWS_HMAC_KEY_ARN
 *                    fingerprints. Must be on before any real customer's bank number is stored.
 *
 * One instance per process, made on first use (instrumentation.ts makes it at start-up, so a refusal
 * stops the server rather than the first payment).
 */
const G = globalThis as typeof globalThis & { __splashKms?: { key: string; kms: Kms } };

function cacheKey(source: NodeJS.ProcessEnv): string {
  return [source.PII_KMS, source.NODE_ENV, source.PII_ALLOW_LOCAL_IN_PROD, source.PII_LOCAL_WRAP_KEY, source.PII_LOCAL_HMAC_KEY, source.PII_AWS_KMS_KEY_ARN, source.PII_AWS_HMAC_KEY_ARN, source.SPLASH_SOLANA_MODE]
    .map((v) => v ?? '')
    .join('|');
}

export function kmsFromEnv(source: NodeJS.ProcessEnv = process.env): Kms {
  const key = cacheKey(source);
  if (G.__splashKms?.key === key) return G.__splashKms.kms;
  const choice = (source.PII_KMS ?? 'local').trim() || 'local';
  let kms: Kms;
  if (choice === 'aws') kms = awsKmsFromEnv(source);
  else if (choice === 'local') kms = localKmsFromEnv(source, { production: source.NODE_ENV === 'production', offline: readSolanaEnv(source).mode === 'offline' });
  else throw new Error(`PII_KMS must be "local" or "aws", not "${choice}"`);
  G.__splashKms = { key, kms };
  return kms;
}

/** Tests: forget the process's key service. */
export function resetKms(): void {
  delete G.__splashKms;
}
