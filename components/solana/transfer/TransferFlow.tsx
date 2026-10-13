'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRightLeft, BadgeCheck, Check, ChevronDown, CircleDollarSign, Clock3, FileCheck2, Landmark, ShieldCheck, Vault, Workflow, type LucideIcon } from 'lucide-react';

import SettlementEngineFlow from '@/components/dashboard/SettlementEngineFlow';

import { ApprovalCard, clock, secondsLeft } from '../ApprovalCard';
import { api, ApiError, existingDeviceKey, php, signPrepared, usd } from '../client';
import { DoneScreen, ProblemCard } from '../PayFlow';
import { ProgressLine } from '../ProgressLine';
import { StatusPill } from '../StatusPill';
import type { CompanyDTO, DetailsDTO, DetailsOptionsDTO, FundingDTO, FundingOptionsDTO, InvoiceDTO, PaymentDTO } from '../types';
import { notifyCompanyChanged, useCompany } from '../useCompany';
import { FundingChoice, fundedByLabel, fundingShort, type FundBody, type PayFrom } from './FundingChoice';
import { PaymentDetails, type DetailsBody } from './PaymentDetails';
import { StepBeneficiary, type Beneficiary } from './StepBeneficiary';
import { StepDelivery, type Delivery } from './StepDelivery';

import './transfer.css';

type Step = 1 | 2 | 3 | 4 | 5;
type Problem = { code: string; message: string; detail?: Record<string, unknown> };

const STEPS = ['Beneficiary', 'Delivery', 'Quote & Send', 'Status', 'Receipt'] as const;
const TITLES: Record<Step, string> = {
  1: 'Who receives it',
  2: 'How much, and how it arrives',
  3: 'Quote & Send',
  4: 'On its way',
  5: 'Paid, with the receipt',
};

/** Where a transfer opened again (?payment=…) picks up, from its state alone. */
function stepFor(state: string): Step {
  if (state === 'evidenced' || state === 'anchored') return 5;
  if (['draft', 'quoted', 'quote_expired', 'rejected_by_policy', 'checked', 'proposal_failed'].includes(state)) return 3;
  return 4;
}

