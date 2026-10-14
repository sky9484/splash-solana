// iso-ui
'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { FileUp, ClipboardPaste } from 'lucide-react';

import { IsoButton, IsoSurface, Morph, ScrollRegion, Tabs, Tag, tabPanelProps, type TabItem } from '@/components/iso';
import { PageHead } from '@/components/dashboard/PageHead';
import type { BillRow, BillTab } from '@/lib/solana-app/bills';
import type { Wire } from '@/lib/solana-app/json';

import { api, php, usd } from '../client';
import type { PaymentDTO } from '../types';
import { problemOf, type Problem } from '../transfer/shared';
import { CheckInvoice } from './CheckInvoice';

type Row = Wire<BillRow>;
interface BillsDTO {
  rows: Row[];
  counts: Record<BillTab, number>;
}

const INVOICE_ID = /^inv_[0-9a-f]{16}$/;
const TABS: Array<{ id: BillTab; label: string; empty: string }> = [
  { id: 'check', label: 'To check', empty: 'Nothing to check. Drop an invoice above, or use the sample invoice.' },
  { id: 'ready', label: 'Ready to pay', empty: 'Nothing is ready to pay. Check an invoice and it lands here.' },
  { id: 'waiting', label: 'Waiting for approval', empty: 'Nothing is waiting for approval.' },
  { id: 'paid', label: 'Paid', empty: 'Nothing paid yet. Paid bills land here with their receipts.' },
];
/** Text files only today (prompt 10 §6.2): PDFs and photos are coming soon. */
const MAX_TEXT_BYTES = 20_000;

/** A payment opens on Transfer's Step 3: one engine, one approval card. */
export function transferStep3(p: Pick<PaymentDTO, 'id' | 'kind'>): string {
  return `/dashboard/transfer?to=${p.kind === 'peer' ? 'splash' : 'bank'}&step=quote&payment=${p.id}`;
}

/**
 * Pay an invoice (prompt 10 §6.2, frame Flow-Inv-Pay): one wide drop zone in the hero wash with Zeke's
 * note beside it, then the bills by status. `?invoice=` opens "Check the invoice" on one bill.
 */
export function PayInvoices() {
  const params = useSearchParams();
  const raw = params.get('invoice');
  const invoiceId = raw && INVOICE_ID.test(raw) ? raw : null;
  if (invoiceId) return <CheckInvoice key={invoiceId} invoiceId={invoiceId} />;
  return <Inbox />;
}

