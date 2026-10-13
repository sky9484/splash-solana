'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApprovalCard, clock, secondsLeft } from './ApprovalCard';
import { BalanceHeader } from './BalanceHeader';
import { api, ApiError, copyText, existingDeviceKey, pct, php, shareReceiptLink, signPrepared, usd } from './client';
import { InvoiceInbox, LoopStrip } from './InvoiceDesk';
import { ProgressLine } from './ProgressLine';
import { EmptyVaultNotice, ShortfallNotice } from './Shortfall';
import type { CompanyDTO, InvoiceDTO, PaymentDTO } from './types';
import { notifyCompanyChanged, useCompany } from './useCompany';

type Screen = 'start' | 'check' | 'route' | 'approve' | 'progress' | 'done';
/** An invoice Zeke reads (Invoices), or a transfer a person types in (Transfer). The same path after the start. */
export type PayMode = 'invoice' | 'transfer';
type Problem = { code: string; message: string; detail?: Record<string, unknown> };

const FIELD_LABEL: Record<string, string> = {
  invoiceNumber: 'Invoice number',
  supplierName: 'Supplier',
  supplierBank: 'Bank',
  supplierAccountLast4: 'Account ending',
  amountPhpMinor: 'Amount due (PHP)',
  dueDate: 'Due date',
  einvoiceRef: 'MyInvois reference',
};
const FIELD_ORDER = ['supplierName', 'invoiceNumber', 'amountPhpMinor', 'dueDate', 'supplierBank', 'supplierAccountLast4', 'einvoiceRef'];

