// iso-ui
'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BellRing, Check, ShieldCheck, X } from 'lucide-react';

import { Details, IsoButton, IsoDisplay, QuoteRing, Tag, holdOverlay, secondsLeft, useFocusTrap, useIsClient, useNow } from '@/components/iso';
// Imported from its own file so the contrast audit (which follows .tsx imports) sees the card's paper.
import { Ticket } from '@/components/iso/Ticket';

import { api, ApiError, dateShort, existingDeviceKey, pctFine, php, signPrepared, timeShort, usd } from '../client';
import type { CompanyDTO, FundingOptionsDTO, PaymentDTO } from '../types';
import { notifyCompanyChanged } from '../useCompany';
import { problemOf, shortName, type Problem } from './shared';

const METHOD: Record<string, string> = { 'call-back': 'by call-back', 'supplier-account': 'from their account record', 'existing-record': 'from an earlier record' };

type Phase = 'ready' | 'waiting' | 'done';

/**
 * Step 4, the approval moment (prompt 10 §5.7, frame Flow-T4-Approve). The cost ticket morphs into
 * this card (the same layoutId); the page behind dims and goes inert; focus stays in the card and Esc
 * cancels. "Approve on this device":
 *
 *   1. a planned move from the reserve lands first (the same approval sequence);
 *   2. the server checks the rules and the quote again before the device is asked. A quote that ran
 *      out, or a payee that changed, is quoted again here, with the reason, for a fresh approval;
 *   3. this device approves. On a 2-of-N account the card then says "1 of 2 approved", who is left,
 *      and offers Remind (one notice; it approves nothing).
 */
