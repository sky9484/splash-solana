// iso-ui
// iso-ui states: 2
'use client';

import Link from 'next/link';
import { Fragment, useEffect, useRef, useState } from 'react';
import { CircleCheck, Download, FileCheck2, Share2 } from 'lucide-react';

import { IsoButton, IsoDisplay, IsoSurface, RouteMap, Station, Tag, Wire, type StationArt, type WireState } from '@/components/iso';
import { PageHead } from '@/components/dashboard/PageHead';
import { pipelineFor, stationOf, type StationId } from '@/lib/solana-app/stations';
import type { CorridorPayoutBundle } from '@/lib/solana-evidence/bundle';
import type { MerkleProof } from '@/lib/solana-evidence/merkle';
import { anchoredRootFromMemo, verifyBundle } from '@/lib/solana-evidence/verify';

import { api, copyText, php, shareReceiptLink, usd } from '../client';
import type { PaymentDTO, ReceiptDTO } from '../types';
import { notifyCompanyChanged } from '../useCompany';
import type { PayeeLabel } from './StepQuote';
import { TechnicalDetails } from './TechnicalDetails';
import { phpWhole, problemOf, shortName, usdWhole, type Problem } from './shared';

/** Where the payment can't go on from, and the one thing to do (§5.8). */
const STOPPED = ['quote_expired', 'rejected_by_policy', 'proposal_failed', 'execute_failed', 'partner_failed'] as const;
/** The last station a stopped payment reached. */
const REACHED: Partial<Record<string, StationId>> = { partner_failed: 'partner', execute_failed: 'waiting' };
/** Where reading stops: nothing more will happen without a person. */
const SETTLED = ['anchored', ...STOPPED];

const LABEL: Record<StationId, string> = { draft: 'Draft', waiting: 'Approved', sent: 'Sent', partner: 'With partner', paid: 'Paid to bank', recording: 'Recording proof', recorded: 'Proof recorded', stopped: 'Stopped' };

/**
 * Step 5, Track (prompt 10 §5.8, frame Flow-T5-Track): the route map again, now driven by the
 * payment's real state through lib/solana-app/stations.ts, the one mapping Overview and History use.
 * Coins move only on the link the payment is on, and only while it is on it: never on a timer. When
 * it is paid, one gold coin drops onto the bank (once). The receipt says "Recording proof" until the
 * proof is recorded; only then can it be verified and shared.
 */
