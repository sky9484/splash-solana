// iso-ui
'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Plus, Search, X } from 'lucide-react';

import { IsoBlock, IsoButton, IsoSurface, Morph, ScrollRegion, Segmented, Sheet, Tag, TextField } from '@/components/iso';
import { PageHead } from '@/components/dashboard/PageHead';
import type { Wire } from '@/lib/solana-app/json';
import type { requestRow, requestsView } from '@/lib/solana-app/requests';

import { api, copyText, usd } from '../client';
import { countryName, minorFromTyped, problemOf, type Payee, type Problem } from '../transfer/shared';
import { DayWords } from './DayWords';
import { INV_TYPES } from './InvoicesChooser';

type RequestsDTO = Wire<ReturnType<typeof requestsView>>;
type Row = Wire<ReturnType<typeof requestRow>>;
type Who = 'splash' | 'external';
interface LineDraft {
  key: number;
  description: string;
  quantity: string;
  unit: string;
}

const REQUEST_ID = /^req_[0-9a-f]{16}$/;
const DAY_MS = 86_400_000;
/** A date some days from today, as the date field holds it (YYYY-MM-DD). */
const dayFromToday = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);


/** A line's amount in US$ minor units (6 decimals): quantity × unit price, integers only. Null until both are valid. */
function lineMinor(l: LineDraft): bigint | null {
  const unit = minorFromTyped(l.unit, 6);
  if (!unit || !/^\d{1,6}$/.test(l.quantity) || l.quantity === '0') return null;
  return BigInt(l.quantity) * BigInt(unit);
}

let lineKey = 0;
const newLine = (): LineDraft => ({ key: ++lineKey, description: '', quantity: '1', unit: '' });

/**
 * Get paid (prompt 10 §6.3, frame Flow-Inv-GetPaid): the requests this company sent, and the composer
 * with a live preview in the receipt style (on a phone, Edit and Preview tabs). A business on Splash
 * finds the request in its own inbox, ready to pay; anyone else gets a link. The money always lands in
 * this company's own Payments account.
 */