function centavosToInput(minor: string): string {
  const s = minor.padStart(3, '0');
  const int = s.slice(0, -2).replace(/^0+(?=\d)/, '');
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${s.slice(-2)}`;
}

/** "560,000.00" → "56000000" (centavos), with no floating point. null when not a valid amount. */
function inputToCentavos(input: string): string | null {
  const t = input.replace(/[₱,\s]|PHP/gi, '');
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  return (BigInt(m[1]!) * 100n + BigInt((m[2] ?? '0').padEnd(2, '0'))).toString();
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

const SCREENS_BY_MODE: Record<PayMode, Array<{ key: Screen; label: string; title?: string }>> = {
  invoice: [
    { key: 'start', label: 'Add an invoice', title: 'Add an invoice' },
    { key: 'check', label: 'Check the invoice' },
    { key: 'route', label: 'Choose a route' },
    { key: 'approve', label: 'Approve' },
    { key: 'progress', label: 'Progress' },
    { key: 'done', label: 'Done' },
  ],
  // Nothing to read, so nothing to check: the person types the details and confirms them by sending.
  transfer: [
    { key: 'start', label: 'Recipient and amount', title: 'Who receives it, and how much' },
    { key: 'route', label: 'Choose a route' },
    { key: 'approve', label: 'Approve' },
    { key: 'progress', label: 'Progress' },
    { key: 'done', label: 'Done' },
  ],
};

/** Where a payment picks up when its page is opened again (?payment=…), from its state alone. */
function screenFor(state: string): Screen {
  if (state === 'quoted' || state === 'quote_expired' || state === 'rejected_by_policy') return 'route';
  if (state === 'checked' || state === 'proposed' || state === 'execute_failed') return 'approve';
  if (state === 'evidenced' || state === 'anchored') return 'done';
  if (state === 'draft') return 'start';
  return 'progress';
}

export function PayFlow({ resumePaymentId, quoteInvoiceId, mode = 'invoice' }: { resumePaymentId?: string | null; quoteInvoiceId?: string | null; mode?: PayMode } = {}) {
  const SCREENS = SCREENS_BY_MODE[mode];
  const { state } = useCompany();
  const [screen, setScreen] = useState<Screen>('start');
  const [invoice, setInvoice] = useState<InvoiceDTO | null>(null);
  const [docText, setDocText] = useState('');
  const [payment, setPayment] = useState<PaymentDTO | null>(null);
  const [error, setError] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const now = useNow(screen === 'route' || screen === 'approve');

  const org = state.status === 'ready' ? state.company : null;
  const keyId = org?.me.keyId ?? '';

  // Opened from the overview, history or an approval link: pick the payment up where it is.
  useEffect(() => {
    if (!resumePaymentId || !org) return;
    let stop = false;
    api<{ payment: PaymentDTO }>(`/payments/${resumePaymentId}`)
      .then((res) => {
        if (stop) return;
        setPayment(res.payment);
        setScreen(screenFor(res.payment.state));
      })
      .catch((e) => !stop && setError({ code: e instanceof ApiError ? e.code : 'error', message: (e as Error).message }));
    return () => {
      stop = true;
    };
  }, [resumePaymentId, org?.org.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back from funding the payments vault (?quote=inv_…): quote the same confirmed record again.
  useEffect(() => {
    if (!quoteInvoiceId || resumePaymentId || !org) return;
    let stop = false;
    api<{ payment: PaymentDTO }>('/payments', { body: { invoiceId: quoteInvoiceId } })
      .then((res) => {
        if (stop) return;
        setPayment(res.payment);
        setScreen('route');
      })
      .catch((e) => !stop && setError({ code: e instanceof ApiError ? e.code : 'error', message: (e as Error).message, detail: e instanceof ApiError ? e.detail : undefined }));
    return () => {
      stop = true;
    };
  }, [quoteInvoiceId, org?.org.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((s: Screen) => {
    setScreen(s);
    setError(null);
    requestAnimationFrame(() => headingRef.current?.focus());
  }, []);

  // Progress: poll until the partner reports a final state.
  useEffect(() => {
    if (screen !== 'progress' || !payment) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await api<{ payment: PaymentDTO }>(`/payments/${payment.id}`);
        if (stop) return;
        setPayment(res.payment);
        if ((res.payment.state === 'evidenced' || res.payment.state === 'anchored') && res.payment.receiptId) {
          setTimeout(() => !stop && setScreen('done'), 900);
          notifyCompanyChanged();
          return;
        }
        if (res.payment.state === 'partner_failed' || res.payment.state === 'proposal_failed' || res.payment.state === 'execute_failed') {
          notifyCompanyChanged();
          return;
        }
      } catch {
        /* keep polling; the uncertain state is shown from the payment record */
      }
      if (!stop) setTimeout(tick, 900);
    };
    const t = setTimeout(tick, 700);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [screen, payment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const fail = (e: unknown) => {
    if (e instanceof ApiError) setError({ code: e.code, message: e.message, detail: e.detail });
    else setError({ code: 'error', message: e instanceof Error ? e.message : String(e) });
  };
  // The record a failed quote was for, so "quote again" needs nothing retyped.
  const pendingInvoiceId = invoice?.id ?? (typeof error?.detail?.invoiceId === 'string' ? error.detail.invoiceId : null) ?? quoteInvoiceId ?? null;

  async function readDraft(body: { sample?: boolean; text?: string; source?: 'paste' | 'upload' }) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ invoice: InvoiceDTO; text: string }>('/invoices', { body });
      setInvoice(res.invoice);
      setDocText(res.text);
      setPayment(null);
      go('check');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function getQuote(invoiceId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ payment: PaymentDTO }>('/payments', { body: { invoiceId } });
      setPayment(res.payment);
      go('route');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function requote() {
    if (!payment) return;
    setBusy(true);
    try {
      const res = await api<{ payment: PaymentDTO }>(`/payments/${payment.id}/requote`, { body: {} });
      setPayment(res.payment);
      go('route');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function choose(quoteId: string, rehearsal: string) {
    if (!payment) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ payment: PaymentDTO }>(`/payments/${payment.id}/select`, { body: { quoteId, rehearsal } });
      setPayment(res.payment);
      go('approve');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!payment) return;
    setBusy(true);
    setError(null);
    try {
      if (!org!.me.canApprove) {
        throw new ApiError('not_an_approver', "This device can't approve for your company yet. Finish setup on it, or approve from the device you set up.", 0);
      }
      if (!(await existingDeviceKey(keyId))) {
        throw new ApiError('no_device_key', "This browser doesn't hold your device key. Approve from the browser where you set up this device.", 0);
      }
      const prepared = await api<{ signer: string; messages: Array<{ id: string; purpose: string; messageBase64: string }> }>(`/payments/${payment.id}/prepare`, { body: {} });
      const signatures = await signPrepared(keyId, prepared.messages);
      const res = await api<{ payment: PaymentDTO }>(`/payments/${payment.id}/approve`, { body: { signatures } });
      setPayment(res.payment);
      go('progress');
    } catch (e) {
      fail(e);
      // Refresh the record so the card shows the current policy result.
      try {
        const res = await api<{ payment: PaymentDTO }>(`/payments/${payment.id}`);
        setPayment(res.payment);
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false);
    }
  }

  const at = SCREENS.findIndex((s) => s.key === screen);
  return (
    <div className="sx-stack-lg">
      <div>
        <h2 ref={headingRef} tabIndex={-1} className="sx-flow-title">
          {SCREENS[at]!.title ?? SCREENS[at]!.label}
        </h2>
        <ol className="sx-steps" aria-label="Payment steps" style={{ marginTop: 14 }}>
          {SCREENS.map((s, i) => (
            <li key={s.key} aria-current={i === at ? 'step' : undefined} data-done={i < at ? 'true' : undefined}>
              {i + 1}. {s.label}
            </li>
          ))}
        </ol>
      </div>

      {screen === 'start' && mode === 'invoice' && <StartScreen org={org} busy={busy} error={error} onRead={readDraft} retryInvoiceId={pendingInvoiceId} onRetry={() => pendingInvoiceId && void getQuote(pendingInvoiceId)} />}
      {screen === 'check' && invoice && (
        <CheckScreen
          personName={org.me.personName}
          invoice={invoice}
          docText={docText}
          busy={busy}
          error={error}
          onInvoice={setInvoice}
          onConfirmed={(inv) => {
            setInvoice(inv);
            void getQuote(inv.id);
          }}
          onBack={() => go('start')}
          setBusy={setBusy}
          setError={setError}
        />
      )}
      {screen === 'route' && payment && (
        <RouteScreen
          payment={payment}
          now={now}
          busy={busy}
          error={error}
          offline={org.mode === 'offline'}
          backLabel={mode === 'transfer' ? 'Back to the details' : 'Back to the invoice'}
          onChoose={choose}
          onRefresh={requote}
          onBack={() => go(mode === 'invoice' && invoice ? 'check' : 'start')}
        />
      )}
      {screen === 'approve' && payment?.approval && (
        <div className="sx-stack">
          {payment.problem && (payment.state === 'rejected_by_policy' || payment.state === 'quote_expired') ? <ProblemCard problem={payment.problem} onRefresh={requote} onBack={() => go('route')} onStart={() => go('start')} /> : null}
          <ApprovalCard card={payment.approval} now={now} busy={busy} onApprove={approve} onCancel={() => go('route')} onRefresh={requote} />
          {error ? <ProblemCard problem={error} onRefresh={requote} onBack={() => go('route')} onStart={() => go('start')} /> : null}
        </div>
      )}
      {screen === 'progress' && payment && (
        <section className="sx-card sx-stack" aria-live="polite">
          <h2>
            {payment.state === 'partner_paid' || payment.state === 'evidenced' || payment.state === 'anchored'
              ? 'Paid'
              : payment.state === 'partner_failed'
                ? 'Returned by the partner'
                : 'On its way'}
          </h2>
          <ProgressLine payment={payment} />
          {payment.problem ? (
            <ProblemCard
              problem={payment.problem}
              onRefresh={requote}
              onBack={() => invoice && void getQuote(invoice.id)}
              onStart={() => go('start')}
            />
          ) : (
            <p className="sx-muted sx-small">
              {payment.simulated ? 'Simulated · devnet-ready. ' : ''}
              {payment.partnerLabel} pays the supplier&rsquo;s bank once the USDC arrives at its deposit address.
            </p>
          )}
        </section>
      )}
      {screen === 'done' && payment && <DoneScreen payment={payment} mode={mode} onAnother={() => { setInvoice(null); setPayment(null); go('start'); }} />}

      {screen === 'start' && mode === 'invoice' ? <BalanceHeader balance={org.balance} simulated={org.simulated} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ 1. Start */

function StartScreen({
  org,
  busy,
  error,
  onRead,
  retryInvoiceId,
  onRetry,
}: {
  org: CompanyDTO;
  busy: boolean;
  error: Problem | null;
  onRead: (b: { sample?: boolean; text?: string; source?: 'paste' | 'upload' }) => void;
  retryInvoiceId: string | null;
  onRetry: () => void;
}) {
  const [text, setText] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const noFunds = BigInt(org.balance.totalMinor) === 0n;
  return (
    <div className="sx-stack-lg">
      <LoopStrip org={org} />
      {noFunds ? <EmptyVaultNotice treasuryMinor={org.treasury ? org.treasury.balanceMinor : '0'} /> : null}
      <div className="sx-routes" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <section className="sx-card sx-stack">
          <h2>Upload invoice</h2>
          <p className="sx-muted sx-small">A text file of the invoice. Offline, Zeke reads text only.</p>
          <label className="sx-btn sx-btn-ghost" style={{ display: 'inline-flex', cursor: 'pointer' }}>
            Choose a file
            <input
              type="file"
              accept=".txt,text/plain"
              className="sx-visually-hidden"
              disabled={busy}
              onChange={async (e) => {
                setFileError(null);
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 20_000 || !/text|^$/.test(f.type)) {
                  setFileError("This file isn't plain text. Paste the invoice text instead, or use the sample invoice.");
                  return;
                }
                onRead({ text: await f.text(), source: 'upload' });
              }}
            />
          </label>
          {fileError ? <p className="sx-small" role="alert">{fileError}</p> : null}
        </section>
        <section className="sx-card sx-stack">
          <h2>Paste invoice text</h2>
          <label htmlFor="paste" className="sx-visually-hidden">
            Invoice text
          </label>
          <textarea id="paste" value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 120 }} placeholder="Paste the invoice here" />
          <button type="button" className="sx-btn sx-btn-ghost" disabled={busy || text.trim().length === 0} onClick={() => onRead({ text, source: 'paste' })}>
            Read this invoice
          </button>
        </section>
        <section className="sx-card sx-stack">
          <h2>Use the sample invoice</h2>
          <p className="sx-muted sx-small">Manila Freight Services Inc., ₱560,000.00 for sea freight. A fictional supplier.</p>
          <button type="button" className="sx-btn" disabled={busy} onClick={() => onRead({ sample: true })}>
            {busy ? 'Zeke is reading…' : 'Use the sample invoice'}
          </button>
        </section>
      </div>
      {error && error.code === 'insufficient_balance' ? (
        <ShortfallNotice detail={error.detail} back={`/dashboard/invoices?quote=${retryInvoiceId ?? ''}`} onRetry={retryInvoiceId ? onRetry : undefined} busy={busy} />
      ) : error ? (
        <div className="sx-notice sx-notice-error" role="alert">
          <p>{error.message}</p>
        </div>
      ) : null}
      <InvoiceInbox org={org} />
    </div>
  );
}

/* ------------------------------------------------------------------ 2. Check the invoice */

function CheckScreen({
  personName,
  invoice,
  docText,
  busy,
  error,
  onInvoice,
  onConfirmed,
  onBack,
  setBusy,
  setError,
}: {
  personName: string;
  invoice: InvoiceDTO;
  docText: string;
  busy: boolean;
  error: Problem | null;
  onInvoice: (i: InvoiceDTO) => void;
  onConfirmed: (i: InvoiceDTO) => void;
  onBack: () => void;
  setBusy: (b: boolean) => void;
  setError: (e: Problem | null) => void;
}) {
  const initial = Object.fromEntries(
    FIELD_ORDER.map((k) => {
      const v = (invoice.fields as Record<string, string | null>)[k];
      return [k, k === 'amountPhpMinor' && v ? centavosToInput(v) : (v ?? '')];
    }),
  );
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [verifier, setVerifier] = useState(personName);
  const [method, setMethod] = useState<'call-back' | 'supplier-account'>('call-back');
  const needs = invoice.needsConfirmation as string[];
  const fields = FIELD_ORDER.filter((k) => needs.includes(k) || values[k]);
  const allTicked = needs.every((k) => ticks[k]);
  const amountOk = inputToCentavos(values.amountPhpMinor ?? '') !== null;
  const bankChanged = values.supplierBank !== invoice.fields.supplierBank || values.supplierAccountLast4 !== invoice.fields.supplierAccountLast4;
  const verification = invoice.bankVerification;
  const verifiedForTheseDetails = !!verification && verification.bank === values.supplierBank && verification.accountLast4 === values.supplierAccountLast4;
  const needsVerify = invoice.bankStatus !== 'known' || bankChanged;
  const lines = docText.split('\n');
  const sourceLines = new Set(Object.values(invoice.sources).flatMap((s) => (s && s.line ? [s.line] : [])));

  async function markVerified() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ bankVerification: InvoiceDTO['bankVerification'] }>(`/invoices/${invoice.id}/verify-bank`, {
        body: { by: verifier || personName, method, bank: values.supplierBank, accountLast4: values.supplierAccountLast4 },
      });
      onInvoice({ ...invoice, bankVerification: res.bankVerification });
    } catch (e) {
      setError({ code: 'error', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    const amount = inputToCentavos(values.amountPhpMinor ?? '');
    if (!amount) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        fields: {
          invoiceNumber: values.invoiceNumber ?? '',
          supplierName: values.supplierName ?? '',
          supplierBank: values.supplierBank ?? '',
          supplierAccountLast4: values.supplierAccountLast4 ?? '',
          amountPhpMinor: amount,
          dueDate: values.dueDate ?? '',
          einvoiceRef: values.einvoiceRef ? values.einvoiceRef : null,
        },
        confirmed: Object.keys(ticks).filter((k) => ticks[k]),
      };
      const res = await api<{ confirmed: InvoiceDTO['confirmed'] }>(`/invoices/${invoice.id}/confirm`, { body });
      onConfirmed({ ...invoice, confirmed: res.confirmed });
    } catch (e) {
      setError({ code: 'error', message: (e as Error).message });
      setBusy(false);
    }
  }

  return (
    <div className="sx-split">
      <section aria-labelledby="doc-title">
        <h2 id="doc-title" className="sx-visually-hidden">
          The invoice
        </h2>
        <div className="sx-paper" tabIndex={0} aria-label="Invoice text">
          {lines.map((l, i) => (
            <div key={i}>{sourceLines.has(i + 1) ? <mark>{l || ' '}</mark> : l || ' '}</div>
          ))}
        </div>
        <p className="sx-hint">Highlighted lines are where Zeke found each field.</p>
      </section>

      <section className="sx-card" aria-labelledby="fields-title">
        <h2 id="fields-title">Zeke&rsquo;s draft</h2>
        <p className="sx-muted sx-small" style={{ marginTop: 4 }}>
          Read by Zeke {invoice.extractor === 'offline' ? '(offline reader, no model)' : '(Claude)'}. Check each field and tick it. Nothing is used until you confirm.
        </p>
        {invoice.suspicious ? (
          <div className="sx-notice sx-notice-warn" style={{ marginTop: 12 }} role="alert">
            <h3>Zeke flagged this document</h3>
            <p>{invoice.suspiciousReasons.join('. ')}. Check every field against the original.</p>
          </div>
        ) : null}
        <div style={{ marginTop: 8 }}>
          {fields.map((k) => {
            const src = (invoice.sources as Record<string, { line: number | null; excerpt: string } | null>)[k];
            return (
              <div key={k} className="sx-fieldrow">
                <div>
                  <label htmlFor={`f-${k}`}>{FIELD_LABEL[k]}</label>
                  <input
                    id={`f-${k}`}
                    className={`sx-input${k === 'invoiceNumber' || k === 'supplierAccountLast4' ? ' sx-mono' : ''}`}
                    value={values[k] ?? ''}
                    inputMode={k === 'amountPhpMinor' || k === 'supplierAccountLast4' ? 'decimal' : undefined}
                    onChange={(e) => {
                      setValues((v) => ({ ...v, [k]: e.target.value }));
                      setTicks((t) => ({ ...t, [k]: false }));
                    }}
                    aria-invalid={k === 'amountPhpMinor' && !amountOk ? true : undefined}
                  />
                  {src?.line ? <p className="sx-source">From line {src.line}</p> : null}
                </div>
                {needs.includes(k) ? (
                  <label className="sx-tick" data-on={ticks[k] ? 'true' : undefined}>
                    <input type="checkbox" checked={!!ticks[k]} onChange={(e) => setTicks((t) => ({ ...t, [k]: e.target.checked }))} />
                    Confirm<span className="sx-visually-hidden"> {FIELD_LABEL[k]}</span>
                  </label>
                ) : (
                  <span />
                )}
              </div>
            );
          })}
        </div>

        {needsVerify ? (
          verifiedForTheseDetails ? (
            <div className="sx-notice sx-notice-ok" style={{ marginTop: 16 }}>
              <h3>Bank details verified</h3>
              <p>
                {verification!.method === 'call-back' ? 'Call-back' : "Supplier's account record"} by {verification!.by}.
              </p>
            </div>
          ) : (
            <div className="sx-notice sx-notice-warn sx-stack" style={{ marginTop: 16 }}>
              <div>
                <h3>{invoice.bankStatus === 'changed' ? 'Changed bank details.' : 'New bank details.'} Verify by phone before paying.</h3>
                <p className="sx-small">Call the supplier on a number you already have, not one from this invoice.</p>
              </div>
              <div className="sx-row" style={{ alignItems: 'end' }}>
                <div style={{ flex: '1 1 160px' }}>
                  <label htmlFor="verifier">Verified by</label>
                  <input id="verifier" className="sx-input" value={verifier} onChange={(e) => setVerifier(e.target.value)} />
                </div>
                <div style={{ flex: '1 1 180px' }}>
                  <label htmlFor="method">How</label>
                  <select id="method" value={method} onChange={(e) => setMethod(e.target.value as 'call-back' | 'supplier-account')}>
                    <option value="call-back">Call-back to a known number</option>
                    <option value="supplier-account">Supplier&rsquo;s account record</option>
                  </select>
                </div>
                <button type="button" className="sx-btn sx-btn-ghost" onClick={markVerified} disabled={busy || !values.supplierBank || !/^\d{4}$/.test(values.supplierAccountLast4 ?? '')}>
                  Mark verified
                </button>
              </div>
            </div>
          )
        ) : (
          <div className="sx-notice sx-notice-ok" style={{ marginTop: 16 }}>
            <p>Bank details match your supplier list.</p>
          </div>
        )}

        {error && error.code === 'insufficient_balance' ? (
          <div style={{ marginTop: 16 }}>
            <ShortfallNotice detail={error.detail} back={`/dashboard/invoices?quote=${invoice.id}`} />
          </div>
        ) : error ? (
          <div className="sx-notice sx-notice-error" role="alert" style={{ marginTop: 16 }}>
            <p>{error.message}</p>
          </div>
        ) : null}
        <div className="sx-row" style={{ marginTop: 18 }}>
          <button type="button" className="sx-btn" disabled={busy || !allTicked || !amountOk} onClick={confirm}>
            {busy ? 'Getting quotes…' : 'Confirm and compare routes'}
          </button>
          <button type="button" className="sx-btn-link" onClick={onBack}>
            Back
          </button>
        </div>
        {!allTicked ? <p className="sx-hint">Tick every field to continue.</p> : null}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ 3. Choose a route */

function RouteScreen({
  payment,
  now,
  busy,
  error,
  offline,
  backLabel,
  onChoose,
  onRefresh,
  onBack,
}: {
  payment: PaymentDTO;
  now: number;
  busy: boolean;
  error: Problem | null;
  offline: boolean;
  backLabel: string;
  onChoose: (quoteId: string, rehearsal: string) => void;
  onRefresh: () => void;
  onBack: () => void;
}) {
  const suggested = payment.cards.find((c) => c.policy === 'cheapest') ?? payment.cards[0];
  const [selected, setSelected] = useState<string>(payment.selectedQuoteId ?? suggested?.quoteId ?? '');
  const [rehearsal, setRehearsal] = useState('none');
  const groupRef = useRef<HTMLDivElement>(null);
  const card = payment.cards.find((c) => c.quoteId === selected);
  const left = card ? secondsLeft(card.expiresAt, now) : 0;
  const ids = payment.cards.map((c) => c.quoteId);

  function onKey(e: React.KeyboardEvent) {
    const i = ids.indexOf(selected);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % ids.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + ids.length) % ids.length;
    if (next >= 0) {
      e.preventDefault();
      setSelected(ids[next]!);
      (groupRef.current?.querySelectorAll('[role=radio]')[next] as HTMLElement | undefined)?.focus();
    }
  }

  const home = suggested?.homeLane;
  return (
    <div className="sx-stack-lg">
      <div ref={groupRef} className="sx-routes" role="radiogroup" aria-label="Routes" onKeyDown={onKey}>
        {payment.cards.map((c) => {
          const on = c.quoteId === selected;
          return (
            <button key={c.quoteId} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} className="sx-route" onClick={() => setSelected(c.quoteId)}>
              <span className="sx-route-head">
                <span>{c.label}</span>
                <span className="sx-radio" aria-hidden="true" />
              </span>
              <span className="sx-route-line">{payment.approval?.kind === 'transfer' || payment.invoice.source === 'transfer' ? 'Recipient receives' : 'Supplier receives'}</span>
              <span className="sx-route-amount">{php(c.receivePhpMinor)}</span>
              <span className="sx-route-line">
                {c.arrives} · all-in {pct(c.allInBps)}
              </span>
              <span className="sx-route-line">{c.laneLine}</span>
              <span className="sx-route-line">
                You pay <span className="sx-num">{usd(c.youPayUsdcMinor)}</span>. {c.solNote}.
              </span>
              {c.aboveTarget ? <span className="sx-pill sx-pill-warn">Above the 0.33% target</span> : null}
            </button>
          );
        })}
      </div>

      <div className="sx-zeke sx-stack">
        <p>
          <strong>Zeke suggests {payment.zeke.suggests}. You choose.</strong>
        </p>
        <p className="sx-muted sx-small">Zeke&rsquo;s note (draft): {payment.zeke.primary}</p>
        {home?.applied ? <p className="sx-small">Solana route chosen by the home-lane rule.</p> : null}
      </div>

      {offline ? (
        <div className="sx-card-quiet sx-stack">
          <label htmlFor="rehearsal">Rehearse a problem (offline only)</label>
          <select id="rehearsal" value={rehearsal} onChange={(e) => setRehearsal(e.target.value)} style={{ maxWidth: 420 }}>
            <option value="none">No problem: the normal path</option>
            <option value="kyt_flag">Screening flags the supplier&rsquo;s wallet</option>
            <option value="partner_return">The partner returns the payment</option>
          </select>
        </div>
      ) : null}

      {error ? <ProblemCard problem={error} onRefresh={onRefresh} onBack={onBack} onStart={onBack} /> : null}

      <div className="sx-row">
        {card && left > 0 ? (
          <button type="button" className="sx-btn" disabled={busy || !card} onClick={() => onChoose(selected, rehearsal)}>
            {busy ? 'Checking your rules…' : `Review ${card.label.toLowerCase()} route`}
          </button>
        ) : (
          <button type="button" className="sx-btn" onClick={onRefresh} disabled={busy}>
            Quote expired, refresh
          </button>
        )}
        {card ? <span className="sx-small sx-muted sx-num">Quote expires in {clock(left)}</span> : null}
        <button type="button" className="sx-btn-link" onClick={onBack}>
          {backLabel}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 6. Done */

export function DoneScreen({ payment, mode, onAnother }: { payment: PaymentDTO; mode: PayMode; onAnother: () => void }) {
  const [copied, setCopied] = useState(false);
  const c = payment.invoice.confirmed;
  const link = payment.receiptId ? `/dashboard/receipts/${payment.receiptId}` : null;
  return (
    <div className="sx-stack-lg">
      <section className="sx-card sx-stack">
        <h2>
          Paid. {c?.supplierName} received {php(payment.approval?.receivePhpMinor ?? '0')}.
        </h2>
        <ProgressLine payment={payment} />
      </section>
      <section className="sx-card sx-evidence" aria-labelledby="ev-title">
        <div className="sx-stack">
          <div className="sx-row">
            <h2 id="ev-title">Evidence</h2>
            {payment.simulated ? <span className="sx-pill sx-pill-sim">Simulated · devnet-ready</span> : null}
          </div>
          <p>
            One record for this payment: the confirmed {payment.invoice.source === 'transfer' ? 'transfer details' : 'invoice'} (as a salted commitment), your approval, the transfer, the
            partner&rsquo;s signed reports and the rate.
          </p>
          <EvidenceStatus receiptId={payment.receiptId} />
        </div>
        <div className="sx-evidence-actions">
          {link ? (
            <>
              <a className="sx-btn" href={`/api/solana/receipts/${payment.receiptId}/pack`} download>
                Download evidence pack
              </a>
              <button
                type="button"
                className="sx-btn sx-btn-ghost"
                onClick={async () => {
                  try {
                    setCopied(await copyText(await shareReceiptLink(payment.receiptId!)));
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? 'Auditor link copied' : 'Share with auditor'}
              </button>
              <Link className="sx-btn sx-btn-ghost" href={link}>
                Open receipt
              </Link>
            </>
          ) : null}
        </div>
      </section>
      <button type="button" className="sx-btn-link" onClick={onAnother}>
        {mode === 'transfer' ? 'Make another transfer' : 'Pay another invoice'}
      </button>
    </div>
  );
}

function EvidenceStatus({ receiptId }: { receiptId: string | null }) {
  const [anchor, setAnchor] = useState<{ status: string; simulated: boolean } | null>(null);
  useEffect(() => {
    if (!receiptId) return;
    void api<{ receipt: { anchor: { status: string; simulated: boolean } } }>(`/receipts/${receiptId}`).then((r) => setAnchor(r.receipt.anchor)).catch(() => setAnchor(null));
  }, [receiptId]);
  if (!anchor) return null;
  return anchor.status === 'anchored' ? (
    <p>
      <span className="sx-pill sx-pill-ok">Anchored</span> {anchor.simulated ? 'Anchored in the simulator (memo), not on a network.' : 'Anchored on Solana devnet.'}
    </p>
  ) : (
    <p>
      <span className="sx-pill sx-pill-pending">Recorded, anchor pending</span>
    </p>
  );
}

/* ------------------------------------------------------------------ 7. Problems */

export function ProblemCard({
  problem,
  onRefresh,
  onBack,
  onStart,
}: {
  problem: { code: string; message: string };
  onRefresh: () => void;
  onBack: () => void;
  onStart: () => void;
}) {
  const action = (() => {
    switch (problem.code) {
      case 'quote_expired':
        return (
          <button type="button" className="sx-btn sx-btn-sm" onClick={onRefresh}>
            Refresh the quote
          </button>
        );
      case 'partner_returned':
        return (
          <div className="sx-row">
            <button type="button" className="sx-btn sx-btn-sm" onClick={onBack}>
              Retry
            </button>
            <button type="button" className="sx-btn-link" onClick={onStart}>
              Pay another way
            </button>
          </div>
        );
      case 'uncertain':
        return <p className="sx-small">Retry stays off until the payment reaches a final state.</p>;
      case 'kyt_flagged':
      case 'duplicate_invoice':
        return (
          <button type="button" className="sx-btn-link" onClick={onStart}>
            Back to start
          </button>
        );
      case 'bank_unverified':
        return (
          <button type="button" className="sx-btn-link" onClick={onStart}>
            Start again and verify the bank details
          </button>
        );
      default:
        return (
          <button type="button" className="sx-btn-link" onClick={onBack}>
            Back
          </button>
        );
    }
  })();
  const tone = problem.code === 'uncertain' || problem.code === 'quote_expired' || problem.code === 'partner_returned' || problem.code === 'bank_unverified' ? 'sx-notice-warn' : 'sx-notice-error';
  return (
    <div className={`sx-notice ${tone} sx-stack`} role="alert">
      <p>{problem.message}</p>
      {action}
    </div>
  );
}
