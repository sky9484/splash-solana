'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import { Tag } from '@/components/iso/Tag';
import { stationLabel, stationOf, STATIONS, type StationId } from '@/lib/solana-app/stations';

import { dateShort, payHref, php, timeShort, usd } from './client';
import { DiscardButton } from './DiscardButton';
import { StatusPill } from './StatusPill';
import type { CompanyDTO } from './types';
import { useCompany } from './useCompany';

type Row = CompanyDTO['payments'][number];
type TreasuryRow = CompanyDTO['treasuryOrders'][number];

/** A treasury order in History's words. T-bills are subscribed and redeemed; stocks are bought and sold. */
function orderWords(o: TreasuryRow): { what: string; where: string } {
  const what = o.kind === 'subscribe' ? 'Subscribed to US Treasury bills' : o.kind === 'redeem' ? 'Redeemed US Treasury bills' : o.kind === 'buy' ? `Bought ${o.name}` : `Sold ${o.name}`;
  const where = o.landsIn === 'investments' ? 'into your Investments account' : o.landsIn === 'payments' ? 'into your Payments account' : 'by bank wire to your company’s bank account';
  return { what, where };
}
type Filter = 'all' | 'waiting' | 'moving' | 'paid' | 'problem';

const FILTERS: Array<{ key: Filter; label: string; test: (p: Row) => boolean }> = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'waiting', label: 'Waiting for approval', test: (p) => p.awaitingApproval },
  { key: 'moving', label: 'On its way', test: (p) => ['approved', 'executed', 'confirmed', 'partner_paid'].includes(p.state) },
  { key: 'paid', label: 'Paid with proof', test: (p) => p.state === 'evidenced' || p.state === 'anchored' },
  { key: 'problem', label: 'Needs attention', test: (p) => p.problem !== null || ['quote_expired', 'rejected_by_policy', 'proposal_failed', 'execute_failed', 'partner_failed', 'evidence_failed'].includes(p.state) },
];

