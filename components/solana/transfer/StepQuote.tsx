// iso-ui
'use client';

import { Fragment, useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';

import { Details, IsoButton, IsoSurface, Segmented, Tag, secondsLeft, useNow, type TagTone } from '@/components/iso';
import { radioKeys, tabStop } from '@/components/iso/radio';

import { api, pctFine, php, usd } from '../client';
import type { FundingOptionsDTO, PaymentDTO, RouteCardDTO } from '../types';
import { AddMoneySheet } from './AddMoneySheet';
import { HowItMoves } from './HowItMoves';
import { SoFar, TxGrid, type SoFarRow } from './SoFar';
import { shortName, usdWhole, type Problem } from './shared';

/** Test mode only: a problem the next step plays out, so each failure can be seen before it happens for real. */
export type Rehearsal = 'none' | 'kyt_flag' | 'partner_return';

type Checks = { quoteId: string; passed: number; total: number; checks: Array<{ name: string; label: string; passed: boolean }> };

/** Who receives it, as Steps 3–5 name them. */
export interface PayeeLabel {
  name: string;
  bank: string | null;
  last4: string | null;
}

/** Every fee on a route, together: partner, Splash and processing. They add up to You pay − Converted. */
export const feesOf = (c: RouteCardDTO) => BigInt(c.costs.partnerMinor) + BigInt(c.costs.splashMinor) + BigInt(c.costs.routeMinor);

/** A lane's tag tone, by the policy its label names (the labels come from the server, aligned with policies). */
const POLICY_TONE: Partial<Record<string, TagTone>> = { cheapest: 'ok', fastest: 'gold' };

/**
 * Step 3, "Pick a route", then "Cost and where it comes from" (prompt 11 §2.3; prompt 10 §5.6). A bank
 * payout: its routes side by side, labelled Cheapest and Fastest by the engine's ranking (never a time,
 * never a network), each with its fee, one line on how it goes, a small route line with coins moving
 * only on the chosen one, and what you pay. A business on Splash: one lane, inside Splash, no fee.
 * Then the cost line by line, where the money comes from, and "How it moves", closed.
 */
export function StepQuote({
  payment,
  payee,
  quoteId,
  onQuoteId,
  funding,
  onFundingChanged,
  sourceOfFunds,
  busy,
  problem,
  rehearsal,
  onRehearsal,
  rows,
  back,
  onRequote,
  onReview,
}: {
  payment: PaymentDTO;
  payee: PayeeLabel;
  quoteId: string | null;
  onQuoteId: (id: string) => void;
  funding: FundingOptionsDTO | null;
  onFundingChanged: () => void;
  sourceOfFunds: string | null;
  busy: 'requote' | 'review' | null;
  problem: Problem | null;
  rehearsal: Rehearsal;
  onRehearsal: (r: Rehearsal) => void;
  rows: SoFarRow[];
  back: { label: string; href?: string; onClick?: () => void };
  onRequote: () => void;
  onReview: () => void;
}) {
  const now = useNow();
  const [adding, setAdding] = useState(false);
  const [checks, setChecks] = useState<Checks | null>(null);
  const peer = payment.kind === 'peer';
  const lanes: RouteCardDTO[] = [...payment.cards, ...(payment.compare ? [payment.compare] : [])];
  const card = lanes.find((c) => c.quoteId === quoteId) ?? payment.cards[0] ?? null;

  // The rules for the route being looked at (a read: nothing changes until "Review and approve").
  const lookingAt = card?.quoteId ?? null;
  useEffect(() => {
    if (!lookingAt) return;
    let stop = false;
    api<{ checks: Checks }>(`/payments/${payment.id}/checks?quoteId=${lookingAt}`)
      .then((r) => !stop && setChecks(r.checks))
      .catch(() => !stop && setChecks(null));
    return () => {
      stop = true;
    };
  }, [payment.id, lookingAt]);

  if (!card) {
    return (
      <p className="iso-note iso-note--danger" role="alert">
        No route can pay this right now. Go back and try again in a minute.
      </p>
    );
  }

  const short = shortName(payee.name);
  const bankShort = payee.bank ? payee.bank.split(/[\s,]/)[0]! : 'Bank';
  const left = secondsLeft(card.expiresAt, now);
  // A bank quote that ran out: its routes are unavailable (dimmed) until a new quote comes.
  const unavailable = left === 0 && !peer;
  const amountFull = peer ? usd(card.receivePhpMinor) : php(card.receivePhpMinor);
  const plan = funding?.plan ?? null;
  const landed = funding?.fundings.find((f) => f.state === 'in_vault') ?? null;
  const checkFailed = checks && checks.quoteId === card.quoteId ? checks.checks.find((c) => !c.passed) : null;
  const sameReceive = lanes.every((c) => c.receivePhpMinor === lanes[0]!.receivePhpMinor);
  // A payment to a Splash business has no rate to run out: Review gets a fresh quote if it must.
  const why =
    payment.state === 'rejected_by_policy'
      ? 'Stopped by a rule, so nothing was sent. See why above; your company’s owner can change rules in Rules.'
      : left === 0 && !peer
        ? 'The quote ran out. Get a new one first.'
        : !plan
          ? 'Working out where the money comes from…'
          : plan.kind === 'external'
            ? `Add money first: your Payments account is short by ${usd(plan.shortMinor)}.`
            : checkFailed
              ? `Stopped by a rule: ${checkFailed.label.toLowerCase()}.`
              : null;

  const values = lanes.map((c) => c.quoteId);
  const main = (
    <>
      <IsoSurface pad className="iso-stack" aria-labelledby="t3-route">
        <div className="iso-row" style={{ justifyContent: 'space-between' }}>
          <h2 id="t3-route" className="iso-h2" data-step-heading>
            Pick a route
          </h2>
          <span className="iso-small iso-num">
            {peer ? `They get ${usdWhole(card.receivePhpMinor)}` : sameReceive && lanes.length > 1 ? `Both deliver ${php(card.receivePhpMinor)}` : `Delivers ${php(card.receivePhpMinor)}`}
            {left === 0 && !peer ? (
              <>
                {' · '}
                <button type="button" className="iso-tip" onClick={onRequote} disabled={busy === 'requote'}>
                  <RefreshCw size={14} aria-hidden="true" /> Get a new quote
                </button>
              </>
            ) : null}
          </span>
        </div>
        <div className={clsx('iso-routes', unavailable && 'iso-stale')} role="radiogroup" aria-label="Route" onKeyDown={radioKeys(values, card.quoteId, onQuoteId)}>
          {lanes.map((c) => {
            const on = c.quoteId === card.quoteId;
            const tags: Array<{ label: string; tone: TagTone }> = peer ? [{ label: 'Inside Splash', tone: 'ok' }] : c.labels.length > 0 ? c.labels.map((l, i) => ({ label: l, tone: POLICY_TONE[c.policies[i] ?? ''] ?? 'ink' })) : [{ label: 'Other route', tone: 'ink' }];
            const stops = peer ? ['You', short] : c.lowerCostLane ? ['You', 'Lower-cost lane', 'Partner', bankShort] : ['You', 'Partner', bankShort];
            const line = peer
              ? `Straight into ${short}’s Splash account. No payout partner, no conversion.`
              : c.lowerCostLane
                ? 'One more step, through the partner’s lower-cost lane.'
                : c.policies.includes('fastest')
                  ? 'Straight to the partner. Expected to finish first.'
                  : 'Straight to the partner.';
            return (
              <button key={c.quoteId} type="button" role="radio" aria-checked={on} tabIndex={tabStop(c.quoteId, values, card.quoteId)} data-radio-value={c.quoteId} className="iso-route" onClick={() => onQuoteId(c.quoteId)}>
                <span className="iso-route__head">
                  <span className="iso-route__tags">
                    {tags.map((t) => (
                      <Tag key={t.label} tone={t.tone} className="iso-lane__name">
                        {t.label}
                      </Tag>
                    ))}
                  </span>
                  <strong className="iso-route__fee iso-num">{peer ? 'No fee' : `Fee ${usd(feesOf(c))}`}</strong>
                </span>
                <span className="iso-route__why">{line}</span>
                <span className="iso-mini" aria-hidden="true">
                  {stops.map((s, i) => (
                    <Fragment key={`${s}-${i}`}>
                      {i > 0 ? (
                        <span className={clsx('iso-mini__wire', on && 'iso-mini__wire--active')}>
                          <span className="iso-coin" />
                        </span>
                      ) : null}
                      <span className="iso-mini__stop">
                        <span className="iso-mini__dot" />
                        <span className="iso-mini__label">{s}</span>
                      </span>
                    </Fragment>
                  ))}
                </span>
                <span className="iso-route__foot iso-num">
                  <span>You pay</span>
                  <strong>{usd(c.youPayUsdcMinor)}</strong>
                </span>
              </button>
            );
          })}
        </div>
        <p className="iso-small iso-row iso-rules" aria-live="polite">
          <ShieldCheck size={16} aria-hidden="true" />
          {checks && checks.quoteId === card.quoteId ? (checkFailed ? `Stopped by a rule: ${checkFailed.label}` : `Passed ${checks.passed} of ${checks.total} rules`) : 'Checking your rules…'}
          <span> · checked again before you approve</span>
        </p>
      </IsoSurface>

      <IsoSurface pad aria-labelledby="t3-cost">
        <h2 id="t3-cost" className="iso-h2" style={{ marginBottom: 14 }}>
          Cost and where it comes from
        </h2>
        <div className="iso-costgrid">
          <div className="iso-stack">
            <dl className="iso-dl iso-dl--rows iso-num" aria-label="What it costs">
              <div>
                <dt>They receive</dt>
                <dd>{amountFull}</dd>
              </div>
              {peer ? null : (
                <>
                  <div>
                    <dt>Rate</dt>
                    <dd>1 USD = {card.rate} PHP</dd>
                  </div>
                  <div>
                    <dt>Converted</dt>
                    <dd>{usd(card.costs.amountMinor)}</dd>
                  </div>
                </>
              )}
              <div>
                <dt>{peer ? 'Fee' : `Fee, all-in (${pctFine(card.allInBps)})`}</dt>
                <dd>{peer ? 'US$0.00' : usd(feesOf(card))}</dd>
              </div>
              <div className="iso-dl__total">
                <dt>You pay</dt>
                <dd>
                  <strong key={card.youPayUsdcMinor} className="iso-pop">
                    {usd(card.youPayUsdcMinor)}
                  </strong>
                </dd>
              </div>
            </dl>
            <p className="iso-small" style={{ margin: 0 }}>
              {peer
                ? 'No Splash fee between Splash businesses.'
                : `Payout partner ${usd(card.costs.partnerMinor)} · Splash ${usd(card.costs.splashMinor)} (${card.costs.splashShare}) · processing ${BigInt(card.costs.routeMinor) > 0n ? usd(card.costs.routeMinor) : 'included'} · target ${payment.allInTarget} or less${payment.simulated ? ' · test quote' : ''}`}
            </p>
          </div>
          <div className="iso-stack">
            <span className="iso-field__label">Pay from</span>
            {!plan ? (
              <div className="iso-skel" style={{ height: 56 }} aria-busy="true" aria-label="Working out where the money comes from" />
            ) : (
              <div className="iso-payfrom">
                <div className="iso-row" style={{ justifyContent: 'space-between' }}>
                  <strong className="iso-num">Payments account · {usd(plan.paymentsNowMinor)}</strong>
                  {plan.kind === 'covered' ? (
                    <Tag tone="ok" tick>
                      Covered
                    </Tag>
                  ) : (
                    <Tag tone="amber">Short by {usd(plan.kind === 'reserve' ? plan.moveMinor : plan.shortMinor)}</Tag>
                  )}
                </div>
                {plan.kind === 'external' ? (
                  <p className="iso-note iso-note--amber" style={{ margin: 0 }}>
                    Your Payments account is short by {usd(plan.shortMinor)}, and your reserve holds {usd(plan.reserveNowMinor)}. Add money first.
                  </p>
                ) : (
                  <span className="iso-small iso-num">{usd(plan.paymentsAfterMinor)} after this payment</span>
                )}
                {plan.kind === 'reserve' ? (
                  <span className="iso-small iso-num">
                    <Tag tone="gold">Moves first</Tag> {usd(plan.moveMinor)} moves from your reserve first, in the same approval · reserve {usd(plan.reserveNowMinor)} → {usd(plan.reserveAfterMinor)}
                  </span>
                ) : null}
                {landed ? (
                  <span className="iso-small iso-num">
                    <Tag tone="ok" tick>
                      Landed in your Payments account
                    </Tag>{' '}
                    {usd(landed.amountMinor)} · {landed.methodLabel}
                  </span>
                ) : null}
              </div>
            )}
            <div className="iso-row">
              <IsoButton variant={plan?.kind === 'external' ? 'primary' : 'quiet'} size="sm" onClick={() => setAdding(true)} disabled={!funding || !card}>
                {plan?.kind === 'external' ? 'Add money' : 'Add money another way'}
              </IsoButton>
              <span className="iso-small">Splash fee to add money: US$0.</span>
            </div>
            <HowItMoves payment={payment} payeeName={payee.name} />
            {payment.simulated && !peer ? (
              <Details summary="Rehearse a problem (test mode only)">
                <span className="iso-stack" style={{ display: 'flex' }}>
                  <span className="iso-small">The next steps play it out with test money, so you can see what you’d see. Nothing real is stopped or returned.</span>
                  <Segmented
                    label="Rehearse a problem"
                    value={rehearsal}
                    onChange={onRehearsal}
                    options={[
                      { value: 'none', label: 'No problem' },
                      { value: 'kyt_flag', label: 'Screening flags them' },
                      { value: 'partner_return', label: 'The bank returns it' },
                    ]}
                  />
                </span>
              </Details>
            ) : null}
          </div>
        </div>
      </IsoSurface>

      {problem ? (
        <p className="iso-note iso-note--danger" role="alert">
          {problem.message}
        </p>
      ) : null}

      {funding ? <AddMoneySheet open={adding} onClose={() => setAdding(false)} target={{ kind: 'payment', paymentId: payment.id, quoteId: card.quoteId, options: funding }} sourceOfFunds={sourceOfFunds} onLanded={onFundingChanged} /> : null}
    </>
  );

  return (
    <TxGrid
      main={main}
      rail={
        <SoFar
          rows={rows}
          action={
            <IsoButton variant="primary" size="lg" block onClick={onReview} busy={busy === 'review'} disabledReason={busy === 'review' ? null : why}>
              {busy === 'review' ? 'Checking your rules…' : 'Review and approve'}
            </IsoButton>
          }
          back={back}
        />
      }
    />
  );
}
