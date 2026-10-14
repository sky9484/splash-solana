// iso-ui
'use client';

import Image from 'next/image';
import { useState } from 'react';

import { IsoButton, IsoSurface, Segmented, Tag } from '@/components/iso';

import { api, ApiError, usd } from '../client';
import { notifyCompanyChanged } from '../useCompany';
import type { TreasuryDTO } from './Treasury';

type Row = TreasuryDTO['sweep']['rows'][number];

function moveWords(r: Row): { what: string; why: string } {
  if (r.purpose === 'quarter_interest') return { what: `Bring ${usd(r.amountMinor)} interest back`, why: `Last quarter’s interest (${r.months ?? 'last quarter'}), to your Payments account` };
  if (r.kind === 'subscribe') return { what: `Move ${usd(r.amountMinor)} in`, why: 'Idle cash above reserve and cushion' };
  return { what: `Move ${usd(r.amountMinor)} out`, why: 'Bills due need it back in your Payments account' };
}

/**
 * Hold or sweep (prompt 11 §4.3, decision 9): the owner's setting, and Zeke's drafts, each a row a
 * person decides. "Approve" opens the approval moment (it never approves in place); "Not now" sets the
 * draft aside, and a sweep-out draft isn't drafted again for 7 days. Under it, the payout fees kept
 * inside Splash this month, when there are any.
 */
export function HoldSweep({ data, myKey, onApprove, onSweep, sweepBusy, sweepError }: { data: TreasuryDTO; myKey: string | null; onApprove: (r: Row) => void; onSweep: (on: boolean) => void; sweepBusy: boolean; sweepError: string | null }) {
  const sw = data.sweep;
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function notNow(r: Row) {
    setBusy(r.id);
    setProblem(null);
    try {
      await api(`/treasury/sweep/${r.id}/dismiss`, { body: {} });
      notifyCompanyChanged();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'That didn’t go through. Try again.');
    } finally {
      setBusy(null);
    }
  }

  const fees = data.feesKept;
  return (
    <IsoSurface pad className="iso-rise iso-rise-3 iso-stack iso-sweep" aria-labelledby="tr-sweep">
      <div className="iso-row" style={{ justifyContent: 'space-between' }}>
        <h2 id="tr-sweep" className="iso-h3">
          Hold or sweep
        </h2>
        <Segmented
          label="Hold or sweep"
          options={[
            { value: 'hold', label: 'Hold' },
            { value: 'sweep', label: 'Sweep' },
          ]}
          value={sw.on ? 'sweep' : 'hold'}
          onChange={(v) => onSweep(v === 'sweep')}
          disabled={!sw.mayChange || sweepBusy || !data.hasAccounts ? ['hold', 'sweep'] : []}
        />
      </div>
      <p className="iso-small" style={{ margin: 0 }} aria-live="polite">
        {sw.on
          ? `When cash builds above your reserve and a ${usd(sw.cushionMinor)} cushion, Zeke drafts a move into the T-bill pool. Nothing moves until you approve it.`
          : 'Idle cash stays in your Payments account. Zeke won’t draft sweeps.'}
        {sw.mayChange ? '' : ' Your company’s owner sets this.'}
      </p>
      {sweepError || problem ? (
        <p className="iso-note iso-note--danger" role="alert" style={{ margin: 0 }}>
          {sweepError ?? problem}
        </p>
      ) : null}

      {sw.rows.length > 0 ? (
        <ul className="iso-drafts">
          {sw.rows.map((r) => {
            const w = moveWords(r);
            return (
              <li key={r.id} className="iso-draft" data-state={r.state}>
                <Image className="iso-draft__zeke" src="/cinematic/agent-bot-cut.png" alt="" width={28} height={28} />
                <span className="iso-draft__what">
                  <strong className="iso-ink iso-num">{w.what}</strong>
                  <span className="iso-small">{w.why}</span>
                </span>
                {r.state === 'drafted' ? (
                  <span className="iso-actions iso-draft__do">
                    <IsoButton variant="approve" size="sm" onClick={() => onApprove(r)}>
                      Approve
                    </IsoButton>
                    <IsoButton variant="quiet" size="sm" busy={busy === r.id} onClick={() => void notNow(r)}>
                      Not now
                    </IsoButton>
                  </span>
                ) : r.state === 'approved' ? (
                  <Tag tone="ok" tick>
                    {r.approvedKey && r.approvedKey === myKey ? 'Approved on this device' : `Approved${r.approvedBy ? ` by ${r.approvedBy}` : ''}`}
                  </Tag>
                ) : (
                  <span className="iso-small iso-draft__done">{r.purpose === 'sweep' && r.kind === 'subscribe' ? 'Dismissed · Zeke will ask again next week' : r.purpose === 'quarter_interest' ? 'Dismissed · Zeke drafts the next one after this quarter' : 'Dismissed · Zeke will ask again tomorrow if bills still need it'}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : sw.on ? (
        <p className="iso-small" style={{ margin: 0 }}>
          Nothing to draft today.
        </p>
      ) : null}

      {BigInt(fees.sumMinor) > 0n ? (
        <div className="iso-feeskept">
          <span className="iso-label">Fees kept inside Splash, this month{fees.since ? ` (since ${fees.since})` : ''}</span>
          <strong className="iso-feeskept__sum iso-num">{usd(fees.sumMinor)}</strong>
          <span className="iso-small">
            {fees.count} {fees.count === 1 ? 'payment' : 'payments'} went to Splash businesses, so no payout fee was charged.
          </span>
        </div>
      ) : null}
    </IsoSurface>
  );
}
