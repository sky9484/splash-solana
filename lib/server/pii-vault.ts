import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { kmsContextBytes, type Kms, type KmsContext } from '@/lib/server/kms/types';

/**
 * Full bank account numbers, encrypted (prompt 10 Phase S §S.1.2; docs/security/PII-STORAGE-MEMO.md).
 *
 * Envelope encryption: each number gets its own random 32-byte data key and a new 12-byte nonce, and
 * is sealed with AES-256-GCM. The associated data is the company and the recipient, so a ciphertext
 * copied to another company (or recipient) fails to open, and so does one with a single byte changed.
 * The data key is then wrapped by the key service (`lib/server/kms`) under the same context and
 * dropped; only the wrapped form is stored.
 *
 * Who may open one is decided by the callers, not here: the payout path while it builds the partner's
 * instruction, and a person through the reveal route (owner or finance admin, a fresh device approval,
 * 30 seconds, every attempt logged). Zeke never: it sees `•••• 4471`.
 *
 * Nothing here logs, and no error carries the number.
 */

export class VaultError extends Error {
  readonly code: 'invalid_number' | 'cannot_open' | 'shredded';

  constructor(code: VaultError['code'], message: string) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
  }
}

export interface SealedNumber {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  wrappedDataKey: Uint8Array;
  keyId: string;
  last4: string;
  fingerprint: string;
}

/** What is stored, as the vault needs it to open. A shredded record has no ciphertext or key. */
export interface OpenableNumber {
  ciphertext: Uint8Array | null;
  nonce: Uint8Array | null;
  wrappedDataKey: Uint8Array | null;
}

/** Digits only: spaces and dashes people type (and the 4-4-4 grouping) are dropped. 6 to 20 digits. */
export function normaliseAccountNumber(raw: string): string {
  const digits = raw.replace(/[\s-]/g, '');
  if (!/^\d{6,20}$/.test(digits)) throw new VaultError('invalid_number', 'An account number is 6 to 20 digits.');
  return digits;
}

export const last4Of = (accountNumber: string) => normaliseAccountNumber(accountNumber).slice(-4);

/**
 * A keyed fingerprint of (bank code + number), to spot the same account twice without opening anything.
 * Keyed by the key service, never a plain or salted hash: a 10 to 16 digit number is brute-forced in
 * minutes from a hash.
 */
export async function fingerprintOf(kms: Kms, bankCode: string, accountNumber: string): Promise<string> {
  const bank = bankCode.trim().toUpperCase();
  if (!bank) throw new VaultError('invalid_number', 'A bank is needed with the account number.');
  const mac = await kms.hmac(new TextEncoder().encode(`splash:pii:fingerprint:v1\nbank:${bank}\naccount:${normaliseAccountNumber(accountNumber)}`));
  return Buffer.from(mac).toString('hex');
}

export async function sealNumber(kms: Kms, ctx: KmsContext & { bankCode: string; accountNumber: string }): Promise<SealedNumber> {
  const digits = normaliseAccountNumber(ctx.accountNumber);
  const context = { orgId: ctx.orgId, beneficiaryId: ctx.beneficiaryId };
  const dataKey = randomBytes(32);
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dataKey, nonce);
    cipher.setAAD(kmsContextBytes(context));
    const ciphertext = Buffer.concat([cipher.update(digits, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    const wrappedDataKey = await kms.wrap(new Uint8Array(dataKey), context);
    return {
      ciphertext: new Uint8Array(ciphertext),
      nonce: new Uint8Array(nonce),
      wrappedDataKey,
      keyId: kms.keyId(),
      last4: digits.slice(-4),
      fingerprint: await fingerprintOf(kms, ctx.bankCode, digits),
    };
  } finally {
    dataKey.fill(0);
  }
}

export async function openNumber(kms: Kms, sealed: OpenableNumber, context: KmsContext): Promise<string> {
  if (!sealed.ciphertext || !sealed.nonce || !sealed.wrappedDataKey) throw new VaultError('shredded', 'This bank number was destroyed and cannot be shown.');
  let dataKey: Buffer | null = null;
  try {
    dataKey = Buffer.from(await kms.unwrap(sealed.wrappedDataKey, context));
    const body = Buffer.from(sealed.ciphertext);
    if (body.length < 17) throw new Error('short');
    const decipher = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(sealed.nonce));
    decipher.setAAD(kmsContextBytes(context));
    decipher.setAuthTag(body.subarray(body.length - 16));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString('utf8');
  } catch {
    // Wrong company or recipient, a changed byte, or the wrong key: all the same to the caller.
    throw new VaultError('cannot_open', 'This bank number could not be opened.');
  } finally {
    dataKey?.fill(0);
  }
}

/**
 * Key rotation: unwrap a record's data key with the old key service and wrap it with the new one. The
 * number itself is never decrypted. docs/security/BREACH-PLAN.md runs this over every record.
 */
export async function rewrapDataKey(from: Kms, to: Kms, sealed: OpenableNumber, context: KmsContext): Promise<{ wrappedDataKey: Uint8Array; keyId: string }> {
  if (!sealed.wrappedDataKey) throw new VaultError('shredded', 'This bank number was destroyed and cannot be shown.');
  const dataKey = await from.unwrap(sealed.wrappedDataKey, context);
  try {
    return { wrappedDataKey: await to.wrap(dataKey, context), keyId: to.keyId() };
  } finally {
    dataKey.fill(0);
  }
}