export function StepTrack({ payment, payee, onPayment, onAnother, onRequote, onRetry }: { payment: PaymentDTO; payee: PayeeLabel; onPayment: (p: PaymentDTO) => void; onAnother: () => void; onRequote: () => void; onRetry: () => void }) {
  const peer = payment.kind === 'peer';
  const kind = peer ? 'peer' : 'bank';
  const station = stationOf(payment.state, kind);
  const ids = pipelineFor(kind);
  const stopped = (STOPPED as readonly string[]).includes(payment.state);
  // A stopped payment shows how far it got: the bank returned it after the partner had it; an execute
  // that failed had been approved. Before approval nothing was reached.
  const at = stopped ? ids.indexOf(REACHED[payment.state] ?? ('none' as StationId)) : ids.indexOf(station);
  const paidAt = ids.indexOf('paid');

  // Read the payment until nothing more happens without a person. Each answer moves the map.
  const [seen, setSeen] = useState(at);
  const [drop, setDrop] = useState(false);
  useEffect(() => {
    if (SETTLED.includes(payment.state)) return;
    let stop = false;
    const t = window.setTimeout(async () => {
      try {
        const res = await api<{ payment: PaymentDTO }>(`/payments/${payment.id}`);
        if (stop) return;
        onPayment(res.payment);
        if (res.payment.state !== payment.state) notifyCompanyChanged();
      } catch {
        /* keep reading on the next tick */
      }
    }, station === 'recording' ? 4000 : 900);
    return () => {
      stop = true;
      window.clearTimeout(t);
    };
  }, [payment, onPayment, station]);
  // The gold coin drops once, when this page sees the payment reach the bank.
  useEffect(() => {
    if (at === seen) return;
    /* eslint-disable react-hooks/set-state-in-effect -- the coin answers a state change seen here */
    if (seen < paidAt && at >= paidAt) setDrop(true);
    setSeen(at);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [at, seen, paidAt]);

  const short = shortName(payee.name);
  const conf = payment.invoice.confirmed;
  const card = [...payment.cards, ...(payment.compare ? [payment.compare] : [])].find((c) => c.quoteId === payment.selectedQuoteId) ?? null;
  const receiveMinor = peer ? (payment.approval?.receiveUsdMinor ?? card?.receivePhpMinor ?? '0') : (payment.approval?.receivePhpMinor ?? conf?.amountPhpMinor ?? '0');
  const amount = peer ? usdWhole(receiveMinor) : phpWhole(receiveMinor);
  const amountFull = peer ? usd(receiveMinor) : php(receiveMinor);
  const paid = at >= paidAt && !stopped;
  const recorded = payment.state === 'anchored';
  const approvers = payment.approvals.approvedBy.map((a) => a.name).join(' and ') || 'you';
  const waiting = payment.state === 'proposed';

  const title = stopped ? stoppedTitle(payment.state, short) : paid ? `${short} has been paid` : `${amount} is on its way to ${short}`;
  const line = stopped
    ? null
    : waiting
      ? `${payment.approvals.approved} of ${payment.approvals.threshold} approved · waiting for ${payment.approvals.waitingFor.map((w) => w.name).join(' and ')}`
      : station === 'sent'
        ? peer
          ? 'Sent from your Payments account.'
          : 'Sent from your Payments account. The partner pays their bank next.'
        : station === 'partner'
          ? `With the payout partner, who pays ${payee.bank} by ${payment.approval?.arrives.split(',')[0] ?? 'bank transfer'}.`
          : station === 'paid'
            ? peer
              ? `In ${short}’s Splash account. Recording the proof.`
              : `In ${short}’s bank account. Recording the proof.`
            : station === 'recording'
              ? 'Paid. Recording the proof for this payment.'
              : 'Paid, and the proof is recorded. This receipt verifies.';

  const art = (id: StationId, tone: 'done' | 'now' | 'quiet'): StationArt => {
    switch (id) {
      case 'waiting':
        return { kind: 'tile', value: tone === 'quiet' ? '1' : '✓', tone: tone === 'quiet' ? 'quiet' : tone === 'now' && waiting ? 'coral' : 'done' };
      case 'sent':
        return { kind: 'coin', coin: 'usd', size: 64 };
      case 'partner':
        return { kind: 'block', glyph: 'partner', size: 84 };
      case 'paid':
        return peer ? { kind: 'block', glyph: 'business', size: 84 } : { kind: 'coin', coin: 'php', size: 64, late: true };
      case 'recording':
        return { kind: 'proof', tone: 'quiet' };
      default:
        return { kind: 'proof', tone: tone === 'quiet' ? 'quiet' : 'ok' };
    }
  };
  const help: Record<StationId, string> = {
    draft: '',
    waiting: waiting ? `${payment.approvals.approved} of ${payment.approvals.threshold} approved` : `by ${approvers}`,
    sent: 'from your Payments account',
    partner: 'payout partner, Philippines',
    paid: peer ? 'their Splash account' : `${payee.bank ?? ''} •••• ${payee.last4 ?? ''}`,
    recording: 'one record for this payment',
    recorded: 'this receipt verifies',
    stopped: '',
  };
  // The link the money is on: from where it is to the next station, only while it travels there.
  const moving = !stopped && (station === 'sent' || (station === 'partner' && !peer));
  const wire = (i: number): WireState => (i < at ? 'done' : i === at && moving ? 'active' : 'quiet');

  return (
    <>
      <PageHead title={title} context={line} actions={recorded ? <Tag tone="ok" tick>Paid · proof recorded</Tag> : paid ? <Tag tone="ok" tick>Paid</Tag> : stopped ? <Tag tone="danger">Stopped</Tag> : waiting ? <Tag tone="coral">Waiting approval</Tag> : <Tag tone="ink">On its way</Tag>} />

      <IsoSurface hero pad className="iso-rise iso-rise-2 iso-stack" aria-label="Where the payment is">
        <RouteMap label={`Where ${amountFull} to ${payee.name} is`} wireTop={40}>
          {ids.map((id, i) => {
            const tone = stopped ? (i <= at ? 'done' : 'quiet') : i < at ? 'done' : i === at ? 'now' : 'quiet';
            const stationLabel = id === 'waiting' && waiting ? 'Waiting approval' : id === 'paid' && peer ? 'In their account' : LABEL[id];
            return (
              <Fragment key={id}>
                {i > 0 ? <Wire state={wire(i - 1)} /> : null}
                <Station art={art(id, tone)} label={stationLabel} help={help[id]} current={i === at} className={[tone === 'quiet' ? 'iso-station--later' : '', id === 'paid' ? 'iso-station--landing' : ''].join(' ').trim() || undefined}>
                  {id === 'paid' && drop ? <span className="iso-landing-coin" aria-hidden="true" onAnimationEnd={() => setDrop(false)} /> : null}
                  {id === 'paid' ? (
                    <span className="iso-sr">{tone === 'quiet' ? 'not yet' : 'done'}</span>
                  ) : null}
                </Station>
              </Fragment>
            );
          })}
        </RouteMap>
        <div className="iso-row iso-track__foot">
          <span className="iso-label">
            {short} gets <IsoDisplay size="md">{amountFull}</IsoDisplay>
          </span>
          <span className="iso-small" aria-live="polite">
            Coins move only on the line the payment is on, and only when it really moves. This page updates by itself.
          </span>
        </div>
      </IsoSurface>

      {stopped ? <Stopped state={payment.state} problem={payment.problem} short={short} onRequote={onRequote} onRetry={onRetry} /> : null}

      <div className="iso-grid-2 iso-rise iso-rise-3">
        {payment.receiptId ? <Receipt payment={payment} short={short} recorded={recorded} /> : <ReceiptPending peer={peer} />}
        <WhatsNext payment={payment} done={recorded || paid} stopped={stopped} onAnother={onAnother} />
      </div>
    </>
  );
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

function ReceiptPending({ peer }: { peer: boolean }) {
  return (
    <IsoSurface pad className="iso-stack" aria-labelledby="t5-receipt">
      <h2 id="t5-receipt" className="iso-h2">
        Receipt
      </h2>
      <p className="iso-small" style={{ margin: 0 }}>
        {peer ? 'The receipt is ready once the money is in their account.' : 'The receipt is ready once the partner reports the bank has paid.'} One record holds the approval, the transfer and the proof.
      </p>
    </IsoSurface>
  );
}

/** The receipt summary: Verify and Share only once the proof is recorded (§5.8). */
function Receipt({ payment, short, recorded }: { payment: PaymentDTO; short: string; recorded: boolean }) {
  const [receipt, setReceipt] = useState<ReceiptDTO | null>(null);
  const [verdict, setVerdict] = useState<null | 'ok' | 'bad'>(null);
  const [shared, setShared] = useState<null | 'copied' | 'failed'>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const read = useRef<string | null>(null);

  useEffect(() => {
    const key = `${payment.receiptId}:${payment.state}`;
    if (!payment.receiptId || read.current === key) return;
    read.current = key;
    api<{ receipt: ReceiptDTO }>(`/receipts/${payment.receiptId}`)
      .then((r) => setReceipt(r.receipt))
      .catch((e) => setProblem(problemOf(e)));
  }, [payment.receiptId, payment.state]);

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
  return (
    <IsoSurface className="iso-stack iso-receipt" aria-labelledby="t5-receipt">
      <div className="iso-surface--head">
        <h2 id="t5-receipt" className="iso-h2">
          Receipt <span className="iso-mono">{payment.invoice.confirmed?.invoiceNumber}</span>
        </h2>
        <Link className="iso-small" href={`/dashboard/receipts/${payment.receiptId}`}>
          Full receipt
        </Link>
      </div>
      <div className="iso-surface--pad iso-stack">
        {!s ? (
          problem ? (
            <p className="iso-note iso-note--danger" role="alert">
              {problem.message}
            </p>
          ) : (
            <div className="iso-skel" style={{ height: 120 }} aria-busy="true" aria-label="Loading the receipt" />
          )
        ) : (
          <dl className="iso-dl iso-dl--rows iso-num">
            <div>
              <dt>{short} received</dt>
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
              <>
                <div>
                  <dt>Rate</dt>
                  <dd>{payment.cards.find((c) => c.quoteId === payment.selectedQuoteId)?.rate ?? '—'}{payment.simulated ? ' (test rate)' : ''}</dd>
                </div>
                <div>
                  <dt>Bank reference</dt>
                  <dd className="iso-mono">{s.bankReference ?? '—'}</dd>
                </div>
              </>
            )}
            <div>
              <dt>Approved by</dt>
              <dd>{payment.approvals.approvedBy.map((a) => a.name).join(' and ') || '—'}, on a device</dd>
            </div>
          </dl>
        )}
        <div className="iso-row iso-proofline">
          <FileCheck2 size={18} aria-hidden="true" />
          <span>
            <strong>{recorded ? 'Proof recorded.' : 'Recording proof.'}</strong> {recorded ? 'This receipt can be checked against the proof recorded for it.' : 'One record for this payment. Verify and Share open once it’s recorded.'}
          </span>
        </div>
        <div className="iso-actions">
          <IsoButton variant="primary" size="sm" onClick={verify} disabledReason={recorded && receipt ? null : 'Opens once the proof is recorded.'}>
            <CircleCheck size={16} aria-hidden="true" /> Verify this receipt
          </IsoButton>
          <IsoButton variant="quiet" size="sm" onClick={() => void share()} disabledReason={recorded ? null : 'Opens once the proof is recorded.'}>
            <Share2 size={16} aria-hidden="true" /> {shared === 'copied' ? 'Auditor link copied' : 'Share with auditor'}
          </IsoButton>
          <IsoButton variant="quiet" size="sm" onClick={() => window.print()}>
            <Download size={16} aria-hidden="true" /> Download PDF
          </IsoButton>
        </div>
        {verdict ? (
          <p className={verdict === 'ok' ? 'iso-note iso-note--ok' : 'iso-note iso-note--danger'} role="status">
            {verdict === 'ok' ? 'Verified. This record matches the proof recorded for it.' : 'This record doesn’t match the proof recorded for it. Open the full receipt to see which check failed.'}
          </p>
        ) : null}
        {shared === 'failed' ? (
          <p className="iso-note iso-note--danger" role="alert">
            The link couldn’t be copied. Open the full receipt to share it.
          </p>
        ) : null}
        <TechnicalDetails payment={payment} bankReference={s?.bankReference ?? null} />
      </div>
    </IsoSurface>
  );
}