function Inbox() {
  const router = useRouter();
  const [bills, setBills] = useState<BillsDTO | null>(null);
  const [tab, setTab] = useState<BillTab | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState<null | 'read' | string>(null);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState('');
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const b = await api<BillsDTO>('/invoices');
      setBills(b);
      // Open on the first tab with something in it.
      setTab((t) => t ?? TABS.find((x) => b.counts[x.id] > 0)?.id ?? 'check');
    } catch (e) {
      setProblem(problemOf(e));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the list is set when the read answers
    void load();
  }, [load]);

  async function read(body: { sample?: boolean; text?: string; source?: 'paste' | 'upload' }) {
    setBusy('read');
    setProblem(null);
    try {
      const res = await api<{ invoice: { id: string } }>('/invoices', { body });
      router.push(`/dashboard/invoices/pay?invoice=${res.invoice.id}`);
    } catch (e) {
      setProblem(problemOf(e));
      setBusy(null);
    }
  }

  async function readFile(f: File | undefined) {
    if (!f) return;
    if (!/^text\/|^$/.test(f.type) || f.size > MAX_TEXT_BYTES) {
      setProblem({ code: 'unsupported_file', message: f.size > MAX_TEXT_BYTES ? 'That file is too long for a text invoice. Paste the invoice’s text instead.' : 'PDFs and photos are coming soon. Paste the invoice’s text, or use a text file.' });
      return;
    }
    await read({ text: await f.text(), source: 'upload' });
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    void readFile(e.dataTransfer.files?.[0]);
  }

  async function pay(r: Row) {
    setBusy(r.id);
    setProblem(null);
    try {
      const res = await api<{ payment: PaymentDTO }>(`/invoices/${r.id}/pay`, { body: {} });
      router.push(transferStep3(res.payment));
    } catch (e) {
      setProblem(problemOf(e));
      setBusy(null);
    }
  }

  const items: Array<TabItem<BillTab>> = TABS.map((t) => ({ id: t.id, label: t.label, count: bills ? bills.counts[t.id] : null }));
  const current = tab ?? 'check';
  const rows = bills?.rows.filter((r) => r.tab === current) ?? [];
  const reading = busy === 'read';

  return (
    <div className="iso iso-page">
      <PageHead
        crumbs={[{ label: 'Invoices', href: '/dashboard/invoices' }, { label: 'Pay an invoice' }]}
        title="Pay an invoice"
        context="Zeke reads each invoice and shows where every field came from. You check it, then approve the payment."
        actions={
          <IsoButton variant="quiet" href="/dashboard/invoices/get">
            Switch to Get paid
          </IsoButton>
        }
      />

      <Morph name="iso-inv-pay">
        <IsoSurface hero pad={false} className="iso-paydesk iso-rise iso-rise-2" aria-labelledby="pi-drop">
          <div
            className={`iso-drop${over ? ' iso-drop--over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            <FileUp className="iso-drop__icon" size={28} aria-hidden="true" />
            <h2 id="pi-drop" className="iso-drop__title">
              Drop an invoice, or paste its text
            </h2>
            <p className="iso-small" style={{ margin: 0 }}>
              Text files and pasted text today. PDFs and photos are coming soon.
            </p>
            {pasting ? (
              <div className="iso-drop__paste">
                <label className="iso-field__label" htmlFor="pi-paste">
                  The invoice&rsquo;s text
                </label>
                <textarea id="pi-paste" value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_TEXT_BYTES} spellCheck={false} />
                <div className="iso-drop__acts">
                  <IsoButton variant="primary" busy={reading} disabledReason={text.trim().length === 0 ? 'Paste the invoice first.' : null} onClick={() => void read({ text, source: 'paste' })}>
                    {reading ? 'Zeke is reading…' : 'Read this invoice'}
                  </IsoButton>
                  <IsoButton variant="quiet" onClick={() => setPasting(false)}>
                    Cancel
                  </IsoButton>
                </div>
              </div>
            ) : (
              <div className="iso-drop__acts">
                <IsoButton variant="primary" busy={reading} onClick={() => fileInput.current?.click()}>
                  Choose a file
                </IsoButton>
                <IsoButton variant="quiet" onClick={() => setPasting(true)}>
                  <ClipboardPaste size={16} aria-hidden="true" /> Paste text
                </IsoButton>
                <IsoButton variant="quiet" busy={reading} onClick={() => void read({ sample: true })}>
                  {reading ? 'Zeke is reading…' : 'Use the sample invoice'}
                </IsoButton>
                <input ref={fileInput} type="file" accept=".txt,text/plain" className="iso-sr" tabIndex={-1} aria-hidden="true" onChange={(e) => void readFile(e.target.files?.[0])} />
              </div>
            )}
          </div>
          <div className="iso-zekenote">
            <Image className="iso-bob" src="/cinematic/agent-bot-cut.png" alt="" width={92} height={92} />
            <strong>Zeke reads; you check.</strong>
            <p>It reads with no tools, so a document can&rsquo;t make it do anything. New bank details always wait for a phone call-back.</p>
            <p className="iso-small">Forward invoices by email · coming soon</p>
          </div>
        </IsoSurface>
      </Morph>

      {problem ? (
        <p className="iso-note iso-note--danger" role="alert">
          {problem.message}
        </p>
      ) : null}

      <IsoSurface className="iso-stack iso-rise iso-rise-3" aria-labelledby="pi-inbox">
        <h2 id="pi-inbox" className="iso-h2">
          Bills
        </h2>
        <Tabs label="Bills by status" prefix="bills" items={items} value={current} onChange={setTab} />
        <div {...tabPanelProps('bills', current)}>
          {!bills ? (
            <div className="iso-skel" style={{ height: 120 }} aria-busy="true" />
          ) : rows.length === 0 ? (
            <p className="iso-empty">{TABS.find((t) => t.id === current)!.empty}</p>
          ) : (
            <ScrollRegion label="Bills">
              <table className="iso-table iso-table--stack">
                <thead>
                  <tr>
                    <th scope="col">Supplier</th>
                    <th scope="col">Invoice</th>
                    <th scope="col">Due</th>
                    <th scope="col" className="iso-r">
                      Amount
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="iso-sr">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.supplier}</strong>
                        {r.from === 'splash' ? <span className="iso-bill__from">on Splash</span> : null}
                      </td>
                      <td className="iso-mono" data-label="Invoice">
                        {r.number}
                      </td>
                      <td data-label="Due">{r.due.tone ? <Tag tone={r.due.tone}>{r.due.label}</Tag> : <span className="iso-num">{r.due.label}</span>}</td>
                      <td className="iso-r iso-num" data-label="Amount">
                        <strong>{r.amount.currency === 'USD' ? usd(r.amount.minor) : php(r.amount.minor)}</strong>
                      </td>
                      <td data-label="Status">
                        <Tag tone={r.status.tone} tick={r.status.tone === 'ok'}>
                          {r.status.label}
                        </Tag>
                      </td>
                      <td className="iso-r iso-table__act">
                        {r.action.kind === 'pay' ? (
                          <button type="button" className="iso-row-btn" disabled={busy !== null} aria-busy={busy === r.id || undefined} onClick={() => void pay(r)}>
                            {busy === r.id ? 'Getting a quote…' : r.action.label}
                            <span className="iso-sr"> {r.supplier}</span>
                          </button>
                        ) : r.action.href ? (
                          <Link className="iso-row-btn" href={r.action.href}>
                            {r.action.label}
                            <span className="iso-sr"> {r.supplier} {r.number}</span>
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
        </div>
      </IsoSurface>
    </div>
  );
}
