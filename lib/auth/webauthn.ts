import { ECDH, createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';

/**
 * Plain WebAuthn assertion verification, server side, with node:crypto only
 * (prompt 07 §3.2: the passkey is a sign-in / step-up factor, not a vault
 * signer; §4.1: no Sui SDK outside lib/evidence-sui).
 *
 * The browser signs `challenge = sha256(message)`, so an assertion is bound to
 * exactly the message the server built (the approval it describes). Checks, in
 * order, all fail-closed:
 *   - the assertion names the enrolled credential id;
 *   - clientDataJSON: type "webauthn.get", challenge equals ours, origin's
 *     host is the relying party;
 *   - authenticatorData: rpIdHash = sha256(rpId), user present AND verified;
 *   - ECDSA P-256 over authenticatorData ‖ sha256(clientDataJSON) verifies
 *     against the ENROLLED public key (never a key the request brings).
 *
 * Enrolled keys are stored as 33-byte compressed P-256 points (base64), the
 * same bytes the earlier build stored, so existing passkeys keep working.
 */

export interface WebAuthnAssertion {
  /** base64url credential id. */
  credentialId: string;
  /** base64url. */
  authenticatorData: string;
  /** base64url of the exact clientDataJSON bytes. */
  clientDataJSON: string;
  /** base64url DER-encoded ECDSA signature. */
  signature: string;
}

export type AssertionCheck = { ok: true } | { ok: false; reason: string };

const b64u = (s: string) => Buffer.from(s, 'base64url');

/** The challenge a browser signs for `message`. */
export function challengeFor(message: Uint8Array): Buffer {
  return createHash('sha256').update(message).digest();
}

/** Parse the wire form the browser sends: base64url JSON of a WebAuthnAssertion. */
export function parseAssertion(serialized: string): WebAuthnAssertion | null {
  try {
    const raw = JSON.parse(b64u(serialized).toString('utf8')) as Record<string, unknown>;
    const pick = (k: string) => (typeof raw[k] === 'string' && raw[k] ? (raw[k] as string) : null);
    const credentialId = pick('credentialId');
    const authenticatorData = pick('authenticatorData');
    const clientDataJSON = pick('clientDataJSON');
    const signature = pick('signature');
    if (!credentialId || !authenticatorData || !clientDataJSON || !signature) return null;
    return { credentialId, authenticatorData, clientDataJSON, signature };
  } catch {
    return null;
  }
}

function publicKeyFromCompressed(compressedB64: string) {
  const compressed = Buffer.from(compressedB64, 'base64');
  if (compressed.length !== 33 || (compressed[0] !== 0x02 && compressed[0] !== 0x03)) {
    throw new Error('stored key is not a 33-byte compressed P-256 point');
  }
  const uncompressed = ECDH.convertKey(compressed, 'prime256v1', undefined, undefined, 'uncompressed') as Buffer;
  return createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: uncompressed.subarray(1, 33).toString('base64url'), y: uncompressed.subarray(33, 65).toString('base64url') },
    format: 'jwk',
  });
}

/** SPKI DER (what PublicKeyCredential.getPublicKey() returns) → compressed P-256, base64. */
export function spkiToCompressedP256(spkiDer: Uint8Array): string {
  const jwk = createPublicKey({ key: Buffer.from(spkiDer), format: 'der', type: 'spki' }).export({ format: 'jwk' }) as { crv?: string; x?: string; y?: string };
  if (jwk.crv !== 'P-256' || !jwk.x || !jwk.y) throw new Error('passkey is not a P-256 key');
  const x = b64u(jwk.x);
  const y = b64u(jwk.y);
  const prefix = (y[y.length - 1] & 1) === 0 ? 0x02 : 0x03;
  return Buffer.concat([Buffer.from([prefix]), x]).toString('base64');
}

export function verifyAssertion(input: {
  assertion: WebAuthnAssertion;
  enrolled: { credentialId: string; publicKey: string; rpId: string };
  challenge: Uint8Array;
}): AssertionCheck {
  const { assertion, enrolled } = input;
  if (assertion.credentialId !== enrolled.credentialId) return { ok: false, reason: 'not the enrolled passkey' };

  let clientData: { type?: unknown; challenge?: unknown; origin?: unknown };
  const clientDataBytes = b64u(assertion.clientDataJSON);
  try {
    clientData = JSON.parse(clientDataBytes.toString('utf8'));
  } catch {
    return { ok: false, reason: 'client data is not JSON' };
  }
  if (clientData.type !== 'webauthn.get') return { ok: false, reason: 'not an assertion' };
  if (typeof clientData.challenge !== 'string' || !b64u(clientData.challenge).equals(Buffer.from(input.challenge))) {
    return { ok: false, reason: 'the passkey signed a different challenge' };
  }
  let originHost = '';
  try {
    originHost = new URL(String(clientData.origin)).hostname;
  } catch {
    return { ok: false, reason: 'origin is missing' };
  }
  if (originHost !== enrolled.rpId) return { ok: false, reason: 'signed for another site' };

  const authData = b64u(assertion.authenticatorData);
  if (authData.length < 37) return { ok: false, reason: 'authenticator data is too short' };
  if (!authData.subarray(0, 32).equals(createHash('sha256').update(enrolled.rpId).digest())) {
    return { ok: false, reason: 'authenticator data is for another site' };
  }
  const flags = authData[32];
  if ((flags & 0x01) === 0) return { ok: false, reason: 'user was not present' };
  if ((flags & 0x04) === 0) return { ok: false, reason: 'user was not verified (biometric or PIN required)' };

  try {
    const signed = Buffer.concat([authData, createHash('sha256').update(clientDataBytes).digest()]);
    const ok = cryptoVerify('sha256', signed, publicKeyFromCompressed(enrolled.publicKey), b64u(assertion.signature));
    return ok ? { ok: true } : { ok: false, reason: 'the signature does not match the enrolled passkey' };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'signature could not be checked' };
  }
}
