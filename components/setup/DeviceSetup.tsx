'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import '@/app/solana/solana.css';
import { confirmWords, deriveRecoveryKey, generateRecoveryWords, pickConfirmationIndices, signPossessionChallenge, type PossessionChallenge } from '@/lib/solana/recovery-kit';
import { copyText, deviceKeySupported, existingDeviceKey, makeDeviceKey, shortKey, signBytesWithDevice } from '@/components/solana/client';

/**
 * Account setup on Solana (prompt 07 §3.2), for a signed-in member:
 * recovery kit → check three words → a key on this device → the vault.
 *
 * Both keys are made in this browser. The words stay in this component's
 * memory and are dropped once the vault holds the kit's key; the device key
 * is non-extractable and lives in IndexedDB. The server receives public keys
 * and signatures over its own nonces, and creates the vault in the same
 * request that records the device, so nobody is left half set up.
 */

type Member = { role: string; publicKey: string };
type Status = {
  state: 'no_device' | 'no_vault' | 'device_not_in_vault' | 'ready';
  isOwner: boolean;
  keyId: string;
  device: { publicKey: string; label: string } | null;
  vault: { cluster: string; simulated: boolean; vaultPda: string; multisigPda: string; threshold: number; members: Member[]; createSignature: string } | null;
};
type Load = { kind: 'loading' } | { kind: 'no_membership'; message: string } | { kind: 'error'; message: string } | { kind: 'ok'; status: Status };
type Step = 'kit' | 'check' | 'create' | 'join';

const OWNER_STEPS: Array<{ key: Step; label: string }> = [
  { key: 'kit', label: 'Recovery kit' },
  { key: 'check', label: 'Check 3 words' },
  { key: 'create', label: 'Device key and vault' },
];

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/setup/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } } & T;
  if (!res.ok) {
    const err = new Error(json.error?.message ?? 'Setup could not continue. Try again.') as Error & { code?: string };
    err.code = json.error?.code;
    throw err;
  }
  return json;
}

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="sx-notice sx-notice-error" role="alert">
      <p>{message}</p>
    </div>
  );
}

