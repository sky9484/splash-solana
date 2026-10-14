// iso-ui
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';

import { IsoButton } from '@/components/iso';
import { PageHead } from '@/components/dashboard/PageHead';
import { stationOf } from '@/lib/solana-app/stations';
import type { Wire } from '@/lib/solana-app/json';
import type { TransferTemplate } from '@/lib/solana-app/store';

import { api, php, usd } from '../client';
import type { CompanyDTO, FundingOptionsDTO, PaymentDTO } from '../types';
import { notifyCompanyChanged, useCompany } from '../useCompany';
import { StepApprove } from './ApprovalMoment';
import { type SoFarRow } from './SoFar';
import { StepAmount } from './StepAmount';
import { StepQuote, type PayeeLabel, type Rehearsal } from './StepQuote';
import { bankLine, StepRecipient } from './StepRecipient';
import { StepTrack } from './StepTrack';
import { QuoteClock, TransferHeader, type HeaderFacts, type TransferStatus } from './TransferHeader';
import { countryName, laneTags, problemOf, shortName, STEP_ORDER, transferHref, type AmountDraft, type EstimateDTO, type Payee, type Problem, type RecipientRow, type RecipientsDTO, type StepId, type To } from './shared';

type Template = Wire<TransferTemplate>;

const PAYMENT_ID = /^pay_[0-9a-f]{16}$/;
const TEMPLATE_ID = /^tpl_[0-9a-f]{16}$/;
/** Nothing has been sent: a new amount or recipient drops this draft (its record stays, "discarded"). */
const DISCARDABLE = ['draft', 'quoted', 'checked', 'quote_expired', 'rejected_by_policy', 'proposal_failed'];
const BEFORE_APPROVAL = ['draft', 'quoted', 'checked', 'quote_expired', 'rejected_by_policy'];
/** Where the approval step can stand open: waiting for this device or the next approver, or just approved. */
const APPROVAL_OPEN = ['checked', 'proposed', 'execute_failed', 'approved', 'executed', 'confirmed', 'partner_paid', 'evidenced', 'evidence_failed', 'anchored'];
const STOPPED = ['quote_expired', 'rejected_by_policy', 'proposal_failed', 'execute_failed', 'partner_failed'];
const APPROVED = ['approved', 'executed', 'confirmed', 'partner_paid', 'evidenced', 'evidence_failed', 'anchored'];

const asTo = (v: string | null): To | null => (v === 'bank' || v === 'splash' ? v : null);
const asStep = (v: string | null): StepId | null => ((STEP_ORDER as readonly string[]).includes(v ?? '') ? (v as StepId) : null);

/** Where a payment opened by its id picks up, from its state alone. */
function stepForState(state: string): StepId {
  if (BEFORE_APPROVAL.includes(state)) return 'quote';
  if (state === 'proposed') return 'approve';
  return 'track';
}

/** The lane a quote opens on: the one Zeke suggests, else the cheapest. Kept by policy across re-quotes. */
function laneFor(p: PaymentDTO, policy: string | null): string | null {
  if (p.selectedQuoteId && [...p.cards, ...(p.compare ? [p.compare] : [])].some((c) => c.quoteId === p.selectedQuoteId)) return p.selectedQuoteId;
  const byPolicy = policy ? p.cards.find((c) => c.policies.includes(policy as never)) : null;
  return (byPolicy ?? p.cards.find((c) => c.policies.includes('cheapest')) ?? p.cards[0])?.quoteId ?? null;
}

function payeeOf(p: PaymentDTO): PayeeLabel {
  if (p.kind === 'peer' && p.invoice.peer) return { name: p.invoice.peer.payeeName, bank: null, last4: null };
  const c = p.invoice.confirmed;
  return { name: c?.supplierName ?? '', bank: c?.supplierBank ?? null, last4: c?.supplierAccountLast4 ?? null };
}

/** The header's status chip, from where the payment is (prompt 11 §2.1). */
function statusOf(step: StepId, p: PaymentDTO | null): TransferStatus {
  if (!p || step === 'recipient' || step === 'amount' || step === 'quote') return 'Draft';
  if (STOPPED.includes(p.state)) return 'Stopped';
  if (p.state === 'checked') return 'Waiting for you';
  if (p.state === 'proposed') return 'Waiting for approval';
  if (step === 'approve' || p.state === 'approved') return 'Approved';
  const st = stationOf(p.state as never, p.kind === 'peer' ? 'peer' : 'bank');
  return st === 'paid' || st === 'recording' || st === 'recorded' ? 'Paid' : 'On its way';
}

