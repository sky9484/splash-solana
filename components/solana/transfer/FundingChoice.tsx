'use client';

import Link from 'next/link';
import { useState } from 'react';

import { shortKey, timeShort, usd } from '../client';
import type { DetailsDTO, FundingDTO, FundingOptionsDTO } from '../types';

export type PayFrom = 'vault' | 'external';
type Method = FundingOptionsDTO['methods'][number];
export type FundBody = { method: Method['id']; asset?: 'USDC' | 'USDT' | 'PYUSD' | 'USD'; fromAddress?: string | null; rehearsal?: 'none' | 'kyt_flag' };

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** A short name for the header and the ticket: "Stripe (USD)", "Wallet (USDT)". */
export function fundingShort(funding: FundingDTO): string {
  return funding.provider ? `${funding.provider} (${funding.asset})` : `Another wallet (${funding.asset})`;
}

/** "Paid from" for the approval card, the ticket and the receipt: who supplied the USDC now in the vault. */
export function fundedByLabel(choice: PayFrom | null, funding: FundingDTO | null): string | null {
  if (funding && funding.state === 'in_vault') return `${funding.methodLabel}${funding.provider ? '' : ` (${funding.asset})`}, checked and in your payments vault`;
  if (choice === 'vault') return 'Your vaults, already checked';
  return null;
}

/**
 * Step 3.3: where the USDC comes from. From the company's own vaults (ready now: that money was checked
 * when it arrived), or from outside them: USD through Stripe or Airwallex, or a stablecoin from another
 * wallet. Money from outside lands in the payments vault first, and only after a funds check and a
 * declaration of where it comes from, so it takes a step longer. The charge is the provider's or the
 * swap venue's, shown before anything is sent; Splash adds nothing.
 */
export function FundingChoice({
  companyName,
  options,
  neededMinor,
  details,
  choice,
  onChoice,
  funding,
  busy,
  offline,
  error,
  onMove,
  onFund,
  onResetFunding,
}: {
  companyName: string;
  options: FundingOptionsDTO;
  neededMinor: string;
  details: DetailsDTO | null;
  choice: PayFrom | null;
  onChoice: (c: PayFrom) => void;
  funding: FundingDTO | null;
  busy: null | 'move' | 'fund';
  offline: boolean;
  error: { code: string; message: string } | null;
  onMove: (amountMinor: string) => void;
  onFund: (body: FundBody) => void;
  onResetFunding: () => void;
}) {
  const need = BigInt(neededMinor);
  const payments = BigInt(options.vaults.paymentsMinor);
  const treasury = BigInt(options.vaults.treasuryMinor);
  const covered = payments >= need;
  const short = covered ? 0n : need - payments;
  const treasuryCovers = !covered && treasury >= short;
  const ids = ['vault', 'external'] as const;

  function onKey(e: React.KeyboardEvent) {
    const i = choice ? ids.indexOf(choice) : -1;
    if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      const next = ids[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : ids.length - 1)) % ids.length]!;
      onChoice(next);
      (e.currentTarget.querySelector(`[data-pay='${next}']`) as HTMLElement | null)?.focus();
    }
  }

  return (
    <div className="sx-stack">
      <div className="sx-pay-choice" role="radiogroup" aria-label="How you pay" onKeyDown={onKey}>
        <button type="button" role="radio" data-pay="vault" aria-checked={choice === 'vault'} tabIndex={choice === 'external' ? -1 : 0} className="sx-pay-tile" onClick={() => onChoice('vault')}>
          <span className="sx-pay-head">
            <span className="sx-radio" aria-hidden="true" />
            <strong>Pay from your vaults</strong>
            <span className="sx-pill sx-pill-ok">Ready now</span>
          </span>
          <span className="sx-small sx-muted">Your payments vault and treasury in Splash. That money was checked when it arrived, so there is nothing more to declare.</span>
          <span className="sx-pay-balances sx-num">
            <span>
              Payments vault <strong>{usd(payments)}</strong>
            </span>
            <span>
              Treasury <strong>{usd(treasury)}</strong>
            </span>
          </span>
        </button>
        <button type="button" role="radio" data-pay="external" aria-checked={choice === 'external'} tabIndex={choice === 'external' ? 0 : -1} className="sx-pay-tile" onClick={() => onChoice('external')}>
          <span className="sx-pay-head">
            <span className="sx-radio" aria-hidden="true" />
            <strong>Fund it another way</strong>
            <span className="sx-pill sx-pill-warn">Adds a funds check</span>
          </span>
          <span className="sx-small sx-muted">USD or a stablecoin from outside your vaults: Stripe, Airwallex, or another wallet. Charges may apply, and you declare where the money comes from.</span>
          <span className="sx-pay-balances sx-num">
            <span>
              Lands in your payments vault <strong>{usd(need)}</strong>
            </span>
          </span>
        </button>
      </div>

      {choice === 'vault' ? (
        <div className="sx-pay-body" aria-live="polite">
          {covered ? (
            <p className="sx-tok">
              <span aria-hidden="true">✓</span> Your payments vault covers this {usd(need)}. Nothing to move.
            </p>
          ) : treasuryCovers ? (
            <div className="sx-stack">
              <p>
                Your payments vault is short by <strong className="sx-num">{usd(short)}</strong>. Move it in from your treasury: one approval on this device, no Splash fee.
              </p>
              <div className="sx-row">
                <button type="button" className="sx-btn" disabled={busy !== null} onClick={() => onMove(short.toString())}>
                  {busy === 'move' ? 'Moving… approve on this device' : `Move ${usd(short)} from your treasury`}
                </button>
              </div>
            </div>
          ) : (
            <div className="sx-notice sx-notice-warn sx-stack" role="status">
              <p>
                Your vaults hold <strong className="sx-num">{usd(payments + treasury)}</strong> together, less than the <span className="sx-num">{usd(need)}</span> this transfer needs.
              </p>
              <p className="sx-small">
                Fund it another way, or <Link href="/dashboard/treasury">add USDC to your treasury</Link> and come back.
              </p>
            </div>
          )}
        </div>
      ) : null}

      {choice === 'external' ? (
        funding && funding.state !== 'held' ? (
          <FundsCheck funding={funding} />
        ) : (
          <ExternalForm
            key={funding?.id ?? 'new'}
            companyName={companyName}
            options={options}
            need={need}
            details={details}
            busy={busy === 'fund'}
            offline={offline}
            held={funding?.state === 'held' ? funding : null}
            onFund={onFund}
            onResetFunding={onResetFunding}
          />
        )
      ) : null}

      {error ? (
        <div className="sx-notice sx-notice-error" role="alert">
          <p>{error.message}</p>
        </div>
      ) : null}
    </div>
  );
}

