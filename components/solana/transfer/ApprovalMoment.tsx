// iso-ui
'use client';

import { useEffect, useRef, useState } from 'react';
import { BellRing, Check, ShieldCheck, X } from 'lucide-react';

import { IsoButton, IsoDisplay, IsoSurface, QuoteRing, Tag, holdOverlay, secondsLeft, useNow } from '@/components/iso';

import { api, ApiError, dateShort, existingDeviceKey, php, signPrepared, timeShort, usd } from '../client';
import type { CompanyDTO, FundingOptionsDTO, PaymentDTO } from '../types';
import { notifyCompanyChanged } from '../useCompany';
import { problemOf, shortName, type Problem } from './shared';

const METHOD: Record<string, string> = { 'call-back': 'by call-back', 'supplier-account': 'from their account record', 'existing-record': 'from an earlier record' };

type Phase = 'ready' | 'waiting' | 'done';
/** "Approved. Sending now." stays this long before Track opens by itself. */
const TRACK_AFTER_MS = 1200;

/**
 * Step 4, "Approve this payment" (prompt 11 §2.3; prompt 10 §5.7): the approval card at 1.5 fr beside
 * "Your rules" at 1 fr, full width, no So far rail and no way back. "Approve on this device":
 *
 *   1. a planned move from the reserve lands first (the same approval sequence);
 *   2. the server checks the rules and the quote again before the device is asked. A quote that ran
 *      out, or a payee that changed, is quoted again here, with the reason, for a fresh approval;
 *   3. this device approves with its own key: "Approved. Sending now.", then Track by itself. On a
 *      2-of-N account the card says "1 of 2 approved", who is left, and offers Remind (one notice; it
 *      approves nothing).
 *
 * The coral button is the only coral control on the screen. Zeke drafts; it can't approve.
 */
