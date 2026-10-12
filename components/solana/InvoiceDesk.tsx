'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { dateShort, php } from './client';
import { StatusPill } from './StatusPill';
import type { CompanyDTO } from './types';

type Row = CompanyDTO['payments'][number];

/**
 * The invoice loop: every supplier invoice moves through the same five stations, from Zeke reading it
 * to the proof on Solana. The earlier "inspection loop" (intake, Walrus proof, Seal access, Zeke draft,
 * payment intent) is the same idea; here each station is a real step of the pay flow, counted from
 * the company's own records.
 */
export const LOOP = [
  { key: 'read', label: 'Read by Zeke', hint: 'Zeke drafts every field, with the line it came from.' },
  { key: 'checked', label: 'Checked by a person', hint: 'Each field ticked, bank details verified.' },
  { key: 'approved', label: 'Approved on a device', hint: 'One approval, signed with your device key.' },
  { key: 'paid', label: 'Paid to the bank', hint: 'The payout partner pays in pesos.' },
  { key: 'proof', label: 'Proof anchored', hint: 'Encrypted on Walrus, anchored on Solana.' },
] as const;

/** How far round the loop a payment has come (0 = read … 4 = proof anchored). */
export function loopStation(state: string): number {
  if (['approved', 'executed', 'confirmed', 'execute_failed', 'partner_failed'].includes(state)) return 2;
  if (state === 'partner_paid' || state === 'evidenced' || state === 'evidence_failed') return 3;
  if (state === 'anchored') return 4;
  return 1; // confirmed by a person, quoted or waiting for approval
}

const FILTERS: Array<{ key: string; label: string; test: (p: Row) => boolean }> = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'waiting', label: 'Waiting for approval', test: (p) => p.awaitingApproval },
  { key: 'paid', label: 'Paid with proof', test: (p) => p.state === 'evidenced' || p.state === 'anchored' },
  { key: 'problem', label: 'Needs attention', test: (p) => p.problem !== null || ['quote_expired', 'rejected_by_policy', 'proposal_failed', 'execute_failed', 'partner_failed', 'evidence_failed'].includes(p.state) },
];

/** The five stations with the company's counts. A station lights once anything has reached it. */
export function LoopStrip({ org }: { org: CompanyDTO }) {
  const invoices = org.payments.filter((p) => p.kind === 'invoice');
  const reached = (n: number) => invoices.filter((p) => loopStation(p.state) >= n).length;
  const counts = [org.invoices.read, org.invoices.confirmed, reached(2), reached(3), reached(4)];
  const furthest = counts.reduce((at, c, i) => (c > 0 ? i : at), -1);
  return (
    <section className="sx-loop" aria-labelledby="loop-title">
      <div className="sx-row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 id="loop-title">The invoice loop</h2>
        <p className="sx-small sx-muted">Every invoice, the same five stations. Zeke drafts; a person checks and approves.</p>
      </div>
      <ol className="sx-loop-track" style={{ ['--p' as string]: furthest <= 0 ? 0 : furthest / (LOOP.length - 1) }}>
        {LOOP.map((s, i) => (
          <li key={s.key} data-on={counts[i]! > 0 ? 'true' : undefined}>
            <span className="sx-loop-node" aria-hidden="true">
              {i + 1}
            </span>
            <span className="sx-loop-count sx-num">{counts[i]}</span>
            <span className="sx-loop-label">{s.label}</span>
            <span className="sx-loop-hint">{s.hint}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Every invoice the company has paid or is paying, where it stands on the loop, and what to do next. */
export function InvoiceInbox({ org }: { org: CompanyDTO }) {
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const rows = useMemo(() => org.payments.filter((p) => p.kind === 'invoice'), [org.payments]);
  const test = FILTERS.find((f) => f.key === filter)!.test;
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((p) => test(p) && (!needle || p.supplierName.toLowerCase().includes(needle) || (p.invoiceNumber ?? '').toLowerCase().includes(needle)));

  return (
    <section className="sx-stack" aria-labelledby="inbox-title">
      <div className="sx-row" style={{ justifyContent: 'space-between' }}>
        <h2 id="inbox-title">Invoices</h2>
        {rows.length > 0 ? (
          <div className="sx-inbox-search">
            <label htmlFor="inbox-q" className="sx-visually-hidden">
              Search invoices
            </label>
            <input id="inbox-q" className="sx-input" type="search" placeholder="Supplier or invoice number" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <div className="sx-card-quiet">
          <p>No invoices yet. Add your first supplier invoice above: Zeke reads it, you check every field, then you pay it from your vault.</p>
        </div>
      ) : (
        <>
          <div className="sx-segmented" role="group" aria-label="Show">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label} <span className="sx-num sx-muted">{rows.filter(f.test).length}</span>
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="sx-muted">Nothing here for this filter.</p>
          ) : (
            <ul className="sx-inbox">
              {shown.map((p) => {
                const at = loopStation(p.state);
                const open = p.receiptId ? `/dashboard/receipts/${p.receiptId}` : `/dashboard/invoices?payment=${p.id}`;
                return (
                  <li key={p.id}>
                    <div className="sx-inbox-who">
                      <strong>{p.supplierName || 'Supplier'}</strong>
                      <span className="sx-small sx-muted">
                        <span className="sx-mono">{p.invoiceNumber ?? 'No number'}</span>
                        {p.dueDate ? ` · due ${dateShort(p.dueDate)}` : ''} · added {dateShort(p.createdAt)}
                      </span>
                    </div>
                    <span className="sx-inbox-amount sx-num">{php(p.amountPhpMinor)}</span>
                    <span className="sx-mini-loop" role="img" aria-label={`${LOOP[at]!.label} (${at + 1} of ${LOOP.length})`}>
                      {LOOP.map((s, i) => (
                        <i key={s.key} data-on={i <= at ? 'true' : undefined} />
                      ))}
                    </span>
                    <span className="sx-inbox-state">
                      <StatusPill state={p.state} label={p.stateLabel} />
                    </span>
                    <Link className="sx-inbox-open" href={open}>
                      {p.receiptId ? 'Receipt' : p.awaitingApproval ? 'Approve' : 'Open'}
                      <span className="sx-visually-hidden"> {p.supplierName} {p.invoiceNumber}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