function ExternalForm({
  companyName,
  options,
  need,
  details,
  busy,
  offline,
  held,
  onFund,
  onResetFunding,
}: {
  companyName: string;
  options: FundingOptionsDTO;
  need: bigint;
  details: DetailsDTO | null;
  busy: boolean;
  offline: boolean;
  held: FundingDTO | null;
  onFund: (body: FundBody) => void;
  onResetFunding: () => void;
}) {
  const usable = options.methods.filter((m) => m.available);
  const [method, setMethod] = useState<Method['id']>(usable.find((m) => m.id === 'stripe')?.id ?? usable[0]?.id ?? 'wallet_usdc');
  const [asset, setAsset] = useState<'USDT' | 'PYUSD'>('USDT');
  const [from, setFrom] = useState('');
  const [declared, setDeclared] = useState(false);
  const [rehearse, setRehearse] = useState(false);
  const [tried, setTried] = useState(false);
  const m = options.methods.find((x) => x.id === method)!;
  const wallet = m.kind === 'stablecoin';
  const charge = m.chargeMinor ? BigInt(m.chargeMinor) : 0n;
  const addrOk = !wallet || BASE58.test(from.trim());
  const ready = !!details && declared && addrOk && m.available;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!ready) return;
    onFund({ method, asset: m.id === 'wallet_swap' ? asset : undefined, fromAddress: wallet ? from.trim() : null, rehearsal: offline && rehearse ? 'kyt_flag' : 'none' });
  }

  return (
    <form className="sx-pay-body sx-stack" onSubmit={submit} aria-label="Fund it another way" noValidate>
      {held ? (
        <div className="sx-notice sx-notice-error sx-stack" role="alert">
          <p>
            Screening held the {held.methodLabel.toLowerCase()} money, so nothing reached your vault. Reference <span className="sx-mono">{held.check?.resultId}</span>. Choose another source, or contact support with the reference.
          </p>
          <button type="button" className="sx-btn-link" onClick={onResetFunding}>
            Clear and choose another source
          </button>
        </div>
      ) : null}

      <fieldset className="sx-tfield">
        <legend>Where the money comes from</legend>
        <div className="sx-fund-methods" role="radiogroup" aria-label="Funding source">
          {options.methods.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={method === x.id} disabled={!x.available} className="sx-fund-method" onClick={() => setMethod(x.id)}>
              <span className="sx-radio" aria-hidden="true" />
              <span className="sx-fund-method-copy">
                <strong>
                  {x.label} <span className="sx-chip">{x.kind === 'usd' ? 'USD' : 'Stablecoin'}</span>
                </strong>
                <span className="sx-small sx-muted">{x.available ? x.detail : x.unavailableReason}</span>
              </span>
              <span className="sx-fund-method-cost sx-num">
                {x.chargeMinor && BigInt(x.chargeMinor) > 0n ? `+ ${usd(x.chargeMinor)}` : 'No charge'}
                <span className="sx-small sx-muted">{x.sandbox ? 'Sandbox estimate' : x.chargeLabel}</span>
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      {wallet ? (
        <div className="sx-transfer-grid">
          {m.id === 'wallet_swap' ? (
            <div className="sx-field">
              <label htmlFor="f-asset">Stablecoin you send</label>
              <select id="f-asset" value={asset} onChange={(e) => setAsset(e.target.value as 'USDT' | 'PYUSD')}>
                <option value="USDT">USDT</option>
                <option value="PYUSD">PYUSD</option>
              </select>
              <p className="sx-hint">Swapped to USDC before it reaches your vault. Only USDC lands.</p>
            </div>
          ) : null}
          <div className="sx-field">
            <label htmlFor="f-from">Sending wallet (Solana address)</label>
            <input id="f-from" className="sx-input sx-mono" value={from} onChange={(e) => setFrom(e.target.value.trim())} spellCheck={false} autoComplete="off" placeholder="The wallet the money leaves from" aria-invalid={tried && !addrOk ? true : undefined} aria-describedby="f-from-hint" />
            <p id="f-from-hint" className="sx-hint">
              {tried && !addrOk ? 'Enter a Solana address (base58, 32–44 characters).' : 'Screened before the money counts. It must be a wallet your company controls.'}
            </p>
          </div>
        </div>
      ) : null}

      <div className="sx-fund-sum sx-num" aria-live="polite">
        <span>
          Lands in your payments vault <strong>{usd(need)}</strong>
        </span>
        <span>
          {m.provider ? `${m.provider} charges` : m.id === 'wallet_swap' ? 'The swap costs' : 'Charge'} <strong>{charge > 0n ? usd(charge) : 'nothing'}</strong>
          {m.sandbox ? <span className="sx-muted"> (sandbox estimate)</span> : null}
        </span>
        <span>
          You send <strong>{usd(need + charge)}</strong> {m.kind === 'usd' ? 'in USD' : `in ${m.id === 'wallet_swap' ? asset : 'USDC'}`}
        </span>
        <span className="sx-muted sx-small">Splash adds nothing to funding. Its 0.10% fee is on the payout, shown on the approval card.</span>
      </div>

      {details ? (
        <label className="sx-tick sx-tdeclare" data-on={declared ? 'true' : undefined}>
          <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} />
          <span>
            I declare this money belongs to {companyName}, comes from {details.sourceOfFundsLabel.toLowerCase()}, and is not the proceeds of crime. I understand it is screened before it counts toward this payment.
          </span>
        </label>
      ) : (
        <p className="sx-notice sx-notice-info sx-small">Answer “About this payment” first. The declaration names where the money comes from.</p>
      )}

      {offline ? (
        <label className="sx-toggle sx-small">
          <input type="checkbox" checked={rehearse} onChange={(e) => setRehearse(e.target.checked)} />
          Rehearse a problem (offline only): screening flags this source
        </label>
      ) : null}

      <div className="sx-row">
        <button type="submit" className="sx-btn" disabled={busy || !m.available}>
          {busy ? 'Sending for the funds check…' : `Bring in ${usd(need)}`}
        </button>
        {tried && !ready ? (
          <span className="sx-hint" role="status">
            {!details ? 'Answer “About this payment” first.' : !addrOk ? 'Enter the sending wallet.' : !declared ? 'Tick the declaration.' : ''}
          </span>
        ) : null}
      </div>
    </form>
  );
}

