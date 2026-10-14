// iso-ui
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { AmountField, IsoButton, IsoSurface, Segmented, Tag, TestModeBadge } from '@/components/iso';
import LocalTime from '@/components/LocalTime';
import { api, ApiError, usd } from '@/components/solana/client';
import type { TreasuryDTO } from '@/components/solana/treasury/Treasury';
import { dollarsToMinor } from '@/components/solana/treasury/OrderSheet';
import { notifyCompanyChanged } from '@/components/solana/useCompany';

/** US$ minor units → "5000.00" for the field. */
const toInput = (minor: string) => {
  const cents = BigInt(minor) / 10_000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
};

/**
 * Settings › Treasury (prompt 10 §7.3, §12): the owner's sweep rule (on or off, and the cushion kept in
 * the Payments account), and the company rules Treasury runs under, read-only at their defaults: the
 * reserve floor and the stock limit. Every change is recorded with who and when; a sweep draft still
 * needs a person's approval on a device.
 */
export function TreasuryRulesCard({ isOwner }: { isOwner: boolean }) {
  const [data, setData] = useState<TreasuryDTO | null>(null);
  const [mode, setMode] = useState<'hold' | 'sweep'>('hold');
  const [cushion, setCushion] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ treasury: TreasuryDTO }>('/treasury');
      setData(r.treasury);
      setMode(r.treasury.sweep.on ? 'sweep' : 'hold');
      setCushion(toInput(r.treasury.sweep.cushionMinor));
    } catch (e) {
      setMessage({ tone: 'danger', text: e instanceof ApiError ? e.message : 'Treasury’s rules did not load. Try again.' });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const cushionMinor = dollarsToMinor(cushion) ?? (cushion.trim() === '0' ? '0' : null);
  const changed = data ? (mode === 'sweep') !== data.sweep.on || cushionMinor !== data.sweep.cushionMinor : false;

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ sweep: { on: boolean; cushionMinor: string } }>('/treasury/sweep', { body: { on: mode === 'sweep', cushionMinor: cushionMinor ?? undefined } });
      setMessage({ tone: 'ok', text: r.sweep.on ? `Sweep is on, with a ${usd(r.sweep.cushionMinor)} cushion. Each draft still needs a person’s approval.` : 'Hold: nothing is drafted.' });
      notifyCompanyChanged();
      await load();
    } catch (e) {
      setMessage({ tone: 'danger', text: e instanceof ApiError ? e.message : 'The rule did not save. Try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <IsoSurface pad className="iso-stack" aria-labelledby="settings-treasury">
      <div className="iso-row" style={{ justifyContent: 'space-between' }}>
        <h2 id="settings-treasury" className="iso-h2">
          Treasury
        </h2>
        <TestModeBadge inline />
      </div>
      <p className="iso-body" style={{ margin: 0 }}>
        The rules Treasury runs under. Zeke drafts from them; a person approves every move on a device. <Link href="/dashboard/treasury">Open Treasury</Link>
      </p>
      {!data ? (
        message ? (
          <p className="iso-note iso-note--danger" role="alert">
            {message.text}
          </p>
        ) : (
          <div className="iso-skel" style={{ height: 120 }} aria-busy="true" aria-label="Loading" />
        )
      ) : (
        <>
          <dl className="iso-dl iso-dl--rows">
            <div>
              <dt>Reserve floor</dt>
              <dd>{data.reserve.marginPct}% above what’s due in the next 30 days</dd>
            </div>
            <div>
              <dt>Stocks</dt>
              <dd>At most {data.stocks.capPct}% of treasury</dd>
            </div>
            <div>
              <dt>US persons</dt>
              <dd>
                {data.eligibility.confirmed && data.eligibility.at ? (
                  <Tag tone="ok" tick>
                    Confirmed by {data.eligibility.by}, <LocalTime value={data.eligibility.at} format="date" />
                  </Tag>
                ) : (
                  'Confirmed once, before the first subscription or buy'
                )}
              </dd>
            </div>
          </dl>
          <p className="iso-small" style={{ margin: 0 }}>
            The floor and the stock limit are set at their defaults by your owner; changing them comes with the rules update.
          </p>
          {isOwner ? (
            <>
              <div className="iso-field">
                <span className="iso-field__label">Idle cash</span>
                <Segmented
                  label="Idle cash"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'hold', label: 'Hold' },
                    { value: 'sweep', label: 'Sweep' },
                  ]}
                />
              </div>
              <p className="iso-small" style={{ margin: 0 }}>
                {mode === 'sweep'
                  ? 'Each morning Zeke drafts a move of cash above your reserve and the cushion into T-bills, and drafts a redemption when bills due need the money back. You approve each one. Zeke never picks an investment.'
                  : 'Idle cash stays where it is. Nothing is drafted; subscribe or redeem yourself whenever you like.'}
              </p>
              {mode === 'sweep' ? (
                <AmountField label="Cushion kept in your Payments account" currency="US$" value={cushion} onChange={setCushion} help="On top of what’s waiting for approval. US$5,000.00 unless you change it." error={cushion && !cushionMinor ? 'Give an amount in dollars and cents.' : null} />
              ) : null}
              <div>
                <IsoButton variant="primary" onClick={() => void save()} busy={busy} disabledReason={!changed ? 'Nothing to save yet.' : mode === 'sweep' && !cushionMinor ? 'Give the cushion first.' : null}>
                  Save
                </IsoButton>
              </div>
            </>
          ) : (
            <p className="iso-small" style={{ margin: 0 }}>
              Sweep is {data.sweep.on ? `on, with a ${usd(data.sweep.cushionMinor)} cushion` : 'off'}. Only your company’s owner can change it.
            </p>
          )}
          {message ? (
            <p className={message.tone === 'ok' ? 'iso-note iso-note--ok' : 'iso-note iso-note--danger'} role={message.tone === 'ok' ? 'status' : 'alert'}>
              {message.text}
            </p>
          ) : null}
        </>
      )}
    </IsoSurface>
  );
}
