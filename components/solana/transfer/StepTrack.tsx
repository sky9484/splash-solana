// iso-ui
'use client';

import Link from 'next/link';
import { Fragment, useEffect, useReducer, useRef, useState } from 'react';
import { Check, CircleCheck, Download, FileCheck2, Share2 } from 'lucide-react';
import clsx from 'clsx';

import { IsoButton, IsoSurface, Tag } from '@/components/iso';
import LocalTime from '@/components/LocalTime';
import { pipelineFor, stationOf, type StationId } from '@/lib/solana-app/stations';
import type { CorridorPayoutBundle } from '@/lib/solana-evidence/bundle';
import type { MerkleProof } from '@/lib/solana-evidence/merkle';
import { anchoredRootFromMemo, verifyBundle } from '@/lib/solana-evidence/verify';

import { api, copyText, php, shareReceiptLink, usd } from '../client';
import type { PaymentDTO, ReceiptDTO } from '../types';
import { notifyCompanyChanged } from '../useCompany';
import { TxGrid } from './SoFar';
import type { PayeeLabel } from './StepQuote';
import { TechnicalDetails } from './TechnicalDetails';
import { problemOf, shortName, type Problem } from './shared';

/** Where the payment can't go on from, and the one thing to do (§5.8). */
const STOPPED = ['quote_expired', 'rejected_by_policy', 'proposal_failed', 'execute_failed', 'partner_failed'] as const;
/** The last station a stopped payment reached. */
const REACHED: Partial<Record<string, StationId>> = { partner_failed: 'partner', execute_failed: 'waiting' };
/** Where reading stops: nothing more will happen without a person. */
const SETTLED = ['anchored', ...STOPPED];

const LABEL: Record<StationId, string> = { draft: 'Draft', waiting: 'Approved', sent: 'Sent', partner: 'With partner', paid: 'Paid to bank', recording: 'Recording proof', recorded: 'Proof recorded', stopped: 'Stopped' };

/** A moment in the reader's own time zone, day first on a 24-hour clock as elsewhere in the app: "14 Oct, 09:12". */
const at = (iso: string) => <LocalTime value={iso} locale="en-GB" options={{ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }} />;

/**
 * Step 5, Track (prompt 11 §2.3; prompt 10 §5.8): the six stations, Approved, Sent, With partner, Paid
 * to bank, Recording proof and Proof recorded, driven by the payment's real state through
 * lib/solana-app/stations.ts (the one mapping Overview and History use). A coin moves only on the
 * segment the payment is on, and only while it is on it: never on a timer. Then the receipt, which
 * verifies once the proof is recorded, and on the right what happened, with times, and what's next.
 */
