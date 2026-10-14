// iso-ui
'use client';

import Image from 'next/image';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';

import { Details, IsoButton, IsoDisplay, IsoSurface, RouteMap, ScrollRegion, Segmented, Station, Tag, TestModeBadge, Wire } from '@/components/iso';
import { PageHead } from '@/components/dashboard/PageHead';
import type { TreasuryView as TreasuryData } from '@/lib/solana-app/investments';
import type { Wire as WireOf } from '@/lib/solana-app/json';
import { bpsText } from '@/lib/treasury/reference';

import { api, ApiError, usd } from '../client';
import { notifyCompanyChanged, useCompany } from '../useCompany';
import { MoveSheet } from './MoveSheet';
import { OrderSheet, type OrderIntent } from './OrderSheet';
import { TreasuryTechnical } from './TreasuryTechnical';

export type TreasuryDTO = WireOf<TreasuryData>;

const CHANGED = 'splash-company-changed';
const big = (s: string | null | undefined) => BigInt(s ?? '0');
const bps = (n: string | number) => Number(n);

/** Where the money would go while a sheet is open: the wires that carry it. */
type Flow = { paymentsReserve: boolean; reserveInvestments: boolean } | null;

/**
 * Treasury (prompt 10 §7, frame Final-Treasury): cash for payments, a reserve for what's due, and
 * investments, all in the company's own accounts. Every figure comes from one read (GET
 * /api/solana/treasury, lib/solana-app/investments.ts); every rate and past return carries its date
 * and source. Investments are test mode only: the company approves each order on its device, and the
 * simulator plays the other side. Splash holds no key to any of them.
 */