/** CSV with integers as written (no rounding, no floats): what an accountant pastes into a ledger. */
function toCsv(rows: Row[]): string {
  const head = ['payment_id', 'kind', 'created_at', 'supplier', 'invoice_or_reference', 'amount_php_minor', 'you_pay_usdc_minor', 'state', 'execute_signature', 'receipt_id'];
  const cell = (v: string | null) => {
    const s = v ?? '';
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [head.join(','), ...rows.map((p) => [p.id, p.kind, p.createdAt, p.supplierName, p.invoiceNumber, p.amountPhpMinor, p.youPayUsdcMinor, p.state, p.execute?.signature ?? null, p.receiptId].map(cell).join(','))].join('\n');
}

/**
 * Every payment, in the state machine's words (prompt 07 §6.2: history and transfers merged): where it
 * is, the transaction that moved the money (on Solscan when it is on a network), and its receipt.
 */
export function History() {
  const { state } = useCompany();
  const [filter, setFilter] = useState<Filter>('all');
  // Overview's pipeline opens History at one station (?station=sent): where those payments are now.
  const param = useSearchParams()?.get('station') ?? null;
  const station = STATIONS.some((s) => s.id === param) ? (param as StationId) : null;
  const rows = useMemo(() => (state.status === 'ready' ? state.company.payments : []), [state]);
  const orders = state.status === 'ready' ? state.company.treasuryOrders : [];
  const shown = rows.filter(FILTERS.find((f) => f.key === filter)!.test).filter((p) => !station || stationOf(p.state, p.paymentKind) === station);

  if (state.status === 'loading') return <p className="sx-muted">Loading payments…</p>;
  if (state.status !== 'ready') {
    return (
      <div className="sx-notice sx-notice-error" role="alert">
        <p>{state.message}</p>
      </div>
    );
  }

  function download() {
    const blob = new Blob([toCsv(shown)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `splash-payments-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="sx-stack-lg">
      {station ? (
        <p className="sx-notice" role="status">
          Showing payments at <strong>{stationLabel(station)}</strong>.{' '}
          <Link href="/dashboard/history">Show all payments</Link>
        </p>
      ) : null}
      <div className="sx-row" style={{ justifyContent: 'space-between' }}>
        <div className="sx-segmented" role="group" aria-label="Show payments">
          {FILTERS.map((f) => {
            const count = rows.filter(f.test).length;
            return (
              <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label} <span className="sx-num">({count})</span>
              </button>
            );
          })}
        </div>
        <button type="button" className="sx-btn sx-btn-ghost" onClick={download} disabled={shown.length === 0}>
          Download CSV
        </button>
      </div>

      {shown.length === 0 ? (
        <section className="sx-card sx-stack">
          <p className="sx-muted">{rows.length === 0 ? 'No payments yet.' : 'No payments match this filter.'}</p>
          {rows.length === 0 ? (
            <div>
              <Link className="sx-btn" href="/dashboard/invoices">
                Pay an invoice
              </Link>{' '}
              <Link className="sx-btn sx-btn-ghost" href="/dashboard/transfer">
                Transfer
              </Link>
            </div>
          ) : null}
        </section>
      ) : (
        <div className="sx-card sx-table-wrap bg-white">
          <table className="sx-table">
            <caption className="sx-visually-hidden">Payments, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Paid to</th>
                <th scope="col" className="sx-num-col">
                  They receive
                </th>
                <th scope="col" className="sx-num-col">
                  You paid
                </th>
                <th scope="col">State</th>
                <th scope="col">
                  <span className="sx-visually-hidden">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.supplierName || 'Supplier'}</strong>{' '}
                    <span className="sx-chip">{p.kind === 'transfer' ? 'Transfer' : 'Invoice'}</span>
                    <span className="sx-small sx-muted" style={{ display: 'block' }}>
                      {p.invoiceNumber ?? 'Invoice not confirmed'} · {dateShort(p.createdAt)} {timeShort(p.createdAt)}
                    </span>
                  </td>
                  {/* A business on Splash gets US$, exactly what was sent; a bank gets pesos. */}
                  <td className="sx-num-col" data-label="They receive">{p.paymentKind === 'peer' ? (p.youPayUsdcMinor ? usd(p.youPayUsdcMinor) : '—') : php(p.amountPhpMinor)}</td>
                  <td className="sx-num-col" data-label="You paid">{p.youPayUsdcMinor ? usd(p.youPayUsdcMinor) : <span className="sx-muted">No route yet</span>}</td>
                  <td>
                    <StatusPill state={p.state} label={p.stateLabel} />
                    {p.problem ? (
                      <span className="sx-small" style={{ display: 'block', marginTop: 4 }}>
                        {p.problem.message}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {p.receiptId ? (
                      <Link href={`/dashboard/receipts/${p.receiptId}`}>
                        Receipt<span className="sx-visually-hidden"> for {p.supplierName}</span>
                      </Link>
                    ) : (
                      <Link href={payHref(p)}>
                        {p.awaitingApproval ? 'Approve' : 'Open'}
                        <span className="sx-visually-hidden"> the payment to {p.supplierName}</span>
                      </Link>
                    )}
                    {p.discardable ? (
                      <span style={{ display: 'block', marginTop: 4 }}>
                        <DiscardButton paymentId={p.id} name={p.supplierName || 'the supplier'} />
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {orders.length > 0 && filter === 'all' && !station ? (
        <section className="sx-card sx-stack" aria-labelledby="history-treasury">
          <h2 id="history-treasury">Treasury</h2>
          <ul className="sx-stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {orders.map((o) => {
              const w = orderWords(o);
              return (
                <li key={o.id} className="sx-row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span>
                    <strong>{w.what}</strong> <Tag tone="gold">{o.sweep ? 'Treasury · sweep' : 'Treasury'}</Tag>
                    <span className="sx-small sx-muted" style={{ display: 'block' }}>
                      {w.where} · {dateShort(o.at)} {timeShort(o.at)}
                    </span>
                  </span>
                  <span className="sx-row" style={{ gap: 12 }}>
                    <span className="sx-num">{usd(o.amountMinor)}</span>
                    {o.receiptId ? (
                      <Link href={`/dashboard/receipts/${o.receiptId}`}>
                        Receipt<span className="sx-visually-hidden"> for {w.what}</span>
                      </Link>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
