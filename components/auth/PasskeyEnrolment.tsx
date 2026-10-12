'use client';

import { useCallback, useEffect, useState } from 'react';

import { createPasskey, describePasskeyError, passkeysSupported } from '@/lib/auth/webauthn-client';

/**
 * Enrol a passkey as a second check at sign-in (prompt 07 §3.2).
 *
 * It is NOT a vault signer. Payments are approved with the member's device
 * key (lib/solana/device-key.ts, set up at /dashboard/setup); nothing a
 * passkey signs can move money. The WebAuthn plumbing below still comes from
 * the earlier build and is replaced by plain WebAuthn verification when the
 * Sui SDK is confined to the evidence module (prompt 07 Phase 2).
 *
 * `authenticatorAttachment: 'platform'` — the key lives in the secure enclave
 * of the person's own phone or laptop. The public key is sent to the server
 * the instant it exists: WebAuthn hands it over once, in the attestation, and
 * never again.
 */

type State =
  | { kind: 'loading' }
  | { kind: 'unsupported' }
  | { kind: 'none'; rpId: string }
  | { kind: 'enrolled'; rpId: string; legacy: boolean };

export default function PasskeyEnrolment() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  // Which action is waiting on the device, so only its button says so.
  const [busy, setBusy] = useState<null | 'enrol' | 'revoke'>(null);
  const [error, setError] = useState('');

  /** Reads the current state. Pure: it does not touch React state, so the
   *  effect below can decide whether the component is still mounted. */
  const readPasskeyState = useCallback(async (): Promise<State> => {
    try {
      if (!passkeysSupported()) return { kind: 'unsupported' };
      const res = await fetch('/api/auth/passkey', { cache: 'no-store' });
      if (!res.ok) throw new Error('could not read passkey status');
      const body = (await res.json()) as { rpId: string; credential: { credentialId: string } | null };
      // The earlier build stored a chain address where the credential id belongs;
      // such a passkey cannot be asked for by id, so it is added again.
      return body.credential
        ? { kind: 'enrolled', rpId: body.rpId, legacy: body.credential.credentialId.startsWith('0x') }
        : { kind: 'none', rpId: body.rpId };
    } catch {
      return { kind: 'unsupported' };
    }
  }, []);

  const load = useCallback(async () => {
    setState(await readPasskeyState());
  }, [readPasskeyState]);

  useEffect(() => {
    // An inline async IIFE, not a call to the useCallback above: the effect
    // lint rule reads the callee's body and cannot see that every setState in
    // it is already behind an await. `cancelled` is the real reason for the
    // shape anyway — a component unmounted mid-fetch must not set state.
    let cancelled = false;
    void (async () => {
      const next = await readPasskeyState();
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [readPasskeyState]);

  async function enrol() {
    if (state.kind !== 'none') return;
    setBusy('enrol');
    setError('');
    try {
      // Creation returns the public key. This is the only time it exists
      // outside the authenticator, so it is saved at once.
      const created = await createPasskey({ rpId: state.rpId, userId: crypto.randomUUID(), userName: 'Splash sign-in' });
      const res = await fetch('/api/auth/passkey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(created),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'The passkey could not be saved.');
      }
      await load();
    } catch (err) {
      setError(describePasskeyError(err));
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    setBusy('revoke');
    setError('');
    try {
      await fetch('/api/auth/passkey', { method: 'DELETE' });
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (state.kind === 'loading') return <p className="iso-passkey-status">Checking this device…</p>;

  if (state.kind === 'unsupported') {
    return (
      <p className="iso-passkey-status">
        This browser cannot hold a passkey. Use a device with a biometric or PIN — a phone, or a laptop with Touch ID
        or Windows Hello — to add this sign-in check.
      </p>
    );
  }

  /* A passkey here is a second check at sign-in. It is not a vault signer:
     payments are approved with the device key from /dashboard/setup. */
  return (
    <div className="iso-passkey">
      {state.kind === 'enrolled' ? (
        <>
          <p className="iso-passkey-status">
            This account has a passkey on <strong>{state.rpId}</strong>.
          </p>
          {state.legacy ? (
            <p className="iso-passkey-note" role="status">
              This passkey was added before passkeys became a sign-in check. Remove it and add it again to use it.
            </p>
          ) : null}
          <p className="iso-passkey-note">
            It is bound to <strong>{state.rpId}</strong> and won&rsquo;t be offered on another host. Removing it here
            does not delete the passkey from your device. Payments are approved with your device key, not this passkey.
          </p>
          <button type="button" className="iso-passkey-revoke" onClick={() => void revoke()} disabled={busy !== null}>
            {busy === 'revoke' ? 'Removing…' : 'Remove this passkey'}
          </button>
        </>
      ) : (
        <>
          <p className="iso-passkey-status">No passkey on this account yet.</p>
          <p className="iso-passkey-note">
            A passkey adds a second check when you sign in. Your device holds the key and never releases it; Splash
            stores only the public half.
          </p>
          <button type="button" className="iso-passkey-enrol" onClick={() => void enrol()} disabled={busy !== null}>
            {busy === 'enrol' ? 'Waiting for your device…' : 'Add a passkey'}
          </button>
        </>
      )}
      {error ? (
        <p className="iso-passkey-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
