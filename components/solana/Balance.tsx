// iso-ui
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, Plus } from 'lucide-react';

import { IsoButton, IsoDisplay, IsoSurface, ScrollRegion, Tag, TestModeBadge } from '@/components/iso';
import { PageHead } from '@/components/dashboard/PageHead';
import { INVOICE_LINKS } from '@/lib/dashboard/links';
import type { Balance as BalanceData } from '@/lib/solana-app/balance';
import type { Wire } from '@/lib/solana-app/json';

import { BalanceWalletCard } from './BalanceWalletCard';
import { api, ApiError, usd } from './client';
import { AddMoneySheet } from './transfer/AddMoneySheet';

export type BalanceDTO = Wire<BalanceData>;

const CHANGED = 'splash-company-changed';
const big = (s: string) => BigInt(s);

/** "+US$25,000.00", "−US$5,012.50". */
function signed(minor: string): string {
  const v = big(minor);
  return v < 0n ? usd(v) : `+${usd(v)}`;
}

/**
 * Balance (prompt 10 §5.10, frame Flow-Balance): what you can pay with today, and how to add more.
 * Every figure comes from one read (GET /api/solana/balance, lib/solana-app/balance.ts). The account
 * ID and the approval setup are in Settings › Account details, not here.
 */
export function Balance() {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: BalanceDTO }>({ status: 'loading' });
  const [adding, setAdding] = useState<null | 'bank_card' | 'wallet'>(null);
  const [opened, setOpened] = useState(0);

  const load = useCallback(async () => {
    try {
      setState({ status: 'ready', data: await api<BalanceDTO>('/balance') });
    } catch (e) {
      setState({ status: 'error', message: e instanceof ApiError ? e.message : 'Your balance did not load. Try again.' });
    }
  }, []);

  useEffect(() => {
    // Read after mount and whenever the company changes; the state is set when the read answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const onChange = () => void load();
    window.addEventListener(CHANGED, onChange);
    return () => window.removeEventListener(CHANGED, onChange);
  }, [load]);

  const add = (way: 'bank_card' | 'wallet') => {
    setOpened((n) => n + 1);
    setAdding(way);
  };

  if (state.status === 'loading') {
    return (
      <div className="iso iso-page" aria-busy="true">
        <PageHead title="Balance" />
        <div className="iso-skel" style={{ height: 240 }} />
        <div className="iso-skel" style={{ height: 200 }} />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="iso iso-page">
        <PageHead title="Balance" />
        <p className="iso-note iso-note--danger" role="alert">
          {state.message}{' '}
          <button type="button" className="iso-btn iso-btn--link" onClick={() => void load()}>
            Try again
          </button>
        </p>
      </div>
    );
  }
  const d = state.data;
  const payments = big(d.paymentsMinor);
  const waiting = big(d.waitingMinor);
  return (
    <div className="iso iso-page">
      <PageHead
        title="Balance"
        context="What you can pay with today, and how to add more. Only your team can move it."
        actions={
          <>
            <IsoButton variant="quiet" href="/dashboard/treasury">
              <ArrowLeftRight size={16} aria-hidden="true" /> Move between accounts
            </IsoButton>
            <IsoButton variant="primary" onClick={() => add('bank_card')}>
              <Plus size={16} aria-hidden="true" /> Add money
            </IsoButton>
          </>
        }
      />

      <IsoSurface hero className="iso-rise iso-rise-2 iso-money iso-balance" aria-labelledby="bal-payments">
        <div className="iso-money__lead" style={{ ['--chars' as string]: usd(payments).length }}>
          <h2 id="bal-payments" className="iso-money__label">
            Payments account
          </h2>
          <IsoDisplay size="xl">{usd(payments)}</IsoDisplay>
          <p className="iso-money__sentence">
            {payments === 0n ? (
              <>Nothing here yet. Add money below to pay your first supplier.</>
            ) : waiting > 0n ? (
              <>
                <strong>{usd(waiting)}</strong> is waiting for your approval. After it, <strong>{usd(d.freeMinor)}</strong> is free to pay with.
              </>
            ) : (
              <>Nothing is waiting for approval. All of it is free to pay with.</>
            )}
          </p>
        </div>
        {payments > 0n ? (
          <div className="iso-stack" style={{ gap: 8 }}>
            <div className="iso-bar" role="img" aria-label={`Free ${usd(d.freeMinor)}, waiting ${usd(d.waitingMinor)}`}>
              {d.bar.freePct !== '0' ? <span className="iso-fill-teal" style={{ width: `${d.bar.freePct}%` }} /> : null}
              {d.bar.waitingPct !== '0' ? <span className="iso-fill-coral" style={{ width: `${d.bar.waitingPct}%` }} /> : null}
            </div>
            <p className="iso-small iso-num iso-row" style={{ margin: 0 }}>
              <span>
                <i aria-hidden="true" className="iso-swatch iso-fill-teal iso-swatch--inline" /> Free {usd(d.freeMinor)}
              </span>
              <span>
                <i aria-hidden="true" className="iso-swatch iso-fill-coral iso-swatch--inline" /> Waiting {usd(d.waitingMinor)}
              </span>
            </p>
          </div>
        ) : null}
        <div className="iso-balance__links">
          <Link href="/dashboard/treasury" className="iso-balance__link">
            <span>Reserve, kept for what&rsquo;s due</span>
            <strong className="iso-num">{usd(d.reserveMinor)}</strong>
          </Link>
          <Link href="/dashboard/treasury" className="iso-balance__link">
            <span>
              Investments <TestModeBadge inline />
            </span>
            <strong className="iso-num">{d.investmentsSetUp ? usd(d.investmentsMinor) : 'Not set up yet'}</strong>
          </Link>
        </div>
      </IsoSurface>

      <section className="iso-stack iso-rise iso-rise-3" aria-labelledby="bal-add">
        <div className="iso-row" style={{ justifyContent: 'space-between' }}>
          <h2 id="bal-add" className="iso-h2">
            Add money
          </h2>
          <span className="iso-small">Splash fee to add money: US$0. It only ever lands in your own account.</span>
        </div>
        <div className="iso-addcards">
          <IsoSurface pad className="iso-stack iso-addcard" aria-labelledby="bal-topup">
            <TestModeBadge />
            <h3 id="bal-topup" className="iso-h3">
              Bank or card top-up
            </h3>
            <p className="iso-small" style={{ margin: 0 }}>
              Pay US dollars in from your company bank account or card. It lands in your Payments account.
            </p>
            {/* One button style for the row (prompt 12 B10): all quiet, the header's Add money being the page's one primary. */}
            <div className="iso-addcard__act">
              <IsoButton variant="quiet" onClick={() => add('bank_card')}>
                Top up
              </IsoButton>
            </div>
          </IsoSurface>
          <BalanceWalletCard onChoose={() => add('wallet')} />
          <IsoSurface pad className="iso-stack iso-addcard" aria-labelledby="bal-customer">
            <Tag tone="ink">From a customer</Tag>
            <h3 id="bal-customer" className="iso-h3">
              Get paid
            </h3>
            <p className="iso-small" style={{ margin: 0 }}>
              Ask a customer to pay you. Businesses on Splash pay in the app; anyone else pays from a link.
            </p>
            <div className="iso-addcard__act">
              {INVOICE_LINKS.get ? (
                <IsoButton variant="quiet" href={INVOICE_LINKS.get}>
                  Request a payment
                </IsoButton>
              ) : (
                <span className="iso-small">Opens with Invoices › Get paid.</span>
              )}
            </div>
          </IsoSurface>
        </div>
      </section>

      <IsoSurface className="iso-rise iso-rise-4" aria-labelledby="bal-moves">
        <div className="iso-surface--head">
          <h2 id="bal-moves" className="iso-h2">
            Money in and out
          </h2>
          <Link className="iso-small" href="/dashboard/history">
            All history
          </Link>
        </div>
        {d.rows.length === 0 ? (
          <div className="iso-empty">
            <strong>Nothing in or out yet.</strong>
            <p className="iso-small" style={{ margin: 0 }}>
              Money you add, and the payments you send, show here.
            </p>
          </div>
        ) : (
          <ScrollRegion label="Money in and out">
            <table className="iso-table iso-table--stack">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">What</th>
                  <th scope="col" className="iso-r">
                    Amount
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Date">{r.date}</td>
                    <td data-label="What">
                      {r.href ? (
                        <Link href={r.href}>
                          <strong>{r.what}</strong>
                        </Link>
                      ) : (
                        <strong>{r.what}</strong>
                      )}
                      <br />
                      <span className="iso-small">{r.detail}</span>
                    </td>
                    <td data-label="Amount" className="iso-r iso-num">
                      {signed(r.amountMinor)}
                    </td>
                    <td data-label="Status">
                      <Tag tone={r.tag.tone} tick={r.tag.tone === 'ok'}>
                        {r.tag.label}
                      </Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </IsoSurface>

      <p className="iso-small" style={{ margin: 0 }}>
        Your account ID and approval setup are in <Link href="/dashboard/settings/account">Settings › Account details</Link>.
      </p>

      <AddMoneySheet
        key={opened}
        open={adding !== null}
        onClose={() => setAdding(null)}
        target={{ kind: 'topup' }}
        initialWay={adding ?? 'bank_card'}
        sourceOfFunds={null}
        onLanded={() => void load()}
      />
    </div>
  );
}
