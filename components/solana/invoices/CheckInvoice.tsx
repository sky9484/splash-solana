// iso-ui
'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Check, Eye, EyeOff, PhoneCall, TriangleAlert } from 'lucide-react';

import { IsoButton, IsoSurface, Tag, TextField, groupDigits } from '@/components/iso';
import { PageHead } from '@/components/dashboard/PageHead';
import LocalTime from '@/components/LocalTime';
import type { checkView } from '@/lib/solana-app/bills';
import type { Wire } from '@/lib/solana-app/json';

import { api, approveTextWithDevice, existingDeviceKey, php } from '../client';
import type { PaymentDTO } from '../types';
import { useCompany } from '../useCompany';
import { minorFromTyped, problemOf, typedFromMinor, type Problem } from '../transfer/shared';
import { useReveal } from '../transfer/useReveal';
import { DayWords } from './DayWords';
import { transferStep3 } from './PayInvoices';

type CheckDTO = Wire<Awaited<ReturnType<typeof checkView>>>;
type FieldKey = CheckDTO['fields'][number]['key'];

/** The fields a person can correct; the bank account comes from the document only ("Not this one" if it's wrong). */
const EDITABLE: FieldKey[] = ['supplierName', 'invoiceNumber', 'dueDate', 'amountPhpMinor', 'einvoiceRef'];


/**
 * Check the invoice (prompt 10 §6.2, frame Flow-Inv-Check): the document on the left, its lines
 * numbered, the lines each field came from lit in mint and the bank lines in amber, the account number
 * masked in the document too. Zeke's draft on the right: each field with "From line N" and a tick a
 * person gives once they've checked it. New or changed bank details raise the amber panel and hold
 * "Confirm and pay" until the call-back is recorded. Then the payment opens on Transfer's Step 3.
 */
