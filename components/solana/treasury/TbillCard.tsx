// iso-ui
'use client';

import { useEffect, useState } from 'react';

import { Details, IsoButton, IsoDisplay, IsoSurface } from '@/components/iso';
import { bpsText } from '@/lib/treasury/reference';

import { usd } from '../client';
import { InterestChart } from './InterestChart';
import { liveEstimate, liveText, perDayText } from './live';
import type { TreasuryDTO } from './Treasury';

/**
 * A clock that ticks every second while the tab is visible and stops while it is hidden. With reduced
 * motion it moves once a minute (prompt 11 Phase 5, motion audit).
 */
function useVisibleNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const step = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 60_000 : ms;
    let timer: number | null = null;
    const stop = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    };
    const sync = () => {
      if (document.hidden) return stop();
      setNow(Date.now());
      if (timer === null) timer = window.setInterval(() => setNow(Date.now()), step);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [ms]);
  return now;
}

/**
 * The US T-bill pool (prompt 11 §4.2, "the third image"): what the company holds in USDY, issued by
 * Ondo, in its own Investments account, with today's interest as a live estimate (it ticks every second
 * while the tab is visible), Subscribe and Redeem, the interest booked each day, and how it works.
 * The live figure is display-only (./live.ts); every amount the books keep is an integer from the
 * server.
 */
export function TbillCard({ data, onOrder, subscribeWhy, redeemWhy }: { data: TreasuryDTO; onOrder: (kind: 'subscribe' | 'redeem') => void; subscribeWhy: string | null; redeemWhy: string | null }) {
  const t = data.tbills;
  const now = useVisibleNow();
  const live = t.live ? liveEstimate({ unitsMicro: t.live.unitsMicro, priceTodayMinor: t.live.priceTodayMinor, bps: t.live.bps }, now) : null;
  const value = live ? `US$${live.valueNow.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : usd(t.holding?.valueMinor ?? '0');
  return (
    <IsoSurface hero pad className="iso-rise iso-rise-3 iso-stack iso-tbill" aria-labelledby="tr-usdy">
      <div className="iso-tbill__head">
        <div className="iso-tbill__what">
          <h2 id="tr-usdy" className="iso-h2">
            US T-bill pool
          </h2>
          <span className="iso-small">USDY, issued by Ondo · held in your Investments account</span>
          <IsoDisplay size="lg">{value}</IsoDisplay>
          {t.rate.fresh ? (
            <span className="iso-small iso-num">
              Rate {bpsText(Number(t.rate.value.bps))} a year · {t.rate.note} · as of {t.rate.asOfLong} ·{' '}
              <a href={t.rate.sourceUrl} target="_blank" rel="noreferrer">
                source
              </a>
            </span>
          ) : (
            <span className="iso-small">
              <strong className="iso-ink">Rate out of date.</strong> Last checked {t.rate.asOfLong} ·{' '}
              <a href={t.rate.sourceUrl} target="_blank" rel="noreferrer">
                source
              </a>
            </span>
          )}
        </div>
        {/* The ticking number is aria-live off; focus reads the static name and the per-day line. */}
        <div className="iso-tbill__live" tabIndex={0} role="group" aria-label="Interest today, a live estimate" aria-describedby="tr-perday">
          <span className="iso-small iso-tbill__livehead">
            <span className="iso-livedot" aria-hidden="true" /> Interest today · live estimate
          </span>
          <strong className="iso-tbill__liveval iso-num" aria-live="off">
            {live ? liveText(live.interestToday) : '+US$0.0000'}
          </strong>
          <span id="tr-perday" className="iso-small iso-num">
            {live ? perDayText(live.perDay) : 'Nothing held yet'}
          </span>
        </div>
      </div>

      <div className="iso-actions">
        <IsoButton variant="primary" onClick={() => onOrder('subscribe')} disabledReason={subscribeWhy}>
          Subscribe
        </IsoButton>
        <IsoButton variant="quiet" onClick={() => onOrder('redeem')} disabledReason={redeemWhy}>
          Redeem
        </IsoButton>
      </div>
      <InterestChart days={t.interest} quarterSoFarMinor={t.quarterSoFarMinor} holds={Boolean(t.holding)} />

      <Details summary="How it works">
        <div className="iso-stack">
          {/* What you hold, in units, and any hold on them: the card's foot before, moved here (§4.2). */}
          {t.holding ? (
            <p className="iso-small iso-num" style={{ margin: 0 }}>
              You hold {t.holding.unitsText} units
              {BigInt(t.holding.heldMinor) > 0n ? ` · ${usd(t.holding.heldMinor)} is in its ${t.holdDays}-day hold until ${t.holding.heldUntilLabel}` : ''}
            </p>
          ) : null}
          <p className="iso-body" style={{ margin: 0 }}>
            A note backed by short-term US Treasury bills and bank deposits. <strong>Not a bank deposit; its value can fall.</strong>
          </p>
          <ul className="iso-bullets">
            <li>You subscribe with US dollars. Your dollars go to Ondo, and Ondo issues USDY units into your Investments account. Splash only builds the order; you approve it.</li>
            <li>You keep the same number of units. Each unit’s price rises daily as interest builds up.</li>
            <li>Subscribed straight from Ondo: units are held {t.holdDays} days before you can redeem them. On the market: no hold, for smaller amounts.</li>
            <li>For non-US companies only.</li>
            <li>Most businesses redeem once a quarter. Redeeming straight with Ondo pays US dollars by bank wire to your company’s bank account, outside Splash.</li>
          </ul>
        </div>
      </Details>
    </IsoSurface>
  );
}
