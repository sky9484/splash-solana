// iso-ui
'use client';

import Image from 'next/image';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';

import { IsoButton, IsoDisplay, IsoSurface, RouteMap, Station, Tag, TestModeBadge, Wire } from '@/components/iso';
import { PageHead } from '@/components/dashboard/PageHead';
import type { TreasuryView as TreasuryData } from '@/lib/solana-app/investments';
import type { Wire as WireOf } from '@/lib/solana-app/json';

import { api, ApiError, usd } from '../client';
import { notifyCompanyChanged, useCompany } from '../useCompany';
import { HoldSweep } from './HoldSweep';
import { MoveSheet } from './MoveSheet';
import { OrderSheet, type OrderIntent } from './OrderSheet';
import { Activity, RiskRules } from './RiskRules';
import { Stocks } from './Stocks';
import { TbillCard } from './TbillCard';
import { TreasuryTechnical } from './TreasuryTechnical';

export type TreasuryDTO = WireOf<TreasuryData>;

const CHANGED = 'splash-company-changed';
const big = (s: string | null | undefined) => BigInt(s ?? '0');

/** Where the money would go while a sheet is open: the wires that carry it. */
type Flow = { paymentsReserve: boolean; reserveInvestments: boolean } | null;

/**
 * Treasury (prompt 10 §7, frame Final-Treasury; prompt 11 Phase 4, "Smart Treasury"): cash for
 * payments, a reserve for what's due, and investments, all in the company's own accounts. Top to
 * bottom: All accounts (unchanged), the test-mode ribbon, the T-bill pool with today's interest live
 * and the interest booked each day, stocks through Treasurers, and a rail with Hold or sweep (Zeke's
 * drafts, each approved by a person) and the activity; then Risk and rules and Zeke. Every figure comes
 * from one read (GET /api/solana/treasury, lib/solana-app/investments.ts); every rate and past return
 * carries its date and source. Investments are test mode only: the company approves each order on its
 * device, and the simulator plays the other side. Splash holds no key to any of them.
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

  // A "Review" link from Overview's Needs you (?sweep=) opens that draft (today's sweep, or the quarter's
  // interest) once it has loaded.
  // The draft's own kind: a sweep subscribes, the quarter's interest redeems.
  const linked = state.status === 'ready' ? (state.data.sweep.rows.find((r) => r.id === sweepId && r.state === 'drafted') ?? null) : null;
  const draftId = linked?.id ?? null;
  const draftKind = linked?.kind ?? null;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (sweepId && draftId === sweepId && draftKind) setOrder((o) => o ?? { asset: 'usdy', kind: draftKind, sweepDraftId: sweepId });
  }, [sweepId, draftId, draftKind]);

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
  const available = big(d.available.totalMinor);
  const redeemable = big(t.holding?.redeemableMinor);
  const moveNote = flow && (flow.paymentsReserve || flow.reserveInvestments) ? 'Showing where the money would move' : 'Nothing is moving right now';
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

      {/* ── Left: the T-bill pool, then stocks. Right rail: Hold or sweep, then activity (prompt 11 §4.1) ── */}
      <div className="iso-treasury__cols">
        <div className="iso-treasury__left">
          <TbillCard
            data={d}
            onOrder={(kind) => openOrder({ asset: 'usdy', kind })}
            subscribeWhy={!d.hasAccounts ? 'Set up your accounts first.' : empty ? 'Nothing is in your accounts yet. Add money, or test money from Move money between accounts.' : available === 0n ? 'Nothing is available to invest: your reserve is at its floor and the rest is needed for what’s waiting.' : null}
            redeemWhy={redeemable === 0n ? (t.holding ? 'Everything you hold is still in its hold.' : 'You don’t hold any T-bills yet.') : null}
          />
          <Stocks data={d} onOrder={openOrder} />
        </div>
        <div className="iso-treasury__rail">
          <HoldSweep data={d} myKey={me?.me.deviceKey ?? null} onApprove={(r) => openOrder({ asset: 'usdy', kind: r.kind, sweepDraftId: r.id, direct: true })} onSweep={(on) => void setSweep(on)} sweepBusy={sweepBusy} sweepError={sweepError} />
          <Activity data={d} myKey={me?.me.deviceKey ?? null} />
        </div>
      </div>

      {/* ── Risk and rules, and Zeke in the same 320 px rail as above (prompt 11 §4.1) ── */}
      <div className="iso-treasury__cols">
        <RiskRules data={d} />
        <div className="iso-surface iso-surface--ink iso-strip iso-treasury__zeke iso-rise iso-rise-5">
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
