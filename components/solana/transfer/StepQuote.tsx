// iso-ui
// iso-ui states: 2
'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

import { ActionBar, Details, Hop, IsoButton, IsoDisplay, IsoSurface, LaneGroup, QuoteRing, RouteMap, Segmented, Station, Tag, Ticket, Wire, secondsLeft, useNow } from '@/components/iso';
import { PageHead } from '@/components/dashboard/PageHead';
import { useNavShell } from '@/components/dashboard/useNavShell';

import { api, pctFine, php, usd } from '../client';
import type { FundingOptionsDTO, PaymentDTO, RouteCardDTO } from '../types';
import { AddMoneySheet } from './AddMoneySheet';
import { HowItMoves } from './HowItMoves';
import { phpWhole, shortName, usdWhole, type Problem } from './shared';

/** Test mode only: a problem the next step plays out, so each failure can be seen before it happens for real. */
export type Rehearsal = 'none' | 'kyt_flag' | 'partner_return';

type Checks = { quoteId: string; passed: number; total: number; checks: Array<{ name: string; label: string; passed: boolean }> };

/** Who receives it, as Step 3 names them. */
export interface PayeeLabel {
  name: string;
  bank: string | null;
  last4: string | null;
}

/**
 * Step 3, "Quote & send" (prompt 10 §5.6, frame Final-Transfer): how the money reaches them, on the
 * route map; the two lanes, labelled by the engine's ranking (never a network, never a time); what it
 * costs, line by line; and where the money comes from, as a plan. A bank payout has the partner on the
 * map, and the partner's lower-cost lane when the chosen route uses it; a payment to a business on
 * Splash has two stations and no Splash fee.
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
  ticketAway,
  rehearsal,
  onRehearsal,
  onRequote,
  onBack,
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
  /** The approval moment is open: the ticket is the approval card now. */
  ticketAway: boolean;
  rehearsal: Rehearsal;
  onRehearsal: (r: Rehearsal) => void;
  onRequote: () => void;
  onBack: () => void;
  onReview: () => void;
}) {
  const shell = useNavShell();
  const now = useNow();
  const [compare, setCompare] = useState(false);
  const [adding, setAdding] = useState(false);
  const [checks, setChecks] = useState<Checks | null>(null);
  const peer = payment.kind === 'peer';
  const lanes: RouteCardDTO[] = [...payment.cards, ...(compare && payment.compare ? [payment.compare] : [])];
  const card = [...payment.cards, ...(payment.compare ? [payment.compare] : [])].find((c) => c.quoteId === quoteId) ?? payment.cards[0] ?? null;

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

  // Keep the ticket's place while it is the approval card, so the page behind doesn't jump.
  const slot = useRef<HTMLDivElement>(null);
  const [slotHeight, setSlotHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!ticketAway && slot.current) setSlotHeight(slot.current.offsetHeight);
  }, [ticketAway, lookingAt]);

  if (!card) {
    return (
      <p className="iso-note iso-note--danger" role="alert">
        No route can pay this right now. Go back and try again in a minute.
      </p>
    );
  }

  const short = shortName(payee.name);
  const left = secondsLeft(card.expiresAt, now);
  const amount = peer ? usdWhole(card.receivePhpMinor) : phpWhole(card.receivePhpMinor);
  const amountFull = peer ? usd(card.receivePhpMinor) : php(card.receivePhpMinor);
  const conf = payment.invoice.confirmed;
  const refLabel = payment.invoice.source === 'transfer' || peer ? 'Reference' : 'Invoice';
  const rateLabel = shell?.rate.label ?? 'test rate';
  const drafted = payment.invoice.source === 'transfer' || peer ? 'a person approves on a device' : 'Zeke drafted this and can’t approve';
  const plan = funding?.plan ?? null;
  const landed = funding?.fundings.find((f) => f.state === 'in_vault') ?? null;
  const checkFailed = checks && checks.quoteId === card.quoteId ? checks.checks.find((c) => !c.passed) : null;
  // A payment to a Splash business has no rate to run out: Review gets a fresh quote if it must.
  const why =
    left === 0 && !peer
      ? 'The quote ran out. Get a new one first.'
      : !plan
        ? 'Working out where the money comes from…'
        : plan.kind === 'external'
          ? `Add money first: your Payments account is short by ${usd(plan.shortMinor)}.`
          : checkFailed
            ? `Stopped by a rule: ${checkFailed.label.toLowerCase()}.`
            : null;

  const options = lanes.map((c) => ({
    value: c.quoteId,
    labels: c.labels.length > 0 ? c.labels : ['The other route'],
    price: usd(c.youPayUsdcMinor),
    sub: peer ? 'One step · straight into their Splash account' : `${c.steps} steps · partner fee ${c.partnerFee} · ${c.lowerCostLane ? 'uses the partner’s lower-cost lane' : 'straight to the partner'}`,
  }));

  return (
    <>
      <PageHead
        title={`How ${amount} reaches ${short}`}
        context={
          <>
            {refLabel} <span className="iso-mono">{conf?.invoiceNumber}</span>
            {peer ? ' · no conversion, no Splash fee' : ` · 1 USD = ${card.rate} PHP (${rateLabel})`}
          </>
        }
        actions={peer ? null : <QuoteRing expiresAt={card.expiresAt} onRefresh={onRequote} />}
      />

      <IsoSurface hero pad className="iso-rise iso-rise-2 iso-stack" aria-label="How the money moves">
        {peer ? (
          <RouteMap label={`How ${amountFull} reaches ${payee.name}`} wireTop={46}>
            <Station art={{ kind: 'coin', coin: 'usd' }} label="Your account" amount={usd(card.youPayUsdcMinor)} help="Payments account · you approve" wide />
            <Wire state="active" />
            <Station art={{ kind: 'block', glyph: 'business' }} label={payee.name} wide amount={<IsoDisplay size="md">{amount}</IsoDisplay>} help="Their own Splash account" />
          </RouteMap>
        ) : (
          <RouteMap label={`How ${amountFull} reaches ${payee.name}`} wireTop={46}>
            <Station art={{ kind: 'coin', coin: 'usd' }} label="Your account" amount={usd(card.youPayUsdcMinor)} help="Payments account · you approve" wide />
            <Wire state="active" />
            <Hop show={card.lowerCostLane}>
              <Station art={{ kind: 'block', glyph: 'arrow' }} label="Lower-cost lane" help="The partner’s cheaper way in" />
              <Wire state="active" />
            </Hop>
            <Station art={{ kind: 'block', glyph: 'partner' }} label="Payout partner" help={`Philippines · fee ${card.partnerFee} · name shown once signed`} />
            <Wire state="active" />
            <Station art={{ kind: 'coin', coin: 'php', late: true }} label={`${payee.bank} ••••${payee.last4}`} wide amount={<IsoDisplay size="md">{amount}</IsoDisplay>} help={`${short} · ${card.arrives}`} />
          </RouteMap>
        )}

        {peer ? null : (
          <div className="iso-stack">
            <LaneGroup label="Route" value={card.quoteId} onChange={onQuoteId} options={options} />
            {payment.compare ? (
              <div>
                <IsoButton variant="link" size="sm" onClick={() => setCompare((v) => !v)} aria-expanded={compare}>
                  {compare ? 'Hide the other route' : 'Compare the other route'}
                </IsoButton>
              </div>
            ) : null}
          </div>
        )}
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
        <p className="iso-small iso-row iso-rules" aria-live="polite">
          <ShieldCheck size={16} aria-hidden="true" />
          {checks && checks.quoteId === card.quoteId ? (checkFailed ? `Stopped by a rule: ${checkFailed.label}` : `Passed ${checks.passed} of ${checks.total} rules`) : 'Checking your rules…'}
          <span> · checked again before you approve</span>
        </p>
      </IsoSurface>

      <div className="iso-grid-2 iso-rise iso-rise-3">
        <div ref={slot} style={ticketAway && slotHeight ? { minHeight: slotHeight } : undefined}>
          {ticketAway ? null : (
            <Ticket
              band={
                <>
                  <span>Cost · {peer ? 'between Splash businesses' : card.labels.join(' · ') || 'the other route'}</span>
                  {payment.simulated ? <span>test quote</span> : null}
                </>
              }
              aria-label="What it costs"
            >
              <dl className="iso-dl iso-dl--rows iso-num">
                {peer ? (
                  <div>
                    <dt>{usd(card.receivePhpMinor)} to {short}</dt>
                    <dd>{usd(card.costs.amountMinor)}</dd>
                  </div>
                ) : (
                  <>
                    <div>
                      <dt>
                        {php(card.receivePhpMinor)} at {card.rate}
                      </dt>
                      <dd>{usd(card.costs.amountMinor)}</dd>
                    </div>
                    <div>
                      <dt>Payout partner fee</dt>
                      <dd>{usd(card.costs.partnerMinor)}</dd>
                    </div>
                  </>
                )}
                <div>
                  <dt>{peer ? 'Splash fee' : `Splash fee (${card.costs.splashShare})`}</dt>
                  <dd>{peer ? 'US$0.00' : usd(card.costs.splashMinor)}</dd>
                </div>
                <div>
                  <dt>Processing</dt>
                  <dd>{BigInt(card.costs.routeMinor) > 0n ? usd(card.costs.routeMinor) : 'Included'}</dd>
                </div>
                <div className="iso-dl__total">
                  <dt>You pay</dt>
                  <dd>
                    <span key={card.youPayUsdcMinor} className="iso-pop">
                      {usd(card.youPayUsdcMinor)}
                    </span>
                  </dd>
                </div>
              </dl>
              <p className="iso-small" style={{ margin: 0 }}>
                {peer ? 'No Splash fee between Splash businesses.' : `All-in ${pctFine(card.allInBps)} · target ${payment.allInTarget} or less${payment.simulated ? ' · test quote' : ''}`}
              </p>
            </Ticket>
          )}
        </div>

        <IsoSurface pad className="iso-stack" aria-labelledby="t3-from">
          <h2 id="t3-from" className="iso-h2">
            Money comes from
          </h2>
          {!plan ? (
            <div className="iso-skel" style={{ height: 72 }} aria-busy="true" aria-label="Working out where the money comes from" />
          ) : (
            <ul className="iso-list iso-from">
              <li>
                <div className="iso-list__main">
                  <div className="iso-row">
                    <strong className="iso-list__title" style={{ marginTop: 0 }}>
                      Payments account
                    </strong>
                    {plan.kind === 'covered' ? (
                      <Tag tone="ok" tick>
                        Covered
                      </Tag>
                    ) : (
                      <Tag tone="amber">Short by {usd(plan.kind === 'reserve' ? plan.moveMinor : plan.shortMinor)}</Tag>
                    )}
                  </div>
                  <div className="iso-list__detail iso-num">
                    {usd(plan.paymentsNowMinor)} now{plan.kind === 'external' ? '' : ` · ${usd(plan.paymentsAfterMinor)} after`}
                  </div>
                </div>
              </li>
              {plan.kind === 'reserve' ? (
                <li>
                  <div className="iso-list__main">
                    <div className="iso-row">
                      <strong className="iso-list__title" style={{ marginTop: 0 }}>
                        From your reserve
                      </strong>
                      <Tag tone="gold">Moves first</Tag>
                    </div>
                    <div className="iso-list__detail iso-num">
                      {usd(plan.moveMinor)} moves to your Payments account first, in the same approval · reserve {usd(plan.reserveNowMinor)} → {usd(plan.reserveAfterMinor)}
                    </div>
                  </div>
                </li>
              ) : null}
              {plan.kind === 'external' ? (
                <li>
                  <div className="iso-list__main">
                    <p className="iso-note iso-note--amber" style={{ margin: 0 }}>
                      Your Payments account is short by {usd(plan.shortMinor)}, and your reserve holds {usd(plan.reserveNowMinor)}. Add money first.
                    </p>
                  </div>
                </li>
              ) : null}
              {landed ? (
                <li>
                  <div className="iso-list__main">
                    <Tag tone="ok" tick>
                      Landed in your Payments account
                    </Tag>
                    <div className="iso-list__detail iso-num">
                      {usd(landed.amountMinor)} · {landed.methodLabel}
                    </div>
                  </div>
                </li>
              ) : null}
            </ul>
          )}
          <ul className="iso-ways">
            <li>
              <strong>From your reserve</strong>, when your Payments account is short
            </li>
            <li>
              <strong>Bank or card top-up</strong>, test mode for now
            </li>
            <li>
              <strong>From a crypto wallet</strong>, on most networks. It lands as US dollars in your account.
            </li>
          </ul>
          <div className="iso-row">
            <IsoButton variant={plan?.kind === 'external' ? 'primary' : 'quiet'} size="sm" onClick={() => setAdding(true)} disabled={!funding || !card}>
              {plan?.kind === 'external' ? 'Add money' : 'Add money another way'}
            </IsoButton>
          </div>
          <p className="iso-small" style={{ margin: 0 }}>
            Splash fee to add money: US$0. It only ever lands in your account.
          </p>
        </IsoSurface>
      </div>

      {problem ? (
        <p className="iso-note iso-note--danger" role="alert">
          {problem.message}
        </p>
      ) : null}

      {funding ? (
        <AddMoneySheet
          open={adding}
          onClose={() => setAdding(false)}
          target={{ kind: 'payment', paymentId: payment.id, quoteId: card.quoteId, options: funding }}
          sourceOfFunds={sourceOfFunds}
          onLanded={onFundingChanged}
        />
      ) : null}

      <ActionBar
        label="This payment"
        summary={
          <>
            You pay <strong>{usd(card.youPayUsdcMinor)}</strong> · {short} gets <strong>{amountFull}</strong> · {drafted}
          </>
        }
      >
        <IsoButton variant="onink" onClick={onBack}>
          Back
        </IsoButton>
        <IsoButton variant="paper" size="lg" onClick={onReview} busy={busy === 'review'} disabledReason={busy === 'review' ? null : why}>
          {busy === 'review' ? 'Checking your rules…' : 'Review and approve'}
        </IsoButton>
      </ActionBar>
    </>
  );
}
