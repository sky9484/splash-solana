// iso-ui
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';

import { IsoButton, StepRail } from '@/components/iso';
import { PageHead } from '@/components/dashboard/PageHead';
import type { Wire } from '@/lib/solana-app/json';
import type { TransferTemplate } from '@/lib/solana-app/store';

import { api, php, usd } from '../client';
import type { CompanyDTO, FundingOptionsDTO, PaymentDTO } from '../types';
import { notifyCompanyChanged, useCompany } from '../useCompany';
import { ApprovalMoment } from './ApprovalMoment';
import { StepAmount } from './StepAmount';
import { StepQuote, type PayeeLabel, type Rehearsal } from './StepQuote';
import { StepRecipient } from './StepRecipient';
import { StepTrack } from './StepTrack';
import { problemOf, shortName, STEP_LABEL, STEP_ORDER, transferHref, type AmountDraft, type Payee, type Problem, type RecipientRow, type RecipientsDTO, type StepId, type To } from './shared';

type Template = Wire<TransferTemplate>;

const PAYMENT_ID = /^pay_[0-9a-f]{16}$/;
const TEMPLATE_ID = /^tpl_[0-9a-f]{16}$/;
/** Nothing has been sent: a new amount or recipient drops this draft (its record stays, "discarded"). */
const DISCARDABLE = ['draft', 'quoted', 'checked', 'quote_expired', 'rejected_by_policy', 'proposal_failed'];
const BEFORE_APPROVAL = ['draft', 'quoted', 'checked', 'quote_expired', 'rejected_by_policy'];
/** Where the approval moment can stand open: waiting for this device or the next approver, or just approved. */
const APPROVAL_OPEN = ['checked', 'proposed', 'execute_failed', 'approved', 'executed', 'confirmed', 'partner_paid', 'evidenced', 'evidence_failed', 'anchored'];

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

/**
 * Transfer (prompt 10 Phase 3): five steps, Recipient, Amount, Quote & send, Approve, Track, to a bank
 * account in the Philippines or to another business on Splash. The URL carries where you are
 * (`?to=bank|splash&step=…&payment=…`), so Back, a refresh and a shared link all land on the same
 * step; past steps in the rail link back until the payment is approved. Splash holds no key that can
 * move the money: a person approves every payment on their device.
 */