export function StepApprove({ company, payment, plan, onPayment, onTrack }: { company: CompanyDTO; payment: PaymentDTO; plan: FundingOptionsDTO['plan'] | null; onPayment: (p: PaymentDTO) => void; onTrack: () => void }) {
  const now = useNow();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [phase, setPhase] = useState<Phase>(() => (payment.state === 'proposed' ? 'waiting' : ['approved', 'executed', 'confirmed', 'partner_paid', 'evidenced', 'anchored'].includes(payment.state) ? 'done' : 'ready'));
  const [busy, setBusy] = useState<null | 'approve' | 'remind'>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reminded, setReminded] = useState<string | null>(null);

  // The floating Zeke steps aside while a decision is on screen (prompt 10 §3.5), as it did for the card.
  useEffect(() => holdOverlay('approval'), []);

  // Approved: say so, then Track opens by itself.
  useEffect(() => {
    if (phase !== 'done') return;
    statusRef.current?.focus({ preventScroll: true });
    const t = window.setTimeout(onTrack, TRACK_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [phase, onTrack]);

  const a = payment.approval;
  if (!a) return null;
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

  const drafted = a.kind === 'invoice' ? 'Zeke drafted this payment.' : `Prepared by ${a.draftedBy}.`;
  const paidFrom = (() => {
    if (plan && plan.kind !== 'external') {
      const nowMinor = plan.paymentsNowMinor;
      return reserve > 0n ? `${usd(reserve)} moves from your reserve first, then Payments account · ${usd(BigInt(nowMinor) + reserve)} → ${usd(BigInt(nowMinor) + reserve - BigInt(a.youPayUsdcMinor))}` : `Payments account · ${usd(nowMinor)} → ${usd(plan.paymentsAfterMinor)}`;
    }
    return 'Payments account';
  })();
  const passed = a.policy.checks.length - failed.length;

  return (
    <div className="iso-approve">
      <IsoSurface hero className="iso-approve__card iso-surface--still" aria-labelledby="t4-title">
        <div className="iso-approve__head">
          <div>
            <h2 id="t4-title" className="iso-h3" data-step-heading>
              Approve this payment
            </h2>
            <span className="iso-small">{a.supplierName} receives</span>
          </div>
          {phase === 'ready' && !peer ? <QuoteRing expiresAt={a.quoteExpiresAt} tone="coral" size={22} prefix="Quote ends in" /> : null}
        </div>
        <IsoDisplay size="lg">{receive}</IsoDisplay>
        <dl className="iso-dl iso-dl--rows iso-num iso-approve__rows">
          <div>
            <dt>To</dt>
            <dd>
              {peer ? (a.intoLine ?? `Into ${a.supplierName}’s Splash account`) : `${a.bank} •••• ${a.accountLast4}`}{' '}
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
            </dd>
          </div>
          <div>
            <dt>Route</dt>
            <dd>{peer ? `Inside Splash · straight into ${short}’s account` : `${lane?.labels.join(' · ') || a.policyLabel} · paid out by ${a.arrives.split(',')[0]}`}</dd>
          </div>
          {/* Prompt 10 §5.7: every card says what the payment is for; a bill's is its invoice. */}
          <div>
            <dt>For</dt>
            <dd>
              {a.purpose ? `${a.purpose} · ` : 'Paying invoice '}
              <span className="iso-mono">{a.invoiceNumber}</span>
            </dd>
          </div>
          <div>
            <dt>Pay from</dt>
            <dd>{paidFrom}</dd>
          </div>
          <div className="iso-dl__total">
            <dt>You pay</dt>
            <dd>
              <strong>{usd(a.youPayUsdcMinor)}</strong>
            </dd>
          </div>
        </dl>
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
        {phase === 'done' ? (
          <div className="iso-stack">
            <p ref={statusRef} tabIndex={-1} className="iso-approved" role="status">
              <span className="iso-tick" aria-hidden="true">
                <Check size={18} strokeWidth={3} />
              </span>
              <span>
                <strong>Approved.</strong> Sending now.
              </span>
            </p>
            <div>
              <IsoButton variant="link" onClick={onTrack}>
                Track it now
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
              <IsoButton variant="primary" size="lg" onClick={onTrack}>
                Track it
              </IsoButton>
              {waiting.length > 0 ? (
                <IsoButton variant="quiet" onClick={() => void remind()} busy={busy === 'remind'}>
                  <BellRing size={16} aria-hidden="true" /> Remind {waiting.length === 1 ? waiting[0]!.name.split(' ')[0] : 'them'}
                </IsoButton>
              ) : null}
            </div>
            {reminded ? (
              <p className="iso-small" role="status" style={{ margin: 0 }}>
                {reminded}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="iso-stack">
            <IsoButton variant="approve" size="lg" block onClick={() => void approve()} busy={busy === 'approve'} disabledReason={busy ? null : why && left > 0 ? why : null}>
              {busy === 'approve' ? 'Confirming with this device’s key…' : left === 0 && !peer ? 'Get a new quote and approve' : 'Approve on this device'}
            </IsoButton>
            <p className="iso-small" style={{ margin: 0 }}>
              {drafted} Zeke can’t approve; only you can. Before your device is asked, the rules and the quote are checked again; if anything changed, you’ll see what and why.
            </p>
          </div>
        )}
        {a.simulated ? <p className="iso-small" style={{ margin: 0 }}>Test mode: no real money moves, and the rate is a test rate.</p> : null}
      </IsoSurface>

      <IsoSurface pad className="iso-stack" aria-labelledby="t4-rules">
        <div className="iso-row" style={{ justifyContent: 'space-between' }}>
          <h2 id="t4-rules" className="iso-h3">
            Your rules
          </h2>
          <Tag tone={failed.length ? 'danger' : 'ok'}>
            {passed} of {a.policy.checks.length} pass
          </Tag>
        </div>
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
        <p className="iso-small" style={{ margin: 0 }}>
          Checked by the server, not by Zeke. Your company’s owner sets them in Rules.
        </p>
      </IsoSurface>
    </div>
  );
}
