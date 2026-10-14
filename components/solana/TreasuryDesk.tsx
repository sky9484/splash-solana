'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { api, ApiError, copyText, dateShort, existingDeviceKey, shortKey, signPrepared, usd } from './client';
import type { CompanyDTO } from './types';
import { notifyCompanyChanged, useCompany } from './useCompany';

type Move = NonNullable<CompanyDTO['treasury']>['moves'][number];
type From = 'treasury' | 'payments';

/** "7,500.25" → micro-USDC as a string, with no floating point. null when not a valid amount. */
export function dollarsToMicro(input: string): string | null {
  const t = input.replace(/[$,\s]|US|USDC/gi, '');
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const v = BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? '0').padEnd(2, '0')) * 10_000n;
  return v > 0n ? v.toString() : null;
}

/** Micro-USDC → "7500.25" for the input (whole cents; a shortfall is already rounded up to one). */
function microToInput(minor: string): string {
  const v = BigInt(minor);
  const cents = (v + 9_999n) / 10_000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

const STATE: Record<Move['state'], { label: string; tone: string }> = {
  prepared: { label: 'Waiting for this device', tone: 'pending' },
  sending: { label: 'Moving', tone: 'pending' },
  checking: { label: 'Checking', tone: 'pending' },
  confirmed: { label: 'Moved', tone: 'ok' },
  failed: { label: 'Not moved', tone: 'warn' },
};

const NAME: Record<From, string> = { treasury: 'Treasury', payments: 'Payments vault' };

/**
 * Two vaults of one multisig, side by side: the treasury (operating cash, vault #1) and the payments
 * vault (vault #0, which pays suppliers). Between them, the move: the amount, the direction, one
 * approval on this device. A shortfall from a payment arrives prefilled (?move=), with a way back.
 */
export function TreasuryDesk({ prefillMinor, back }: { prefillMinor: string | null; back: string | null }) {
  const { state } = useCompany();
  const [from, setFrom] = useState<From>('treasury');
  const [amount, setAmount] = useState(prefillMinor ? microToInput(prefillMinor) : '');
  const [busy, setBusy] = useState<null | 'fund' | 'prepare' | 'sign' | 'send'>(null);
  const [error, setError] = useState<{ code: string; message: string; detail?: Record<string, unknown> } | null>(null);
  const [done, setDone] = useState<Move | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // A move whose outcome was unknown when its request ended: check it until it is final. Reading never resends.
  const checking = state.status === 'ready' ? state.company.treasury?.moves.find((m) => m.state === 'checking') : undefined;
  useEffect(() => {
    if (!checking) return;
    const t = setInterval(() => {
      void api<{ move: Move }>(`/treasury/moves/${checking.id}`)
        .then((r) => {
          if (r.move.state !== 'checking') notifyCompanyChanged();
        })
        .catch(() => undefined);
    }, 1500);
    return () => clearInterval(t);
  }, [checking?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.status === 'loading') return <p className="sx-muted">Loading your vaults…</p>;
  if (state.status !== 'ready' || !state.company.vault || !state.company.treasury) {
    return (
      <div className="sx-narrow sx-stack">
        <p className="sx-lede">{state.status === 'ready' ? 'Set up this device and your vault first. Your treasury is a second vault of the same multisig.' : state.message}</p>
        <Link className="sx-btn" href={state.status === 'signin' ? '/login' : '/dashboard/setup'}>
          {state.status === 'signin' ? 'Sign in' : 'Set up this device'}
        </Link>
      </div>
    );
  }
  const org = state.company;
  const t = org.treasury!;
  const vault = org.vault!;
  const balances: Record<From, bigint> = { treasury: BigInt(t.balanceMinor), payments: BigInt(org.balance.totalMinor) };
  const to: From = from === 'treasury' ? 'payments' : 'treasury';
  const micro = dollarsToMicro(amount);
  const over = micro !== null && BigInt(micro) > balances[from];
  const keyId = org.me.keyId;

  async function fundTreasury() {
    setBusy('fund');
    setError(null);
    try {
      await api('/treasury/fund', { body: {} });
      notifyCompanyChanged();
    } catch (e) {
      setError(e instanceof ApiError ? { code: e.code, message: e.message, detail: e.detail } : { code: 'error', message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function move(retryMoveId?: string) {
    setError(null);
    setDone(null);
    try {
      if (!org.me.canApprove) throw new ApiError('not_an_approver', "This device can't approve for your company yet. Finish setup on it.", 0);
      if (!(await existingDeviceKey(keyId))) throw new ApiError('no_device_key', "This browser doesn't hold your device key. Move from the browser where you set up this device.", 0);
      setBusy('prepare');
      const prepared = await api<{ move: Move; messages: Array<{ id: string; messageBase64: string }> }>('/treasury/moves', {
        body: retryMoveId ? { retryMoveId } : { from, amountMinor: micro },
      });
      setBusy('sign');
      const signatures = await signPrepared(keyId, prepared.messages);
      setBusy('send');
      const res = await api<{ move: Move }>(`/treasury/moves/${prepared.move.id}/approve`, { body: { signatures } });
      setDone(res.move);
      if (res.move.state === 'confirmed') setAmount('');
    } catch (e) {
      setError(e instanceof ApiError ? { code: e.code, message: e.message, detail: e.detail } : { code: 'error', message: (e as Error).message });
    } finally {
      setBusy(null);
      notifyCompanyChanged();
    }
  }

  const copy = async (addr: string) => setCopied((await copyText(addr)) ? addr : null);
  const vaultCard = (kind: From) => {
    const addr = kind === 'treasury' ? t.vaultPda : vault.vaultPda;
    const solscan = kind === 'treasury' ? t.solscanUrl : vault.solscanUrl;
    return (
      <section className="sx-vault-card" data-role={kind} aria-labelledby={`v-${kind}`}>
        <p className="sx-vault-kicker">{kind === 'treasury' ? 'Operating cash · vault #1' : 'Pays suppliers · vault #0'}</p>
        <h2 id={`v-${kind}`}>{NAME[kind]}</h2>
        <p className="sx-vault-amount sx-num">{usd(balances[kind])}</p>
        <p className="sx-small sx-muted">
          <span className="sx-mono">{shortKey(addr, 6)}</span>{' '}
          <button type="button" className="sx-btn-link sx-small" onClick={() => void copy(addr)}>
            {copied === addr ? 'Copied' : 'Copy'}
          </button>
          {solscan ? (
            <>
              {' · '}
              <a href={solscan} target="_blank" rel="noreferrer">
                Solscan<span className="sx-visually-hidden"> (opens in a new tab)</span>
              </a>
            </>
          ) : null}
        </p>
      </section>
    );
  };

  const label = busy === 'prepare' ? 'Preparing…' : busy === 'sign' ? 'Waiting for this device…' : busy === 'send' ? 'Moving…' : 'Move with this device';
  const failed = org.treasury!.moves.find((m) => m.state === 'failed' && m.problem && m.problem.code !== 'replaced');

  return (
    <div className="sx-stack-lg">
      <div className="sx-vaults">
        {vaultCard('treasury')}
        <div className="sx-vault-channel" data-dir={from === 'treasury' ? 'right' : 'left'} aria-hidden="true">
          <span />
        </div>
        {vaultCard('payments')}
      </div>

      <section className="sx-card sx-stack" aria-labelledby="move-title">
        <div className="sx-row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 id="move-title">Move USDC between your vaults</h2>
          {org.simulated ? <span className="sx-pill sx-pill-sim">Simulated · devnet-ready</span> : null}
        </div>
        <div className="sx-segmented" role="group" aria-label="Direction">
          <button type="button" aria-pressed={from === 'treasury'} onClick={() => setFrom('treasury')}>
            Treasury → Payments vault
          </button>
          <button type="button" aria-pressed={from === 'payments'} onClick={() => setFrom('payments')}>
            Payments vault → Treasury
          </button>
        </div>
        <div className="sx-row" style={{ alignItems: 'end' }}>
          <div className="sx-field" style={{ flex: '1 1 220px', maxWidth: 320 }}>
            <label htmlFor="move-amount">Amount (USDC)</label>
            <input id="move-amount" className="sx-input sx-num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="7,500.00" aria-invalid={(amount !== '' && !micro) || over ? true : undefined} aria-describedby="move-hint" />
          </div>
          <button type="button" className="sx-btn sx-btn-ghost" onClick={() => setAmount(microToInput(balances[from].toString()))} disabled={balances[from] === 0n}>
            All of it
          </button>
        </div>
        <p id="move-hint" className="sx-hint">
          {over
            ? `The ${NAME[from].toLowerCase()} holds ${usd(balances[from])}.`
            : `From the ${NAME[from].toLowerCase()} (${usd(balances[from])}) to the ${NAME[to].toLowerCase()}. No Splash fee. Kora pays the network fee, so you don’t need SOL.`}
        </p>
        {error ? (
          <div className="sx-notice sx-notice-error" role="alert">
            <p>{error.message}</p>
          </div>
        ) : null}
        {done ? (
          <div className={`sx-notice ${done.state === 'confirmed' ? 'sx-notice-ok' : 'sx-notice-warn'} sx-stack`} role="status">
            <p>
              {done.state === 'confirmed'
                ? `Moved ${usd(done.amountMinor)} to your ${NAME[done.to].toLowerCase()}.`
                : done.problem?.message ?? 'The move did not finish.'}
            </p>
            {done.state === 'confirmed' && back ? (
              <p>
                <Link className="sx-btn sx-btn-sm" href={back}>
                  {back.startsWith('/dashboard/transfer') ? 'Back to your transfer' : back.startsWith('/dashboard/batch') ? 'Back to your batch' : 'Back to your invoice'}
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="sx-row">
          <button type="button" className="sx-btn" disabled={busy !== null || !micro || over || !!checking} onClick={() => void move()}>
            {label}
          </button>
          {checking ? <span className="sx-hint">A move is still on its way. This updates on its own.</span> : null}
        </div>
      </section>

      {failed && failed.problem?.code === 'execute_failed' ? (
        <div className="sx-notice sx-notice-warn sx-stack">
          <p>{failed.problem.message}</p>
          <div>
            <button type="button" className="sx-btn sx-btn-sm" onClick={() => void move(failed.id)} disabled={busy !== null}>
              Retry the move of {usd(failed.amountMinor)}
            </button>
          </div>
        </div>
      ) : null}

      <div className="sx-overview-top">
        <section className="sx-card sx-stack" aria-labelledby="t-fund-title">
          <h2 id="t-fund-title">Add USDC to your treasury</h2>
          {org.mode === 'offline' ? (
            <>
              <p className="sx-muted sx-small">Offline, the simulator plays the faucet. Nothing touches a network.</p>
              <div>
                <button type="button" className="sx-btn sx-btn-ghost" onClick={() => void fundTreasury()} disabled={busy !== null}>
                  {busy === 'fund' ? 'Adding…' : 'Add 100,000 test USDC (simulated)'}
                </button>
              </div>
            </>
          ) : (
            <p className="sx-small">
              Send USDC on Solana to <span className="sx-mono">{t.vaultPda}</span> from your own wallet{org.faucetUrl ? (
                <>
                  , or from the{' '}
                  <a href={org.faucetUrl} target="_blank" rel="noreferrer">
                    Circle faucet<span className="sx-visually-hidden"> (opens in a new tab)</span>
                  </a>
                </>
              ) : null}
              .
            </p>
          )}
        </section>
        <section className="sx-card-quiet sx-stack" aria-labelledby="t-who-title">
          <h2 id="t-who-title">Who can move it</h2>
          <p className="sx-small">
            Both vaults belong to your company&rsquo;s Squads multisig, with the same members and the same approval rule: {vault.threshold} of {vault.members.length}. Splash holds no key to either and
            cannot move them. Every move is signed on a device, and its memo <span className="sx-mono">splash:move:v1:…</span> shows on Solscan.
          </p>
        </section>
      </div>

      <section className="sx-stack" aria-labelledby="moves-title">
        <h2 id="moves-title">Moves</h2>
        {t.moves.length === 0 ? (
          <p className="sx-muted">No moves yet.</p>
        ) : (
          <ul className="sx-verify">
            {t.moves.map((m) => (
              <li key={m.id} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                <span>
                  <strong className="sx-num">{usd(m.amountMinor)}</strong> {NAME[m.from]} → {NAME[m.to]}
                  <span className="sx-small sx-muted" style={{ display: 'block' }}>
                    {dateShort(m.createdAt)} · {m.approvedBy ? `approved by ${m.approvedBy.who}` : `by ${m.createdBy}`}
                    {m.signature ? (
                      <>
                        {' · '}
                        {m.signature.solscanUrl ? (
                          <a href={m.signature.solscanUrl} target="_blank" rel="noreferrer">
                            Solscan<span className="sx-visually-hidden"> (opens in a new tab)</span>
                          </a>
                        ) : (
                          <span className="sx-mono">{shortKey(m.signature.signature, 6)} (simulated)</span>
                        )}
                      </>
                    ) : null}
                  </span>
                </span>
                <span className={`sx-pill sx-pill-${STATE[m.state].tone}`}>{STATE[m.state].label}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
