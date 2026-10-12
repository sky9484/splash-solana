'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { confirmWords, deriveRecoveryKey, generateRecoveryWords, pickConfirmationIndices, signPossessionChallenge, type PossessionChallenge } from '@/lib/solana/recovery-kit';

import { api, ApiError, copyText, deviceKeySupported, makeDeviceKey, notifyOrgChanged, rememberOrgId, shortKey, signBytesWithDevice } from './client';
import type { OrgDTO } from './types';
import { useOrg } from './useOrg';

type Step = 'company' | 'kit' | 'check' | 'device' | 'vault' | 'done';
const STEPS: Array<{ key: Step; label: string }> = [
  { key: 'company', label: 'Company' },
  { key: 'kit', label: 'Recovery kit' },
  { key: 'check', label: 'Check 3 words' },
  { key: 'device', label: 'Device key' },
  { key: 'vault', label: 'Vault' },
];

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="sx-notice sx-notice-error" role="alert">
      <p>{message}</p>
    </div>
  );
}

function StepList({ step }: { step: Step }) {
  const at = STEPS.findIndex((s) => s.key === step);
  return (
    <ol className="sx-steps" aria-label="Setup steps">
      {STEPS.map((s, i) => (
        <li key={s.key} aria-current={i === at ? 'step' : undefined} data-done={i < at || step === 'done' ? 'true' : undefined}>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

export function OnboardingFlow() {
  const { state } = useOrg();
  const [step, setStep] = useState<Step>('company');
  const [orgId, setOrgId] = useState<string | null>(null);
  const [company, setCompany] = useState('');
  const [person, setPerson] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The 24 words live only in this component's memory, and are dropped once the vault has its kit key.
  const [words, setWords] = useState<string[] | null>(null);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [picks, setPicks] = useState<number[]>([]);
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    if (step === 'device' && supported === null) void deviceKeySupported().then(setSupported);
  }, [step, supported]);

  // An org mid-setup (no vault yet) resumes at the right step only if this tab still has its words;
  // otherwise it starts again, because the words were never stored anywhere.
  const existing = state.status === 'ready' ? state.org : null;

  if (state.status === 'loading') return <p className="sx-muted">Loading…</p>;
  if (existing?.vault && step !== 'done') return <VaultSummary org={existing} onReset={() => { rememberOrgId(null); setStep('company'); }} />;

  async function createCompany(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ orgId: string }>('/onboarding/org', { body: { companyName: company, personName: person || undefined } });
      setOrgId(res.orgId);
      rememberOrgId(res.orgId);
      setWords(generateRecoveryWords());
      setShown(false);
      setStep('kit');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function startCheck() {
    setPicks(pickConfirmationIndices(3));
    setTyped({});
    setError(null);
    setStep('check');
  }

  function checkWords(e: React.FormEvent) {
    e.preventDefault();
    if (!words) return;
    const ok = confirmWords(words, picks.map((index) => ({ index, word: typed[index] ?? '' })));
    if (!ok) {
      setError("Those words don't match your kit. Check what you wrote down and try again.");
      return;
    }
    setError(null);
    setStep('device');
  }

  async function createDeviceAndProve() {
    if (!orgId || !words) return;
    setBusy(true);
    setError(null);
    const kit = deriveRecoveryKey(words);
    try {
      const device = await makeDeviceKey(orgId);
      const { challenges } = await api<{ challenges: Array<PossessionChallenge & { role: 'device' | 'kit' }> }>('/onboarding/challenge', {
        body: { orgId, keys: [{ role: 'device', publicKey: device.publicKey }, { role: 'kit', publicKey: kit.publicKey }] },
      });
      const proofs = [];
      for (const c of challenges) {
        const signer = c.role === 'kit' ? kit : { sign: (m: Uint8Array) => signBytesWithDevice(orgId, m) };
        proofs.push({ role: c.role, publicKey: c.publicKey, nonce: c.nonce, signature: await signPossessionChallenge(signer, c) });
      }
      await api('/onboarding/keys', { body: { orgId, proofs } });
      setStep('vault');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      kit.destroy();
      setBusy(false);
    }
  }

  async function createVault() {
    if (!orgId) return;
    setBusy(true);
    setError(null);
    try {
      await api('/onboarding/vault', { body: { orgId } });
      setWords(null); // the kit key is in the vault; the words leave this page's memory
      setTyped({});
      setStep('done');
      notifyOrgChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sx-narrow">
      <h1>Set up your vault</h1>
      <p className="sx-lede">Your company gets its own Squads vault on Solana. Its keys are made in this browser. Splash never sees them.</p>
      {state.status === 'reset' && step === 'company' ? (
        <div className="sx-notice sx-notice-info" style={{ marginTop: 16 }}>
          <p>{state.message}</p>
        </div>
      ) : null}
      <div style={{ marginTop: 24 }}>
        <StepList step={step} />
      </div>

      {step === 'company' && (
        <form className="sx-card sx-stack" onSubmit={createCompany}>
          <h2>Your company</h2>
          <div className="sx-field">
            <label htmlFor="company">Company name</label>
            <input id="company" className="sx-input" value={company} onChange={(e) => setCompany(e.target.value)} required minLength={2} maxLength={120} autoComplete="organization" />
          </div>
          <div className="sx-field">
            <label htmlFor="person">Your name</label>
            <input id="person" className="sx-input" value={person} onChange={(e) => setPerson(e.target.value)} maxLength={80} autoComplete="name" />
            <p className="sx-hint">Shown on approvals and the receipt.</p>
          </div>
          <ErrorNote message={error} />
          <button className="sx-btn" type="submit" disabled={busy || company.trim().length < 2}>
            {busy ? 'Creating…' : 'Continue'}
          </button>
        </form>
      )}

      {step === 'kit' && words && (
        <section className="sx-card sx-stack" aria-labelledby="kit-title">
          <h2 id="kit-title">Your recovery kit</h2>
          <p>
            These 24 words are a key to your vault. If you lose this device, they get you back in. Write them down on paper and keep them somewhere safe and offline.
          </p>
          <div className="sx-notice sx-notice-warn">
            <p>Anyone with these words can move your money. Splash never sees them and can&rsquo;t recover them for you.</p>
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
            <button
              type="button"
              className="sx-btn sx-btn-ghost"
              disabled={!shown}
              onClick={async () => {
                setCopied(await copyText(words.join(' ')));
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="sx-btn" disabled={!shown} onClick={startCheck}>
              I&rsquo;ve saved them
            </button>
          </div>
          {copied ? <p className="sx-hint">Copied to this device&rsquo;s clipboard. Paste it somewhere offline, then clear your clipboard.</p> : null}
        </section>
      )}

      {step === 'check' && words && (
        <form className="sx-card sx-stack" onSubmit={checkWords} aria-labelledby="check-title">
          <h2 id="check-title">Check three words</h2>
          <p className="sx-muted">Type these words from your kit. This check runs in your browser only.</p>
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
            <button className="sx-btn" type="submit">
              Check words
            </button>
            <button type="button" className="sx-btn-link" onClick={() => setStep('kit')}>
              Show the kit again
            </button>
          </div>
        </form>
      )}

      {step === 'device' && (
        <section className="sx-card sx-stack" aria-labelledby="device-title">
          <h2 id="device-title">A key for this device</h2>
          <p>
            This browser makes a signing key that cannot be copied out of it. You use it to approve every payment. Splash gets only its public key, and a signature that
            proves you hold it. The same goes for your recovery kit.
          </p>
          {supported === false ? (
            <div className="sx-notice sx-notice-error" role="alert">
              <p>This browser can&rsquo;t make a device key. Use a recent Chrome, Safari or Firefox.</p>
            </div>
          ) : null}
          <ErrorNote message={error} />
          <button className="sx-btn" type="button" onClick={createDeviceAndProve} disabled={busy || supported === false}>
            {busy ? 'Creating the key…' : 'Create the key on this device'}
          </button>
        </section>
      )}

      {step === 'vault' && (
        <section className="sx-card sx-stack" aria-labelledby="vault-title">
          <h2 id="vault-title">Create your vault</h2>
          <p>
            Your vault is a Squads multisig with two members: this device&rsquo;s key and your recovery kit. Either one can approve. Nobody can change the members later,
            Splash included. Splash pays the network fee, so you don&rsquo;t need SOL to set it up.
          </p>
          <ErrorNote message={error} />
          <button className="sx-btn" type="button" onClick={createVault} disabled={busy}>
            {busy ? 'Creating the vault…' : 'Create vault'}
          </button>
        </section>
      )}

      {step === 'done' && existing?.vault ? <VaultSummary org={existing} fresh onReset={() => { rememberOrgId(null); setStep('company'); }} /> : null}
    </div>
  );
}

function VaultSummary({ org, fresh = false, onReset }: { org: OrgDTO; fresh?: boolean; onReset: () => void }) {
  const vault = org.vault!;
  const [copied, setCopied] = useState(false);
  const device = vault.members.find((m) => m.role === 'admin_device');
  const kit = vault.members.find((m) => m.role === 'recovery_kit_a');
  const sim = vault.simulated;
  const rows = useMemo(
    () => [
      { k: 'Vault address', v: <span className="sx-mono">{vault.vaultPda}</span> },
      { k: 'Members', v: <>This device <span className="sx-mono">{shortKey(device?.publicKey)}</span> and your recovery kit <span className="sx-mono">{shortKey(kit?.publicKey)}</span></> },
      { k: 'Approvals needed', v: <>{vault.threshold} of {vault.members.length}: either key can approve</> },
      { k: 'Who can change members', v: <>Nobody. Config authority: none</> },
      { k: 'Created', v: <span className="sx-mono">{shortKey(vault.signature, 8)}</span> },
    ],
    [vault, device, kit],
  );
  return (
    <div className={fresh ? 'sx-stack-lg' : 'sx-narrow sx-stack-lg'}>
      {!fresh ? (
        <div>
          <h1>Your vault</h1>
          <p className="sx-lede">{org.org.companyName}</p>
        </div>
      ) : null}
      <section className="sx-card sx-stack" aria-labelledby="vault-done">
        <div className="sx-row" style={{ justifyContent: 'space-between' }}>
          <h2 id="vault-done">{fresh ? 'Your vault is ready' : 'Vault'}</h2>
          {sim ? <span className="sx-pill sx-pill-sim">Simulated · devnet-ready</span> : <span className="sx-pill sx-pill-ok">On devnet</span>}
        </div>
        <dl className="sx-kv">
          {rows.map((r) => (
            <div key={r.k} style={{ display: 'contents' }}>
              <dt>{r.k}</dt>
              <dd>{r.v}</dd>
            </div>
          ))}
        </dl>
        {vault.solscanUrl ? (
          <p>
            <a href={vault.solscanUrl} target="_blank" rel="noreferrer">
              View the vault on Solscan
            </a>
          </p>
        ) : null}
        <div className="sx-row">
          <Link className="sx-btn" href="/solana/fund">
            Add test USDC
          </Link>
          <button type="button" className="sx-btn sx-btn-ghost" onClick={async () => setCopied(await copyText(vault.vaultPda))}>
            {copied ? 'Copied' : 'Copy vault address'}
          </button>
        </div>
      </section>
      <section id="walk-away-kit" className="sx-card-quiet sx-stack" aria-labelledby="walk-title">
        <h2 id="walk-title">Walk-away kit</h2>
        <p>
          Your 24 words and your vault address are all you need to reach your money without Splash. The words control a member key of the vault, so they can approve and
          move funds on their own. Splash keeps no copy.
        </p>
        <p className="sx-small sx-muted">Restoring the words into a wallet app has not been tested in this build yet.</p>
      </section>
      <p className="sx-small">
        <button type="button" className="sx-btn-link" onClick={onReset}>
          Start over with a new company
        </button>
      </p>
    </div>
  );
}
