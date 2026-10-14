// iso-ui
'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import clsx from 'clsx';

import { clock, secondsLeft, TestModeBadge, useNow } from '@/components/iso';

import { STEP_LABEL, STEP_ORDER, type StepId } from './shared';

export type TransferStatus = 'Draft' | 'Waiting for you' | 'Waiting for approval' | 'Approved' | 'On its way' | 'Paid' | 'Stopped';

/** What the header says, every figure read from server state by TransferFlow (never typed in here). */
export interface HeaderFacts {
  status: TransferStatus;
  /** "Pay Manila Freight Services", or "Send a payout" before a recipient is chosen. */
  title: string;
  /** "BDO Unibank •••• 4471 · Philippines · INV-0415". */
  sub: string;
  /** null: not known yet ("Set at step 2"). */
  receive: string | null;
  /** "about US$5,000.00" at step 2, the all-in figure from step 3; null: "Not yet". */
  youPay: string | null;
  /** "PESONet", "InstaPay", "Inside Splash"; "Bank" until the rail is known. */
  paidOutBy: string;
  quote: ReactNode;
  testMode: boolean;
}

/** "New quote in 0:48" on steps 3–4, from the quote's own expiry. */
export function QuoteClock({ expiresAt }: { expiresAt: string }) {
  const now = useNow();
  const s = secondsLeft(expiresAt, now);
  return (
    <span className="iso-num" role="timer" aria-live={s > 0 && s <= 10 ? 'polite' : 'off'} suppressHydrationWarning>
      {s === 0 ? 'Quote ran out' : `New quote in ${clock(s)}`}
    </span>
  );
}

/**
 * Transfer's intent header (prompt 11 §2.1), on all five steps: what this payment is, where it stands
 * and what it costs, in dark teal above the step. Done steps before Approve link back while the
 * payment can still change (steps 2 and 3); Approve and Track never go back. No hover lift.
 */
export function TransferHeader({ step, facts, backTo }: { step: StepId; facts: HeaderFacts; backTo: (s: StepId) => string | null }) {
  const index = STEP_ORDER.indexOf(step);
  return (
    <header className="iso-txhead" aria-labelledby="tx-title">
      <div className="iso-txhead__top">
        <div className="iso-txhead__what">
          <p className="iso-txhead__chips">
            <span className="iso-txhead__chip">Transfer</span>
            <span className="iso-txhead__chip" data-testid="tx-status">
              {facts.status}
            </span>
            {facts.testMode ? <TestModeBadge inline /> : null}
          </p>
          <h1 id="tx-title" className="iso-txhead__title">
            {facts.title}
          </h1>
          <p className="iso-txhead__sub">{facts.sub}</p>
        </div>
        <div className="iso-txhead__where">
          <p className="iso-txhead__stepline">
            <span>
              Step {index + 1} of {STEP_ORDER.length}
            </span>
            <span>{STEP_LABEL[step]}</span>
          </p>
          <ol className="iso-txhead__steps" aria-label="Transfer steps">
            {STEP_ORDER.map((s, i) => {
              const state = i < index ? 'done' : i === index ? 'now' : 'later';
              const href = state === 'done' && (index === 1 || index === 2) && (s === 'recipient' || s === 'amount') ? backTo(s) : null;
              const inner = (
                <>
                  <span className="iso-txhead__bar" aria-hidden="true" />
                  <span className="iso-txhead__seglabel">{STEP_LABEL[s]}</span>
                  <span className="iso-sr">{state === 'done' ? ', done' : state === 'now' ? ', this step' : ''}</span>
                </>
              );
              return (
                <li key={s} className={clsx('iso-txhead__seg', `iso-txhead__seg--${state}`)} aria-current={state === 'now' ? 'step' : undefined}>
                  {href ? (
                    <Link href={href} className="iso-txhead__seglink" aria-label={`Back to ${STEP_LABEL[s].toLowerCase()}`}>
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      <dl className="iso-txhead__metrics">
        <div>
          <dt>They receive</dt>
          <dd className="iso-num">{facts.receive ?? 'Set at step 2'}</dd>
        </div>
        <div>
          <dt>You pay</dt>
          <dd className="iso-num">{facts.youPay ?? 'Not yet'}</dd>
        </div>
        <div>
          <dt>Paid out by</dt>
          <dd>{facts.paidOutBy}</dd>
        </div>
        <div>
          <dt>Quote</dt>
          <dd>{facts.quote}</dd>
        </div>
      </dl>
    </header>
  );
}