export function CheckInvoice({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const { state } = useCompany();
  const keyId = state.status === 'ready' ? state.company.me.keyId : '';
  const [check, setCheck] = useState<CheckDTO | null>(null);
  const [loadProblem, setLoadProblem] = useState<Problem | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [ticks, setTicks] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [editing, setEditing] = useState<FieldKey | null>(null);
  const [callOpen, setCallOpen] = useState(false);
  const [spokeTo, setSpokeTo] = useState('');
  const [numberCalled, setNumberCalled] = useState('');
  const [callProblem, setCallProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState<null | 'pay' | 'verify' | 'reveal' | 'dismiss'>(null);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [lit, setLit] = useState<number | null>(null);
  const { shown, left, ctl } = useReveal(true);

  const load = useCallback(async () => {
    try {
      const r = await api<{ check: CheckDTO }>(`/invoices/${invoiceId}`);
      setCheck(r.check);
      setValues((v) =>
        Object.keys(v).length > 0
          ? v
          : {
              supplierName: r.check.values.supplierName,
              invoiceNumber: r.check.values.invoiceNumber,
              dueDate: r.check.values.dueDate,
              amountPhpMinor: typedFromMinor(r.check.values.amountPhpMinor, 2),
              einvoiceRef: r.check.values.einvoiceRef ?? '',
            },
      );
    } catch (e) {
      setLoadProblem(problemOf(e));
    }
  }, [invoiceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the check is set when the read answers
    void load();
  }, [load]);

  if (loadProblem) {
    return (
      <div className="iso iso-page">
        <PageHead crumbs={[{ label: 'Invoices', href: '/dashboard/invoices' }, { label: 'Pay an invoice', href: '/dashboard/invoices/pay' }, { label: 'Check' }]} title="Check the invoice" />
        <p className="iso-note iso-note--danger" role="alert">
          {loadProblem.message}
        </p>
        <div>
          <IsoButton variant="quiet" href="/dashboard/invoices/pay">
            Back to your bills
          </IsoButton>
        </div>
      </div>
    );
  }
  if (!check) {
    return (
      <div className="iso iso-page" aria-busy="true">
        <PageHead title="Check the invoice" />
        <div className="iso-skel" style={{ height: 90 }} />
        <div className="iso-skel" style={{ height: 420 }} />
      </div>
    );
  }

  const c = check;
  const panel = c.panel;
  const waitingForCall = Boolean(panel && !panel.verified);
  const amountMinor = minorFromTyped(values.amountPhpMinor ?? '', 2);
  const allTicked = c.fields.every((f) => ticks[f.key]);
  const reason = waitingForCall ? 'Waiting for the call-back above.' : !allTicked ? 'Tick each field once you’ve checked it.' : !amountMinor ? 'Check the amount.' : null;
  const crumbs = [{ label: 'Invoices', href: '/dashboard/invoices' }, { label: 'Pay an invoice', href: '/dashboard/invoices/pay' }, { label: c.number }];

  const setValue = (k: FieldKey, v: string) => {
    setValues((x) => ({ ...x, [k]: v }));
    setTicks((t) => ({ ...t, [k]: false }));
  };

  async function reveal() {
    setBusy('reveal');
    setProblem(null);
    try {
      if (!(await existingDeviceKey(keyId))) throw new Error('This browser can’t approve for you. Use the browser where you set up this device.');
      const ch = await api<{ nonce: string; message: string }>(`/invoices/${invoiceId}/reveal`, { body: { step: 'challenge' } });
      const approval = await approveTextWithDevice(keyId, ch.message);
      const res = await api<{ accountNumber: string; expiresAt: string }>(`/invoices/${invoiceId}/reveal`, { body: { step: 'reveal', nonce: ch.nonce, signature: approval } });
      ctl.show(res.accountNumber, res.expiresAt);
    } catch (e) {
      setProblem(problemOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function markVerified() {
    setBusy('verify');
    setCallProblem(null);
    try {
      await api(`/invoices/${invoiceId}/verify-bank`, { body: { spokeTo: spokeTo.trim(), numberCalled: numberCalled.trim() } });
      setCallOpen(false);
      await load();
    } catch (e) {
      setCallProblem(problemOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function confirmAndPay() {
    if (!amountMinor) return;
    setBusy('pay');
    setProblem(null);
    try {
      const confirmed = c.fields.flatMap((f) => (ticks[f.key] ? (f.key === 'supplierAccountLast4' ? ['supplierBank', 'supplierAccountLast4'] : [f.key]) : []));
      const res = await api<{ payment: PaymentDTO }>(`/invoices/${invoiceId}/pay`, {
        body: {
          fields: {
            supplierName: values.supplierName ?? '',
            invoiceNumber: values.invoiceNumber ?? '',
            dueDate: values.dueDate ?? '',
            amountPhpMinor: amountMinor,
            supplierBank: c.values.supplierBank,
            supplierAccountLast4: c.values.supplierAccountLast4,
            einvoiceRef: values.einvoiceRef ? values.einvoiceRef : null,
          },
          confirmed,
        },
      });
      router.push(transferStep3(res.payment));
    } catch (e) {
      setProblem(problemOf(e));
      setBusy(null);
    }
  }

  async function dismiss() {
    setBusy('dismiss');
    setProblem(null);
    try {
      await api(`/invoices/${invoiceId}/dismiss`, { body: {} });
      router.push('/dashboard/invoices/pay');
    } catch (e) {
      setProblem(problemOf(e));
      setBusy(null);
    }
  }

  const display = (k: FieldKey): ReactNode => {
    if (k === 'amountPhpMinor') return amountMinor ? php(amountMinor) : values.amountPhpMinor || '—';
    if (k === 'dueDate') return <DayWords iso={values.dueDate} />;
    return values[k] || '—';
  };

  return (
    <div className="iso iso-page">
      <PageHead
        crumbs={crumbs}
        title="Check the invoice"
        context={
          <>
            {c.supplierName} · <span className="iso-mono">{c.number}</span> · read by Zeke at <LocalTime value={c.readAt} format="time" options={{ hour: '2-digit', minute: '2-digit', hour12: false }} />. Tick each field once you&rsquo;ve checked it against the document.
          </>
        }
      />

      {panel ? (
        <section className="iso-callout iso-rise" role={panel.verified ? undefined : 'alert'} aria-label="Bank details">
          <span className="iso-callout__icon" aria-hidden="true">
            <TriangleAlert size={22} />
          </span>
          <p className="iso-callout__text">
            <strong>New bank details.</strong>{' '}
            {panel.previous ? (
              <>
                {c.supplierName} used to be paid into {panel.previous.bank} <span className="iso-num">{panel.previous.masked}</span>; this invoice asks for {panel.asked.bank} <span className="iso-num">{panel.asked.masked}</span>.
              </>
            ) : (
              <>
                You haven&rsquo;t paid {c.supplierName} before; this invoice asks for {panel.asked.bank} <span className="iso-num">{panel.asked.masked}</span>.
              </>
            )}{' '}
            Call them on a number you already have, not one on this invoice, and confirm the account before anyone pays it.
          </p>
          {panel.verified ? (
            <Tag tone="ok" tick className="iso-pop">
              {/* One run of text: the tag spaces its children apart. */}
              <span>
                Verified by {panel.verified.by}, <LocalTime value={panel.verified.at} format="time" options={{ hour: '2-digit', minute: '2-digit', hour12: false }} />
                {panel.verified.numberCalled ? <>, on {panel.verified.numberCalled} (from your records)</> : null}
                {panel.verified.spokeTo ? <>. Spoke to {panel.verified.spokeTo}</> : null}
              </span>
            </Tag>
          ) : c.canVerify ? (
            <IsoButton variant="quiet" onClick={() => setCallOpen(true)} aria-expanded={callOpen} aria-controls="ck-call">
              <PhoneCall size={16} aria-hidden="true" /> I called them
            </IsoButton>
          ) : (
            <span className="iso-small">The owner or a finance admin records the call-back.</span>
          )}
        </section>
      ) : null}

      {callOpen && !panel?.verified ? (
        <IsoSurface className="iso-callback iso-pop" aria-labelledby="ck-call-title" id="ck-call">
          <h2 id="ck-call-title" className="iso-h2">
            Record the call-back
          </h2>
          <TextField label="Who you spoke to" value={spokeTo} onChange={setSpokeTo} autoComplete="off" maxLength={80} />
          <TextField label="Number you called" help="From your records, not the invoice." value={numberCalled} onChange={setNumberCalled} inputMode="tel" autoComplete="off" maxLength={24} error={callProblem?.code === 'number_on_invoice' ? callProblem.message : null} />
          <div className="iso-row" style={{ alignSelf: 'end' }}>
            <IsoButton
              variant="primary"
              size="lg"
              busy={busy === 'verify'}
              disabledReason={spokeTo.trim().length < 2 ? 'Say who you spoke to.' : numberCalled.replace(/\D/g, '').length < 6 ? 'Give the number you called.' : null}
              onClick={() => void markVerified()}
            >
              Mark verified
            </IsoButton>
            <IsoButton variant="quiet" size="lg" onClick={() => setCallOpen(false)}>
              Cancel
            </IsoButton>
          </div>
          {callProblem && callProblem.code !== 'number_on_invoice' ? (
            <p className="iso-note iso-note--danger" role="alert">
              {callProblem.message}
            </p>
          ) : null}
        </IsoSurface>
      ) : null}

      {c.suspicious ? (
        <p className="iso-note iso-note--amber" role="note">
          <strong>Zeke flagged this document.</strong> {c.suspiciousReasons.join('. ')}. Check every field against the original.
        </p>
      ) : null}

      <div className="iso-checkgrid">
        <IsoSurface pad={false} className="iso-doc iso-rise iso-rise-2" aria-labelledby="ck-doc">
          <h2 id="ck-doc" className="iso-h2">
            The document
          </h2>
          {c.document ? (
            <>
              <ol className="iso-doc__lines" aria-label="The invoice, line by line">
                {c.document.map((text, i) => {
                  const n = i + 1;
                  const why = c.highlights[String(n)];
                  return (
                    <li key={n} className={`iso-doc__line${why === 'field' ? ' iso-doc__line--field' : why === 'bank' ? ' iso-doc__line--bank' : ''}${lit === n ? ' iso-doc__line--focus' : ''}`} data-line={n}>
                      <span className="iso-doc__no" aria-hidden="true">
                        {n}
                      </span>
                      <span className="iso-doc__text">{text || ' '}</span>
                    </li>
                  );
                })}
              </ol>
              <p className="iso-small" style={{ margin: 0 }}>
                Highlighted lines are where Zeke found each field. The account number stays masked here too.
              </p>
            </>
          ) : (
            <p className="iso-small" style={{ margin: 0 }}>
              This invoice was read before documents were kept with it. Check each field against the original.
            </p>
          )}
        </IsoSurface>

        <IsoSurface pad={false} className="iso-draft iso-rise iso-rise-3" aria-labelledby="ck-draft">
          <div className="iso-draft__head">
            <h2 id="ck-draft" className="iso-h2">
              Zeke&rsquo;s draft
            </h2>
            <Tag tone="ink">AI · you check</Tag>
          </div>
          {c.fields.map((f) => {
            const ticked = Boolean(ticks[f.key]);
            const bank = f.key === 'supplierAccountLast4';
            const editable = EDITABLE.includes(f.key) && !ticked;
            const help = bank
              ? !c.bank.full
                ? 'only the last four digits are kept for this invoice'
                : shown
                  ? `shown for 30 seconds after you approved on your device, then masked again · hidden in 0:${String(left).padStart(2, '0')}`
                  : c.bank.mayReveal
                    ? 'owner and finance admin only, after approving on their device'
                    : 'only the owner or a finance admin can see the full number'
              : f.help.text;
            const labelId = `ck-f-${f.key}`;
            return (
              <div key={f.key} className="iso-checkrow" onMouseEnter={() => setLit(f.line)} onMouseLeave={() => setLit(null)} onFocus={() => setLit(f.line)} onBlur={() => setLit(null)}>
                <span id={labelId} className="iso-checkrow__label">
                  {f.label}
                </span>
                <div className={`iso-checkrow__box${ticked ? ' iso-checkrow__box--ok' : ''}`}>
                  {editing === f.key ? (
                    <input
                      className={`iso-checkrow__input${f.key === 'invoiceNumber' || f.key === 'einvoiceRef' ? ' iso-mono' : ''}`}
                      aria-labelledby={labelId}
                      type={f.key === 'dueDate' ? 'date' : 'text'}
                      inputMode={f.key === 'amountPhpMinor' ? 'decimal' : undefined}
                      value={values[f.key] ?? ''}
                      onChange={(e) => setValue(f.key, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === 'Escape') setEditing(null);
                      }}
                      autoFocus
                    />
                  ) : (
                    <span className="iso-checkrow__value">
                      {bank ? (
                        <>
                          {c.bank.name} <span className={shown ? 'iso-mono' : 'iso-num'} aria-live="polite">{shown ? groupDigits(shown.number) : c.bank.masked}</span>
                        </>
                      ) : f.key === 'amountPhpMinor' ? (
                        <strong className="iso-num">{display(f.key)}</strong>
                      ) : (
                        <span className={f.key === 'invoiceNumber' || f.key === 'einvoiceRef' ? 'iso-mono' : undefined}>{display(f.key)}</span>
                      )}
                    </span>
                  )}
                  <span className="iso-checkrow__acts">
                    {bank && c.bank.full && c.bank.mayReveal ? (
                      shown ? (
                        <button type="button" className="iso-tickbtn" onClick={() => ctl.close()}>
                          <EyeOff size={15} aria-hidden="true" /> Hide
                        </button>
                      ) : (
                        <button type="button" className="iso-tickbtn" aria-busy={busy === 'reveal' || undefined} disabled={busy !== null} onClick={() => void reveal()}>
                          <Eye size={15} aria-hidden="true" /> {busy === 'reveal' ? 'Approving…' : 'Show number'}
                        </button>
                      )
                    ) : null}
                    {editable ? (
                      <button type="button" className="iso-tickbtn" aria-pressed={editing === f.key} onClick={() => setEditing(editing === f.key ? null : f.key)}>
                        {editing === f.key ? 'Done' : 'Change'}
                        <span className="iso-sr"> {f.label}</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="iso-tickbtn"
                      aria-pressed={ticked}
                      aria-label={`${f.label}: ${ticked ? 'checked' : 'mark as checked'}`}
                      onClick={() => {
                        setEditing(null);
                        setTicks((t) => ({ ...t, [f.key]: !ticked }));
                      }}
                    >
                      {ticked ? <Check size={15} strokeWidth={3} aria-hidden="true" /> : null}
                      {ticked ? 'Checked' : 'Tick'}
                    </button>
                  </span>
                </div>
                <span className={`iso-checkrow__help${!bank && f.help.tone === 'amber' ? ' iso-checkrow__help--amber' : ''}`}>
                  {f.line ? `From line ${f.line}` : 'Not found on a line'}
                  {help ? ` · ${help}` : ''}
                </span>
              </div>
            );
          })}

          {problem ? (
            <p className="iso-note iso-note--danger" role="alert">
              {problem.message}
            </p>
          ) : null}

          <div className="iso-draft__acts">
            <IsoButton variant="primary" size="lg" busy={busy === 'pay'} disabledReason={reason} onClick={() => void confirmAndPay()}>
              {busy === 'pay' ? 'Getting a quote…' : 'Confirm and pay'}
            </IsoButton>
            {confirmDismiss ? (
              <span className="iso-row">
                <span className="iso-small">Set this invoice aside? It leaves your inbox.</span>
                <IsoButton variant="quiet" size="sm" busy={busy === 'dismiss'} onClick={() => void dismiss()}>
                  Set it aside
                </IsoButton>
                <IsoButton variant="link" size="sm" onClick={() => setConfirmDismiss(false)}>
                  Keep it
                </IsoButton>
              </span>
            ) : (
              <IsoButton variant="quiet" size="lg" onClick={() => setConfirmDismiss(true)}>
                Not this one
              </IsoButton>
            )}
          </div>
        </IsoSurface>
      </div>
    </div>
  );
}