/**
 * Transfer (prompt 11 Phase 2; prompt 10 Phase 3): five steps, Recipient, Amount, Route, Approve,
 * Track, to a bank account in the Philippines or to another business on Splash, under one intent
 * header that says what the payment is on every step. Steps 1–3 have the "So far" rail with the one
 * main action; Approve is full width; Track has what happened. The URL carries where you are
 * (`?to=bank|splash&step=…&payment=…`), so Back, a refresh and a shared link all land on the same
 * step. One state machine; the engine, the quote, the approval and the tracking are unchanged. Splash
 * holds no key that can move the money: a person approves every payment on their device.
 */
export function TransferFlow() {
  const { state } = useCompany();
  if (state.status === 'loading') {
    return (
      <div className="iso iso-page iso-page--transfer" aria-busy="true">
        <div className="iso-skel" style={{ height: 180 }} />
        <div className="iso-skel" style={{ height: 320 }} />
      </div>
    );
  }
  if (state.status !== 'ready' || !state.company.vault) {
    return (
      <div className="iso iso-page iso-page--transfer">
        <PageHead title="Transfer" />
        <div className="iso-surface iso-surface--pad iso-stack">
          <p className="iso-body" style={{ margin: 0 }}>
            {state.status === 'ready' ? 'Set up this device and your Payments account first. It takes about a minute.' : state.message}
          </p>
          <div>
            <IsoButton variant="primary" href={state.status === 'signin' ? '/login' : '/dashboard/setup'}>
              {state.status === 'signin' ? 'Sign in' : 'Set up this device'}
            </IsoButton>
          </div>
        </div>
      </div>
    );
  }
  return (
    <MotionConfig reducedMotion="user">
      <Flow company={state.company} />
    </MotionConfig>
  );
}

