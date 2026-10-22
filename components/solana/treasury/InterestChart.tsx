// iso-ui
'use client';

import { useState } from 'react';

import { Segmented } from '@/components/iso';

import { usd } from '../client';
import type { TreasuryDTO } from './Treasury';

type Day = TreasuryDTO['tbills']['interest'][number];

/**
 * The days a span shows and its tiles (prompt 11 §4.2): This period is the sum of the days shown, and
 * Average a day that sum over the number of days, rounded down (integers, US$ minor units).
 */
export function chartTiles<D extends { interestMinor: string | bigint }>(days: readonly D[], span: '7' | '30') {
  const shown = span === '7' ? days.slice(-7) : [...days];
  const values = shown.map((d) => BigInt(d.interestMinor));
  const total = values.reduce((n, v) => n + v, 0n);
  return { shown, values, total, average: shown.length ? total / BigInt(shown.length) : 0n };
}

/**
 * "Interest per day" (prompt 11 §4.2): one bar a day for the last 7 or 30 days, each the interest
 * booked that day from the official daily price (lib/treasury/history.ts, integers). Hover or focus a
 * bar for its date and amount; the first and last bars carry their dates; a sentence says the same for
 * a screen reader. Under it: This period, Average a day, This quarter so far. Before any interest is
 * booked, one line instead (prompt 12 B3).
 */
export function InterestChart({ days, quarterSoFarMinor, holds }: { days: Day[]; quarterSoFarMinor: string; holds: boolean }) {
  const [span, setSpan] = useState<'7' | '30'>('7');
  const [active, setActive] = useState<number | null>(null);
  const { shown, values, total, average } = chartTiles(days, span);
  const top = values.reduce((m, v) => (v > m ? v : m), 0n);
  // Bar heights in whole percent of the tallest bar (integers; the tallest is 100).
  const pct = (v: bigint) => (top === 0n ? 0 : Number((v * 100n) / top));
  const first = shown[0];
  const last = shown.at(-1);
  const at = active === null ? null : shown[active];
  // Prompt 12 B3: no chart until a day's interest is booked; an empty 200 px plot says nothing.
  if (!days.some((d) => BigInt(d.interestMinor) > 0n)) {
    return (
      <div className="iso-ichart">
        <h3 id="tr-ichart" className="iso-h3">
          Interest per day
        </h3>
        <p className="iso-small" style={{ margin: 0 }}>
          Interest shows here after your first full day.
        </p>
      </div>
    );
  }
  return (
    <div className="iso-ichart">
      <div className="iso-row" style={{ justifyContent: 'space-between' }}>
        <h3 id="tr-ichart" className="iso-h3">
          Interest per day
        </h3>
        <Segmented
          label="How many days"
          options={[
            { value: '7', label: '7 days' },
            { value: '30', label: '30 days' },
          ]}
          value={span}
          onChange={(v) => {
            setSpan(v);
            setActive(null);
          }}
        />
      </div>
      <p className="iso-sr" id="tr-ichart-sum">
        {first && last ? `Interest booked each day from ${first.label} to ${last.label}: ${usd(total)} in all, about ${usd(average)} a day.` : 'No interest booked yet.'}
      </p>
      <div className="iso-ichart__plot" role="group" aria-labelledby="tr-ichart" aria-describedby="tr-ichart-sum" onMouseLeave={() => setActive(null)}>
        <p className="iso-ichart__tip iso-num" aria-live="polite">
          {at ? `${at.label} · ${usd(at.interestMinor)}` : ' '}
        </p>
        {total === 0n ? (
          <p className="iso-small iso-ichart__empty" style={{ margin: 0 }}>
            {holds
              ? `No interest booked in these ${shown.length} days yet. It is booked once a day, for T-bills held at the start of the day, so today’s live estimate is booked tomorrow.`
              : `No interest booked in these ${shown.length} days. It is booked once a day, for T-bills held at the start of the day.`}
          </p>
        ) : null}
        <ol className="iso-ichart__bars" data-span={span}>
          {shown.map((d, i) => (
            <li key={d.day}>
              <button
                type="button"
                className="iso-ichart__bar"
                style={{ height: `${Math.max(pct(values[i]!), values[i]! > 0n ? 2 : 0)}%` }}
                aria-label={`${d.label} · ${usd(d.interestMinor)}`}
                data-active={active === i ? '' : undefined}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              />
            </li>
          ))}
        </ol>
        <div className="iso-ichart__axis iso-small iso-num" aria-hidden="true">
          <span>{first?.label}</span>
          <span>{last?.label}</span>
        </div>
      </div>
      <dl className="iso-ichart__tiles">
        <div>
          <dt>This period</dt>
          <dd className="iso-num" data-testid="tile-period">
            +{usd(total)}
          </dd>
        </div>
        <div>
          <dt>Average a day</dt>
          <dd className="iso-num" data-testid="tile-average">
            +{usd(average)}
          </dd>
        </div>
        <div>
          <dt>This quarter so far</dt>
          <dd className="iso-num">+{usd(quarterSoFarMinor)}</dd>
        </div>
      </dl>
      <p className="iso-small" style={{ margin: 0 }}>
        The live figure is an estimate. Your books use Ondo’s official price, set once a day.
      </p>
    </div>
  );
}