export function ApprovalMoment({
  company,
  payment,
  plan,
  onPayment,
  onCancel,
  onTrack,
}: {
  company: CompanyDTO;
  payment: PaymentDTO;
  plan: FundingOptionsDTO['plan'] | null;
  onPayment: (p: PaymentDTO) => void;
  onCancel: () => void;
  onTrack: () => void;
}) {
  const client = useIsClient();
  const box = useRef<HTMLDivElement>(null);
  const approveRef = useRef<HTMLButtonElement>(null);
  const trackRef = useRef<HTMLButtonElement>(null);
  const now = useNow();
  const [phase, setPhase] = useState<Phase>(() => (payment.state === 'proposed' ? 'waiting' : ['approved', 'executed', 'confirmed', 'partner_paid', 'evidenced', 'anchored'].includes(payment.state) ? 'done' : 'ready'));
  const [busy, setBusy] = useState<null | 'approve' | 'remind'>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reminded, setReminded] = useState<string | null>(null);

  useEffect(() => holdOverlay('approval'), []);
  useFocusTrap(box, client, () => {
    if (!busy) onCancel();
  }, phase === 'done' ? trackRef : approveRef);
  useEffect(() => {
    if (phase === 'done') trackRef.current?.focus();
  }, [phase]);

  const a = payment.approval;
  if (!a || !client) return null;
  const peer = payment.kind === 'peer';
  const left = secondsLeft(a.quoteExpiresAt, now);
  const failed = a.policy.checks.filter((c) => !c.passed);
  const reserve = BigInt(a.reserveMoveMinor ?? '0');
  const short = shortName(a.supplierName);
  const receive = peer ? usd(a.receiveUsdMinor ?? '0') : php(a.receivePhpMinor);
  const lane = [...payment.cards, ...(payment.compare ? [payment.compare] : [])].find((c) => c.quoteId === a.quoteId) ?? null;
  const waiting = payment.approvals.waitingFor;
  const why =
    phase !== 'ready'
      ? null
      : left === 0
        ? 'The quote ran out. Approving gets a new one first.'
        : !a.verified
          ? 'Check their bank details first.'
          : failed.length > 0
            ? `Stopped by a rule: ${failed[0]!.label.toLowerCase()}.`
            : null;

  async function approve() {
    if (!a) return;
    setBusy('approve');
    setProblem(null);
    setNote(null);
    try {
      if (!company.me.canApprove) throw new ApiError('not_an_approver', 'This device can’t approve for your company yet. Finish setting it up first.', 0);
      if (!(await existingDeviceKey(company.me.keyId))) throw new ApiError('no_device_key', 'This browser can’t approve for you. Approve from the browser where you set up this device.', 0);

      // 1. The planned move from the reserve lands first.
      if (reserve > 0n && payment.state === 'checked') {
        const moved = await api<{ move: { id: string }; messages: Array<{ id: string; messageBase64: string }> }>('/treasury/moves', { body: { from: 'treasury', amountMinor: reserve.toString() } });
        const approvals = await signPrepared(company.me.keyId, moved.messages);
        const res = await api<{ move: { state: string; problem: { message: string } | null } }>(`/treasury/moves/${moved.move.id}/approve`, { body: { signatures: approvals } });
        if (res.move.state !== 'confirmed') throw new ApiError('move_unconfirmed', res.move.problem?.message ?? 'The move from your reserve hasn’t landed yet. Try again in a moment.', 0);
        notifyCompanyChanged();
      }

      // 2. The server checks the rules and the quote again before this device is asked.
      let prepared: { messages: Array<{ id: string; messageBase64: string }> };
      try {
        prepared = await api(`/payments/${payment.id}/prepare`, { body: {} });
      } catch (e) {
        if (e instanceof ApiError && (e.code === 'quote_expired' || e.code === 'payee_changed')) {
          const policy = lane?.policies[0] ?? null;
          const fresh = await api<{ payment: PaymentDTO }>(`/payments/${payment.id}/requote`, { body: { allowShort: true } });
          const next = fresh.payment.cards.find((c) => (policy ? c.policies.includes(policy) : false)) ?? fresh.payment.cards[0];
          if (!next) throw new ApiError('no_route', 'No route can pay this right now. Try again in a minute.', 0);
          const chosen = await api<{ payment: PaymentDTO }>(`/payments/${payment.id}/select`, { body: { quoteId: next.quoteId } });
          onPayment(chosen.payment);
          setNote(e.code === 'payee_changed' ? 'The payee or the amount changed since the route was chosen, so it was quoted again. Check the figures, then approve.' : (chosen.payment.approvals.resetNote ?? 'The quote ran out, so it was quoted again. Check the figures, then approve.'));
          return;
        }
        throw e;
      }

      // 3. This device approves.
      const approvals = await signPrepared(company.me.keyId, prepared.messages);
      const res = await api<{ payment: PaymentDTO }>(`/payments/${payment.id}/approve`, { body: { signatures: approvals } });
      onPayment(res.payment);
      notifyCompanyChanged();
      setPhase(res.payment.state === 'proposed' ? 'waiting' : 'done');
    } catch (e) {
      setProblem(problemOf(e));
      try {
        onPayment((await api<{ payment: PaymentDTO }>(`/payments/${payment.id}`)).payment);
      } catch {
        /* the card keeps what it had */
      }
    } finally {
      setBusy(null);
    }
  }

  async function remind() {
    setBusy('remind');
    setProblem(null);
    try {
      const res = await api<{ sent: boolean; to: string[]; nextAt: string }>(`/payments/${payment.id}/remind`, { body: {} });
      setReminded(res.sent ? `Reminder sent to ${res.to.join(' and ')}.` : `Already reminded. You can remind again at ${timeShort(res.nextAt).slice(0, 5)}.`);
    } catch (e) {
      setProblem(problemOf(e));
    } finally {
      setBusy(null);
    }
  }

  const drafted = a.kind === 'invoice' ? 'Drafted by Zeke' : `Prepared by ${a.draftedBy}`;
  const paidFrom = (() => {
    if (plan && plan.kind !== 'external') {
      const nowMinor = plan.paymentsNowMinor;
      return reserve > 0n ? `${usd(reserve)} moves from your reserve first, then Payments account · ${usd(BigInt(nowMinor) + reserve)} → ${usd(BigInt(nowMinor) + reserve - BigInt(a.youPayUsdcMinor))}` : `Payments account · ${usd(nowMinor)} → ${usd(plan.paymentsAfterMinor)}`;
    }
    return 'Payments account';
  })();

  return createPortal(
    <div className="iso iso-modal-root">
      <div ref={box} className="iso-modal">
      <Ticket
        card
        role="dialog"
        aria-modal
        aria-labelledby="t4-title"
        band={
          <>
            <span>
              {drafted} · <strong>a person approves</strong>
            </span>
            {phase === 'ready' && !peer ? <QuoteRing expiresAt={a.quoteExpiresAt} tone="coral" size={14} prefix="quote ends in" /> : null}
          </>
        }
        footer={
          phase === 'done' ? (
            <div className="iso-stack">
              <p className="iso-approved" role="status">
                <span className="iso-tick" aria-hidden="true">
                  <Check size={18} strokeWidth={3} />
                </span>
                <span>
                  <strong>Approved by you.</strong> Sending now. Nothing else needs you.
                </span>
              </p>
              <div className="iso-actions">
                <IsoButton ref={trackRef} variant="primary" size="lg" onClick={onTrack}>
                  Track it
                </IsoButton>
              </div>
            </div>
          ) : phase === 'waiting' ? (
            <div className="iso-stack">
              <p className="iso-approved" role="status">
                <span className="iso-tick" aria-hidden="true">
                  <Check size={18} strokeWidth={3} />
                </span>
                <span>
                  <strong>
                    {payment.approvals.approved} of {payment.approvals.threshold} approved
                  </strong>
                  {waiting.length > 0 ? ` · waiting for ${waiting.map((w) => w.name).join(' and ')}` : ''}
                </span>
              </p>
              <div className="iso-actions">
                {waiting.length > 0 ? (
                  <IsoButton variant="quiet" onClick={() => void remind()} busy={busy === 'remind'}>
                    <BellRing size={16} aria-hidden="true" /> Remind {waiting.length === 1 ? waiting[0]!.name.split(' ')[0] : 'them'}
                  </IsoButton>
                ) : null}
                <IsoButton ref={trackRef} variant="primary" size="lg" onClick={onTrack}>
                  Track it
                </IsoButton>
              </div>
              {reminded ? (
                <p className="iso-small" role="status" style={{ margin: 0 }}>
                  {reminded}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="iso-stack">
              <div className="iso-actions">
                <IsoButton ref={approveRef} variant="approve" size="lg" onClick={() => void approve()} busy={busy === 'approve'} disabledReason={busy ? null : why && left > 0 ? why : null}>
                  {busy === 'approve' ? 'Approving on this device…' : left === 0 && !peer ? 'Get a new quote and approve' : 'Approve on this device'}
                </IsoButton>
                <IsoButton variant="quiet" onClick={onCancel} disabled={busy !== null}>
                  Cancel
                </IsoButton>
              </div>
              <p className="iso-small" style={{ margin: 0 }}>
                Your device asks you to confirm. Before it does, we check the rules and the quote again; if anything changed, you’ll see what and why.
              </p>
            </div>
          )
        }
      >
        <div className="iso-row" style={{ justifyContent: 'space-between' }}>
          <h2 id="t4-title" className="iso-h3">
            Approve this payment
          </h2>
          <button type="button" className="iso-iconbtn" aria-label="Cancel and go back to the quote" onClick={onCancel} disabled={busy !== null}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <section className="iso-stack" aria-label="The payment">
          <div className="iso-row">
            <span>
              {peer ? (
                <>{a.intoLine ?? `Into ${a.supplierName}’s Splash account`}</>
              ) : (
                <>
                  {a.supplierName} · {a.bank} <span className="iso-num">•••• {a.accountLast4}</span>
                </>
              )}
            </span>
            {peer ? (
              <Tag tone="ok" tick>
                Verified company
              </Tag>
            ) : a.verified ? (
              <Tag tone="ok" tick>
                Checked {METHOD[a.verified.method] ?? ''} ({dateShort(a.verified.at)})
              </Tag>
            ) : (
              <Tag tone="amber">Not checked</Tag>
            )}
          </div>
          <div className="iso-ticket__perf">
            <span className="iso-small">They receive</span>
            <IsoDisplay size="lg">{receive}</IsoDisplay>
          </div>
          <dl className="iso-dl iso-dl--rows iso-num">
            <div>
              <dt>You pay</dt>
              <dd>
                <strong>{usd(a.youPayUsdcMinor)}</strong>
              </dd>
            </div>
            <div>
              <dt>All-in cost</dt>
              <dd>{peer ? 'No Splash fee between Splash businesses · processing included' : `${pctFine(a.costs.allInBps)} · partner ${usd(a.costs.partnerMinor)} · Splash ${usd(a.costs.splashMinor)} · processing ${BigInt(a.costs.routeMinor) > 0n ? usd(a.costs.routeMinor) : 'included'}`}</dd>
            </div>
            <div>
              <dt>{peer ? 'Goes' : 'Route'}</dt>
              <dd>{peer ? `Straight into ${short}’s Splash account` : `${lane?.labels.join(' · ') || a.policyLabel} · paid out by ${a.arrives.split(',')[0]}`}</dd>
            </div>
            <div>
              <dt>Reference</dt>
              <dd className="iso-mono">{a.invoiceNumber}</dd>
            </div>
            {/* §5.7 / frame T4: every card says what the payment is for; a bill's is its invoice. */}
            {a.purpose || a.kind === 'invoice' ? (
              <div>
                <dt>{peer ? 'Note' : 'Purpose'}</dt>
                <dd>{a.purpose ?? `Paying invoice ${a.invoiceNumber}`}</dd>
              </div>
            ) : null}
            <div>
              <dt>Paid from</dt>
              <dd>{paidFrom}</dd>
            </div>
          </dl>
          <Details summary={`Rules checked: ${a.policy.checks.length - failed.length} of ${a.policy.checks.length}`}>
            <ul className="iso-checklist">
              {a.policy.checks.map((c) => (
                <li key={c.name} data-ok={c.passed ? 'true' : undefined}>
                  {c.passed ? <ShieldCheck size={16} aria-hidden="true" /> : <X size={16} aria-hidden="true" />}
                  <span>
                    {c.label}
                    <span className="iso-sr">{c.passed ? ': passed' : ': not passed'}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Details>
          {note ? (
            <p className="iso-note iso-note--amber" role="status">
              {note}
            </p>
          ) : null}
          {problem ? (
            <p className="iso-note iso-note--danger" role="alert">
              {problem.message}
            </p>
          ) : null}
          {a.simulated ? <p className="iso-small" style={{ margin: 0 }}>Test mode: no real money moves, and the rate is a test rate.</p> : null}
        </section>
      </Ticket>
      </div>
    </div>,
    document.body,
  );
}