export function Treasury({ prefillMoveMinor, back, sweepId }: { prefillMoveMinor: string | null; back: string | null; sweepId: string | null }) {
  const { state: company } = useCompany();
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: TreasuryDTO }>({ status: 'loading' });
  const [order, setOrder] = useState<OrderIntent | null>(null);
  const [moving, setMoving] = useState(Boolean(prefillMoveMinor));
  const [flow, setFlow] = useState<Flow>(null);
  const [sweepBusy, setSweepBusy] = useState(false);
  const [sweepError, setSweepError] = useState<string | null>(null);
  // Each order opens a fresh sheet (its own amount, path and quote).
  const [opened, bump] = useReducer((n: number) => n + 1, 0);

  const load = useCallback(async () => {
    try {
      setState({ status: 'ready', data: await api<{ treasury: TreasuryDTO }>('/treasury').then((r) => r.treasury) });
    } catch (e) {
      setState({ status: 'error', message: e instanceof ApiError ? e.message : 'Treasury did not load. Try again.' });
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

  // A "Review" link from Overview's Needs you (?sweep=) opens today's draft once it has loaded.
  const draftId = state.status === 'ready' ? (state.data.sweep.draft?.id ?? null) : null;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (sweepId && draftId === sweepId) setOrder((o) => o ?? { asset: 'usdy', kind: 'subscribe', sweepDraftId: sweepId });
  }, [sweepId, draftId]);

  const openOrder = (o: OrderIntent) => {
    bump();
    setOrder(o);
  };

  async function setSweep(on: boolean) {
    setSweepBusy(true);
    setSweepError(null);
    try {
      await api('/treasury/sweep', { body: { on } });
      notifyCompanyChanged();
    } catch (e) {
      setSweepError(e instanceof ApiError ? e.message : 'Sweep did not change. Try again.');
    } finally {
      setSweepBusy(false);
    }
  }

  if (state.status === 'loading') {
    return (
      <div className="iso iso-page" aria-busy="true">
        <PageHead title="Treasury" />
        <div className="iso-skel" style={{ height: 300 }} />
        <div className="iso-skel" style={{ height: 380 }} />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="iso iso-page">
        <PageHead title="Treasury" />
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
  const me = company.status === 'ready' ? company.company : null;
  const a = d.accounts;
  const t = d.tbills;
  const draft = d.sweep.draft;
  const available = big(d.available.totalMinor);
  const redeemable = big(t.holding?.redeemableMinor);
  const moveNote = flow && (flow.paymentsReserve || flow.reserveInvestments) ? 'Showing where the money would move' : 'Nothing is moving right now';
  const tsla = d.stocks.rows.find((r) => r.id === 'tsla');
  const noStockRoom = big(d.stocks.maxBuyMinor) === 0n;
  const empty = big(a.paymentsMinor) + big(a.reserveMinor) === 0n;

  return (
    <div className="iso iso-page iso-treasury">
      <PageHead
        title="Treasury"
        context="Cash for payments, a reserve for what’s due, and investments, all in your own accounts."
        actions={
          d.hasAccounts ? (
            <IsoButton variant="quiet" onClick={() => setMoving(true)}>
              <ArrowLeftRight size={16} aria-hidden="true" /> Move money between accounts
            </IsoButton>
          ) : null
        }
      />

      {!d.hasAccounts ? (
        <p className="iso-note" role="status">
          Set up your accounts first. Treasury uses the same accounts and the same approvers as your payments.{' '}
          <a href="/dashboard/setup">Finish setup</a>
        </p>
      ) : null}

      {/* ── The three accounts: the page's one extruded number ── */}
      <IsoSurface hero className="iso-rise iso-rise-2 iso-treasury__hero" aria-labelledby="tr-total">
        <div className="iso-treasury__top">
          <div className="iso-treasury__lead">
            <h2 id="tr-total" className="iso-money__label">
              All accounts
            </h2>
            {/* §8: only Overview's total counts up; this one shows the figure as it is. */}
            <IsoDisplay size="xl">{usd(a.totalMinor)}</IsoDisplay>
          </div>
          <span className="iso-small iso-num" aria-live="polite">
            {moveNote}
          </span>
        </div>
        <RouteMap label="Your three accounts" wireTop={46}>
          <Station art={{ kind: 'coin', coin: 'usd', size: 84 }} label="Payments account" amount={usd(a.paymentsMinor)} help={big(a.waitingMinor) > 0n ? `${usd(a.waitingMinor)} waiting for approval` : 'Pays your suppliers'} />
          <Wire state={flow?.paymentsReserve ? 'active' : 'quiet'} />
          <Station art={{ kind: 'vault', size: 132 }} label="Reserve" amount={usd(a.reserveMinor)} help="Kept for what’s due" wide />
          <Wire state={flow?.reserveInvestments ? 'active' : 'quiet'} />
          <Station art={{ kind: 'block', glyph: 'invest', size: 96 }} label="Investments" amount={usd(a.investmentsMinor)}>
            <TestModeBadge inline />
          </Station>
        </RouteMap>
        <div className="iso-treasury__reserve">
          <div className="iso-row iso-num" style={{ justifyContent: 'space-between' }}>
            <span>
              <strong>Reserve {usd(a.reserveMinor)}</strong> · {big(d.reserve.payablesMinor) > 0n ? `payables due in the next 30 days ${usd(d.reserve.payablesMinor)} + ${d.reserve.marginPct}%` : 'nothing due in the next 30 days'}
            </span>
            {d.reserve.covered ? (
              <Tag tone="ok" tick>
                Covered
              </Tag>
            ) : (
              <Tag tone="danger">{usd(d.reserve.shortMinor)} short</Tag>
            )}
          </div>
          <div className="iso-resbar" role="img" aria-label={d.reserve.atFloor ? 'Reserve is exactly at its floor' : d.reserve.covered ? 'Reserve is above its floor' : 'Reserve is below its floor'}>
            <span className="iso-resbar__fill" style={{ width: `${d.reserve.bar.fillPct}%` }} />
            {d.reserve.bar.floorPct !== null ? <span className="iso-resbar__floor" style={{ left: `${d.reserve.bar.floorPct}%` }} /> : null}
          </div>
          <div className="iso-row iso-small iso-num" style={{ justifyContent: 'space-between' }}>
            <span>
              Floor {usd(d.reserve.floorMinor)} ({d.reserve.marginPct}%, set by your owner)
            </span>
            <span>
              Available to invest <strong className="iso-ink">{usd(available)}</strong>
              {available > 0n ? ` · ${d.available.fromLabel}` : ''}
            </span>
          </div>
        </div>
      </IsoSurface>

      <p className="iso-ribbon iso-rise iso-rise-3" role="note">
        <TestModeBadge inline />
        <span>Investments aren’t live until legal sign-off in Malaysia. Buttons work on test money.</span>
      </p>

      <div className="iso-split">
        {/* ── US Treasury bills ── */}
        <IsoSurface pad className="iso-split__side iso-rise iso-rise-3 iso-stack iso-tcard" aria-labelledby="tr-usdy">
          <div>
            <h2 id="tr-usdy" className="iso-h2">
              US Treasury bills
            </h2>
            <span className="iso-small">USDY, issued by Ondo</span>
          </div>
          {t.rate.fresh ? (
            <div className="iso-tcard__rate">
              <span className="iso-tcard__pct iso-num">{bpsText(bps(t.rate.value.bps))}</span>
              <strong>a year</strong>
              <span className="iso-small">
                {t.rate.note} · as of {t.rate.asOfLong} ·{' '}
                <a href={t.rate.sourceUrl} target="_blank" rel="noreferrer">
                  source
                </a>
              </span>
            </div>
          ) : (
            <div className="iso-tcard__rate">
              <span className="iso-tcard__pct">Rate out of date</span>
              <span className="iso-small">
                Last checked {t.rate.asOfLong} ·{' '}
                <a href={t.rate.sourceUrl} target="_blank" rel="noreferrer">
                  source
                </a>
              </span>
            </div>
          )}
          <p className="iso-body" style={{ margin: 0 }}>
            A note backed by short-term US Treasury bills and bank deposits. <strong>Not a bank deposit; its value can fall.</strong>
          </p>
          <ul className="iso-bullets">
            <li>You subscribe with US dollars. Your dollars go to Ondo, and Ondo issues USDY units into your Investments account. Splash only builds the order; you approve it.</li>
            <li>You keep the same number of units. Each unit’s price rises daily as interest builds up.</li>
            <li>Subscribed straight from Ondo: units are held {t.holdDays} days before you can redeem them. On the market: no hold, for smaller amounts.</li>
            <li>For non-US companies only.</li>
          </ul>

          <div className="iso-idle">
            <div className="iso-row" style={{ justifyContent: 'space-between' }}>
              <strong className="iso-ink">Idle cash</strong>
              <Segmented
                label="Hold or sweep"
                options={[
                  { value: 'hold', label: 'Hold' },
                  { value: 'sweep', label: 'Sweep' },
                ]}
                value={d.sweep.on ? 'sweep' : 'hold'}
                onChange={(v) => void setSweep(v === 'sweep')}
                disabled={!d.sweep.mayChange || sweepBusy || !d.hasAccounts ? ['hold', 'sweep'] : []}
              />
            </div>
            <p className="iso-small" style={{ margin: 0 }} aria-live="polite">
              {d.sweep.on
                ? `Sweep is on. Each morning Zeke drafts a move of cash above your reserve and a ${usd(d.sweep.cushionMinor)} cushion into T-bills, and drafts a redemption when bills due need the money back. You approve each one.`
                : 'Hold: idle cash stays where it is. Nothing is drafted; subscribe or redeem yourself whenever you like.'}
              {d.sweep.mayChange ? '' : ' Your company’s owner sets this.'}
            </p>
            {sweepError ? (
              <p className="iso-note iso-note--danger" role="alert">
                {sweepError}
              </p>
            ) : null}
            {draft ? (
              <div className="iso-idle__draft">
                <span className="iso-num">
                  <Tag tone="ink">Zeke drafted</Tag> {draft.kind === 'subscribe' ? 'Subscribe' : 'Redeem'} <strong className="iso-ink">{usd(draft.amountMinor)}</strong> · {draft.reason}
                </span>
                <IsoButton variant="quiet" size="sm" onClick={() => openOrder({ asset: 'usdy', kind: draft.kind, sweepDraftId: draft.id })}>
                  Review
                </IsoButton>
              </div>
            ) : null}
          </div>

          <div className="iso-tcard__foot">
            <span className="iso-num">
              {t.holding ? (
                <>
                  You hold <strong className="iso-ink">{usd(t.holding.valueMinor)}</strong> (test) · {t.holding.unitsText} units
                  {big(t.holding.heldMinor) > 0n ? (
                    <>
                      <br />
                      <span className="iso-small">
                        {usd(t.holding.heldMinor)} is in its {t.holdDays}-day hold until {t.holding.heldUntilLabel}
                      </span>
                    </>
                  ) : null}
                </>
              ) : (
                <span className="iso-small">You don’t hold any yet.</span>
              )}
            </span>
            <span className="iso-actions">
              <IsoButton variant="quiet" onClick={() => openOrder({ asset: 'usdy', kind: 'redeem' })} disabledReason={redeemable === 0n ? (t.holding ? 'Everything you hold is still in its hold.' : 'You don’t hold any T-bills yet.') : null}>
                Redeem
              </IsoButton>
              <IsoButton variant="primary" onClick={() => openOrder({ asset: 'usdy', kind: 'subscribe' })} disabledReason={!d.hasAccounts ? 'Set up your accounts first.' : empty ? 'Nothing is in your accounts yet. Add money, or test money from Move money between accounts.' : available === 0n ? 'Nothing is available to invest: your reserve is at its floor and the rest is needed for what’s waiting.' : null}>
                Subscribe
              </IsoButton>
            </span>
          </div>
        </IsoSurface>

        {/* ── US stocks and ETFs ── */}
        <IsoSurface pad className="iso-split__main iso-rise iso-rise-4 iso-stack iso-tcard" aria-labelledby="tr-stocks">
          <div className="iso-row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div>
              <h2 id="tr-stocks" className="iso-h2">
                US stocks and ETFs
              </h2>
              <span className="iso-small">via Ondo · each unit tracks a share; dividends are reinvested after tax</span>
            </div>
            <span className="iso-small iso-num">
              Stocks are <strong className="iso-ink">{d.stocks.sharePct}% of treasury</strong> · your limit {d.stocks.capPct}%
            </span>
          </div>
          <p className="iso-small" style={{ margin: 0 }}>
            Each unit tracks a US share or ETF. You don’t own the share itself; prices move with the market and can fall.
          </p>
          {noStockRoom && d.hasAccounts ? (
            <p className="iso-note" role="status" style={{ margin: 0 }}>
              {big(d.accounts.reserveMinor) + big(d.accounts.investmentsMinor) === 0n
                ? 'Stocks can be at most 20% of your Reserve and investments together, and both are empty, so there’s no room for a buy yet.'
                : 'Your 20% stock limit, or what’s available to invest, allows nothing more today.'}
            </p>
          ) : null}
          <ScrollRegion label="US stocks and ETFs">
            <table className="iso-table iso-table--stack iso-stocks">
              <thead>
                <tr>
                  <th scope="col">Tracks</th>
                  <th scope="col" className="iso-r">
                    Past 12 months
                  </th>
                  <th scope="col" className="iso-r">
                    Dividends, past 12 months
                  </th>
                  <th scope="col" className="iso-r">
                    You hold (test)
                  </th>
                  <th scope="col">
                    <span className="iso-sr">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.stocks.rows.map((r) => {
                  const ret = bps(r.return12m.value.bps);
                  const div = r.dividends12m.value;
                  return (
                    <tr key={r.id}>
                      <td data-label="Tracks">
                        <strong>{r.name}</strong>
                        <br />
                        <span className="iso-small">
                          {r.tracks} · as of {r.return12m.asOfLabel}
                        </span>
                      </td>
                      <td data-label="Past 12 months" className={`iso-r iso-num${ret < 0 ? ' iso-neg' : ''}`}>
                        {r.return12m.fresh ? bpsText(ret, { sign: true }) : 'Out of date'}
                      </td>
                      <td data-label="Dividends, past 12 months" className="iso-r iso-num">
                        {div === null ? 'none' : !r.dividends12m.fresh ? 'Out of date' : `${bpsText(bps(div.bps))}${r.dividends12m.note === 'trailing' ? ' trailing' : ''}`}
                      </td>
                      <td data-label="You hold (test)" className="iso-r iso-num">
                        {r.holdingMinor ? usd(r.holdingMinor) : '–'}
                      </td>
                      <td className="iso-r">
                        <span className="iso-actions iso-actions--end">
                          {r.holdingMinor ? (
                            <IsoButton variant="quiet" size="sm" onClick={() => openOrder({ asset: r.id, kind: 'sell' })}>
                              Sell<span className="iso-sr"> {r.name}</span>
                            </IsoButton>
                          ) : null}
                          <IsoButton variant="quiet" size="sm" onClick={() => openOrder({ asset: r.id, kind: 'buy' })} disabled={!d.hasAccounts || noStockRoom}>
                            Buy<span className="iso-sr"> {r.name}</span>
                          </IsoButton>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollRegion>
          <p className="iso-small" style={{ margin: 0 }}>
            Past returns of the share, dividends included. Not a forecast.
            {tsla && bps(tsla.return12m.value.bps) < 0 ? ` ${tsla.name} shows why: down ${Math.trunc(-bps(tsla.return12m.value.bps) / 100)}% over the same year.` : ''} Stocks never count towards your reserve.
          </p>
          <Details summary="Sources">
            <ul className="iso-sources">
              <li>
                T-bills rate, {t.rate.asOfLong}:{' '}
                <a href={t.rate.sourceUrl} target="_blank" rel="noreferrer">
                  {new URL(t.rate.sourceUrl).host}
                </a>
              </li>
              {d.stocks.rows.flatMap((r) => [
                <li key={`${r.id}-r`}>
                  {r.name}, past 12 months, {r.return12m.asOfLong}:{' '}
                  <a href={r.return12m.sourceUrl} target="_blank" rel="noreferrer">
                    {new URL(r.return12m.sourceUrl).host}
                  </a>
                </li>,
                <li key={`${r.id}-d`}>
                  {r.name}, dividends, {r.dividends12m.asOfLong}:{' '}
                  <a href={r.dividends12m.sourceUrl} target="_blank" rel="noreferrer">
                    {new URL(r.dividends12m.sourceUrl).host}
                  </a>
                  {r.dividends12m.note && r.dividends12m.note !== 'trailing' ? ` (${r.dividends12m.note})` : ''}
                </li>,
              ])}
            </ul>
          </Details>
        </IsoSurface>
      </div>

      {/* ── Positions ── */}
      {d.positions.length > 0 ? (
        <IsoSurface className="iso-rise iso-rise-4" aria-labelledby="tr-pos">
          <div className="iso-surface--head">
            <h2 id="tr-pos" className="iso-h2">
              Positions
            </h2>
            <span className="iso-small">Test prices</span>
          </div>
          <ScrollRegion label="Positions">
            <table className="iso-table iso-table--stack">
              <thead>
                <tr>
                  <th scope="col">Asset</th>
                  <th scope="col" className="iso-r">
                    Units
                  </th>
                  <th scope="col" className="iso-r">
                    Value (test)
                  </th>
                  <th scope="col" className="iso-r">
                    Change since bought
                  </th>
                  <th scope="col">In a hold</th>
                  <th scope="col">
                    <span className="iso-sr">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.positions.map((p) => {
                  const change = big(p.changeMinor);
                  return (
                    <tr key={p.asset}>
                      <td data-label="Asset">
                        <strong>{p.name}</strong>
                      </td>
                      <td data-label="Units" className="iso-r iso-num">
                        {p.unitsText}
                      </td>
                      <td data-label="Value (test)" className="iso-r iso-num">
                        {usd(p.valueMinor)}
                      </td>
                      <td data-label="Change since bought" className={`iso-r iso-num${change < 0n ? ' iso-neg' : ''}`}>
                        {change === 0n ? 'No change' : change > 0n ? `+${usd(change)}` : usd(change)}
                      </td>
                      <td data-label="In a hold">{big(p.heldMinor) > 0n ? `${usd(p.heldMinor)} until ${p.heldUntilLabel}` : 'None'}</td>
                      <td className="iso-r">
                        <IsoButton variant="quiet" size="sm" onClick={() => openOrder({ asset: p.asset, kind: p.action })} disabledReason={big(p.redeemableMinor) === 0n ? 'Still in its hold.' : null}>
                          {p.action === 'redeem' ? 'Redeem' : 'Sell'}
                          <span className="iso-sr"> {p.name}</span>
                        </IsoButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollRegion>
        </IsoSurface>
      ) : null}

      {/* ── Risk and rules, and Zeke ── */}
      <div className="iso-split">
        <IsoSurface pad className="iso-split__main iso-rise iso-rise-5" aria-labelledby="tr-risk">
          <h2 id="tr-risk" className="iso-h2" style={{ marginBottom: 10 }}>
            Risk and rules
          </h2>
          <ul className="iso-bullets">
            <li>These are your company’s own investments, in your own account. Splash doesn’t hold, manage or advise on them, and holds no key to any of your accounts.</li>
            <li>Not available to US persons. Before your first subscription or buy, an owner confirms no owner, director or approver is one.{d.eligibility.confirmed ? ` Confirmed by ${d.eligibility.by}.` : ''}</li>
            <li>
              Your company rules: reserve floor {d.reserve.marginPct}% above what’s due · stocks at most {d.stocks.capPct}% of treasury. Set by your owner; changing them comes with the rules update.
            </li>
            <li>Sweep, when it’s on: Zeke drafts each move from your owner’s rule (keep the reserve at its floor and at least {usd(d.sweep.cushionMinor)} in Payments). Every move needs an approval. Zeke never picks an investment.</li>
            <li>Splash fee on subscribing, redeeming, buying and selling: US$0.</li>
            <li>Subject to legal sign-off in Malaysia.</li>
          </ul>
        </IsoSurface>
        <div className="iso-split__side iso-surface iso-surface--ink iso-strip iso-treasury__zeke iso-rise iso-rise-5">
          <Image src="/cinematic/agent-bot-cut.png" alt="" width={40} height={40} />
          <span>
            <strong>Zeke:</strong> {d.zeke}
          </span>
        </div>
      </div>

      <TreasuryTechnical data={d} />

      {me ? (
        <>
          <OrderSheet
            key={opened}
            company={me}
            treasury={d}
            intent={order}
            onFlow={setFlow}
            onClose={() => {
              setOrder(null);
              setFlow(null);
            }}
          />
          <MoveSheet
            open={moving}
            company={me}
            treasury={d}
            prefillMinor={prefillMoveMinor}
            back={back}
            onFlow={setFlow}
            onClose={() => {
              setMoving(false);
              setFlow(null);
            }}
          />
        </>
      ) : null}
    </div>
  );
}
