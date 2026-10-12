'use client';

import { useCallback, useEffect, useState } from 'react';

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
  | { kind: 'enrolled'; rpId: string; suiAddress: string };

export default function PasskeyEnrolment() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  // Which action is waiting on the device, so only its button says so.
  const [busy, setBusy] = useState<null | 'enrol' | 'restore' | 'revoke'>(null);
  const [error, setError] = useState('');

  /** Reads the current state. Pure: it does not touch React state, so the
   *  effect below can decide whether the component is still mounted. */
  const readPasskeyState = useCallback(async (): Promise<State> => {
    try {
      if (typeof window === 'undefined' || !window.PublicKeyCredential) {
        return { kind: 'unsupported' };
      }
      const res = await fetch('/api/auth/passkey', { cache: 'no-store' });
      if (!res.ok) throw new Error('could not read passkey status');
      const body = (await res.json()) as { rpId: string; credential: { suiAddress: string } | null };
      return body.credential
        ? { kind: 'enrolled', rpId: body.rpId, suiAddress: body.credential.suiAddress }
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

  async function provider(rpId: string) {
    const { BrowserPasskeyProvider } = await import('@mysten/sui/keypairs/passkey');
    return new BrowserPasskeyProvider('Splash sign-in', {
      rp: { name: 'Splash', id: rpId },
      authenticatorSelection: {
        // The approver's own device, not a key on a lanyard.
        authenticatorAttachment: 'platform',
        // A biometric or PIN per approval is the point: possession of an
        // unlocked laptop must not be sufficient to release a payment.
        userVerification: 'required',
        residentKey: 'required',
      },
    });
  }

  async function save(publicKey: { toSuiAddress(): string; toBase64(): string }) {
    const res = await fetch('/api/auth/passkey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credentialId: publicKey.toSuiAddress(),
        publicKey: publicKey.toBase64(),
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? 'The passkey could not be saved.');
    }
  }

  function failure(err: unknown, action: 'Set-up' | 'Restore') {
    // A user who dismisses the biometric prompt gets NotAllowedError; that is
    // a cancellation, not a fault worth an alarming message.
    const name = (err as { name?: string })?.name;
    if (name === 'NotAllowedError') return `${action} was cancelled.`;
    return err instanceof Error ? err.message : `${action} failed.`;
  }

  async function enrol() {
    if (state.kind !== 'none') return;
    setBusy('enrol');
    setError('');
    try {
      const { PasskeyKeypair } = await import('@mysten/sui/keypairs/passkey');
      // Creation returns the public key. This is the only time it exists
      // outside the authenticator.
      const keypair = await PasskeyKeypair.getPasskeyInstance(await provider(state.rpId));
      await save(keypair.getPublicKey());
      await load();
    } catch (err) {
      setError(failure(err, 'Set-up'));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Re-attach a passkey this device already holds for this site — after the
   * signer was removed, or the local database was reset. WebAuthn will not
   * hand the public key over again, so it is recovered from signatures: each
   * P-256 signature fits up to four keys, and two signatures over different
   * random challenges share exactly one. Both prompts must pick the same
   * passkey, and the key found is the one signing will use (same provider,
   * same site), so a restored signer is one that can actually sign.
   */
  async function restore() {
    if (state.kind !== 'none') return;
    setBusy('restore');
    setError('');
    try {
      const { PasskeyKeypair, findCommonPublicKey } = await import('@mysten/sui/keypairs/passkey');
      const device = await provider(state.rpId);
      const challenge = () => crypto.getRandomValues(new Uint8Array(32));
      const first = await PasskeyKeypair.signAndRecover(device, challenge());
      const second = await PasskeyKeypair.signAndRecover(device, challenge());
      const publicKey = (() => {
        try {
          return findCommonPublicKey(first, second);
        } catch {
          throw new Error('The two prompts used different passkeys. Try again and pick the same one both times.');
        }
      })();
      await save(publicKey);
      await load();
    } catch (err) {
      setError(failure(err, 'Restore'));
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
          <p className="iso-passkey-note">
            Made a Splash passkey on this device before? Restore it instead of adding a new one. Your device asks twice;
            pick the same passkey both times.
          </p>
          <button type="button" className="iso-passkey-revoke" onClick={() => void restore()} disabled={busy !== null}>
            {busy === 'restore' ? 'Waiting for your device…' : 'Restore a passkey on this device'}
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