export function StepTrack({ payment, payee, onPayment, onAnother, onRequote, onRetry }: { payment: PaymentDTO; payee: PayeeLabel; onPayment: (p: PaymentDTO) => void; onAnother: () => void; onRequote: () => void; onRetry: () => void }) {
  const peer = payment.kind === 'peer';
  const kind = peer ? 'peer' : 'bank';
  const station = stationOf(payment.state, kind);
  const ids = pipelineFor(kind);
  const stopped = (STOPPED as readonly string[]).includes(payment.state);
  // A stopped payment shows how far it got: the bank returned it after the partner had it; an execute
  // that failed had been approved. Before approval nothing was reached.
  const reached = stopped ? ids.indexOf(REACHED[payment.state] ?? ('none' as StationId)) : ids.indexOf(station);
  const paidAt = ids.indexOf('paid');

  // Read the payment until nothing more happens without a person. Each answer moves the tracker; a read
  // that fails (a network blip, a deploy) tries again rather than leaving the tracker frozen.
  const [retry, retryRead] = useReducer((n: number, outcome: 'failed' | 'read') => (outcome === 'read' ? 0 : n + 1), 0);
  useEffect(() => {
    if (SETTLED.includes(payment.state)) return;
    let stop = false;
    const t = window.setTimeout(async () => {
      try {
        const res = await api<{ payment: PaymentDTO }>(`/payments/${payment.id}`);
        if (stop) return;
        if (retry > 0) retryRead('read');
        onPayment(res.payment);
        if (res.payment.state !== payment.state) notifyCompanyChanged();
      } catch {
        if (!stop) retryRead('failed');
      }
    }, retry > 0 ? Math.min(2000 * retry, 10_000) : station === 'recording' ? 4000 : 900);
    return () => {
      stop = true;
      window.clearTimeout(t);
    };
  }, [payment, onPayment, station, retry]);

  const short = shortName(payee.name);
  const paid = reached >= paidAt && !stopped;
  const recorded = payment.state === 'anchored';
  const waiting = payment.state === 'proposed';
  const title = stopped ? stoppedTitle(payment.state, short) : recorded ? 'Paid, with proof recorded' : paid ? (peer ? 'Paid into their Splash account' : 'Paid to the bank') : 'On its way';
  // The segment the money is on: from where it is to the next station, only while it travels there.
  const moving = !stopped && (station === 'sent' || (station === 'partner' && !peer));

  const [receipt, setReceipt] = useState<ReceiptDTO | null>(null);
  const [receiptProblem, setReceiptProblem] = useState<Problem | null>(null);
  const read = useRef<string | null>(null);
  useEffect(() => {
    const key = `${payment.receiptId}:${payment.state}`;
    if (!payment.receiptId || read.current === key) return;
    read.current = key;
    api<{ receipt: ReceiptDTO }>(`/receipts/${payment.receiptId}`)
      .then((r) => setReceipt(r.receipt))
      .catch((e) => setReceiptProblem(problemOf(e)));
  }, [payment.receiptId, payment.state]);

  const main = (
    <>
      <IsoSurface pad className="iso-stack" aria-labelledby="t5-title">
        <div className="iso-row" style={{ justifyContent: 'space-between' }}>
          <h2 id="t5-title" className="iso-h2" data-step-heading>
            {title}
          </h2>
          {recorded ? (
            <Tag tone="ok" tick>
              Proof recorded
            </Tag>
          ) : paid ? (
            <Tag tone="ok" tick>
              Paid
            </Tag>
          ) : stopped ? (
            <Tag tone="danger">Stopped</Tag>
          ) : waiting ? (
            <Tag tone="coral">Waiting approval</Tag>
          ) : (
            <Tag tone="ink">On its way</Tag>
          )}
        </div>
        <ol className="iso-tracker" style={{ ['--n' as string]: ids.length }} aria-label={`Where ${peer ? usd(payment.approval?.receiveUsdMinor ?? '0') : php(payment.approval?.receivePhpMinor ?? '0')} to ${payee.name} is`}>
          {ids.map((id, i) => {
            // Arriving is a done thing: once the money is in, "Paid to bank" / "In their account" is ticked
            // and recording the proof is what happens now (prompt 11 Phase 5 review).
            const nowAt = recorded ? ids.length : station === 'paid' ? reached + 1 : reached;
            const tone = stopped ? (i <= reached ? 'done' : 'later') : i < nowAt ? 'done' : i === nowAt ? 'now' : 'later';
            const label = id === 'waiting' && waiting ? 'Waiting approval' : id === 'paid' && peer ? 'In their account' : LABEL[id];
            return (
              <Fragment key={id}>
                <li className={clsx('iso-tracker__st', `iso-tracker__st--${tone}`)} aria-current={tone === 'now' ? 'step' : undefined}>
                  <span className="iso-tracker__dot" aria-hidden="true">
                    {tone === 'done' ? <Check size={13} strokeWidth={3} /> : null}
                  </span>
                  <span className="iso-tracker__label">{label}</span>
                  <span className="iso-sr">{tone === 'done' ? ': done' : tone === 'now' ? ': now' : ': not yet'}</span>
                  {i < ids.length - 1 ? (
                    <span className={clsx('iso-tracker__bar', i < reached && 'iso-tracker__bar--done', i === reached && moving && 'iso-tracker__bar--active')} aria-hidden="true">
                      <span className="iso-coin" />
                    </span>
                  ) : null}
                </li>
              </Fragment>
            );
          })}
        </ol>
        <p className="iso-small" style={{ margin: 0 }} aria-live="polite">
          {peer ? 'Straight into their own Splash account: no payout partner.' : payment.simulated ? 'In this demo the payout partner is a test partner.' : `Paid out by ${payment.partnerLabel}.`} This page updates by itself.
        </p>
      </IsoSurface>

      {stopped ? <Stopped state={payment.state} problem={payment.problem} short={short} onRequote={onRequote} onRetry={onRetry} /> : null}

      {payment.receiptId ? <Receipt payment={payment} payee={payee} receipt={receipt} problem={receiptProblem} recorded={recorded} /> : <ReceiptPending peer={peer} paid={paid} />}
    </>
  );

  return <TxGrid main={main} rail={<Rail payment={payment} receipt={receipt} peer={peer} stopped={stopped} done={recorded || paid} onAnother={onAnother} />} />;
}