/** "What's next": nothing needs you, or the one thing that does. */
function WhatsNext({ payment, done, stopped, onAnother }: { payment: PaymentDTO; done: boolean; stopped: boolean; onAnother: () => void }) {
  const [saved, setSaved] = useState<null | 'saved' | Problem>(null);
  async function save() {
    try {
      await api('/templates', { body: { paymentId: payment.id } });
      setSaved('saved');
    } catch (e) {
      setSaved(problemOf(e));
    }
  }
  const waiting = payment.state === 'proposed';
  return (
    <IsoSurface pad className="iso-stack" aria-labelledby="t5-next">
      <h2 id="t5-next" className="iso-h2">
        What’s next
      </h2>
      <p className="iso-body" style={{ margin: 0 }}>
        {stopped ? 'This payment needs you: see what happened above.' : waiting ? `Nothing for you. ${payment.approvals.waitingFor.map((w) => w.name).join(' and ')} approves next.` : done ? 'Nothing needs you.' : 'Nothing needs you. This page updates by itself, and Overview shows it too.'}
      </p>
      <div className="iso-actions">
        <IsoButton variant="primary" onClick={onAnother}>
          Pay another
        </IsoButton>
        <IsoButton variant="quiet" onClick={() => void save()} disabledReason={saved === 'saved' ? 'Saved as a template.' : null}>
          {saved === 'saved' ? 'Saved as a template' : 'Save as template'}
        </IsoButton>
        <IsoButton variant="link" href="/dashboard">
          Back to Overview
        </IsoButton>
      </div>
      {saved && saved !== 'saved' ? (
        <p className="iso-note iso-note--danger" role="alert">
          {saved.message}
        </p>
      ) : null}
    </IsoSurface>
  );
}
