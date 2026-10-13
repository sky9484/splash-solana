'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { dateShort, payHref, php, shortKey, timeShort, usd } from './client';
import { DiscardButton } from './DiscardButton';
import { StatusPill } from './StatusPill';
import type { CompanyDTO } from './types';
import { useCompany } from './useCompany';

type Row = CompanyDTO['payments'][number];
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
  const rows = useMemo(() => (state.status === 'ready' ? state.company.payments : []), [state]);
  const shown = rows.filter(FILTERS.find((f) => f.key === filter)!.test);

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
                <th scope="col">Supplier</th>
                <th scope="col" className="sx-num-col">
                  Supplier receives
                </th>
                <th scope="col" className="sx-num-col">
                  From your vault
                </th>
                <th scope="col">State</th>
                <th scope="col">Transfer</th>
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
                  <td className="sx-num-col" data-label="Supplier receives">{php(p.amountPhpMinor)}</td>
                  <td className="sx-num-col" data-label="From your vault">{p.youPayUsdcMinor ? usd(p.youPayUsdcMinor) : <span className="sx-muted">No route yet</span>}</td>
                  <td>
                    <StatusPill state={p.state} label={p.stateLabel} />
                    {p.problem ? (
                      <span className="sx-small" style={{ display: 'block', marginTop: 4 }}>
                        {p.problem.message}
                      </span>
                    ) : null}
                  </td>
                  <td data-label="Transfer">
                    {p.execute ? (
                      p.execute.solscanUrl ? (
                        <a href={p.execute.solscanUrl} target="_blank" rel="noreferrer">
                          <span className="sx-mono">{shortKey(p.execute.signature, 5)}</span>
                          <span className="sx-visually-hidden"> on Solscan (opens in a new tab)</span>
                        </a>
                      ) : (
                        <span className="sx-mono" title={p.execute.signature}>
                          {shortKey(p.execute.signature, 5)} <span className="sx-muted">(simulated)</span>
                        </span>
                      )
                    ) : (
                      <span className="sx-muted">Not sent</span>
                    )}
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
    </div>
  );
}
