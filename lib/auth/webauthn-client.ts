/**
 * Browser side of the passkey (a sign-in / step-up factor; never a vault
 * signer). Plain WebAuthn: create a credential, and sign `sha256(message)`
 * with it. Verified on the server by lib/auth/webauthn.ts.
 */

const toB64u = (bytes: ArrayBuffer | Uint8Array) => {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromB64u = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && Boolean(navigator.credentials);
}

/** Make a platform passkey. Returns the credential id and its SPKI public key (both base64url). */
export async function createPasskey(input: { rpId: string; userId: string; userName: string }): Promise<{ credentialId: string; spkiPublicKey: string }> {
  const credential = (await navigator.credentials.create({
    publicKey: {
      rp: { id: input.rpId, name: 'Splash' },
      user: { id: new TextEncoder().encode(input.userId), name: input.userName, displayName: input.userName },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }], // ES256 (P-256)
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      attestation: 'none',
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error('No passkey was created.');
  const response = credential.response as AuthenticatorAttestationResponse;
  const spki = response.getPublicKey?.();
  if (!spki) throw new Error('This browser did not return the passkey’s public key. Use a recent Chrome, Safari or Edge.');
  return { credentialId: toB64u(credential.rawId), spkiPublicKey: toB64u(spki) };
}

/** Sign `message` with the given passkey. Returns the serialized assertion the server verifies. */
export async function signWithPasskey(passkey: { credentialId: string; rpId: string }, message: string | Uint8Array): Promise<string> {
  const bytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  const challenge = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: passkey.rpId,
      allowCredentials: [{ type: 'public-key', id: fromB64u(passkey.credentialId) }],
      userVerification: 'required',
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error('The passkey prompt was closed.');
  const response = credential.response as AuthenticatorAssertionResponse;
  const assertion = {
    credentialId: toB64u(credential.rawId),
    authenticatorData: toB64u(response.authenticatorData),
    clientDataJSON: toB64u(response.clientDataJSON),
    signature: toB64u(response.signature),
  };
  return toB64u(new TextEncoder().encode(JSON.stringify(assertion)));
}

/** A person-readable reason for a failed passkey prompt. */
export function describePasskeyError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError') return 'The passkey prompt was cancelled or timed out.';
  if (name === 'InvalidStateError') return 'This passkey is already registered on this device.';
  if (name === 'SecurityError') return 'Passkeys need a secure page (https, or localhost).';
  return error instanceof Error ? error.message : 'The passkey could not be used.';
}

/** This account's passkey on this site, or null (with the reason to show). */
export async function myPasskey(): Promise<{ passkey: { credentialId: string; rpId: string } | null; reason?: string }> {
  const res = await fetch('/api/auth/passkey', { cache: 'no-store' });
  if (!res.ok) return { passkey: null, reason: 'Could not read your passkey. Try again.' };
  const body = (await res.json()) as { rpId: string; credential: { credentialId: string } | null };
  if (!body.credential) return { passkey: null, reason: 'Add a passkey in Settings → Security first.' };
  if (body.credential.credentialId.startsWith('0x')) {
    return { passkey: null, reason: 'Your passkey needs adding again in Settings → Security.' };
  }
  return { passkey: { credentialId: body.credential.credentialId, rpId: body.rpId } };
}