function stoppedTitle(state: string, short: string): string {
  if (state === 'quote_expired') return 'The quote ran out before sending';
  if (state === 'rejected_by_policy') return 'Stopped by one of your rules';
  if (state === 'partner_failed') return `The bank returned the payment to ${short}`;
  return 'This payment couldn’t be sent';
}

/** Each failure: one sentence, one thing to do (§5.8). */
function Stopped({ state, problem, short, onRequote, onRetry }: { state: string; problem: { code: string; message: string } | null; short: string; onRequote: () => void; onRetry: () => void }) {
  const [text, action] =
    state === 'quote_expired'
      ? ['Quote expired before sending: nothing left your account. Get a new quote, then approve again.', <IsoButton key="a" variant="primary" onClick={onRequote}>Get a new quote</IsoButton>]
      : state === 'rejected_by_policy'
        ? [`Stopped by a rule: ${problem?.message ?? 'one of your rules'} Your company’s owner can change rules in Rules.`, <IsoButton key="a" variant="quiet" href="/dashboard/rules">Open Rules</IsoButton>]
        : state === 'partner_failed'
          ? [`The bank returned it: what the partner received comes back to your Payments account (Splash’s fee isn’t part of it). Check the account details with ${short}, then pay again.`, <IsoButton key="a" variant="quiet" href="/dashboard/transfer?to=bank&step=recipient">Check their details</IsoButton>]
          : state === 'execute_failed'
            ? ['Couldn’t send: nothing left your account. Approve again to try once more.', <IsoButton key="a" variant="primary" onClick={onRetry}>Try again</IsoButton>]
            : ['Couldn’t send: nothing left your account. Get a new quote and try again.', <IsoButton key="a" variant="primary" onClick={onRequote}>Try again</IsoButton>];
  return (
    <div className="iso-note iso-note--danger iso-stack" role="alert">
      <p style={{ margin: 0 }}>{text}</p>
      <div className="iso-actions">{action}</div>
    </div>
  );
}

function ReceiptPending({ peer, paid }: { peer: boolean; paid: boolean }) {
  return (
    <IsoSurface pad className="iso-stack" aria-labelledby="t5-receipt">
      <h2 id="t5-receipt" className="iso-h2">
        Receipt
      </h2>
      <p className="iso-small" style={{ margin: 0 }}>
        {paid ? 'The receipt is ready once the proof is recorded.' : peer ? 'The receipt is ready once the money is in their account.' : 'The receipt is ready once the partner reports the bank has paid.'} One record holds the approval, the transfer and the proof.
      </p>
    </IsoSurface>
  );
}

