// iso-ui
'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Check } from 'lucide-react';

import { CountUp, IsoButton, IsoDisplay, IsoSurface, QuoteRing, RouteMap, ScrollRegion, Station, Tag, Wire, type StationArt } from '@/components/iso';
import { PageHead } from '@/components/dashboard/PageHead';
import { INVOICE_LINKS } from '@/lib/dashboard/links';
import type { Wire as WireOf } from '@/lib/solana-app/json';
import type { Overview as OverviewData } from '@/lib/solana-app/overview';

import { api, ApiError, php, usd } from './client';

export type OverviewDTO = WireOf<OverviewData>;

const CHANGED = 'splash-company-changed';

/**
 * Overview (prompt 10 Phase 2, frame "Overview"): what a finance manager opens the dashboard for,
 * from one read of the company's state (GET /api/solana/overview, lib/solana-app/overview.ts).
 * Every figure here is formatted from that read: nothing is typed in, nothing is summed here.
 */
export function Overview() {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: OverviewDTO }>({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      setState({ status: 'ready', data: await api<OverviewDTO>('/overview') });
    } catch (e) {
      setState({ status: 'error', message: e instanceof ApiError ? e.message : 'The overview did not load. Try again.' });
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

  if (state.status === 'loading') return <OverviewSkeleton />;
  if (state.status === 'error') {
    return (
      <div className="iso iso-page">
        <PageHead title="Overview" />
        <p className="iso-note iso-note--danger" role="alert">
          {state.message}{' '}
          <button type="button" className="iso-btn iso-btn--link" onClick={() => void load()}>
            Try again
          </button>
        </p>
      </div>
    );
  }
  return <OverviewView data={state.data} />;
}

const big = (s: string | null | undefined) => BigInt(s ?? '0');

/** The screen itself, from the read: separate so a test can render it from a fixture. */
export function OverviewView({ data }: { data: OverviewDTO }) {
  const m = data.money;
  const total = big(m.totalMinor);
  const waiting = big(m.waitingMinor);
  const nothingYet = total === 0n;
  const needs = data.needs;
  const [allNeeds, setAllNeeds] = useState(false);
  return (
    <div className="iso iso-page">
      <PageHead
        title="Overview"
        context={
          <>
            {data.today} ·{' '}
            <strong>{data.needsCount === 0 ? 'nothing needs you' : data.needsCount === 1 ? '1 thing needs you' : `${data.needsCount} things need you`}</strong>
          </>
        }
        actions={
          <>
            <IsoButton variant="primary" href={INVOICE_LINKS.pay}>
              Pay an invoice
            </IsoButton>
            <IsoButton variant="quiet" href="/dashboard/transfer">
              New transfer
            </IsoButton>
            {INVOICE_LINKS.get ? (
              <IsoButton variant="quiet" href={INVOICE_LINKS.get}>
                Get paid
              </IsoButton>
            ) : null}
          </>
        }
      />

      <div className="iso-split">
        {/* ── Money position: the page's one extruded number ── */}
        <IsoSurface hero className="iso-split__main iso-rise iso-rise-2 iso-money" aria-labelledby="ov-money">
          <div className="iso-money__top">
            {/* The figure is sized to its length, so a long total shrinks instead of running into the art. */}
            <div className="iso-money__lead" style={{ ['--chars' as string]: usd(total).length }}>
              <h2 id="ov-money" className="iso-money__label">
                Your money, all accounts
              </h2>
              <IsoDisplay size="xl">
                <CountUp minor={total} format={usd} />
              </IsoDisplay>
              <p className="iso-money__sentence">
                {nothingYet ? (
                  <>
                    No money in your accounts yet. <Link href="/dashboard/fund">Add money</Link> to pay your first supplier.
                  </>
                ) : m.covered ? (
                  <>
                    {big(m.payablesDueMinor) === 0n ? 'Nothing is due in the next 30 days.' : 'Enough for everything due in the next 30 days.'}
                    {waiting > 0n ? (
                      <>
                        {' '}
                        <strong>{usd(waiting)}</strong> is waiting for your approval.
                      </>
                    ) : null}
                  </>
                ) : (
                  <span className="iso-money__short">
                    <strong>{usd(big(m.shortMinor))} short</strong> of what&rsquo;s due in the next 30 days. <Link href="/dashboard/fund">Add money</Link> or move some from your reserve.
                  </span>
                )}
              </p>
            </div>
            <Image className="iso-art iso-money__vault" src="/cinematic/vault-transparent.png" alt="" width={210} height={117} priority />
          </div>
          <MoneyBar shares={m.shares} investmentsSetUp={m.investmentsSetUp} />
          <div className="iso-money__rows">
            <MoneyRow swatch="teal" name="Payments account" amount={usd(big(m.paymentsMinor))} note="Pays your suppliers" />
            <MoneyRow swatch="mint" name="Reserve" amount={usd(big(m.reserveMinor))} note={big(m.payablesDueMinor) > 0n ? `Next 30 days ${usd(big(m.payablesDueMinor))} + 10%` : 'Nothing due in the next 30 days'} />
            {m.investmentsSetUp ? (
              <MoneyRow swatch="gold" name="Investments" amount={usd(big(m.investmentsMinor))} note="Treasury bills and stocks · test mode" />
            ) : (
              <div className="iso-money__row">
                <i aria-hidden="true" className="iso-swatch iso-fill-gold" />
                <div>
                  <strong className="iso-money__name">Investments</strong>
                  <span className="iso-money__amount iso-money__amount--none">Not set up yet</span>
                  <Link className="iso-small" href="/dashboard/treasury">
                    See Treasury
                  </Link>
                </div>
              </div>
            )}
          </div>
          <p className="iso-money__promises">
            <span>
              <Check size={14} aria-hidden="true" /> Only your team can move this money
            </span>
            <span>
              <Check size={14} aria-hidden="true" /> Every payment gets a receipt that proves itself
            </span>
            <span>
              <Check size={14} aria-hidden="true" /> Zeke drafts, a person approves
            </span>
          </p>
        </IsoSurface>

        {/* ── Needs you ── */}
        <section className="iso-surface iso-split__side iso-rise iso-rise-3 iso-needs" aria-labelledby="ov-needs">
          <div className="iso-surface--head">
            <h2 id="ov-needs" className="iso-h2">
              Needs you
            </h2>
            <span className="iso-num iso-muted">{needs.total}</span>
          </div>
          {needs.rows.length === 0 ? (
            <div className="iso-empty">
              <p style={{ margin: 0 }}>Nothing needs you.</p>
              <p className="iso-small" style={{ margin: 0 }}>
                <Link href={INVOICE_LINKS.pay}>Pay an invoice</Link> or <Link href={INVOICE_LINKS.pay}>check what&rsquo;s due this week</Link>.
              </p>
            </div>
          ) : (
            <ul className="iso-list">
              {(allNeeds ? [...needs.rows, ...needs.more] : needs.rows).map((r, i) => (
                <li key={`${r.kind}-${i}`}>
                  <div className="iso-list__main">
                    <Tag tone={r.tag.tone}>{r.tag.label}</Tag>
                    <div className="iso-list__title">{r.title}</div>
                    <div className="iso-list__detail iso-num">
                      {r.detail}
                      {r.quote && r.quote.fresh ? (
                        <>
                          {' · '}
                          <QuoteRing expiresAt={r.quote.expiresAt} tone="coral" size={14} prefix="quote ends in" />
                        </>
                      ) : null}
                    </div>
                  </div>
                  <Link className="iso-row-btn" href={r.action.href}>
                    {r.action.label}
                    <span className="iso-sr">: {r.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {needs.more.length > 0 ? (
            <p className="iso-small" style={{ margin: 0, padding: '0 22px 14px' }}>
              {/* The rest open in place: they are setup, bills and checks, not payments, so History is the wrong page. */}
              <button type="button" className="iso-btn iso-btn--link" aria-expanded={allNeeds} onClick={() => setAllNeeds((v) => !v)}>
                {allNeeds ? 'Show fewer' : `See all ${needs.total}`}
              </button>
            </p>
          ) : null}
          <div className="iso-strip iso-needs__zeke">
            <span style={{ flex: '1 1 auto' }}>
              {needs.readToday > 0 ? `Zeke read ${needs.readToday} ${needs.readToday === 1 ? 'invoice' : 'invoices'} today. It drafts; you approve.` : 'Zeke reads the invoices you drop in. It drafts; you approve.'}
            </span>
            <Link href="/dashboard/zeke">Open Zeke</Link>
          </div>
        </section>
      </div>

      {/* ── Payments this month: the settlement pipeline ── */}
      <IsoSurface className="iso-rise iso-rise-4" aria-labelledby="ov-flow">
        <div className="iso-row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 id="ov-flow" className="iso-h2">
            Payments this month
          </h2>
          <span className="iso-small iso-num">
            {data.month.paidCount === 0 ? (
              'Nothing paid yet this month'
            ) : (
              <>
                Paid <strong>{usd(big(data.month.paidUsdMinor))}</strong> · {data.month.paidCount} {data.month.paidCount === 1 ? 'payment' : 'payments'} ·{' '}
                {data.month.verifiedCount === data.month.paidCount ? (data.month.paidCount === 1 ? 'with a verified receipt' : data.month.paidCount === 2 ? 'both with a verified receipt' : 'all with a verified receipt') : `${data.month.verifiedCount} with a verified receipt so far`}
              </>
            )}
          </span>
        </div>
        {data.month.fees ? (
          <p className="iso-small iso-num" style={{ margin: '6px 0 0' }}>
            Fees {usd(big(data.month.fees.totalMinor))} (Splash {usd(big(data.month.fees.splashMinor))} · partner {usd(big(data.month.fees.partnerMinor))}) · average all-in {data.month.fees.avgAllIn}
          </p>
        ) : null}
        <div className="iso-ov-pipeline" style={{ marginTop: 18 }}>
          <RouteMap label="Payments this month, by where they are">
            {data.pipeline.map((s, i) => (
              <PipelineStop key={s.id} stop={s} first={i === 0} />
            ))}
          </RouteMap>
        </div>
        <p className="iso-small" style={{ margin: '12px 0 0' }}>
          {data.pipeline.some((s) => s.moving)
            ? 'Coins move along a line while a payment is on its way along it.'
            : 'Coins move along a line only while a payment is on its way. Nothing is moving right now.'}
        </p>
      </IsoSurface>

      <div className="iso-split" style={{ alignItems: 'flex-start' }}>
        {/* ── Recent payments ── */}
        <IsoSurface className="iso-split__main iso-rise iso-rise-4" aria-labelledby="ov-recent">
          <div className="iso-row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 id="ov-recent" className="iso-h2">
              Recent payments
            </h2>
            <Link href="/dashboard/history" className="iso-small" style={{ fontWeight: 700 }}>
              All payments
            </Link>
          </div>
          {data.recent.length === 0 ? (
            <div className="iso-empty" style={{ paddingInline: 0 }}>
              <p style={{ margin: 0 }}>No payments yet.</p>
              <p className="iso-small" style={{ margin: 0 }}>
                <Link href={INVOICE_LINKS.pay}>Pay your first supplier invoice</Link>, or <Link href="/dashboard/transfer">send a transfer</Link>.
              </p>
            </div>
          ) : (
            <ScrollRegion label="Recent payments">
              {/* On a phone each row stacks into a card (styles/iso-ui.css .iso-table--stack); the roles keep it a table to a screen reader. */}
              <table className="iso-table iso-table--stack" role="table" style={{ marginTop: 10 }}>
                <thead role="rowgroup">
                  <tr role="row">
                    <th scope="col" role="columnheader">
                      Paid to
                    </th>
                    <th scope="col" role="columnheader" className="iso-r">
                      They got
                    </th>
                    <th scope="col" role="columnheader" className="iso-r">
                      You paid
                    </th>
                    <th scope="col" role="columnheader">
                      Status
                    </th>
                    <th scope="col" role="columnheader">
                      <span className="iso-sr">Receipt</span>
                    </th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {data.recent.map((p) => (
                    <tr key={p.id} role="row">
                      <td role="cell">
                        <strong>{p.name}</strong>
                        <br />
                        <span className="iso-small">
                          {p.reference ? <span className="iso-mono">{p.reference}</span> : null}
                          {p.reference ? ' · ' : ''}
                          {p.date}
                        </span>
                      </td>
                      <td role="cell" className="iso-r" data-label="They got">
                        {p.theyGetUsdMinor ? usd(big(p.theyGetUsdMinor)) : php(big(p.theyGetPhpMinor))}
                      </td>
                      <td role="cell" className="iso-r" data-label="You paid">
                        {p.youPaidUsdMinor ? usd(big(p.youPaidUsdMinor)) : '—'}
                      </td>
                      <td role="cell">
                        <Tag tone={p.tag.tone}>{p.tag.label}</Tag>
                      </td>
                      <td role="cell" className="iso-table__act">
                        {p.receiptHref ? (
                          <Link href={p.receiptHref} style={{ fontWeight: 700 }}>
                            Receipt<span className="iso-sr"> for {p.name}</span>
                          </Link>
                        ) : p.reviewHref ? (
                          <Link href={p.reviewHref} style={{ fontWeight: 700 }}>
                            Review<span className="iso-sr"> the payment to {p.name}</span>
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
        </IsoSurface>

        <div className="iso-split__side iso-stack" style={{ gap: 22 }}>
          {/* ── Where you can pay ── */}
          <IsoSurface className="iso-rise iso-rise-5" aria-labelledby="ov-corr">
            <h2 id="ov-corr" className="iso-h2" style={{ marginBottom: 12 }}>
              Where you can pay
            </h2>
            <ul className="iso-paylist">
              {data.corridors.map((c) => (
                <li key={c.route} className={c.status === 'test' || c.status === 'live' ? 'is-open' : undefined}>
                  <div>
                    <strong>{c.route}</strong>
                    <span className="iso-small">{c.detail}</span>
                  </div>
                  <Tag tone={c.status === 'test' || c.status === 'live' ? 'ok' : 'ink'}>{c.status === 'test' ? 'Test mode' : c.status === 'live' ? 'Live' : c.status === 'next' ? 'Next' : 'Later'}</Tag>
                </li>
              ))}
            </ul>
          </IsoSurface>

          {/* ── Checks and limits ── */}
          <IsoSurface className="iso-rise iso-rise-5" aria-labelledby="ov-checks">
            <h2 id="ov-checks" className="iso-h2" style={{ marginBottom: 12 }}>
              Checks and limits
            </h2>
            {/* One row per check, so a long value wraps under its own label instead of squeezing every label. */}
            <dl className="iso-dl iso-dl--rows iso-num">
              <div>
                <dt>Company check</dt>
                <dd>
                  <Tag tone={data.checks.companyCheck.tone}>{data.checks.companyCheck.label}</Tag>
                </dd>
              </div>
              <div>
                <dt>Per payment</dt>
                <dd>up to {usd(big(data.checks.perPaymentMinor))}</dd>
              </div>
              <div>
                <dt>Today</dt>
                <dd>
                  {usd(big(data.checks.usedTodayMinor))} of {usd(big(data.checks.dailyMinor))}
                </dd>
              </div>
              <div>
                <dt>Second approver above {usd(big(data.checks.secondApproverAboveMinor))}</dt>
                <dd>
                  <Tag tone="ink">{data.checks.secondApproverBuilt ? 'On' : 'Planned'}</Tag>
                </dd>
              </div>
            </dl>
            <Link href="/dashboard/settings/policy" className="iso-btn iso-btn--link" style={{ marginTop: 6 }}>
              See all rules
            </Link>
          </IsoSurface>
        </div>
      </div>
    </div>
  );
}

function MoneyBar({ shares, investmentsSetUp }: { shares: OverviewDTO['money']['shares']; investmentsSetUp: boolean }) {
  const p = Number(shares.payments);
  const r = Number(shares.reserve);
  const i = investmentsSetUp ? Number(shares.investments) : 0;
  const label = investmentsSetUp ? `Payments ${p}%, reserve ${r}%, investments ${i}%` : `Payments ${p}%, reserve ${r}%`;
  if (p + r + i === 0) return <div className="iso-bar" role="img" aria-label="No money in your accounts yet" />;
  return (
    <div className="iso-bar" role="img" aria-label={label}>
      {p > 0 ? <span className="iso-fill-teal" style={{ width: `${p}%` }} /> : null}
      {r > 0 ? <span className="iso-fill-mint" style={{ width: `${r}%` }} /> : null}
      {i > 0 ? <span className="iso-fill-gold" style={{ width: `${i}%` }} /> : null}
    </div>
  );
}

function MoneyRow({ swatch, name, amount, note }: { swatch: 'teal' | 'mint' | 'gold'; name: string; amount: string; note: string }) {
  return (
    <div className="iso-money__row">
      <i aria-hidden="true" className={`iso-swatch iso-fill-${swatch}`} />
      <div>
        <strong className="iso-money__name">{name}</strong>
        <span className="iso-money__amount iso-num">{amount}</span>
        <span className="iso-small">{note}</span>
      </div>
    </div>
  );
}

const HELP_EMPTY: Record<string, string> = {
  waiting: 'nothing waiting',
  sent: 'nothing moving',
  partner: 'payout partner, PH',
  // Where payments are now, not what happened: two paid payments sit at "Proof recorded", not here.
  paid: 'none here now',
  recording: 'nothing waiting',
  recorded: 'none this month',
};

function PipelineStop({ stop, first }: { stop: OverviewDTO['pipeline'][number]; first: boolean }) {
  const count = Number(stop.count);
  const amount = big(stop.amountPhpMinor);
  let art: StationArt;
  if (stop.id === 'paid' && count > 0) art = { kind: 'coin', coin: 'php', size: 64 };
  else if (stop.id === 'recorded') art = { kind: 'proof', tone: count > 0 ? 'ok' : 'quiet' };
  else art = { kind: 'tile', value: String(count), tone: count === 0 ? 'quiet' : stop.id === 'waiting' ? 'coral' : 'live' };
  const help = count === 0 ? HELP_EMPTY[stop.id] : stop.id === 'recorded' ? `${count} of ${count} verify` : `${count === 1 ? '' : `${count} · `}${php(amount)}`;
  return (
    <>
      {first ? null : <Wire state={stop.moving ? 'active' : 'quiet'} />}
      <Station art={art} label={stop.label} help={help} href={stop.href} />
    </>
  );
}

function OverviewSkeleton() {
  return (
    <div className="iso iso-page" aria-busy="true" aria-label="Loading the overview">
      <PageHead title="Overview" context="Reading your accounts…" />
      <div className="iso-split">
        <div className="iso-surface iso-surface--hero iso-split__main iso-skel" style={{ minHeight: 360 }} />
        <div className="iso-surface iso-split__side iso-skel" style={{ minHeight: 360 }} />
      </div>
      <div className="iso-surface iso-skel" style={{ minHeight: 200 }} />
    </div>
  );
}