export function GetPaid() {
  const params = useSearchParams();
  const [data, setData] = useState<RequestsDTO | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [openId, setOpenId] = useState<string | null>(() => {
    const raw = params.get('request');
    return raw && REQUEST_ID.test(raw) ? raw : null;
  });

  const load = useCallback(async () => {
    try {
      setData(await api<RequestsDTO>('/requests'));
    } catch (e) {
      setProblem(problemOf(e));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the list is set when the read answers
    void load();
  }, [load]);

  const open = data?.requests.find((r) => r.id === openId) ?? null;

  return (
    <div className="iso iso-page">
      <PageHead
        crumbs={[{ label: 'Invoices', href: '/dashboard/invoices', prefetch: true, types: INV_TYPES }, { label: 'Get paid' }]}
        title="Get paid"
        context="Money always lands in your own Payments account. Businesses on Splash pay in the app; anyone else pays from a link."
        actions={
          <IsoButton variant="quiet" href="/dashboard/invoices/pay">
            Switch to Pay an invoice
          </IsoButton>
        }
      />

      {problem ? (
        <p className="iso-note iso-note--danger" role="alert">
          {problem.message}
        </p>
      ) : null}

      <Morph name="iso-inv-get">
        <IsoSurface className="iso-stack iso-rise iso-rise-2" aria-labelledby="gp-list">
          <div className="iso-row" style={{ justifyContent: 'space-between' }}>
            <h2 id="gp-list" className="iso-h2">
              Requests
            </h2>
            {data && data.unpaidCount > 0 ? (
              <span className="iso-small iso-num">
                Unpaid <strong>{usd(data.unpaidMinor)}</strong>
                {data.overdueCount > 0 ? ` · ${data.overdueCount} overdue` : ''}
              </span>
            ) : null}
          </div>
          {!data ? (
            <div className="iso-skel" style={{ height: 120 }} aria-busy="true" />
          ) : data.requests.length === 0 ? (
            <p className="iso-empty">No requests yet. Make one below: a business on Splash pays in the app, anyone else from a link.</p>
          ) : (
            <ScrollRegion label="Requests">
              <table className="iso-table iso-table--stack">
                <thead>
                  <tr>
                    <th scope="col">Invoice</th>
                    <th scope="col">Payer</th>
                    <th scope="col" className="iso-r">
                      Amount
                    </th>
                    <th scope="col">Due</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="iso-sr">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.requests.map((r) => (
                    <tr key={r.id}>
                      <td className="iso-mono">{r.number}</td>
                      <td data-label="Payer">
                        <strong>{r.payer.name}</strong>
                        <span className="iso-bill__from">{r.payer.detail}</span>
                      </td>
                      <td className="iso-r iso-num" data-label="Amount">
                        <strong>{usd(r.amountMinor)}</strong>
                      </td>
                      <td className="iso-num" data-label="Due">
                        {r.dueLabel}
                      </td>
                      <td data-label="Status">
                        <Tag tone={r.status.tone} tick={r.status.tone === 'ok'}>
                          {r.status.label}
                        </Tag>
                      </td>
                      <td className="iso-r iso-table__act">
                        {r.receiptHref ? (
                          <Link className="iso-row-btn" href={r.receiptHref}>
                            Receipt<span className="iso-sr"> for {r.number}</span>
                          </Link>
                        ) : (
                          <button type="button" className="iso-row-btn" onClick={() => setOpenId(r.id)}>
                            {r.status.key === 'overdue' ? 'Remind' : r.status.key === 'draft' ? 'Send' : 'Open'}
                            <span className="iso-sr"> {r.number}</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
        </IsoSurface>
      </Morph>

      <Composer company={data?.companyName ?? ''} hasAccount={data?.hasAccount ?? true} onMade={(id) => void load().then(() => setOpenId(id))} />

      <RequestSheet request={open} onClose={() => setOpenId(null)} onChanged={() => void load()} />
    </div>
  );
}

/* ── The composer ─────────────────────────────────────────────────────── */

function Composer({ company, hasAccount, onMade }: { company: string; hasAccount: boolean; onMade: (id: string) => void }) {
  const [who, setWho] = useState<Who>('splash');
  const [payee, setPayee] = useState<Payee | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [number, setNumber] = useState('');
  const [due, setDue] = useState(() => dayFromToday(14));
  const [lines, setLines] = useState<LineDraft[]>(() => [newLine()]);
  const [myInvois, setMyInvois] = useState('');
  const [note, setNote] = useState('');
  const [pane, setPane] = useState<'edit' | 'preview'>('edit');
  const [busy, setBusy] = useState<null | 'send' | 'draft'>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  const amounts = lines.map(lineMinor);
  const total = amounts.every((a) => a !== null) ? amounts.reduce<bigint>((n, a) => n + (a ?? 0n), 0n) : null;
  const payerName = who === 'splash' ? (payee?.name ?? null) : name.trim() || null;
  const reason = !hasAccount
    ? 'Set up your Payments account first: a request is paid into it.'
    : who === 'splash' && !payee
      ? 'Choose the business that pays.'
      : who === 'external' && (name.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()))
        ? 'Give the payer’s name and email.'
        : !/^[A-Za-z0-9][A-Za-z0-9/.-]{0,31}$/.test(number.trim())
          ? 'Give your invoice number (letters, digits, - / .).'
          : lines.some((l) => l.description.trim().length < 2)
            ? 'Describe each line.'
            : total === null || total === 0n
              ? 'Give each line a quantity and a price.'
              : null;

  const setLine = (key: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function make(send: boolean) {
    setBusy(send ? 'send' : 'draft');
    setProblem(null);
    try {
      const res = await api<{ request: Row }>('/requests', {
        body: {
          payer: who === 'splash' ? { kind: 'splash', payerOrgId: payee!.orgId } : { kind: 'external', name: name.trim(), email: email.trim() },
          number: number.trim(),
          dueDate: due,
          lines: lines.map((l) => ({ description: l.description.trim(), quantity: l.quantity, unitMinor: minorFromTyped(l.unit, 6) ?? '0' })),
          myInvoisRef: myInvois.trim() || null,
          note: note.trim() || null,
          send,
        },
      });
      setNumber('');
      setLines([newLine()]);
      setMyInvois('');
      setNote('');
      setPane('edit');
      onMade(res.request.id);
    } catch (e) {
      setProblem(problemOf(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <IsoSurface hero pad={false} className={`iso-composer iso-composer--${pane} iso-rise iso-rise-3`} aria-labelledby="gp-new">
      <div className="iso-composer__tabs" style={{ gridColumn: '1 / -1' }}>
        <Segmented
          label="Edit or preview the request"
          options={[
            { value: 'edit', label: 'Edit' },
            { value: 'preview', label: 'Preview' },
          ]}
          value={pane}
          onChange={setPane}
        />
      </div>
      <div className="iso-composer__form">
        <h2 id="gp-new" className="iso-h2">
          New request
        </h2>
        <div className="iso-stack" style={{ gap: 8 }}>
          <span className="iso-field__label" id="gp-who">
            Who pays
          </span>
          <Segmented
            label="Who pays"
            options={[
              { value: 'splash', label: 'A business on Splash' },
              { value: 'external', label: 'Someone else' },
            ]}
            value={who}
            onChange={setWho}
          />
        </div>
        {who === 'splash' ? (
          <BusinessPicker payee={payee} onPayee={setPayee} />
        ) : (
          <>
            <div className="iso-composer__pair iso-composer__pair--people">
              <TextField label="Name" value={name} onChange={setName} autoComplete="organization" maxLength={120} />
              <TextField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" maxLength={254} />
            </div>
            <p className="iso-small" style={{ margin: 0 }}>
              You send them a link to a page with your account details. It never shows a Splash address.
            </p>
          </>
        )}
        <div className="iso-composer__pair">
          <TextField label="Your invoice number" value={number} onChange={setNumber} autoComplete="off" spellCheck={false} maxLength={32} />
          <TextField label="Due date" type="date" value={due} onChange={setDue} />
        </div>
        <fieldset className="iso-fieldset">
          <legend className="iso-field__label">Lines</legend>
          <div className="iso-reqlines">
            {lines.map((l, i) => {
              const a = amounts[i];
              return (
                <div key={l.key} className="iso-reqline" role="group" aria-label={`Line ${i + 1}`}>
                  <TextField label="Description" value={l.description} onChange={(v) => setLine(l.key, { description: v })} maxLength={120} />
                  <TextField label="Qty" value={l.quantity} onChange={(v) => setLine(l.key, { quantity: v.replace(/\D/g, '').slice(0, 6) })} inputMode="numeric" />
                  <TextField label="Unit price (US$)" value={l.unit} onChange={(v) => setLine(l.key, { unit: v.replace(/[^\d.,]/g, '') })} inputMode="decimal" />
                  {lines.length > 1 ? (
                    <button type="button" className="iso-iconbtn" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      <X size={18} aria-hidden="true" />
                    </button>
                  ) : (
                    <span />
                  )}
                  <p className="iso-reqline__amount" aria-live="polite">
                    {a ? `= ${usd(a)}` : ' '}
                  </p>
                </div>
              );
            })}
          </div>
          <div>
            <IsoButton variant="link" size="sm" disabledReason={lines.length >= 20 ? 'A request has at most 20 lines.' : null} onClick={() => setLines((ls) => [...ls, newLine()])}>
              <Plus size={16} aria-hidden="true" /> Add a line
            </IsoButton>
          </div>
        </fieldset>
        <TextField label="MyInvois reference (optional)" help="Kept with the request. Splash doesn’t submit it for you." value={myInvois} onChange={setMyInvois} autoComplete="off" spellCheck={false} maxLength={64} />
        <TextField label="Note (optional)" help="On the request and its receipt." value={note} onChange={setNote} maxLength={280} />
        {problem ? (
          <p className="iso-note iso-note--danger" role="alert">
            {problem.message}
          </p>
        ) : null}
        <div className="iso-stack" style={{ gap: 8 }}>
          <div className="iso-row">
            <IsoButton variant="primary" size="lg" busy={busy === 'send'} disabled={Boolean(reason)} aria-describedby={reason ? 'gp-why' : undefined} onClick={() => void make(true)}>
              {busy === 'send' ? 'Sending…' : 'Send request'}
            </IsoButton>
            <IsoButton variant="quiet" busy={busy === 'draft'} disabled={Boolean(reason)} aria-describedby={reason ? 'gp-why' : undefined} onClick={() => void make(false)}>
              Save draft
            </IsoButton>
          </div>
          {reason ? (
            <span id="gp-why" className="iso-btn-why">
              {reason}
            </span>
          ) : null}
        </div>
      </div>
      <Preview company={company} payerName={payerName} onSplash={who === 'splash'} number={number.trim()} due={due} lines={lines} amounts={amounts} total={total} />
    </IsoSurface>
  );
}

function Preview({ company, payerName, onSplash, number, due, lines, amounts, total }: { company: string; payerName: string | null; onSplash: boolean; number: string; due: string; lines: LineDraft[]; amounts: Array<bigint | null>; total: bigint | null }) {
  return (
    <aside className="iso-reqpreview" aria-label="Preview of the request">
      <div className="iso-reqpreview__head">
        <span className="iso-reqpreview__who">
          <Image src="/splash-main-icon.png" alt="" width={26} height={26} />
          {company || 'Your company'}
        </span>
        <Tag tone="ink">Preview</Tag>
      </div>
      <span className="iso-small">
        asks <strong>{payerName ?? (onSplash ? 'the business you choose' : 'your customer')}</strong> to pay
      </span>
      <span className="iso-reqpreview__amount">{usd(total ?? 0n)}</span>
      <dl>
        <dt>Invoice</dt>
        <dd className="iso-mono">{number || '—'}</dd>
        <dt>Due</dt>
        <dd><DayWords iso={due} /></dd>
        {lines.map((l, i) =>
          l.description.trim() ? (
            <div key={l.key} style={{ display: 'contents' }}>
              <dt>
                {l.description.trim()}
                {l.quantity && l.quantity !== '1' ? ` × ${l.quantity}` : ''}
              </dt>
              <dd>{amounts[i] ? usd(amounts[i]!) : '—'}</dd>
            </div>
          ) : null,
        )}
      </dl>
      <span className="iso-btn iso-btn--primary iso-reqpreview__cta" aria-hidden="true">
        {onSplash ? 'Pay in Splash' : 'Pay from a crypto wallet'}
      </span>
      <span className="iso-small">The money lands in {company ? `${company}’s` : 'your'} own account. Splash never holds it.</span>
    </aside>
  );
}

/** "A business on Splash": search the directory (name, @handle or registration number), choose one. */
function BusinessPicker({ payee, onPayee }: { payee: Payee | null; onPayee: (p: Payee | null) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Payee[] | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a short query shows nothing, at once
      setHits(null);
      return;
    }
    let stop = false;
    const t = window.setTimeout(async () => {
      try {
        const res = await api<{ results: Payee[] }>(`/directory?q=${encodeURIComponent(term)}`);
        if (!stop) {
          setHits(res.results);
          setProblem(null);
        }
      } catch (e) {
        if (!stop) setProblem(problemOf(e));
      }
    }, 250);
    return () => {
      stop = true;
      window.clearTimeout(t);
    };
  }, [q]);

  if (payee) {
    return (
      <div className="iso-stack" style={{ gap: 6 }}>
        <span className="iso-field__label">Business</span>
        <div className="iso-recips__row iso-recips__row--on" style={{ border: '1.5px solid var(--mint)' }}>
          <IsoBlock glyph="business" size={40} />
          <div className="iso-list__main">
            <div className="iso-list__title">{payee.name}</div>
            <div className="iso-list__detail">{[countryName(payee.country), payee.handle ? `@${payee.handle}` : null].filter(Boolean).join(' · ')}</div>
          </div>
          <Tag tone="ok" tick>
            Verified
          </Tag>
          <IsoButton variant="link" size="sm" onClick={() => onPayee(null)}>
            Change<span className="iso-sr"> business</span>
          </IsoButton>
        </div>
        <span className="iso-field__help">It lands in their &ldquo;Pay an invoice&rdquo; inbox, ready to pay. No Splash fee between Splash businesses.</span>
      </div>
    );
  }
  return (
    <div className="iso-stack" style={{ gap: 10 }}>
      <TextField label="Find the business on Splash" help="By name, Splash handle or registration number." value={q} onChange={setQ} type="search" autoComplete="off" spellCheck={false} end={<Search size={18} aria-hidden="true" className="iso-field__icon" />} />
      {problem ? (
        <p className="iso-note iso-note--danger" role="alert">
          {problem.message}
        </p>
      ) : null}
      {hits && hits.length > 0 ? (
        <ul className="iso-list iso-recips" aria-label="Businesses on Splash">
          {hits.map((h) => (
            <li key={h.orgId}>
              <div className="iso-recips__row">
                <IsoBlock glyph="business" size={40} />
                <div className="iso-list__main">
                  <div className="iso-list__title">{h.name}</div>
                  <div className="iso-list__detail">{[countryName(h.country), h.handle ? `@${h.handle}` : null].filter(Boolean).join(' · ') || 'A verified business on Splash'}</div>
                </div>
                <IsoButton variant="quiet" size="sm" aria-label={`Ask ${h.name} to pay`} onClick={() => onPayee(h)}>
                  Choose
                </IsoButton>
              </div>
            </li>
          ))}
        </ul>
      ) : hits && q.trim().length >= 2 ? (
        <p className="iso-small" style={{ margin: 0 }}>
          No business on Splash matches. Choose &ldquo;Someone else&rdquo; to send them a link instead.
        </p>
      ) : null}
    </div>
  );
}

/* ── One request ──────────────────────────────────────────────────────── */

function RequestSheet({ request, onClose, onChanged }: { request: Row | null; onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<null | 'remind' | 'send' | 'cancel'>(null);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const r = request;
  const link = useMemo(() => (r?.link && typeof window !== 'undefined' ? `${window.location.origin}${r.link}` : null), [r?.link]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- another request starts fresh */
    setNote(null);
    setProblem(null);
    setConfirmCancel(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [r?.id]);

  if (!r) return null;

  async function act(action: 'remind' | 'send' | 'cancel') {
    setBusy(action);
    setProblem(null);
    setNote(null);
    try {
      const res = await api<{ request: Row; channel?: 'inbox' | 'link' }>(`/requests/${r!.id}/${action}`, { body: {} });
      if (action === 'remind') {
        if (res.channel === 'link' && res.request.link) {
          const copied = await copyText(`${window.location.origin}${res.request.link}`);
          setNote(copied ? `Link copied. Send it to ${r!.payer.name} again; Splash doesn’t email it for you.` : 'Copy the link below and send it to them again.');
        } else setNote(`Reminder sent. ${r!.payer.name} sees it on the request in their inbox.`);
      }
      if (action === 'send') setNote(res.request.link ? `Request ready. Copy the link and send it to ${r!.payer.name}.` : `Sent. It’s in ${r!.payer.name}’s inbox, ready to pay.`);
      onChanged();
      if (action === 'cancel') onClose();
    } catch (e) {
      setProblem(problemOf(e));
    } finally {
      setBusy(null);
    }
  }

  const sent = r.status.key === 'sent' || r.status.key === 'viewed' || r.status.key === 'overdue';
  return (
    <Sheet
      open={Boolean(r)}
      onClose={onClose}
      title={`Request ${r.number}`}
      footer={
        <>
          {r.status.key === 'draft' ? (
            <IsoButton variant="primary" busy={busy === 'send'} onClick={() => void act('send')}>
              Send request
            </IsoButton>
          ) : null}
          {sent ? (
            <IsoButton variant="primary" busy={busy === 'remind'} onClick={() => void act('remind')}>
              Remind {r.payer.name}
            </IsoButton>
          ) : null}
          <IsoButton variant="quiet" onClick={onClose}>
            Close
          </IsoButton>
        </>
      }
    >
      <dl className="iso-dl iso-dl--rows iso-num">
        <div>
          <dt>Payer</dt>
          <dd>
            {r.payer.name} · {r.payer.kind === 'splash' ? 'a business on Splash' : r.payer.email}
          </dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd>
            <strong>{usd(r.amountMinor)}</strong>
          </dd>
        </div>
        <div>
          <dt>Due</dt>
          <dd><DayWords iso={r.dueDate} /></dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <Tag tone={r.status.tone} tick={r.status.tone === 'ok'}>
              {r.status.label}
            </Tag>
            {r.reminders > 0 ? <span className="iso-small"> · {r.reminders === 1 ? '1 reminder' : `${r.reminders} reminders`}</span> : null}
          </dd>
        </div>
        {r.lines.map((l, i) => (
          <div key={i}>
            <dt>{l.quantity === '1' ? l.description : `${l.description} × ${l.quantity}`}</dt>
            <dd>{usd(l.amountMinor)}</dd>
          </div>
        ))}
        {r.myInvoisRef ? (
          <div>
            <dt>MyInvois reference</dt>
            <dd className="iso-mono">{r.myInvoisRef}</dd>
          </div>
        ) : null}
        {r.note ? (
          <div>
            <dt>Note</dt>
            <dd>{r.note}</dd>
          </div>
        ) : null}
      </dl>
      {r.link && link ? (
        <div className="iso-stack" style={{ gap: 8 }}>
          <span className="iso-field__label">Pay link</span>
          <div className="iso-paypage__acct">
            <code>{link}</code>
          </div>
          <div className="iso-row">
            <IsoButton variant="quiet" size="sm" onClick={async () => setNote((await copyText(link)) ? 'Link copied.' : 'Copy the link above.')}>
              <Copy size={16} aria-hidden="true" /> Copy link
            </IsoButton>
            <a className="iso-small" href={`${r.link}?preview=1`} target="_blank" rel="noreferrer">
              See the page they see
            </a>
          </div>
        </div>
      ) : null}
      {note ? (
        <p className="iso-note iso-note--ok" role="status">
          {note}
        </p>
      ) : null}
      {problem ? (
        <p className="iso-note iso-note--danger" role="alert">
          {problem.message}
        </p>
      ) : null}
      {r.status.key !== 'paid' && r.status.key !== 'cancelled' ? (
        confirmCancel ? (
          <div className="iso-row">
            <span className="iso-small">Cancel this request? {r.payer.kind === 'external' ? 'Its link stops working.' : 'It leaves their inbox.'}</span>
            <IsoButton variant="quiet" size="sm" busy={busy === 'cancel'} onClick={() => void act('cancel')}>
              Cancel request
            </IsoButton>
            <IsoButton variant="link" size="sm" onClick={() => setConfirmCancel(false)}>
              Keep it
            </IsoButton>
          </div>
        ) : (
          <div>
            <IsoButton variant="link" size="sm" onClick={() => setConfirmCancel(true)}>
              Cancel this request
            </IsoButton>
          </div>
        )
      ) : null}
    </Sheet>
  );
}