function problemOf(e: unknown): Problem {
  if (e instanceof ApiError) return { code: e.code, message: e.message, detail: e.detail };
  return { code: 'error', message: e instanceof Error ? e.message : String(e) };
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/**
 * Transfer (Sky, 13 Oct): the five steps of the earlier "Send a payout" flow, on the Solana money path.
 *
 *   1 Beneficiary    who receives it (saved and verified, or new with a call-back)
 *   2 Delivery       how many pesos reach their bank, and a reference
 *   3 Quote & Send   what the payout partner needs, the route, how you pay, and the approval
 *   4 Status         approved, sent, received by the partner, paid to the bank
 *   5 Receipt        one record of the whole payment
 *
 * Step 3 pays from the company's own vaults (ready now), or brings USD or a stablecoin in from outside
 * them first (a funds check and a declaration). Either way the payout leaves the payments vault with
 * one approval on this device, and Splash never holds the money.
 */
export function TransferFlow({ resumePaymentId }: { resumePaymentId?: string | null }) {
  const { state } = useCompany();
  const [step, setStep] = useState<Step>(1);
  const [beneficiary, setBeneficiary] = useState<Beneficiary | null>(null);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [invoice, setInvoice] = useState<InvoiceDTO | null>(null);
  const [payment, setPayment] = useState<PaymentDTO | null>(null);
  const [details, setDetails] = useState<DetailsDTO | null>(null);
  const [previous, setPrevious] = useState<DetailsDTO | null>(null);
  const [detailOptions, setDetailOptions] = useState<DetailsOptionsDTO | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [rehearsal, setRehearsal] = useState('none');
  const [options, setOptions] = useState<FundingOptionsDTO | null>(null);
  const [payFrom, setPayFrom] = useState<PayFrom | null>(null);
  const [funding, setFunding] = useState<FundingDTO | null>(null);
  const [busy, setBusy] = useState<null | 'quote' | 'details' | 'move' | 'fund' | 'review' | 'approve'>(null);
  const [error, setError] = useState<Problem | null>(null);
  const [fundError, setFundError] = useState<Problem | null>(null);
  const [detailsError, setDetailsError] = useState<{ message: string; missing?: string[] } | null>(null);
  const [engineOpen, setEngineOpen] = useState(false);
  const [engineMounted, setEngineMounted] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const now = useNow(step === 3);

  const org = state.status === 'ready' ? state.company : null;
  const paymentId = payment?.id ?? null;
  const card = payment?.cards.find((c) => c.quoteId === quoteId) ?? null;

  const go = useCallback((s: Step) => {
    setStep(s);
    setError(null);
    requestAnimationFrame(() => headingRef.current?.focus());
  }, []);

  /** The vaults and every way to bring USDC in, for the chosen route. */
  const loadOptions = useCallback(async (pid: string, qid: string | null) => {
    try {
      const res = await api<FundingOptionsDTO>(`/payments/${pid}/fund${qid ? `?quoteId=${qid}` : ''}`);
      setOptions(res);
      const live = res.fundings.filter((f) => f.state !== 'held').at(-1) ?? res.fundings.at(-1) ?? null;
      if (live) {
        setFunding(live);
        setPayFrom('external');
      }
    } catch (e) {
      setFundError(problemOf(e));
    }
  }, []);

  /** Keep the chosen route by its kind when quotes are refreshed (their ids change). */
  const adopt = useCallback((p: PaymentDTO) => {
    setPayment(p);
    setQuoteId((prev) => {
      const prevKind = p.cards.find((c) => c.quoteId === prev)?.kind;
      const keep = p.selectedQuoteId ?? (prev && p.cards.some((c) => c.quoteId === prev) ? prev : null);
      if (keep) return keep;
      const sameKind = prevKind ? p.cards.find((c) => c.kind === prevKind) : null;
      return (sameKind ?? p.cards.find((c) => c.policy === 'cheapest') ?? p.cards[0])?.quoteId ?? null;
    });
  }, []);

  // Opened from history or the overview (?payment=…): pick the transfer up where it stands.
  useEffect(() => {
    if (!resumePaymentId || !org) return;
    let stop = false;
    (async () => {
      try {
        const res = await api<{ payment: PaymentDTO }>(`/payments/${resumePaymentId}`);
        if (stop) return;
        const p = res.payment;
        adopt(p);
        const c = p.invoice.confirmed;
        if (c) {
          setBeneficiary({ name: c.supplierName, bank: c.supplierBank, accountLast4: c.supplierAccountLast4, saved: true, verification: null });
          setDelivery({ amountPhpMinor: String(c.amountPhpMinor), reference: c.invoiceNumber });
        }
        setDetails(p.invoice.details ?? null);
        const d = await api<{ details: DetailsDTO | null; previousDetails: DetailsDTO | null; detailsOptions: DetailsOptionsDTO }>(`/transfers/${p.invoice.id}/details`);
        if (stop) return;
        setPrevious(d.previousDetails);
        setDetailOptions(d.detailsOptions);
        setStep(stepFor(p.state));
        if (stepFor(p.state) === 3) await loadOptions(p.id, p.selectedQuoteId ?? null);
      } catch (e) {
        if (!stop) setError(problemOf(e));
      }
    })();
    return () => {
      stop = true;
    };
  }, [resumePaymentId, org?.org.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The funding options follow the chosen route (its cost is what lands in the vault).
  useEffect(() => {
    if (step !== 3 || !paymentId || !quoteId) return;
    // The options are set after the request answers, not during this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadOptions(paymentId, quoteId);
  }, [step, paymentId, quoteId, loadOptions]);

  // A funding under its check: read it until it is in the vault or held. Reading never credits twice.
  useEffect(() => {
    if (!funding || funding.state !== 'checking') return;
    let stop = false;
    const t = setInterval(async () => {
      try {
        const res = await api<{ funding: FundingDTO }>(`/fundings/${funding.id}`);
        if (stop) return;
        if (res.funding.state !== 'checking') {
          setFunding(res.funding);
          notifyCompanyChanged();
          if (paymentId) void loadOptions(paymentId, quoteId);
        }
      } catch {
        /* keep reading */
      }
    }, 700);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [funding?.id, funding?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  // Status: read the payment until the partner reports a final state.
  useEffect(() => {
    if (step !== 4 || !paymentId) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await api<{ payment: PaymentDTO }>(`/payments/${paymentId}`);
        if (stop) return;
        setPayment(res.payment);
        if ((res.payment.state === 'evidenced' || res.payment.state === 'anchored') && res.payment.receiptId) {
          notifyCompanyChanged();
          setTimeout(() => !stop && go(5), 900);
          return;
        }
        if (['partner_failed', 'proposal_failed', 'execute_failed'].includes(res.payment.state)) {
          notifyCompanyChanged();
          return;
        }
      } catch {
        /* keep reading; the uncertain state is shown from the payment record */
      }
      if (!stop) setTimeout(tick, 900);
    };
    const t = setTimeout(tick, 700);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [step, paymentId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.status === 'loading') return <p className="sx-muted">Loading your company…</p>;
  if (!org || !org.vault) {
    return (
      <div className="sx-narrow sx-stack">
        <p className="sx-lede">{state.status === 'ready' ? 'Set up this device and your vault first. It takes about a minute.' : state.message}</p>
        <Link className="sx-btn" href={state.status === 'signin' ? '/login' : '/dashboard/setup'}>
          {state.status === 'signin' ? 'Sign in' : 'Set up this device'}
        </Link>
      </div>
    );
  }
  const company: CompanyDTO = org;

  async function getQuote(d: Delivery) {
    if (!beneficiary) return;
    setDelivery(d);
    setBusy('quote');
    setError(null);
    try {
      const t = await api<{ invoice: InvoiceDTO; previousDetails: DetailsDTO | null; detailsOptions: DetailsOptionsDTO }>('/transfers', {
        body: {
          recipient: { name: beneficiary.name, bank: beneficiary.bank, accountLast4: beneficiary.accountLast4 },
          amountPhpMinor: d.amountPhpMinor,
          reference: d.reference || null,
          verification: beneficiary.verification,
        },
      });
      setInvoice(t.invoice);
      setPrevious(t.previousDetails);
      setDetailOptions(t.detailsOptions);
      setDetails(null);
      setEditingDetails(false);
      setFunding(null);
      setPayFrom(null);
      setOptions(null);
      setQuoteId(null);
      const q = await api<{ payment: PaymentDTO }>('/payments', { body: { invoiceId: t.invoice.id, allowShort: true } });
      adopt(q.payment);
      go(3);
    } catch (e) {
      setError(problemOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function requote() {
    if (!payment) return;
    setBusy('quote');
    setError(null);
    try {
      const res = await api<{ payment: PaymentDTO }>(`/payments/${payment.id}/requote`, { body: { allowShort: true } });
      adopt(res.payment);
    } catch (e) {
      setError(problemOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function saveDetails(body: DetailsBody) {
    const inv = payment?.invoice.id ?? invoice?.id;
    if (!inv) return;
    setBusy('details');
    setDetailsError(null);
    try {
      const res = await api<{ details: DetailsDTO }>(`/transfers/${inv}/details`, { method: 'PUT', body });
      setDetails(res.details);
      setPrevious(res.details);
      setEditingDetails(false);
      // A route already reviewed with the old details is reviewed again with the new ones.
      if (payment?.approval) setPayment({ ...payment, approval: null });
    } catch (e) {
      const p = problemOf(e);
      setDetailsError({ message: p.message, missing: Array.isArray(p.detail?.missing) ? (p.detail!.missing as string[]) : undefined });
    } finally {
      setBusy(null);
    }
  }

  async function moveFromTreasury(amountMinor: string) {
    setBusy('move');
    setFundError(null);
    try {
      if (!company.me.canApprove) throw new ApiError('not_an_approver', "This device can't approve for your company yet. Finish setup on it.", 0);
      if (!(await existingDeviceKey(company.me.keyId))) throw new ApiError('no_device_key', "This browser doesn't hold your device key. Move from the browser where you set up this device.", 0);
      const prepared = await api<{ move: { id: string }; messages: Array<{ id: string; messageBase64: string }> }>('/treasury/moves', { body: { from: 'treasury', amountMinor } });
      const signatures = await signPrepared(company.me.keyId, prepared.messages);
      const res = await api<{ move: { state: string; problem: { message: string } | null } }>(`/treasury/moves/${prepared.move.id}/approve`, { body: { signatures } });
      if (res.move.state !== 'confirmed') throw new ApiError('move_unconfirmed', res.move.problem?.message ?? 'The move has not confirmed yet. Check Treasury, then come back.', 0);
      notifyCompanyChanged();
      if (paymentId) await loadOptions(paymentId, quoteId);
    } catch (e) {
      setFundError(problemOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function fundIt(body: FundBody) {
    if (!payment || !quoteId) return;
    setBusy('fund');
    setFundError(null);
    try {
      const res = await api<{ funding: FundingDTO }>(`/payments/${payment.id}/fund`, { body: { ...body, quoteId, sourceOfFunds: details?.sourceOfFunds, declared: true } });
      setFunding(res.funding);
    } catch (e) {
      setFundError(problemOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function review() {
    if (!payment || !quoteId) return;
    setBusy('review');
    setError(null);
    try {
      const res = await api<{ payment: PaymentDTO }>(`/payments/${payment.id}/select`, { body: { quoteId, rehearsal } });
      setPayment(res.payment);
    } catch (e) {
      setError(problemOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (!payment) return;
    setBusy('approve');
    setError(null);
    try {
      if (!company.me.canApprove) throw new ApiError('not_an_approver', "This device can't approve for your company yet. Finish setup on it, or approve from the device you set up.", 0);
      if (!(await existingDeviceKey(company.me.keyId))) throw new ApiError('no_device_key', "This browser doesn't hold your device key. Approve from the browser where you set up this device.", 0);
      const prepared = await api<{ messages: Array<{ id: string; messageBase64: string }> }>(`/payments/${payment.id}/prepare`, { body: {} });
      const signatures = await signPrepared(company.me.keyId, prepared.messages);
      const res = await api<{ payment: PaymentDTO }>(`/payments/${payment.id}/approve`, { body: { signatures } });
      setPayment(res.payment);
      notifyCompanyChanged();
      go(4);
    } catch (e) {
      setError(problemOf(e));
      try {
        const res = await api<{ payment: PaymentDTO }>(`/payments/${payment.id}`);
        setPayment(res.payment);
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(null);
    }
  }

  function startOver() {
    setBeneficiary(null);
    setDelivery(null);
    setInvoice(null);
    setPayment(null);
    setDetails(null);
    setPrevious(null);
    setFunding(null);
    setPayFrom(null);
    setOptions(null);
    setQuoteId(null);
    setRehearsal('none');
    go(1);
  }

  /** The settlement engine: mounted, then faded in on the next frame; faded out, then unmounted. */
  function toggleEngine() {
    const still = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (engineOpen) {
      setEngineOpen(false);
      if (still) setEngineMounted(false);
      return;
    }
    setEngineMounted(true);
    if (still) setEngineOpen(true);
    else requestAnimationFrame(() => requestAnimationFrame(() => setEngineOpen(true)));
  }

  /* ---------------------------------------------------------------- derived */
  const need = card ? BigInt(card.youPayUsdcMinor) : null;
  const covered = !!options && need !== null && BigInt(options.vaults.paymentsMinor) >= need;
  const left = card ? secondsLeft(card.expiresAt, now) : 0;
  const detailsDone = !!details && !editingDetails;
  const fundingDone = covered && (payFrom === 'vault' || (payFrom === 'external' && funding?.state === 'in_vault'));
  const fundedBy = fundedByLabel(payFrom, funding);
  const recipientName = beneficiary?.name ?? payment?.invoice.confirmed?.supplierName ?? '';
  const amountMinor = delivery?.amountPhpMinor ?? (payment ? String(payment.invoice.confirmed?.amountPhpMinor ?? '') : null);

  const status = (() => {
    if (step === 5) return 'Paid';
    if (step === 4) return payment?.state === 'partner_failed' ? 'Returned' : payment?.stateLabel ?? 'On its way';
    if (step === 3) {
      if (payment?.approval && payment.state === 'checked') return 'Ready to approve';
      if (funding?.state === 'checking') return 'Funds check';
      return 'Quoted';
    }
    return 'Draft';
  })();
  const quoteLabel = step >= 4 ? 'Quote used at signing' : step === 3 && card ? (left > 0 ? `Quote expires in ${clock(left)}` : 'Quote expired') : 'Quote at Step 3';

  return (
    <div className="sx-t">
      <header className="sx-thead">
        <div className="sx-thead-main">
          <div className="sx-thead-copy">
            <div className="sx-thead-chips">
              <span className="sx-tchip">Transfer</span>
              <span className="sx-tchip sx-tchip-state">
                <BadgeCheck aria-hidden="true" /> {status}
              </span>
              <button type="button" className="sx-tchip sx-tchip-btn" aria-expanded={engineOpen} aria-controls="t-engine" onClick={toggleEngine}>
                <Workflow aria-hidden="true" /> Settlement engine <ChevronDown aria-hidden="true" className="sx-tchip-caret" />
              </button>
            </div>
            <h1>Send a transfer</h1>
            <p>Pesos to a bank account in the Philippines, no invoice needed. Paid from your own vault; a person approves on this device, and the receipt keeps the proof.</p>
            <div className="sx-thead-route">
              <span className="sx-mono">USDC → PHP</span>
              <span>Philippines · bank deposit</span>
              <span className="sx-num">{quoteLabel}</span>
            </div>
          </div>
          <div className="sx-thead-progress">
            <span className="sx-thead-kicker">Current step</span>
            <div className="sx-thead-current">
              <div>
                <strong>{STEPS[step - 1]}</strong>
                <span>
                  Step {step} of {STEPS.length}
                </span>
              </div>
              <span className="sx-thead-count sx-num">
                {step}/{STEPS.length}
              </span>
            </div>
            <div className="sx-thead-bar" aria-hidden="true">
              <i style={{ ['--p' as string]: step / STEPS.length }} />
            </div>
          </div>
        </div>
        <dl className="sx-thead-metrics">
          <Metric icon={CircleDollarSign} label="Recipient receives" value={amountMinor ? php(amountMinor) : 'Amount at Step 2'} />
          <Metric icon={ArrowRightLeft} label="You pay" value={card ? usd(card.youPayUsdcMinor) : 'At the quote'} />
          <Metric icon={Vault} label="Paid from" value={payFrom === 'vault' ? 'Your vaults' : payFrom === 'external' ? (funding ? fundingShort(funding) : 'Another way') : step === 3 ? 'Choose in 3.3' : step < 3 ? 'Choose at Step 3' : '—'} />
          <Metric icon={Clock3} label="Quote" value={step === 3 && card ? (left > 0 ? clock(left) : 'Expired') : step >= 4 ? 'Used at signing' : 'Not yet'} />
        </dl>
      </header>

      {engineMounted ? (
        <div id="t-engine" className="sx-engine" data-open={engineOpen ? 'true' : undefined} onTransitionEnd={(e) => e.target === e.currentTarget && !engineOpen && setEngineMounted(false)} aria-hidden={!engineOpen}>
          <div>
            <SettlementEngineFlow
              variant="settlement"
              sources={[
                { label: 'Your vaults', sublabel: 'Payments + treasury · ready now' },
                { label: 'Stablecoin wallet', sublabel: 'USDC, USDT or PYUSD · checked first' },
                { label: 'Stripe', sublabel: 'USD · sandbox', src: '/stripe-logo.svg' },
                { label: 'Airwallex', sublabel: 'USD · sandbox', src: '/airwallex-logo.png' },
              ]}
              corridors={[{ label: 'PHP', sublabel: 'Philippines · bank deposit', flag: 'PH' }]}
              captions={['A person approves each payment', 'Quote checked at signing', 'One record per payment']}
            />
          </div>
        </div>
      ) : null}

      <ol className="sx-tsteps" aria-label="Transfer steps">
        {STEPS.map((label, i) => {
          const n = (i + 1) as Step;
          const active = n === step;
          const done = n < step;
          const canGoBack = done && step <= 3 && !(payment?.approval && payment.state === 'checked') && n <= 2;
          const body = (
            <>
              <span className="sx-tstep-n" aria-hidden="true">
                {done ? <Check /> : n}
              </span>
              <span className="sx-tstep-copy">
                <span>Step {n}</span>
                <strong>{label}</strong>
              </span>
            </>
          );
          return (
            <li key={label} aria-current={active ? 'step' : undefined} data-done={done ? 'true' : undefined}>
              {canGoBack ? (
                <button type="button" className="sx-tstep-btn" onClick={() => go(n)} aria-label={`Back to step ${n}: ${label}`}>
                  {body}
                </button>
              ) : (
                <span className="sx-tstep-btn">{body}</span>
              )}
            </li>
          );
        })}
      </ol>

      <div className="sx-tgrid">
        <section className="sx-tpanel" aria-labelledby="t-step-title">
          <h2 id="t-step-title" ref={headingRef} tabIndex={-1} className="sx-flow-title">
            {TITLES[step]}
          </h2>

          {step === 1 ? <StepBeneficiary org={company} value={beneficiary} onNext={(b) => { setBeneficiary(b); go(2); }} /> : null}
          {step === 2 && beneficiary ? <StepDelivery beneficiary={beneficiary} value={delivery} busy={busy === 'quote'} onBack={() => go(1)} onNext={(d) => void getQuote(d)} /> : null}
          {(step === 1 || step === 2) && error ? <ProblemCard problem={error} onRefresh={() => undefined} onBack={() => setError(null)} onStart={startOver} /> : null}

          {step === 3 && payment ? (
            <div className="sx-tsecs">
              <Section n="3.1" title="About this payment" note="What the payout partner needs" state={detailsDone ? 'done' : 'active'}>
                {detailOptions ? (
                  <PaymentDetails
                    key={`${payment.invoice.id}-${editingDetails}`}
                    recipientName={recipientName}
                    given={detailsDone ? details : null}
                    previous={editingDetails ? null : previous}
                    options={detailOptions}
                    busy={busy === 'details'}
                    error={detailsError}
                    onSave={(b) => void saveDetails(b)}
                    onChange={() => setEditingDetails(true)}
                  />
                ) : (
                  <p className="sx-muted">Loading the questions…</p>
                )}
              </Section>

              <Section n="3.2" title="Route" note={card ? `Quote expires in ${clock(left)}` : undefined} state="active">
                <RoutePicker payment={payment} selected={quoteId} onSelect={(id) => { setQuoteId(id); if (payment.approval) setPayment({ ...payment, approval: null }); }} />
                <div className="sx-row" style={{ marginTop: 12 }}>
                  {left === 0 ? (
                    <button type="button" className="sx-btn sx-btn-sm" onClick={() => void requote()} disabled={busy === 'quote'}>
                      {busy === 'quote' ? 'Refreshing…' : 'Quote expired, refresh'}
                    </button>
                  ) : (
                    <button type="button" className="sx-btn-link sx-small" onClick={() => void requote()} disabled={busy === 'quote'}>
                      Refresh the quote
                    </button>
                  )}
                  <span className="sx-small sx-muted">
                    Zeke suggests {payment.zeke.suggests}. You choose.
                  </span>
                </div>
              </Section>

              <Section n="3.3" title="How will you pay?" note={fundingDone ? 'Covered' : undefined} state={fundingDone ? 'done' : 'active'}>
                {options && card ? (
                  <FundingChoice
                    companyName={company.org.companyName}
                    options={options}
                    neededMinor={String(card.youPayUsdcMinor)}
                    details={detailsDone ? details : null}
                    choice={payFrom}
                    onChoice={(c) => { setPayFrom(c); setFundError(null); }}
                    funding={funding}
                    busy={busy === 'move' ? 'move' : busy === 'fund' ? 'fund' : null}
                    offline={company.mode === 'offline'}
                    error={fundError}
                    onMove={(m) => void moveFromTreasury(m)}
                    onFund={(b) => void fundIt(b)}
                    onResetFunding={() => setFunding(null)}
                  />
                ) : (
                  <p className="sx-muted">Loading your vaults…</p>
                )}
              </Section>

              <Section n="3.4" title="Review and send" state={detailsDone && fundingDone ? 'active' : 'locked'}>
                <ul className="sx-tready" aria-label="Before you approve">
                  <ReadyItem ok={detailsDone} label="The partner’s details are given" />
                  <ReadyItem ok={!!card && left > 0} label={card && left > 0 ? `Route chosen: ${card.label}` : 'A live quote (refresh it if it expired)'} />
                  <ReadyItem ok={fundingDone} label={fundingDone ? `Covered: ${fundedBy}` : 'Your payments vault holds the full cost'} />
                </ul>
                {company.mode === 'offline' ? (
                  <details className="sx-small" style={{ marginTop: 12 }}>
                    <summary>Rehearse a problem (offline only)</summary>
                    <label htmlFor="t-rehearsal" className="sx-visually-hidden">
                      Problem to rehearse
                    </label>
                    <select id="t-rehearsal" value={rehearsal} onChange={(e) => setRehearsal(e.target.value)} style={{ maxWidth: 420, marginTop: 8 }}>
                      <option value="none">No problem: the normal path</option>
                      <option value="kyt_flag">Screening flags the recipient’s deposit address</option>
                      <option value="partner_return">The partner returns the payment</option>
                    </select>
                  </details>
                ) : null}
                {payment.approval && ['checked', 'rejected_by_policy', 'quote_expired'].includes(payment.state) && payment.selectedQuoteId === quoteId ? (
                  <div className="sx-stack" style={{ marginTop: 16 }}>
                    {payment.problem && payment.state !== 'checked' ? <ProblemCard problem={payment.problem} onRefresh={() => void requote()} onBack={() => setPayment({ ...payment, approval: null })} onStart={startOver} /> : null}
                    <ApprovalCard card={payment.approval} now={now} busy={busy === 'approve'} onApprove={() => void approve()} onCancel={() => setPayment({ ...payment, approval: null })} onRefresh={() => void requote()} fundedBy={fundedBy} />
                  </div>
                ) : (
                  <div className="sx-row" style={{ marginTop: 16 }}>
                    <button type="button" className="sx-btn" disabled={!detailsDone || !fundingDone || !card || left === 0 || busy !== null} onClick={() => void review()}>
                      {busy === 'review' ? 'Checking your rules…' : 'Review and approve'}
                    </button>
                    {!detailsDone || !fundingDone ? <span className="sx-hint">{!detailsDone ? 'Answer “About this payment” first.' : 'Cover the payment first.'}</span> : null}
                  </div>
                )}
                {error ? (
                  <div style={{ marginTop: 12 }}>
                    <ProblemCard problem={error} onRefresh={() => void requote()} onBack={() => setError(null)} onStart={startOver} />
                  </div>
                ) : null}
              </Section>
            </div>
          ) : null}

          {step === 4 && payment ? (
            <div className="sx-stack" aria-live="polite">
              <ProgressLine payment={payment} />
              {payment.problem ? (
                <ProblemCard problem={payment.problem} onRefresh={() => void requote()} onBack={() => go(3)} onStart={startOver} />
              ) : (
                <p className="sx-muted sx-small">
                  {payment.simulated ? 'Simulated · devnet-ready. ' : ''}
                  {payment.partnerLabel} pays the recipient’s bank once the USDC reaches its deposit address.
                  {fundedBy ? ` Paid from: ${fundedBy}.` : ''}
                </p>
              )}
            </div>
          ) : null}

          {step === 5 && payment ? (
            <div className="sx-stack-lg">
              {fundedBy ? (
                <p className="sx-small sx-muted">
                  Paid from: {fundedBy}
                  {details ? ` · ${details.purposeLabel}: ${details.description}` : ''}
                </p>
              ) : null}
              <DoneScreen payment={payment} mode="transfer" onAnother={startOver} />
            </div>
          ) : null}
        </section>

        <aside className="sx-taside" aria-label="This transfer">
          <div className="sx-ticket">
            <div className="sx-ticket-head">
              <span className="sx-thead-kicker">This transfer</span>
              <strong className="sx-num">{amountMinor ? php(amountMinor) : '₱ —'}</strong>
              <span>To {recipientName || 'the recipient'}</span>
            </div>
            <dl className="sx-ticket-rows">
              <dt>Bank</dt>
              <dd>{beneficiary ? <>{beneficiary.bank} <span className="sx-mono">•••• {beneficiary.accountLast4}</span></> : '—'}</dd>
              <dt>Reference</dt>
              <dd className="sx-mono">{payment?.invoice.confirmed?.invoiceNumber ?? (delivery?.reference || '—')}</dd>
              <dt>Purpose</dt>
              <dd>{details ? details.purposeLabel : '—'}</dd>
              <dt>Route</dt>
              <dd>{card ? card.laneLine : '—'}</dd>
              <dt>Paid from</dt>
              <dd>{payFrom === 'vault' ? 'Your vaults' : funding ? fundingShort(funding) : '—'}</dd>
              <dt>State</dt>
              <dd>{payment ? <StatusPill state={payment.state} label={payment.stateLabel} /> : 'Draft'}</dd>
            </dl>
          </div>
          <Signal icon={ShieldCheck} title="Your vault, your keys" body="The payout leaves your own payments vault. Splash holds no key that can move it, and takes nothing on the way in." />
          <Signal icon={FileCheck2} title="Rules before you sign" body="Limits, a duplicate check, verified bank details and screening run before the approval can be signed." />
          <Signal icon={Landmark} title="One record per payment" body="A transfer gets the same receipt as an invoice: approval, transfer, the partner’s reports and the rate." />
          {company.simulated ? <p className="sx-small sx-muted">Simulated · devnet-ready. Mock partner; Stripe, Airwallex and the swap are sandbox stand-ins.</p> : null}
        </aside>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="sx-thead-metric">
      <span className="sx-thead-icon" aria-hidden="true">
        <Icon />
      </span>
      <span>
        <dt>{label}</dt>
        <dd className="sx-num">{value}</dd>
      </span>
    </div>
  );
}

function Signal({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="sx-signal">
      <span className="sx-signal-icon" aria-hidden="true">
        <Icon />
      </span>
      <div>
        <strong>{title}</strong>
        <p className="sx-small sx-muted">{body}</p>
      </div>
    </div>
  );
}

function Section({ n, title, note, state, children }: { n: string; title: string; note?: string; state: 'active' | 'done' | 'locked'; children: React.ReactNode }) {
  return (
    <section className="sx-tsec" data-state={state} aria-labelledby={`t-sec-${n}`}>
      <header className="sx-tsec-head">
        <span className="sx-tsec-n" aria-hidden="true">
          {state === 'done' ? <Check /> : n}
        </span>
        <h3 id={`t-sec-${n}`}>
          <span className="sx-visually-hidden">{n} </span>
          {title}
        </h3>
        {note ? <span className="sx-tsec-note sx-num">{note}</span> : null}
      </header>
      <div className="sx-tsec-body">{children}</div>
    </section>
  );
}

function ReadyItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li data-ok={ok ? 'true' : undefined}>
      <span aria-hidden="true">{ok ? '✓' : '○'}</span>
      {label}
      <span className="sx-visually-hidden">{ok ? ': done' : ': not yet'}</span>
    </li>
  );
}

/** The route cards, as a keyboard radio group: what the recipient receives and what it costs. */
function RoutePicker({ payment, selected, onSelect }: { payment: PaymentDTO; selected: string | null; onSelect: (quoteId: string) => void }) {
  const ids = payment.cards.map((c) => c.quoteId);
  const ref = useRef<HTMLDivElement>(null);
  function onKey(e: React.KeyboardEvent) {
    const i = selected ? ids.indexOf(selected) : -1;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % ids.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + ids.length) % ids.length;
    if (next >= 0) {
      e.preventDefault();
      onSelect(ids[next]!);
      (ref.current?.querySelectorAll('[role=radio]')[next] as HTMLElement | undefined)?.focus();
    }
  }
  return (
    <div ref={ref} className="sx-routes sx-troutes" role="radiogroup" aria-label="Routes" onKeyDown={onKey}>
      {payment.cards.map((c) => {
        const on = c.quoteId === selected;
        return (
          <button key={c.quoteId} type="button" role="radio" aria-checked={on} tabIndex={on || (!selected && c === payment.cards[0]) ? 0 : -1} className="sx-route" onClick={() => onSelect(c.quoteId)}>
            <span className="sx-route-head">
              <span>{c.label}</span>
              <span className="sx-radio" aria-hidden="true" />
            </span>
            <span className="sx-route-line">Recipient receives</span>
            <span className="sx-route-amount">{php(c.receivePhpMinor)}</span>
            <span className="sx-route-line">
              You pay <span className="sx-num">{usd(c.youPayUsdcMinor)}</span>
            </span>
            <span className="sx-route-line">{c.laneLine}</span>
            <span className="sx-route-line">{c.solNote}</span>
          </button>
        );
      })}
    </div>
  );
}
