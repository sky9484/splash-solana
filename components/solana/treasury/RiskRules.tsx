// iso-ui
'use client';

import { IsoSurface } from '@/components/iso';

import { usd } from '../client';
import type { TreasuryDTO } from './Treasury';

/**
 * Treasury activity (prompt 11 §4.6): interest booked and moves in and out, dated, newest first. "You
 * approved" when this device's key approved the move; otherwise who did.
 */
export function Activity({ data, myKey }: { data: TreasuryDTO; myKey: string | null }) {
  const rows = data.activity;
  return (
    <IsoSurface pad className="iso-rise iso-rise-4 iso-stack" aria-labelledby="tr-activity">
      <h2 id="tr-activity" className="iso-h3">
        Treasury activity
      </h2>
      {rows.length === 0 ? (
        <p className="iso-small" style={{ margin: 0 }}>
          Nothing yet. Interest booked each day and every move in or out show here.
        </p>
      ) : (
        <ul className="iso-activity">
          {rows.map((r) => (
            <li key={r.id}>
              <span>
                <strong className="iso-ink">{r.what === 'interest' ? 'Interest' : r.what === 'in' ? 'Moved in' : 'Moved out'}</strong>
                <span className="iso-small">
                  {r.what === 'interest' || !(r.approvedKey || r.approvedBy) ? '' : r.approvedKey && r.approvedKey === myKey ? ' · you approved' : ` · approved by ${r.approvedBy ?? 'your team'}`} · {r.label}
                </span>
              </span>
              <span className={`iso-num${r.what === 'out' ? ' iso-neg' : ''}`}>
                {r.what === 'out' ? '−' : '+'}
                {usd(r.amountMinor)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </IsoSurface>
  );
}

/**
 * Risk and rules (prompt 10 §7; prompt 11 §4.6): today's list, plus who carries stock orders and the
 * fee line. Treasurers is named here and on the stocks card only (prompt 11 §0.4).
 */
export function RiskRules({ data }: { data: TreasuryDTO }) {
  const d = data;
  return (
    <IsoSurface pad className="iso-rise iso-rise-5" aria-labelledby="tr-risk">
      <h2 id="tr-risk" className="iso-h2" style={{ marginBottom: 10 }}>
        Risk and rules
      </h2>
      <ul className="iso-bullets">
        <li>These are your company’s own investments, in your own account. Splash doesn’t hold, manage or advise on them, and holds no key to any of your accounts.</li>
        <li>Not available to US persons. Before your first subscription or buy, an owner confirms no owner, director or approver is one.{d.eligibility.confirmed ? ` Confirmed by ${d.eligibility.by}.` : ''}</li>
        <li>Your company rules: reserve floor {d.reserve.marginPct}% above what’s due · stocks at most {d.stocks.capPct}% of treasury. Set by your owner; changing them comes with the rules update.</li>
        <li>Sweep, when it’s on: Zeke drafts each move from your owner’s rule (keep the reserve at its floor and at least {usd(d.sweep.cushionMinor)} in Payments), and once a quarter a move to bring that quarter’s interest back. Every move needs an approval. Zeke never picks an investment.</li>
        <li>Stocks are bought through Treasurers. Splash fee on subscribing, redeeming, buying and selling: US$0.</li>
        <li>Subject to legal sign-off in Malaysia.</li>
      </ul>
    </IsoSurface>
  );
}
