'use client';

import { useEffect, useState } from 'react';

/**
 * "Continue with Google" — the zkLogin frontend.
 *
 * The backend for this has been complete, correct and covered by 29 passing
 * tests since before this component existed, with zero callers. A capability
 * nothing invokes is not a capability, which is why this is the whole of
 * Phase 4's frontend work: the route, the JWT verification, the nonce binding
 * and the address derivation are already there.
 *
 * The button renders only when the server says the flow can actually complete
 * — FEATURE_ZKLOGIN on, a Google client id configured, and the Sui epoch
 * readable. A sign-in button that fails after a full OAuth round trip is worse
 * than no button.
 *
 * What signing in this way gets you: identity. It does not get you authority.
 * A zkLogin session carries no membership, so every financial route refuses it
 * until someone grants one — the same as a password account. That is asserted
 * in tests/zklogin-authority.test.mjs, not just intended.
 */

type Params = {
  enabled: boolean;
  reason?: string;
  clientId?: string;
  epoch?: number;
  maxEpoch?: number;
  epochSpan?: number;
};

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';

/** Where Google returns the user. The route that consumes the id_token. */
const REDIRECT_PATH = '/login/zklogin/callback';

export default function ZkLoginButton({ onError }: { onError?: (message: string) => void }) {
  const [params, setParams] = useState<Params | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/auth/zklogin/params', { cache: 'no-store' });
        const body = (await res.json()) as Params;
        if (!cancelled) setParams(body);
      } catch {
        // A params failure means the button does not appear. It is not worth
        // an error message on a page whose password form works fine.
        if (!cancelled) setParams({ enabled: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!params?.enabled || !params.clientId || params.maxEpoch === undefined) return null;

  async function start() {
    if (!params?.clientId || params.maxEpoch === undefined) return;
    setStarting(true);
    try {
      const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
      const { generateNonce, generateRandomness } = await import('@mysten/sui/zklogin');

      // The ephemeral key never leaves the browser. The nonce commits the
      // OAuth token to THIS key and THIS maxEpoch, so a token intercepted in
      // transit cannot be replayed against a different key — the server
      // recomputes the same nonce and rejects a mismatch.
      const ephemeral = Ed25519Keypair.generate();
      const randomness = generateRandomness();
      const nonce = generateNonce(ephemeral.getPublicKey(), params.maxEpoch, randomness);

      sessionStorage.setItem(
        'splash.zklogin.pending',
        JSON.stringify({
          maxEpoch: params.maxEpoch,
          randomness,
          ephemeralPublicKey: ephemeral.getPublicKey().toBase64(),
          // The secret key stays in this tab only, and only until the
          // callback consumes it.
          ephemeralSecret: ephemeral.getSecretKey(),
        }),
      );

      const url = new URL(GOOGLE_AUTH);
      url.searchParams.set('client_id', params.clientId);
      url.searchParams.set('redirect_uri', `${window.location.origin}${REDIRECT_PATH}`);
      url.searchParams.set('response_type', 'id_token');
      url.searchParams.set('scope', 'openid email');
      url.searchParams.set('nonce', nonce);
      window.location.href = url.toString();
    } catch (error) {
      setStarting(false);
      onError?.(error instanceof Error ? error.message : 'Google sign-in could not be started.');
    }
  }

  return (
    <>
      <div className="iso-auth-divider" role="separator">
        <span>or</span>
      </div>
      <button type="button" className="iso-auth-oauth" onClick={() => void start()} disabled={starting}>
        <GoogleMark />
        {starting ? 'Opening Google…' : 'Continue with Google'}
      </button>
      <p className="iso-auth-oauth-note">
        Signing in proves who you are. An administrator grants what you can do.
      </p>
    </>
  );
}

/** Google's mark, inline so the button needs no network request to render. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" width="18" height="18">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}