export default function DeviceSetup() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [holdsKey, setHoldsKey] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>('kit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);

  // The 24 words live only here, and are dropped once the vault has the kit's key.
  const [words, setWords] = useState<string[] | null>(null);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [picks, setPicks] = useState<number[]>([]);
  const [typed, setTyped] = useState<Record<number, string>>({});

  const refresh = useCallback(async () => {
    try {
      const status = await call<Status>('status');
      setLoad({ kind: 'ok', status });
      if (status.device) {
        const held = await existingDeviceKey(status.keyId);
        setHoldsKey(Boolean(held && held.publicKey === status.device.publicKey));
      }
    } catch (e) {
      const err = e as Error & { code?: string };
      setLoad(err.code === 'no_membership' ? { kind: 'no_membership', message: err.message } : { kind: 'error', message: err.message });
    }
  }, []);

  useEffect(() => {
    // The status and IndexedDB can only be read after mount (no SSR access to the browser's key store).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    void deviceKeySupported().then(setSupported);
  }, [refresh]);

  if (load.kind === 'loading') return <div className="sx sx-embedded"><p className="sx-muted">Checking this device…</p></div>;
  if (load.kind === 'no_membership') {
    return (
      <div className="sx sx-embedded">
        <section className="sx-card sx-stack" aria-labelledby="access-title">
          <h2 id="access-title">Waiting for access to your company</h2>
          <p>{load.message}</p>
        </section>
      </div>
    );
  }
  if (load.kind === 'error') return <div className="sx sx-embedded"><ErrorNote message={load.message} /></div>;

  const { status } = load;

  if (status.state === 'ready' && status.vault) {
    return (
      <div className="sx sx-embedded">
        <VaultReady status={status} holdsKey={holdsKey} />
      </div>
    );
  }

  if (status.state === 'device_not_in_vault' || status.state === 'no_vault') {
    return (
      <div className="sx sx-embedded">
        <section className="sx-card sx-stack" aria-labelledby="pending-title">
          <h2 id="pending-title">This device is registered</h2>
          <p>
            Its key <span className="sx-mono">{shortKey(status.device?.publicKey)}</span> is on record, but it isn&rsquo;t a member of your company&rsquo;s vault yet, so it
            can&rsquo;t approve payments. A current vault member adds it with an approval on the vault. Splash can&rsquo;t add it for you.
          </p>
        </section>
      </div>
    );
  }

  // no_device
  const vaultExists = Boolean(status.vault);
  if (!vaultExists && !status.isOwner) {
    return (
      <div className="sx sx-embedded">
        <section className="sx-card sx-stack" aria-labelledby="owner-title">
          <h2 id="owner-title">Your company&rsquo;s owner sets up the vault first</h2>
          <p>Once the vault exists, come back here to add this device. Nothing else is needed from you yet.</p>
        </section>
      </div>
    );
  }

  const unsupported = supported === false ? (
    <div className="sx-notice sx-notice-error" role="alert">
      <p>This browser can&rsquo;t make a device key. Use a recent Chrome, Safari or Firefox.</p>
    </div>
  ) : null;

  async function proveAndComplete(withKit: boolean) {
    setBusy(true);
    setError(null);
    const kit = withKit && words ? deriveRecoveryKey(words) : null;
    try {
      const device = await makeDeviceKey(status.keyId);
      const keys = [{ role: 'device' as const, publicKey: device.publicKey }, ...(kit ? [{ role: 'kit' as const, publicKey: kit.publicKey }] : [])];
      const { challenges } = await call<{ challenges: Array<PossessionChallenge & { role: 'device' | 'kit' }> }>('challenge', { keys });
      const proofs = [];
      for (const c of challenges) {
        const signer = c.role === 'kit' && kit ? kit : { sign: (m: Uint8Array) => signBytesWithDevice(status.keyId, m) };
        proofs.push({ role: c.role, publicKey: c.publicKey, nonce: c.nonce, signature: await signPossessionChallenge(signer, c) });
      }
      await call('complete', { proofs });
      setWords(null); // the kit key is in the vault; the words leave this page's memory
      setTyped({});
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      kit?.destroy();
      setBusy(false);
    }
  }

  if (vaultExists) {
    return (
      <div className="sx sx-embedded">
        <section className="sx-card sx-stack" aria-labelledby="join-title">
          <h2 id="join-title">Add this device to your company</h2>
          <p>
            Your company already has a vault. This browser makes a signing key that cannot be copied out of it. Splash gets only its public key and a signature that proves
            you hold it. A vault member then adds it to the vault before it can approve payments.
          </p>
          {unsupported}
          <ErrorNote message={error} />
          <button className="sx-btn" type="button" onClick={() => proveAndComplete(false)} disabled={busy || supported === false}>
            {busy ? 'Creating the key…' : 'Create the key on this device'}
          </button>
        </section>
      </div>
    );
  }

  const at = OWNER_STEPS.findIndex((s) => s.key === step);
  return (
    <div className="sx sx-embedded">
      <div className="sx-stack">
        <ol className="sx-steps" aria-label="Device and vault steps">
          {OWNER_STEPS.map((s, i) => (
            <li key={s.key} aria-current={i === at ? 'step' : undefined} data-done={i < at ? 'true' : undefined}>
              {s.label}
            </li>
          ))}
        </ol>

        {step === 'kit' && !words && (
          <section className="sx-card sx-stack" aria-labelledby="kit-start">
            <h2 id="kit-start">Make your recovery kit</h2>
            <p>
              24 words, made in this browser. If you lose this device, they get you back into your company&rsquo;s vault. Have paper and a pen ready; you&rsquo;ll write them
              down next.
            </p>
            <button className="sx-btn" type="button" onClick={() => { setWords(generateRecoveryWords()); setShown(false); setCopied(false); }}>
              Make the 24 words
            </button>
          </section>
        )}

        {step === 'kit' && words && (
          <section className="sx-card sx-stack" aria-labelledby="kit-title">
            <h2 id="kit-title">Your recovery kit</h2>
            <p>These 24 words are a key to your vault. Write them down on paper and keep them somewhere safe and offline.</p>
            <div className="sx-notice sx-notice-warn">
              <p>Anyone with these words can move your money. Splash never sees them and can&rsquo;t show them again or recover them for you.</p>
            </div>
            <ol className="sx-words" data-hidden={shown ? 'false' : 'true'} aria-hidden={shown ? undefined : true} aria-label="Recovery words">
              {words.map((w, i) => (
                <li key={i}>{shown ? w : '•••••'}</li>
              ))}
            </ol>
            <div className="sx-row">
              <button type="button" className="sx-btn sx-btn-ghost" onClick={() => setShown((v) => !v)} aria-pressed={shown}>
                {shown ? 'Hide words' : 'Show words'}
              </button>
              <button type="button" className="sx-btn sx-btn-ghost" disabled={!shown} onClick={async () => setCopied(await copyText(words.join(' ')))}>
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                type="button"
                className="sx-btn"
                disabled={!shown}
                onClick={() => { setPicks(pickConfirmationIndices(3)); setTyped({}); setError(null); setStep('check'); }}
              >
                I&rsquo;ve written them down
              </button>
            </div>
            {copied ? <p className="sx-hint">Copied to this device&rsquo;s clipboard. Paste it somewhere offline, then clear your clipboard.</p> : null}
          </section>
        )}

        {step === 'check' && words && (
          <form
            className="sx-card sx-stack"
            aria-labelledby="check-title"
            onSubmit={(e) => {
              e.preventDefault();
              if (!confirmWords(words, picks.map((index) => ({ index, word: typed[index] ?? '' })))) {
                setError("Those words don't match your kit. Check what you wrote down and try again.");
                return;
              }
              setError(null);
              setStep('create');
            }}
          >
            <h2 id="check-title">Check three words</h2>
            <p className="sx-muted">Type these words from what you wrote down. This check runs in your browser only.</p>
            <div className="sx-check-grid">
              {picks.map((index) => (
                <div key={index} className="sx-field" style={{ marginTop: 0 }}>
                  <label htmlFor={`w${index}`}>Word {index + 1}</label>
                  <input
                    id={`w${index}`}
                    className="sx-input sx-mono"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={typed[index] ?? ''}
                    onChange={(e) => setTyped((t) => ({ ...t, [index]: e.target.value }))}
                    required
                  />
                </div>
              ))}
            </div>
            <ErrorNote message={error} />
            <div className="sx-row">
              <button className="sx-btn" type="submit">Check words</button>
              <button type="button" className="sx-btn-link" onClick={() => setStep('kit')}>Show the kit again</button>
            </div>
          </form>
        )}

        {step === 'create' && words && (
          <section className="sx-card sx-stack" aria-labelledby="create-title">
            <h2 id="create-title">A key for this device, and your vault</h2>
            <p>
              This browser makes a signing key that cannot be copied out of it. You use it to approve every payment. Then your company&rsquo;s vault is created with two
              members: this device and your recovery kit. Either one can approve. Nobody can change the members later, Splash included. Splash pays the network fee, so you
              don&rsquo;t need SOL.
            </p>
            {unsupported}
            <ErrorNote message={error} />
            <button className="sx-btn" type="button" onClick={() => proveAndComplete(true)} disabled={busy || supported === false}>
              {busy ? 'Creating your vault…' : 'Create the key and the vault'}
            </button>
          </section>
        )}
      </div>
    </div>
  );
}

