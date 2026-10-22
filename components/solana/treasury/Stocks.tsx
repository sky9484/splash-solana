// iso-ui
'use client';

import { Details, IsoButton, IsoSurface, ScrollRegion } from '@/components/iso';
import { bpsText } from '@/lib/treasury/reference';

import { usd } from '../client';
import type { OrderIntent } from './OrderSheet';
import type { TreasuryDTO } from './Treasury';

const bps = (n: string | number) => Number(n);

/**
 * US stocks and ETFs (prompt 11 §4.5, decision 11): bought through Treasurers, Splash's stock partner,
 * which sends each order to the issuer of the stock token (named only in Technical details). The
 * catalogue, its dated sources and the 20% limit are today's; held rows get "Buy more" and "Sell".
 * Prices go up and down, so stocks never count toward the reserve.
 */
export function Stocks({ data, onOrder }: { data: TreasuryDTO; onOrder: (o: OrderIntent) => void }) {
  const s = data.stocks;
  const tsla = s.rows.find((r) => r.id === 'tsla');
  const noRoom = BigInt(s.maxBuyMinor) === 0n;
  const first = s.rows.find((r) => !r.holdingMinor) ?? s.rows[0];
  const buyWhy = !data.hasAccounts ? 'Set up your accounts first.' : noRoom ? 'Your 20% stock limit, or what’s available to invest, allows nothing more today.' : null;
  return (
    <IsoSurface pad className="iso-rise iso-rise-4 iso-stack iso-tcard" aria-labelledby="tr-stocks">
      <div className="iso-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 id="tr-stocks" className="iso-h2">
            US stocks and ETFs
          </h2>
          <span className="iso-small iso-num">
            Stocks are <strong className="iso-ink">{s.sharePct}% of treasury</strong> · your limit {s.capPct}%
          </span>
        </div>
        {first ? (
          <IsoButton variant="primary" onClick={() => onOrder({ asset: first.id, kind: 'buy' })} disabledReason={buyWhy}>
            Buy a stock or ETF
          </IsoButton>
        ) : null}
      </div>
      <p className="iso-note iso-note--gold" style={{ margin: 0 }}>
        <span>
          <strong>Bought through Treasurers, our stock partner.</strong> Treasurers sends your order to each stock’s issuer. Each unit you hold tracks a share price; it isn’t direct share ownership and pays no interest. Prices go up and down, so stocks never count toward your reserve.
        </span>
      </p>
      {noRoom && data.hasAccounts ? (
        <p className="iso-small" role="status" style={{ margin: 0 }}>
          {BigInt(data.accounts.reserveMinor) + BigInt(data.accounts.investmentsMinor) === 0n
            ? 'Stocks can be at most 20% of your Reserve and investments together, and both are empty, so there’s no room for a buy yet.'
            : 'Your 20% stock limit, or what’s available to invest, allows nothing more today.'}
        </p>
      ) : null}
      <ScrollRegion label="US stocks and ETFs">
        <table className="iso-table iso-table--stack iso-stocks">
          <thead>
            <tr>
              <th scope="col">Tracks</th>
              <th scope="col" className="iso-r">
                Past 12 months
              </th>
              <th scope="col" className="iso-r">
                Dividends, past 12 months
              </th>
              <th scope="col" className="iso-r">
                You hold (test)
              </th>
              <th scope="col">
                <span className="iso-sr">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => {
              const ret = bps(r.return12m.value.bps);
              const div = r.dividends12m.value;
              return (
                <tr key={r.id}>
                  <td data-label="Tracks">
                    <strong>{r.name}</strong>
                    <br />
                    <span className="iso-small">
                      {r.tracks} · as of {r.return12m.asOfLabel}
                    </span>
                  </td>
                  <td data-label="Past 12 months" className={`iso-r iso-num${ret < 0 ? ' iso-neg' : ''}`}>
                    {r.return12m.fresh ? bpsText(ret, { sign: true }) : 'Out of date'}
                  </td>
                  <td data-label="Dividends, past 12 months" className="iso-r iso-num">
                    {div === null ? 'none' : !r.dividends12m.fresh ? 'Out of date' : `${bpsText(bps(div.bps))}${r.dividends12m.note === 'trailing' ? ' trailing' : ''}`}
                  </td>
                  <td data-label="You hold (test)" className="iso-r iso-num">
                    {r.holdingMinor ? usd(r.holdingMinor) : '–'}
                  </td>
                  <td className="iso-r">
                    <span className="iso-actions iso-actions--end">
                      <IsoButton variant="quiet" size="sm" onClick={() => onOrder({ asset: r.id, kind: 'buy' })} disabled={!data.hasAccounts || noRoom}>
                        {r.holdingMinor ? 'Buy more' : 'Buy'}
                        <span className="iso-sr"> {r.name}</span>
                      </IsoButton>
                      {r.holdingMinor ? (
                        <IsoButton variant="quiet" size="sm" onClick={() => onOrder({ asset: r.id, kind: 'sell' })}>
                          Sell<span className="iso-sr"> {r.name}</span>
                        </IsoButton>
                      ) : null}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollRegion>
      <p className="iso-small" style={{ margin: 0 }}>
        Past returns of the share, dividends included. Not a forecast.
        {tsla && bps(tsla.return12m.value.bps) < 0 ? ` ${tsla.name} shows why: down ${Math.trunc(-bps(tsla.return12m.value.bps) / 100)}% over the same year.` : ''} Stocks never count towards your reserve.
      </p>
      <Details summary="Sources">
        <ul className="iso-sources">
          {s.rows.flatMap((r) => [
            <li key={`${r.id}-r`}>
              {r.name}, past 12 months, {r.return12m.asOfLong}:{' '}
              <a href={r.return12m.sourceUrl} target="_blank" rel="noreferrer">
                {new URL(r.return12m.sourceUrl).host}
              </a>
            </li>,
            <li key={`${r.id}-d`}>
              {r.name}, dividends, {r.dividends12m.asOfLong}:{' '}
              <a href={r.dividends12m.sourceUrl} target="_blank" rel="noreferrer">
                {new URL(r.dividends12m.sourceUrl).host}
              </a>
              {r.dividends12m.note && r.dividends12m.note !== 'trailing' ? ` (${r.dividends12m.note})` : ''}
            </li>,
          ])}
        </ul>
      </Details>
    </IsoSurface>
  );
}