function Flow({ company }: { company: CompanyDTO }) {
  const params = useSearchParams();
  // A bank account unless the URL says otherwise: most transfers go to a supplier's bank.
  const urlTo = asTo(params.get('to')) ?? 'bank';
  const urlStep = asStep(params.get('step'));
  const rawPayment = params.get('payment');
  const urlPayment = rawPayment && PAYMENT_ID.test(rawPayment) ? rawPayment : null;
  const rawTemplate = params.get('template');
  const urlTemplate = rawTemplate && TEMPLATE_ID.test(rawTemplate) ? rawTemplate : null;

  const [recipients, setRecipients] = useState<RecipientsDTO | null>(null);
  const [recipient, setRecipient] = useState<RecipientRow | null>(null);
  const [payee, setPayee] = useState<Payee | null>(null);
  const [draft, setDraft] = useState<AmountDraft | null>(null);
  const [made, setMade] = useState<{ key: string; detailsKey: string } | null>(null);
  const [payment, setPayment] = useState<PaymentDTO | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [funding, setFunding] = useState<FundingOptionsDTO | null>(null);
  const [estimate, setEstimate] = useState<EstimateDTO | null>(null);
  const [busy, setBusy] = useState<null | 'amount' | 'requote' | 'review'>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [loadProblem, setLoadProblem] = useState<Problem | null>(null);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [rehearsal, setRehearsal] = useState<Rehearsal>('none');
  // What was typed on step 2 before going back to step 1: kept for the same recipient (prompt 11 §2.2).
  const [kept, setKept] = useState<{ key: string; draft: AmountDraft } | null>(null);

  /** Move to another step: the URL changes (Back works), the page goes to the top, the step's heading takes focus. */
  const go = useCallback((next: { to?: To | null; step?: StepId | null; payment?: string | null; template?: null }, mode: 'push' | 'replace' = 'push') => {
    const url = transferHref(new URLSearchParams(window.location.search), next);
    window.history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', url);
    setProblem(null);
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0 });
      requestAnimationFrame(() => {
        const heading = document.querySelector<HTMLElement>('.iso-page--transfer [data-step-heading]');
        if (heading) {
          heading.tabIndex = -1;
          heading.focus({ preventScroll: true });
        }
      });
    });
  }, []);

  // A payment opened by its id (?payment=…: a refresh mid-flow, or a bill handed over from Pay an
  // invoice): read it and pick it up where it stands. A read cut short (React mounts twice in
  // development) is simply made again: nothing here marks it done before it answers.
  useEffect(() => {
    if (!urlPayment || payment?.id === urlPayment) return;
    let stop = false;
    api<{ payment: PaymentDTO }>(`/payments/${urlPayment}`)
      .then((r) => {
        if (stop) return;
        setPayment(r.payment);
        setQuoteId(laneFor(r.payment, null));
        setLoadProblem(null);
      })
      .catch((e) => !stop && setLoadProblem(problemOf(e)));
    return () => {
      stop = true;
    };
  }, [urlPayment, payment?.id]);

  // Templates, for Step 1 ("Pay again"), and one opened by its id (?template=…).
  useEffect(() => {
    let stop = false;
    api<{ templates: Template[] }>('/templates')
      .then((r) => !stop && setTemplates(r.templates))
      .catch(() => !stop && setTemplates([]));
    return () => {
      stop = true;
    };
  }, []);

  const startFromTemplate = useCallback(
    async (t: Template) => {
      setProblem(null);
      const base: AmountDraft = {
        phpMinor: t.amountPhpMinor,
        usdMinor: t.amountUsdMinor ?? '',
        reference: '',
        purpose: t.purpose ?? 'goods',
        description: t.description ?? '',
        relationship: t.relationship ?? null,
        sourceOfFunds: t.sourceOfFunds ?? null,
        note: t.note ?? '',
      };
      if (t.to === 'splash' && t.payee) {
        setPayee({ orgId: t.payee.orgId, name: t.payee.name, handle: t.payee.handle, country: t.payee.country, verified: true });
        setDraft(base);
        go({ to: 'splash', step: 'amount', payment: null, template: null });
        return;
      }
      try {
        const list = recipients ?? (await api<RecipientsDTO>('/recipients'));
        if (!recipients) setRecipients(list);
        const r = list.recipients.find((x) => x.id === t.recipientId) ?? null;
        if (!r) throw new Error(`${t.payeeName} isn’t on your saved recipients any more. Choose another recipient.`);
        if (!r.payable) throw new Error(`${t.payeeName}’s bank details need a call-back before they can be paid again.`);
        setRecipient(r);
        setDraft(base);
        go({ to: 'bank', step: 'amount', payment: null, template: null });
      } catch (e) {
        go({ to: 'bank', step: 'recipient', payment: null, template: null }, 'replace');
        setProblem(problemOf(e));
      }
    },
    [recipients, go],
  );
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!urlTemplate || !templates || opened.current === urlTemplate) return;
    opened.current = urlTemplate;
    const t = templates.find((x) => x.id === urlTemplate);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opening a template is a navigation
    if (t) void startFromTemplate(t);
  }, [urlTemplate, templates, startFromTemplate]);

  // Where the money comes from follows the route being looked at (its cost is what's needed).
  const paymentId = payment?.id ?? null;
  const loadFunding = useCallback(async (pid: string, qid: string | null) => {
    try {
      setFunding(await api<FundingOptionsDTO>(`/payments/${pid}/fund${qid ? `?quoteId=${qid}` : ''}`));
    } catch (e) {
      setProblem(problemOf(e));
    }
  }, []);
  useEffect(() => {
    if (!paymentId || !quoteId || !payment || !BEFORE_APPROVAL.includes(payment.state)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the plan is set when the read answers
    void loadFunding(paymentId, quoteId);
  }, [paymentId, quoteId, payment, loadFunding]);

  /* ---------------------------------------------------------------- which step */
  const step: StepId = (() => {
    if (urlPayment) {
      if (!payment || payment.id !== urlPayment) return urlStep === 'track' ? 'track' : 'quote';
      const fromState = stepForState(payment.state);
      // The approval step stays open after the approval ("Approved. Sending now.", then Track), and on a
      // 2-of-N account while the other approver is awaited.
      if (urlStep === 'approve') return payment.approval && APPROVAL_OPEN.includes(payment.state) ? 'approve' : fromState;
      if (urlStep === 'quote' && BEFORE_APPROVAL.includes(payment.state)) return 'quote';
      if (urlStep === 'track') return 'track';
      return fromState;
    }
    if (urlStep === 'amount' && urlTo && (urlTo === 'bank' ? recipient?.payable : payee)) return 'amount';
    return 'recipient';
  })();
  const to: To = payment && urlPayment ? (payment.kind === 'peer' ? 'splash' : 'bank') : urlTo;
  const sent = payment ? !BEFORE_APPROVAL.includes(payment.state) : false;

  // A bill came from Pay an invoice (prompt 10 §6.2): its recipient and amount were checked there, so
  // the first two steps lead back to the invoice, not to a new transfer.
  const source = payment?.invoice.source ?? null;
  const fromBill = source === 'sample' || source === 'paste' || source === 'upload' || source === 'request';
  const back = fromBill && source !== 'request' && payment ? `/dashboard/invoices/pay?invoice=${payment.invoice.id}` : fromBill ? '/dashboard/invoices/pay' : null;
  const backTo = (s: StepId): string | null => (sent ? null : back ?? transferHref(params, { step: s, payment: null }));

  /* ---------------------------------------------------------------- actions */
  async function makePayment(d: AmountDraft) {
    const key = JSON.stringify({ to, r: recipient?.id ?? null, p: payee?.orgId ?? null, php: to === 'bank' ? d.phpMinor : null, usd: to === 'splash' ? d.usdMinor : null, ref: d.reference, note: d.note });
    const detailsKey = JSON.stringify([d.purpose, d.description, d.relationship, d.sourceOfFunds]);
    setBusy('amount');
    setProblem(null);
    try {
      // The same recipient and amount as the draft already quoted: keep it, with any new answers.
      if (payment && made?.key === key && BEFORE_APPROVAL.includes(payment.state)) {
        if (to === 'bank' && made.detailsKey !== detailsKey) {
          await api(`/transfers/${payment.invoice.id}/details`, { method: 'PUT', body: { details: { purpose: d.purpose, description: d.description, relationship: d.relationship, sourceOfFunds: d.sourceOfFunds } } });
          setMade({ key, detailsKey });
        }
        setDraft(d);
        go({ to, step: 'quote', payment: payment.id });
        return;
      }
      // A different amount or recipient: the earlier draft is dropped (nothing was sent for it).
      if (payment && DISCARDABLE.includes(payment.state)) await api(`/payments/${payment.id}/discard`, { body: {} }).catch(() => undefined);
      let invoiceId: string;
      if (to === 'bank') {
        if (!recipient || !d.phpMinor) throw new Error('Choose a recipient and an amount first.');
        const t = await api<{ invoice: { id: string } }>('/transfers', { body: { recipientId: recipient.id, amountPhpMinor: d.phpMinor, reference: d.reference || null } });
        await api(`/transfers/${t.invoice.id}/details`, { method: 'PUT', body: { details: { purpose: d.purpose, description: d.description, relationship: d.relationship, sourceOfFunds: d.sourceOfFunds } } });
        invoiceId = t.invoice.id;
      } else {
        if (!payee) throw new Error('Choose a business first.');
        const t = await api<{ invoice: { id: string } }>('/transfers/peer', { body: { payeeOrgId: payee.orgId, amountUsdMinor: d.usdMinor, note: d.note || null, reference: d.reference || null } });
        invoiceId = t.invoice.id;
      }
      const q = await api<{ payment: PaymentDTO }>('/payments', { body: { invoiceId, allowShort: true } });
      setPayment(q.payment);
      setQuoteId(laneFor(q.payment, null));
      setFunding(null);
      setDraft(d);
      setMade({ key, detailsKey });
      go({ to, step: 'quote', payment: q.payment.id });
    } catch (e) {
      setProblem(problemOf(e));
    } finally {
      setBusy(null);
    }
  }

  /** "Use invoice …" on Step 2: that invoice's own payment, on Step 3, so the invoice is never paid twice. */
  async function payBill(billId: string) {
    setBusy('amount');
    setProblem(null);
    try {
      if (payment && DISCARDABLE.includes(payment.state)) await api(`/payments/${payment.id}/discard`, { body: {} }).catch(() => undefined);
      const res = await api<{ payment: PaymentDTO }>(`/invoices/${billId}/pay`, { body: {} });
      setPayment(res.payment);
      setQuoteId(laneFor(res.payment, null));
      setFunding(null);
      setDraft(null);
      setMade(null);
      go({ to: 'bank', step: 'quote', payment: res.payment.id });
    } catch (e) {
      setProblem(problemOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function requote() {
    if (!payment) return;
    const policy = [...payment.cards, ...(payment.compare ? [payment.compare] : [])].find((c) => c.quoteId === quoteId)?.policies[0] ?? null;
    setBusy('requote');
    setProblem(null);
    try {
      const res = await api<{ payment: PaymentDTO }>(`/payments/${payment.id}/requote`, { body: { allowShort: true } });
      setPayment(res.payment);
      setQuoteId(laneFor({ ...res.payment, selectedQuoteId: null }, policy));
      if (step !== 'quote') go({ step: 'quote' });
    } catch (e) {
      setProblem(problemOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function review() {
    if (!payment || !quoteId) return;
    setBusy('review');
    setProblem(null);
    try {
      let chosen = quoteId;
      // A payment to a Splash business shows no quote clock: one that ran out is quoted again here.
      const card = payment.cards.find((c) => c.quoteId === quoteId);
      if (payment.kind === 'peer' && card && Date.parse(card.expiresAt) <= Date.now()) {
        const fresh = await api<{ payment: PaymentDTO }>(`/payments/${payment.id}/requote`, { body: { allowShort: true } });
        chosen = fresh.payment.cards[0]?.quoteId ?? quoteId;
        setPayment(fresh.payment);
        setQuoteId(chosen);
      }
      const res = await api<{ payment: PaymentDTO }>(`/payments/${payment.id}/select`, { body: { quoteId: chosen, ...(rehearsal !== 'none' ? { rehearsal } : {}) } });
      setPayment(res.payment);
      // It now waits for an approval: the sidebar's badge and Zeke's one nudge read the new count.
      if (res.payment.state === 'checked') notifyCompanyChanged();
      if (res.payment.state === 'checked' && res.payment.approval) go({ step: 'approve' });
      else setProblem(res.payment.problem ?? { code: 'not_ready', message: 'This route can’t be approved right now.' });
    } catch (e) {
      setProblem(problemOf(e));
    } finally {
      setBusy(null);
    }
  }

  function another() {
    setRehearsal('none');
    setPayment(null);
    setDraft(null);
    setMade(null);
    setRecipient(null);
    setPayee(null);
    setQuoteId(null);
    setFunding(null);
    setEstimate(null);
    notifyCompanyChanged();
    go({ to: null, step: null, payment: null, template: null });
  }

  const onPayment = useCallback((p: PaymentDTO) => setPayment(p), []);
  const onFundingChanged = useCallback(() => {
    if (paymentId) void loadFunding(paymentId, quoteId);
  }, [paymentId, quoteId, loadFunding]);
  const onTrack = useCallback(() => go({ step: 'track' }), [go]);

  /* ---------------------------------------------------------------- the header and So far, from server state */
  const ready = payment && payment.id === urlPayment ? payment : null;
  const label: PayeeLabel = useMemo(
    () => (ready ? payeeOf(ready) : to === 'bank' ? { name: recipient?.name ?? '', bank: recipient?.bank ?? null, last4: recipient?.accountLast4 ?? null } : { name: payee?.name ?? '', bank: null, last4: null }),
    [ready, to, recipient, payee],
  );
  const peer = to === 'splash';
  const amountKey = `${to}:${recipient?.id ?? payee?.orgId ?? ''}`;
  const lanes = ready ? [...ready.cards, ...(ready.compare ? [ready.compare] : [])] : [];
  const card = ready ? (lanes.find((c) => c.quoteId === (step === 'quote' ? quoteId : (ready.selectedQuoteId ?? quoteId))) ?? ready.cards[0] ?? null) : null;
  /** The picked lane's names for So far's Route row, "Cheapest" only when it truly is (shared.ts laneTags). */
  const routeName = card ? (peer ? 'Inside Splash' : laneTags(card, lanes).map((t) => t.label).join(' · ') || 'Other route') : null;
  const est = step === 'amount' ? estimate : null;
  const reference = ready?.invoice.confirmed?.invoiceNumber ?? (draft?.reference || null);
  const peerInfo = ready?.invoice.peer ?? null;
  const testMode = company.mode === 'offline' || company.cluster !== 'mainnet-beta';

  const facts: HeaderFacts = useMemo(() => {
    const receive = card ? (peer ? usd(card.receivePhpMinor) : php(card.receivePhpMinor)) : est ? (peer ? usd(est.usdMinor) : est.phpMinor ? php(est.phpMinor) : null) : null;
    const youPay = card ? usd(card.youPayUsdcMinor) : est ? `about ${usd(est.usdMinor)}` : null;
    const paidOutBy = peer ? 'Inside Splash' : card ? card.arrives : (est?.rail ?? 'Bank');
    const quote =
      step === 'recipient' || step === 'amount' || !card ? (
        'At step 3'
      ) : peer ? (
        'No conversion'
      ) : step === 'track' ? (
        `Locked at ${card.rate}`
      ) : (
        <QuoteClock expiresAt={step === 'approve' && ready?.approval ? ready.approval.quoteExpiresAt : card.expiresAt} />
      );
    const sub = !label.name
      ? 'Choose who you are paying to start'
      : peer
        ? [countryName(peerInfo?.payeeCountry ?? payee?.country ?? null), peerInfo?.payeeHandle || payee?.handle ? `@${peerInfo?.payeeHandle ?? payee?.handle}` : null, 'into their own Splash account', reference].filter(Boolean).join(' · ')
        : [label.bank && label.last4 ? bankLine({ bank: label.bank, accountLast4: label.last4 }) : null, reference].filter(Boolean).join(' · ');
    return { status: statusOf(step, ready), title: label.name ? `Pay ${label.name}` : 'Send a payout', sub, receive, youPay, paidOutBy, quote, testMode };
  }, [card, est, peer, step, ready, label, peerInfo, payee, reference, testMode]);

  const approvedBy = ready ? ready.approvals.approvedBy.map((a) => a.name).join(' and ') : '';
  const rows: SoFarRow[] = [
    { label: 'Paying', value: label.name || null, sub: peer ? 'into their own Splash account' : label.bank && label.last4 ? `${label.bank} •••• ${label.last4}` : undefined },
    { label: 'They receive', value: facts.receive },
    // On Route the lane picked is known; later steps, the one the server holds (prompt 11 §2.2).
    {
      label: 'Route',
      value:
        ready && card && (step === 'quote' ? ready.state !== 'quote_expired' : ready.selectedQuoteId && !BEFORE_APPROVAL.slice(0, 2).includes(ready.state) && ready.state !== 'quote_expired')
          ? `${routeName} · ${usd(card.youPayUsdcMinor)}`
          : null,
    },
    { label: 'Approval', value: ready && (APPROVED.includes(ready.state) || ready.approvals.approved > 0) ? `Approved by ${approvedBy || 'you'}` : null },
  ];

  const lead = (
    <>
      {/* "Pay again" shows the tab's own kind: a bank template under Bank account, a Splash one under Splash business. */}
      {templates && templates.some((t) => t.to === to) ? <Templates templates={templates.filter((t) => t.to === to)} onUse={(t) => void startFromTemplate(t)} onRemoved={(id) => setTemplates(templates.filter((x) => x.id !== id))} /> : null}
      {problem ? (
        <p className="iso-note iso-note--danger" role="alert">
          {problem.message}
        </p>
      ) : null}
    </>
  );

  return (
    <div className="iso iso-page iso-page--transfer">
      <TransferHeader step={step} facts={facts} backTo={backTo} />

      <div key={step} className="iso-tx-enter">
        {step === 'recipient' ? (
          <StepRecipient
            company={company}
            to={urlTo}
            onTo={(t) => go({ to: t, step: 'recipient', payment: null }, 'replace')}
            recipients={recipients}
            onRecipients={setRecipients}
            recipient={recipient}
            onRecipient={setRecipient}
            payee={payee}
            onPayee={setPayee}
            onContinue={() => go({ step: 'amount', payment: null })}
            rows={rows}
            lead={lead}
          />
        ) : null}

        {step === 'amount' ? (
          <StepAmount
            key={amountKey}
            company={company}
            kind={to === 'bank' ? 'bank' : 'peer'}
            recipient={recipient}
            payee={payee}
            options={recipients?.detailsOptions ?? null}
            draft={draft ?? (kept?.key === amountKey ? kept.draft : null)}
            busy={busy === 'amount'}
            problem={problem}
            rows={rows}
            onEstimate={setEstimate}
            onUseBill={(id) => void payBill(id)}
            onBack={(d) => {
              setKept({ key: amountKey, draft: d });
              go({ step: 'recipient' });
            }}
            onNext={(d) => void makePayment(d)}
          />
        ) : null}

        {step === 'quote' && urlPayment ? (
          ready ? (
            <StepQuote
              payment={ready}
              payee={label}
              quoteId={quoteId}
              onQuoteId={setQuoteId}
              funding={funding}
              onFundingChanged={onFundingChanged}
              sourceOfFunds={draft?.sourceOfFunds ?? ready.invoice.details?.sourceOfFunds ?? null}
              busy={busy === 'requote' || busy === 'review' ? busy : null}
              problem={problem}
              rehearsal={rehearsal}
              onRehearsal={setRehearsal}
              rows={rows}
              back={back ? { label: 'Back to the invoice', href: back } : { label: 'Back to amount', onClick: () => go({ step: 'amount', payment: null }) }}
              onRequote={() => void requote()}
              onReview={() => void review()}
            />
          ) : (
            <Loading problem={loadProblem} />
          )
        ) : null}

        {step === 'approve' && urlPayment ? (
          ready && ready.approval ? (
            <StepApprove company={company} payment={ready} plan={funding?.plan ?? null} onPayment={onPayment} onTrack={onTrack} />
          ) : (
            <Loading problem={loadProblem} />
          )
        ) : null}

        {step === 'track' && urlPayment ? (
          ready ? (
            <StepTrack payment={ready} payee={label} onPayment={onPayment} onAnother={another} onRequote={() => void requote()} onRetry={() => go({ step: 'approve' })} />
          ) : (
            <Loading problem={loadProblem} />
          )
        ) : null}
      </div>
    </div>
  );
}

function Loading({ problem }: { problem: Problem | null }) {
  if (problem) {
    return (
      <div className="iso-note iso-note--danger iso-stack" role="alert">
        <p style={{ margin: 0 }}>{problem.message}</p>
        <div>
          <IsoButton variant="quiet" href="/dashboard/transfer">
            Start a new transfer
          </IsoButton>
        </div>
      </div>
    );
  }
  return (
    <div className="iso-stack" aria-busy="true" aria-label="Loading the payment">
      <div className="iso-skel" style={{ height: 52 }} />
      <div className="iso-skel" style={{ height: 260 }} />
    </div>
  );
}

/** "Pay again": transfers saved as templates (§5.8). Each opens Step 2 filled in; nothing is sent until a person approves. */
function Templates({ templates, onUse, onRemoved }: { templates: Template[]; onUse: (t: Template) => void; onRemoved: (id: string) => void }) {
  const shown = useMemo(() => templates.slice(0, 6), [templates]);
  async function remove(id: string) {
    try {
      await api(`/templates/${id}`, { method: 'DELETE' });
      onRemoved(id);
    } catch {
      /* it stays listed; the next load shows the truth */
    }
  }
  return (
    <section className="iso-templates" aria-labelledby="t1-templates">
      <h2 id="t1-templates" className="iso-label">
        Pay again
      </h2>
      <ul className="iso-templates__list">
        {shown.map((t) => (
          <li key={t.id} className="iso-templates__item">
            <button type="button" className="iso-templates__use" onClick={() => onUse(t)}>
              <strong>{shortName(t.payeeName)}</strong>
              <span className="iso-num">{t.amountPhpMinor ? php(t.amountPhpMinor) : t.amountUsdMinor ? usd(t.amountUsdMinor) : ''}</span>
            </button>
            <button type="button" className="iso-iconbtn" aria-label={`Remove the template for ${t.payeeName}`} onClick={() => void remove(t.id)}>
              <X size={14} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