/** The extra step a person chose: declared, screened, then in the vault. Each line says what happened. */
function FundsCheck({ funding }: { funding: FundingDTO }) {
  const inVault = funding.state === 'in_vault';
  const stops = [
    { key: 'declared', label: 'Declared', meta: `${funding.sourceOfFundsLabel} · by ${funding.declaredBy}`, done: true },
    { key: 'screened', label: inVault ? 'Screened: clear' : 'Screening the source', meta: funding.fromAddress ? `Wallet ${shortKey(funding.fromAddress, 4)} · ${funding.check?.label ?? ''}` : `${funding.provider ?? ''} account · ${funding.check?.label ?? ''}`, done: inVault },
    { key: 'vault', label: inVault ? 'In your payments vault' : 'Lands in your payments vault', meta: inVault ? `${usd(funding.amountMinor)} at ${timeShort(funding.settledAt)}${funding.simulated ? ' · simulated' : ''}` : `${usd(funding.amountMinor)} once the check clears`, done: inVault },
  ];
  return (
    <div className="sx-pay-body sx-stack" aria-live="polite">
      <p>
        <strong>{funding.methodLabel}</strong>
        {funding.chargeMinor !== '0' ? (
          <span className="sx-muted sx-num">
            {' '}
            · {funding.chargeLabel} {usd(funding.chargeMinor)}
          </span>
        ) : null}
      </p>
      <ol className="sx-fcheck" aria-label="Funds check">
        {stops.map((s) => (
          <li key={s.key} data-done={s.done ? 'true' : undefined} data-current={!s.done ? 'true' : undefined}>
            <span className="sx-fcheck-dot" aria-hidden="true">
              {s.done ? '✓' : ''}
            </span>
            <span>
              <strong>{s.label}</strong>
              <span className="sx-small sx-muted">{s.meta}</span>
            </span>
          </li>
        ))}
      </ol>
      {!inVault ? <p className="sx-small sx-muted">Money from outside your vaults is checked before it can pay anyone. Money already in them skips this step: add funds to your treasury ahead of time, and the next transfer is ready now.</p> : null}
    </div>
  );
}
