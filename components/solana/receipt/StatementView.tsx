// iso-ui
'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';

import { IsoButton } from '@/components/iso';
import { monthLabel } from '@/lib/solana-app/months';
import type { statementFor } from '@/lib/solana-app/statement';
import type { Wire } from '@/lib/solana-app/json';

import { api } from '../client';
import { MytDayTime } from './Myt';

type StatementDTO = Wire<Awaited<ReturnType<typeof statementFor>>>;
/**
 * US dollars as the records hold them (USDC, to the millionth), trailing zeros dropped down to cents:
 * every line, balance and total then adds up exactly. Receipts round the same figures to the cent.
 */
function exactUsd(minor: string | bigint, symbol = true): string {
  const v = BigInt(minor);
  const abs = v < 0n ? -v : v;
  const whole = (abs / 1_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let frac = (abs % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  if (frac.length < 2) frac = frac.padEnd(2, '0');
  return `${v < 0n ? '−' : ''}${symbol ? 'US$' : ''}${whole}.${frac}`;
}

const ACCOUNT_NAME = { payments: 'Payments account', treasury: 'Treasury (Reserve and Investments)', all: 'All accounts' } as const;

/**
 * The monthly statement (prompt 12 §5.5): one A4 page in the receipt's style. The summary, then every
 * line with its receipt and the balance after it, in Malaysia time. Integers from the records,
 * formatted here. An empty month still prints, opening equal to closing.
 */
export function StatementView() {
  const q = useSearchParams();
  const month = q?.get('month') ?? '';
  const account = q?.get('account') ?? 'payments';
  const [s, setS] = useState<StatementDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ statement: StatementDTO }>(`/statement?month=${encodeURIComponent(month)}&account=${encodeURIComponent(account)}`)
      .then((r) => setS(r.statement))
      .catch((e) => setError((e as Error).message));
  }, [month, account]);

  const print = useCallback(() => {
    if (!s) return;
    const before = document.title;
    const restore = () => {
      document.title = before;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    document.title = `Splash statement ${s.month} ${s.account}`;
    window.print();
  }, [s]);

  if (error) {
    return (
      <div className="iso-stack">
        <p className="iso-note iso-note--danger" role="alert">
          {error}
        </p>
        <Link href="/dashboard/history">Back to History</Link>
      </div>
    );
  }
  if (!s) return <div className="iso-skel" style={{ height: 320 }} aria-busy="true" aria-label="Loading the statement" />;

  const sum = s.summary;
  const label = monthLabel(s.month);
  const rows: Array<[string, string, boolean?]> = [
    ['Opening balance', exactUsd(s.openingMinor), true],
    ['Money in', exactUsd(sum.inMinor)],
    ['Payments out', exactUsd(sum.paymentsOutMinor)],
    ['Fees', exactUsd(sum.feesMinor)],
    ...(s.account === 'payments' ? [] : [['Interest booked', exactUsd(sum.interestMinor)] as [string, string]]),
    ['Moves between your accounts', exactUsd(sum.movesMinor)],
    ...(BigInt(sum.resultsMinor) !== 0n ? [['Result on sales, against cost', exactUsd(sum.resultsMinor)] as [string, string]] : []),
    ['Closing balance', exactUsd(s.closingMinor), true],
  ];

  return (
    <div className="iso-receipt">
      <div className="iso-r-actions iso-print-hide">
        <span className="iso-actions">
          <IsoButton variant="primary" onClick={print}>
            <Download size={16} aria-hidden="true" /> Download PDF
          </IsoButton>
          <Link className="iso-btn iso-btn--link" href="/dashboard/history">
            Back to History
          </Link>
        </span>
      </div>
      <article className={s.testMode ? 'iso-a4 iso-a4--test iso-stmt' : 'iso-a4 iso-stmt'} aria-labelledby="stmt-title">
        <div className="iso-a4__brand">
          <span className="iso-a4__logo">
            <Image src="/splash-main-icon.png" alt="" width={48} height={47} />
          </span>
          <strong>Splash</strong>
        </div>
        <h2 id="stmt-title" className="iso-a4__title iso-stmt__title">
          Monthly statement
        </h2>
        <p className="iso-a4__meta iso-stmt__meta">
          <span>{s.companyName}</span>
          <span>{label}</span>
          <span>{ACCOUNT_NAME[s.account]}</span>
          {s.testMode ? <span>Test mode: simulated, no real money moved</span> : null}
        </p>

        <table className="iso-a4__table iso-stmt__summary">
          <caption className="iso-sr">Summary for {label}</caption>
          <tbody>
            {rows.map(([k, v, strong]) => (
              <tr key={k} className={strong ? 'iso-stmt__total' : undefined}>
                <th scope="row">{k}</th>
                <td className="iso-num">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {s.lines.length === 0 ? (
          <p className="iso-stmt__empty">No activity in {label}.</p>
        ) : (
          <table className="iso-a4__table iso-stmt__lines">
            <caption className="iso-sr">Every line in {label}, in Malaysia time</caption>
            <thead>
              <tr>
                <th scope="col">Date (MYT)</th>
                <th scope="col">Description</th>
                <th scope="col">Receipt</th>
                <th scope="col" className="iso-r">
                  In (US$)
                </th>
                <th scope="col" className="iso-r">
                  Out (US$)
                </th>
                <th scope="col" className="iso-r">
                  Balance after (US$)
                </th>
              </tr>
            </thead>
            <tbody>
              {s.lines.map((l) => (
                <tr key={l.id}>
                  <td data-label="Date (MYT)" className="iso-num">
                    <MytDayTime at={l.at} />
                  </td>
                  <td data-label="Description">{l.description}</td>
                  <td data-label="Receipt">
                    {l.receiptId && l.receiptNumber ? (
                      <Link className="iso-mono" href={`/dashboard/receipts/${l.receiptId}`}>
                        {l.receiptNumber}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td data-label="In (US$)" className="iso-num iso-r">
                    {BigInt(l.inMinor) > 0n ? exactUsd(l.inMinor, false) : ''}
                  </td>
                  <td data-label="Out (US$)" className="iso-num iso-r">
                    {BigInt(l.outMinor) > 0n ? exactUsd(l.outMinor, false) : ''}
                  </td>
                  <td data-label="Balance after (US$)" className="iso-num iso-r">
                    {exactUsd(l.balanceAfterMinor, false)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <footer className="iso-a4__foot">
          <span>The accountant posts from this statement and each line’s receipt.</span>
          <span>Figures are US dollars as the records hold them, to the millionth. Receipts show them rounded to the cent.</span>
        </footer>
      </article>
    </div>
  );
}