export function TransferFlow() {
  const { state } = useCompany();
  if (state.status === 'loading') {
    return (
      <div className="iso iso-page iso-page--transfer" aria-busy="true">
        <div className="iso-skel" style={{ height: 52 }} />
        <div className="iso-skel" style={{ height: 220 }} />
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
  const [busy, setBusy] = useState<null | 'amount' | 'requote' | 'review'>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [loadProblem, setLoadProblem] = useState<Problem | null>(null);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [rehearsal, setRehearsal] = useState<Rehearsal>('none');

  /** Move to another step: the URL changes (Back works), the page goes to the top, the title takes focus. */
  const go = useCallback((next: { to?: To | null; step?: StepId | null; payment?: string | null; template?: null }, mode: 'push' | 'replace' = 'push') => {
    const url = transferHref(new URLSearchParams(window.location.search), next);
    window.history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', url);
    setProblem(null);
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0 });
      const title = document.querySelector<HTMLElement>('.iso-page--transfer .iso-title');
      if (title) {
        title.tabIndex = -1;
        title.focus({ preventScroll: true });
      }
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
      // The approval moment stays open after the approval (its tick, then "Track it"), and on a 2-of-N
      // account while the other approver is awaited.
      if (urlStep === 'approve') return payment.approval && APPROVAL_OPEN.includes(payment.state) ? 'approve' : fromState;
      if (urlStep === 'quote' && BEFORE_APPROVAL.includes(payment.state)) return 'quote';
      if (urlStep === 'track') return 'track';
      return fromState;
    }
    if (urlStep === 'amount' && urlTo && (urlTo === 'bank' ? recipient?.payable : payee)) return 'amount';
    return 'recipient';
  })();
  const to: To | null = payment && urlPayment ? (payment.kind === 'peer' ? 'splash' : 'bank') : urlTo;
  const index = STEP_ORDER.indexOf(step);
  const sent = payment ? !BEFORE_APPROVAL.includes(payment.state) : false;

  // A bill came from Pay an invoice (prompt 10 §6.2): its recipient and amount were checked there, so
  // the first two steps lead back to the invoice, not to a new transfer.
  const source = payment?.invoice.source ?? null;
  const fromBill = source === 'sample' || source === 'paste' || source === 'upload' || source === 'request';
  const back = fromBill && source !== 'request' && payment ? `/dashboard/invoices/pay?invoice=${payment.invoice.id}` : fromBill ? '/dashboard/invoices/pay' : null;
  const rail = STEP_ORDER.map((s, i) => ({
    label: STEP_LABEL[s],
    href:
      i < index && !sent && (s === 'recipient' || s === 'amount' || (s === 'quote' && payment))
        ? back && s !== 'quote'
          ? back
          : transferHref(params, s === 'quote' ? { step: 'quote' } : { step: s, payment: null })
        : undefined,
  }));

  /* ---------------------------------------------------------------- actions */
  async function makePayment(d: AmountDraft) {
    if (!to) return;
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
    notifyCompanyChanged();
    go({ to: null, step: null, payment: null, template: null });
  }

  const onPayment = useCallback((p: PaymentDTO) => setPayment(p), []);
  const onFundingChanged = useCallback(() => {
    if (paymentId) void loadFunding(paymentId, quoteId);
  }, [paymentId, quoteId, loadFunding]);

  const label = payment ? payeeOf(payment) : { name: recipient?.name ?? payee?.name ?? '', bank: recipient?.bank ?? null, last4: recipient?.accountLast4 ?? null };
  // While the approval card is open, the page behind it is inactive: dimmed, inert, out of reach.
  const inactiveBehind = Boolean(step === 'approve' && payment?.approval);

  return (
    <div className="iso iso-page iso-page--transfer">
      <div className={inactiveBehind ? 'iso-dimmed iso-stack-lg' : 'iso-stack-lg'} inert={inactiveBehind ? true : undefined}>
        <StepRail steps={rail} current={index} label="Transfer steps" />

        {step === 'recipient' ? (
          <>
            <PageHead title="Who are you paying?" context="Pick where the money goes. Each has its own steps." />
            {templates && templates.length > 0 ? <Templates templates={templates} onUse={(t) => void startFromTemplate(t)} onRemoved={(id) => setTemplates(templates.filter((x) => x.id !== id))} /> : null}
            {problem ? (
              <p className="iso-note iso-note--danger" role="alert">
                {problem.message}
              </p>
            ) : null}
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
            />
          </>
        ) : null}

        {step === 'amount' && to ? (
          <>
            <PageHead title={to === 'bank' ? `How much does ${shortName(label.name)} get?` : `How much are you sending ${shortName(label.name)}?`} context={to === 'bank' ? 'Type either amount; the other follows. The exact cost comes on the next step.' : 'They get exactly what you send. No Splash fee between Splash businesses.'} />
            <StepAmount
              key={`${to}:${recipient?.id ?? payee?.orgId ?? ''}`}
              company={company}
              kind={to === 'bank' ? 'bank' : 'peer'}
              recipient={recipient}
              payee={payee}
              options={recipients?.detailsOptions ?? null}
              draft={draft}
              busy={busy === 'amount'}
              problem={problem}
              onBack={() => go({ step: 'recipient' })}
              onNext={(d) => void makePayment(d)}
            />
          </>
        ) : null}

        {(step === 'quote' || step === 'approve') && urlPayment ? (
          payment && payment.id === urlPayment ? (
            <StepQuote
              payment={payment}
              payee={label}
              quoteId={quoteId}
              onQuoteId={setQuoteId}
              funding={funding}
              onFundingChanged={onFundingChanged}
              sourceOfFunds={draft?.sourceOfFunds ?? payment.invoice.details?.sourceOfFunds ?? null}
              busy={busy === 'requote' || busy === 'review' ? busy : null}
              problem={problem}
              ticketAway={inactiveBehind}
              rehearsal={rehearsal}
              onRehearsal={setRehearsal}
              onRequote={() => void requote()}
              onBack={() => go({ step: 'amount', payment: null })}
              onReview={() => void review()}
            />
          ) : (
            <Loading problem={loadProblem} />
          )
        ) : null}

        {step === 'track' && urlPayment ? (
          payment && payment.id === urlPayment ? (
            <StepTrack payment={payment} payee={label} onPayment={onPayment} onAnother={another} onRequote={() => void requote()} onRetry={() => go({ step: 'approve' })} />
          ) : (
            <Loading problem={loadProblem} />
          )
        ) : null}
      </div>

      {inactiveBehind && payment ? (
        <ApprovalMoment
          company={company}
          payment={payment}
          plan={funding?.plan ?? null}
          onPayment={onPayment}
          onCancel={() => go({ step: 'quote' })}
          onTrack={() => go({ step: 'track' })}
        />
      ) : null}
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
    <section className="iso-templates iso-rise" aria-labelledby="t1-templates">
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