/** The receipt: Verify and Share only once the proof is recorded (§5.8). */
function Receipt({ payment, payee, receipt, problem, recorded }: { payment: PaymentDTO; payee: PayeeLabel; receipt: ReceiptDTO | null; problem: Problem | null; recorded: boolean }) {
  const [verdict, setVerdict] = useState<null | 'ok' | 'bad'>(null);
  const [shared, setShared] = useState<null | 'copied' | 'failed'>(null);

  function verify() {
    if (!receipt || receipt.anchor.status !== 'anchored') return;
    const result = verifyBundle({
      bundle: receipt.bundle as unknown as CorridorPayoutBundle,
      proof: receipt.proof as unknown as MerkleProof,
      anchor: anchoredRootFromMemo(receipt.anchor.memo, { signature: receipt.anchor.signature ?? undefined, simulated: receipt.anchor.simulated }),
    });
    setVerdict(result.ok ? 'ok' : 'bad');
  }

  async function share() {
    if (!payment.receiptId) return;
    try {
      setShared((await copyText(await shareReceiptLink(payment.receiptId))) ? 'copied' : 'failed');
    } catch {
      setShared('failed');
    }
  }

  const s = receipt?.summary ?? null;
  const peer = payment.kind === 'peer';
  const rate = payment.cards.find((c) => c.quoteId === payment.selectedQuoteId)?.rate ?? null;
  return (
    <IsoSurface pad className="iso-stack iso-receipt" aria-labelledby="t5-receipt">
      <div className="iso-row" style={{ justifyContent: 'space-between' }}>
        <h2 id="t5-receipt" className="iso-h2">
          Receipt
        </h2>
        <IsoButton variant="quiet" onClick={verify} disabledReason={recorded && receipt ? null : 'Opens once the proof is recorded.'}>
          <CircleCheck size={16} aria-hidden="true" /> Verify receipt
        </IsoButton>
      </div>
      {!s ? (
        problem ? (
          <p className="iso-note iso-note--danger" role="alert">
            {problem.message}
          </p>
        ) : (
          <div className="iso-skel" style={{ height: 120 }} aria-busy="true" aria-label="Loading the receipt" />
        )
      ) : (
        <dl className="iso-dl iso-dl--rows iso-num iso-receipt__rows">
          <div>
            <dt>Invoice</dt>
            <dd className="iso-mono">{s.invoiceNumber}</dd>
          </div>
          <div>
            <dt>Paid to</dt>
            <dd>{s.supplierName}</dd>
          </div>
          <div>
            <dt>{peer ? 'Into' : 'Bank'}</dt>
            <dd>{peer ? 'Their Splash account' : `${s.bank} •••• ${s.accountLast4}`}</dd>
          </div>
          <div>
            <dt>They received</dt>
            <dd>
              <strong>{peer ? usd(s.receiveUsdMinor ?? '0') : php(s.receivePhpMinor)}</strong>
            </dd>
          </div>
          <div>
            <dt>You paid</dt>
            <dd>{usd(s.youPayUsdcMinor)}</dd>
          </div>
          {peer ? (
            s.note ? (
              <div>
                <dt>Note</dt>
                <dd>{s.note}</dd>
              </div>
            ) : null
          ) : (
            <div>
              <dt>Rate</dt>
              <dd>
                {rate ?? '—'}
                {payment.simulated ? ' (test rate)' : ''}
              </dd>
            </div>
          )}
          <div>
            <dt>Approved by</dt>
            <dd>{payment.approvals.approvedBy.map((a) => a.name).join(' and ') || '—'}, on a device</dd>
          </div>
          {peer ? null : (
            <div>
              <dt>Bank reference</dt>
              <dd className="iso-mono">{s.bankReference ?? '—'}</dd>
            </div>
          )}
        </dl>
      )}
      <div className="iso-row iso-proofline">
        <FileCheck2 size={18} aria-hidden="true" />
        <span>
          <strong>{recorded ? 'Proof recorded.' : 'Recording proof.'}</strong> {recorded ? 'Verify to check nothing was changed since.' : 'One record for this payment. Verify and Share open once it’s recorded.'}
        </span>
      </div>
      {verdict ? (
        <p className={verdict === 'ok' ? 'iso-note iso-note--ok' : 'iso-note iso-note--danger'} role="status">
          {verdict === 'ok' ? 'This receipt verifies. It matches the proof recorded for it.' : 'This record doesn’t match the proof recorded for it. Open the full receipt to see which check failed.'}
        </p>
      ) : null}
      <div className="iso-actions">
        <IsoButton variant="link" onClick={() => void share()} disabledReason={recorded ? null : 'Opens once the proof is recorded.'}>
          <Share2 size={16} aria-hidden="true" /> {shared === 'copied' ? 'Auditor link copied' : 'Share with auditor'}
        </IsoButton>
        <IsoButton variant="link" onClick={() => window.print()}>
          <Download size={16} aria-hidden="true" /> Download PDF
        </IsoButton>
        {payment.receiptId ? (
          <Link className="iso-btn iso-btn--link" href={`/dashboard/receipts/${payment.receiptId}`}>
            Full receipt
          </Link>
        ) : null}
      </div>
      {shared === 'failed' ? (
        <p className="iso-note iso-note--danger" role="alert">
          The link couldn’t be copied. Open the full receipt to share it.
        </p>
      ) : null}
      <TechnicalDetails payment={payment} bankReference={s?.bankReference ?? null} />
      <span className="iso-sr">Paid to {payee.name}.</span>
    </IsoSurface>
  );
}

