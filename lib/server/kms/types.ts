/**
 * What a bank number's key service does (prompt 10 Phase S §S.1.3). Two adapters: `local.ts` (now) and
 * `aws.ts` (the target, AWS KMS in ap-southeast-1). The vault (`lib/server/pii-vault.ts`) never sees a
 * master key: it hands a data key to `wrap` and gets bytes back.
 */
export interface Kms {
  readonly kind: 'local' | 'aws';
  /** Which master key wraps new data keys. Stored beside each record, so a rotation knows what to re-wrap. */
  keyId(): string;
  /** Wrap a 32-byte data key. The context is bound to the result: unwrapping under another one fails. */
  wrap(dataKey: Uint8Array, context: KmsContext): Promise<Uint8Array>;
  unwrap(wrapped: Uint8Array, context: KmsContext): Promise<Uint8Array>;
  /** HMAC-SHA256 under the fingerprint key, which is never the wrapping key. */
  hmac(message: Uint8Array): Promise<Uint8Array>;
}

/** Whose number this is. A wrapped key or ciphertext copied to another company, or another recipient, fails. */
export interface KmsContext {
  orgId: string;
  beneficiaryId: string;
}

/** The context as bytes: the AES-GCM associated data for the number and for a locally wrapped key. */
export function kmsContextBytes(ctx: KmsContext): Uint8Array {
  if (!ctx.orgId || !ctx.beneficiaryId) throw new Error('a bank number belongs to a company and a recipient');
  return new TextEncoder().encode(`splash:pii:v1\norg:${ctx.orgId}\nbeneficiary:${ctx.beneficiaryId}`);
}