function VaultReady({ status, holdsKey }: { status: Status; holdsKey: boolean | null }) {
  const vault = status.vault!;
  const [copied, setCopied] = useState(false);
  const kit = vault.members.find((m) => m.role === 'recovery_kit_a');
  return (
    <div className="sx-stack-lg">
      {holdsKey === false ? (
        <div className="sx-notice sx-notice-warn" role="status">
          <p>
            This browser doesn&rsquo;t hold your device key. Approve payments from the device you set up with, or use your recovery kit to add this one to the vault.
          </p>
        </div>
      ) : null}
      <section className="sx-card sx-stack" aria-labelledby="ready-title">
        <div className="sx-row" style={{ justifyContent: 'space-between' }}>
          <h2 id="ready-title">Your vault is ready</h2>
          {vault.simulated ? <span className="sx-pill sx-pill-sim">Simulated · devnet-ready</span> : <span className="sx-pill sx-pill-ok">On devnet</span>}
        </div>
        <dl className="sx-kv">
          <dt>Vault address</dt>
          <dd><span className="sx-mono">{vault.vaultPda}</span></dd>
          <dt>Members</dt>
          <dd>
            This device <span className="sx-mono">{shortKey(status.device?.publicKey)}</span> and your recovery kit <span className="sx-mono">{shortKey(kit?.publicKey)}</span>
          </dd>
          <dt>Approvals needed</dt>
          <dd>{vault.threshold} of {vault.members.length}: either key can approve</dd>
          <dt>Who can change members</dt>
          <dd>Nobody. Config authority: none</dd>
        </dl>
        <div className="sx-row">
          <Link className="sx-btn" href="/dashboard">Go to your dashboard</Link>
          <button type="button" className="sx-btn sx-btn-ghost" onClick={async () => setCopied(await copyText(vault.vaultPda))}>
            {copied ? 'Copied' : 'Copy vault address'}
          </button>
        </div>
      </section>
      <section className="sx-card-quiet sx-stack" aria-labelledby="walk-title">
        <h2 id="walk-title">Walk-away kit</h2>
        <p>
          Your 24 words and your vault address are all you need to reach your money without Splash. The words control a member key of the vault, so they can approve and move
          funds on their own. Splash keeps no copy.
        </p>
        <p className="sx-small sx-muted">Restoring the words into a wallet app has not been tested in this build yet.</p>
      </section>
    </div>
  );
}