/** The right rail on Track: what happened so far, with times, and what's next. */
function Rail({ payment, receipt, peer, stopped, done, onAnother }: { payment: PaymentDTO; receipt: ReceiptDTO | null; peer: boolean; stopped: boolean; done: boolean; onAnother: () => void }) {
  const [saved, setSaved] = useState<null | 'saved' | Problem>(null);
  async function save() {
    try {
      await api('/templates', { body: { paymentId: payment.id } });
      setSaved('saved');
    } catch (e) {
      setSaved(problemOf(e));
    }
  }
  const t = payment.timeline;
  const recorded = payment.state === 'anchored';
  const events: Array<{ what: string; at: string | null }> = [];
  if (t.approvedAt || payment.approvals.approved > 0) events.push({ what: 'Approved', at: t.approvedAt ?? null });
  if (t.sentAt) events.push({ what: 'Sent', at: t.sentAt });
  if (!peer && t.receivedAt) events.push({ what: 'With partner', at: t.receivedAt });
  // Inside Splash there's no partner to report "paid": the money is in their account when the chain confirms it.
  const paidMoment = peer ? (payment.confirmedAt ?? t.paidAt ?? null) : (t.paidAt ?? null);
  if (paidMoment) events.push({ what: peer ? 'In their account' : 'Paid to bank', at: paidMoment });
  if (t.returnedAt) events.push({ what: 'Returned by the bank', at: t.returnedAt });
  if (payment.receiptId) events.push({ what: 'Recording proof', at: receipt?.bundle.receipt.issuedAt ?? null });
  if (recorded) events.push({ what: 'Proof recorded', at: null });
  const waiting = payment.state === 'proposed';
  return (
    <IsoSurface pad className="iso-stack" aria-labelledby="t5-happened">
      <h2 id="t5-happened" className="iso-h3">
        What happened
      </h2>
      {events.length === 0 ? (
        <p className="iso-small" style={{ margin: 0 }}>
          Nothing yet.
        </p>
      ) : (
        <ol className="iso-happened">
          {events.map((e) => (
            <li key={e.what}>
              <strong>{e.what}</strong>
              {e.at ? <span className="iso-small">{at(e.at)}</span> : null}
            </li>
          ))}
        </ol>
      )}
      <hr className="iso-divider" />
      <h2 id="t5-next" className="iso-h3">
        What’s next
      </h2>
      <p className="iso-body" style={{ margin: 0 }}>
        {stopped ? 'This payment needs you: see what happened on the left.' : waiting ? `Nothing for you. ${payment.approvals.waitingFor.map((w) => w.name).join(' and ')} approves next.` : done ? (recorded ? 'Nothing. The receipt is ready to verify and share.' : 'Nothing needs you. The proof is being recorded.') : 'Nothing needs you. This page updates by itself, and Overview shows it too.'}
      </p>
      <div className="iso-actions">
        <IsoButton variant="quiet" onClick={() => void save()} disabledReason={saved === 'saved' ? 'Saved as a template.' : null}>
          {saved === 'saved' ? 'Saved as a template' : 'Save as template'}
        </IsoButton>
      </div>
      {saved && saved !== 'saved' ? (
        <p className="iso-note iso-note--danger" role="alert">
          {saved.message}
        </p>
      ) : null}
      <IsoButton variant="quiet" block onClick={onAnother}>
        Start a new transfer
      </IsoButton>
    </IsoSurface>
  );
}
