// iso-ui
'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';

import { AmountField, IsoButton, IsoDisplay, Segmented, Sheet, Tag, TestModeBadge, holdOverlay, useFocusTrap, useIsClient } from '@/components/iso';
// Imported from its own file so the contrast audit (which follows .tsx imports) sees the card's paper.
import { Ticket } from '@/components/iso/Ticket';
import type { OrderPreview } from '@/lib/solana-app/investments';
import type { Wire } from '@/lib/solana-app/json';

import { api, ApiError, approveTextWithDevice, existingDeviceKey, usd } from '../client';
import type { CompanyDTO } from '../types';
import { notifyCompanyChanged } from '../useCompany';
import type { TreasuryDTO } from './Treasury';

type Asset = 'usdy' | 'spy' | 'qqq' | 'nvda' | 'googl' | 'tsla';
type Kind = 'subscribe' | 'redeem' | 'buy' | 'sell';
type Path = 'market' | 'ondo';
/** `direct`: "Approve" on a drafted move (Hold or sweep, prompt 11 §4.3) goes straight to the approval moment. */
export type OrderIntent = { asset: Asset | string; kind: Kind; sweepDraftId?: string; direct?: boolean };
type PreviewDTO = Wire<OrderPreview>;
type Flow = { paymentsReserve: boolean; reserveInvestments: boolean } | null;

/** "10,000.50" → US$ minor units as a string, whole cents, no floating point. null when not an amount. */
export function dollarsToMinor(input: string): string | null {
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(input.replaceAll(',', '').trim());
  if (!m) return null;
  const v = BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? '0').padEnd(2, '0')) * 10_000n;
  return v > 0n ? v.toString() : null;
}

/** US$ minor units → "10000.50" for the field (whole cents, rounded down). */
function minorToInput(minor: string): string {
  const cents = BigInt(minor) / 10_000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

const TITLE: Record<Kind, (name: string) => string> = {
  subscribe: () => 'Subscribe to US Treasury bills',
  redeem: () => 'Redeem US Treasury bills',
  buy: (n) => `Buy ${n}`,
  sell: (n) => `Sell ${n}`,
};
const APPROVE_TITLE: Record<Kind, string> = { subscribe: 'Approve this subscription', redeem: 'Approve this redemption', buy: 'Approve this buy', sell: 'Approve this sale' };
const RISK = {
  tbill: 'Not a bank deposit; its value can fall.',
  // Prompt 11 §0.4: stocks used to say "via Ondo"; the stock sheets now name Treasurers, the stock partner.
  stock: 'Bought through Treasurers. You don’t own the share itself; prices move with the market and can fall.',
};

/**
 * An investment order (prompt 10 §7.2): a sheet with the amount, the path and what it does, then the
 * same approval moment as a payment, with the asset and its risk line. The device approves the exact
 * order text the server wrote; the server checks the rules again before anything settles. Before the
 * first subscription or buy, the owner confirms once that nobody behind the company is a US person.
 */
export function OrderSheet({ company, treasury, intent, onFlow, onClose }: { company: CompanyDTO; treasury: TreasuryDTO; intent: OrderIntent | null; onFlow: (f: Flow) => void; onClose: () => void }) {
  const [stage, setStage] = useState<'sheet' | 'approve'>('sheet');
  const [amount, setAmount] = useState('');
  const [path, setPath] = useState<Path | null>(null);
  const [preview, setPreview] = useState<PreviewDTO | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [tick, setTick] = useState(false);
  const [busy, setBusy] = useState(false);

  const kind = intent?.kind ?? 'subscribe';
  const asset = intent?.asset ?? 'usdy';
  const tbill = asset === 'usdy';
  const paying = kind === 'subscribe' || kind === 'buy';
  const sweep = intent?.sweepDraftId ?? null;
  const draftRow = sweep ? (treasury.sweep.rows.find((r) => r.id === sweep) ?? null) : null;
  const name = tbill ? 'US Treasury bills' : (treasury.stocks.rows.find((r) => r.id === asset)?.name ?? asset);
  const minor = sweep ? null : dollarsToMinor(amount);
  const needsGate = paying && !treasury.eligibility.confirmed;

  // Quote what the order would do whenever the amount or the path changes (a read; nothing moves).
  useEffect(() => {
    if (!intent || stage !== 'sheet') return;
    if (!sweep && !minor) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreview(null);
      return;
    }
    let live = true;
    const t = setTimeout(async () => {
      setQuoting(true);
      try {
        const body = sweep ? { sweepDraftId: sweep, ...(path ? { path } : {}) } : { asset, kind, amountMinor: minor, ...(path ? { path } : {}) };
        const r = await api<{ preview: PreviewDTO }>('/treasury/orders/quote', { body });
        if (!live) return;
        setPreview(r.preview);
        setProblem(null);
      } catch (e) {
        if (!live) return;
        setPreview(null);
        setProblem(e instanceof ApiError ? e.message : 'The order could not be priced. Try again.');
      } finally {
        if (live) setQuoting(false);
      }
    }, 280);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [intent, stage, sweep, minor, path, asset, kind]);

  // "Approve" on a drafted move opens the approval moment itself, once the order is priced and nothing
  // on the sheet needs the person first (the one-time eligibility confirmation). It never approves.
  useEffect(() => {
    if (!intent?.direct || stage !== 'sheet' || quoting || !preview?.ok || needsGate) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStage('approve');
  }, [intent, stage, quoting, preview, needsGate]);

  // The wires on the page carry the money while the sheet shows where it would go.
  useEffect(() => {
    if (!intent) {
      onFlow(null);
      return;
    }
    if (paying) {
      const fromPayments = preview?.from ? BigInt(preview.from.paymentsMinor) > 0n : true;
      onFlow({ paymentsReserve: fromPayments, reserveInvestments: true });
    } else onFlow(preview?.quote.landsIn === 'bank_wire' ? null : { paymentsReserve: true, reserveInvestments: true });
  }, [intent, paying, preview, onFlow]);

  if (!intent) return null;
  const limit = preview ? BigInt(preview.limit.maxMinor) : null;
  const chosenPath: Path = path ?? (preview?.request.path as Path | undefined) ?? 'market';
  // Exactly how much of this order each account gives (the Reserve's spare first), never a total
  // attached to one account's name.
  const fromLine = paying
    ? preview?.from
      ? [BigInt(preview.from.reserveMinor) > 0n ? `Reserve ${usd(preview.from.reserveMinor)}` : null, BigInt(preview.from.paymentsMinor) > 0n ? `Payments account ${usd(preview.from.paymentsMinor)}` : null].filter(Boolean).join(' + ')
      : `Your Reserve’s spare first, then your Payments account (${usd(treasury.available.totalMinor)} available to invest)`
    : `Investments account (you can ${kind} ${usd(preview?.redeemableMinor ?? (tbill ? (treasury.tbills.holding?.redeemableMinor ?? '0') : '0'))} now)`;
  const gateReason = needsGate && !(company.me.isOwner && tick) ? (company.me.isOwner ? 'Tick the confirmation above first. It’s asked once, before your first subscription or buy.' : 'Your company’s owner confirms this once, before the first subscription or buy.') : null;
  // The price on screen is for what was typed 280 ms ago until the new one answers: Approve waits for it,
  // so an order is never approved at the previous amount (review finding, 16 Oct).
  const stale = !sweep && preview !== null && preview.request.amountMinor !== minor;
  const why = quoting || stale ? 'Pricing the order…' : !preview ? (sweep ? 'Pricing the order…' : 'Enter an amount first.') : !preview.ok && !preview.gateOnly ? preview.problem : gateReason;

  async function review() {
    setBusy(true);
    setProblem(null);
    try {
      if (needsGate && company.me.isOwner && tick) {
        await api('/treasury/eligibility', { body: { confirm: true } });
        notifyCompanyChanged();
      }
      setStage('approve');
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'The confirmation did not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Sheet
        open={stage === 'sheet'}
        onClose={onClose}
        title={sweep && preview ? (draftRow?.purpose === 'quarter_interest' ? `Interest back: redeem ${usd(preview.request.amountMinor)}` : `Sweep: ${preview.request.kind} ${usd(preview.request.amountMinor)}`) : TITLE[kind](name)}
        footer={
          <div className="iso-stack" style={{ gap: 8 }}>
            <IsoButton variant="approve" size="lg" block onClick={() => void review()} busy={busy} disabledReason={busy ? null : why}>
              Review and approve
            </IsoButton>
            <span className="iso-small">On the next screen your device asks you to confirm. A second approver is needed if your rules say so.</span>
          </div>
        }
      >
        <div className="iso-stack">
          <span className="iso-row">
            <TestModeBadge />
            {sweep ? <Tag tone="ink">Zeke drafted</Tag> : null}
          </span>
          {sweep && draftRow?.purpose === 'quarter_interest' ? (
            <p className="iso-note" style={{ margin: 0 }}>
              Drafted by Zeke: last quarter’s interest ({draftRow.months ?? 'last quarter'}), back to your Payments account. Nothing moves until you approve.
            </p>
          ) : sweep ? (
            <p className="iso-note" style={{ margin: 0 }}>
              Drafted by Zeke from your sweep rule: keep the reserve at its floor and at least {usd(treasury.sweep.cushionMinor)} in Payments. Your owner chose T-bills when turning sweep on; Zeke didn’t. Nothing moves until you approve.
            </p>
          ) : null}
          {/* §7.2: a subscription's path is the planner's, and the sheet says which and why. A redemption
              offers Ondo's wire as a second path, with what that means. */}
          {tbill && kind === 'subscribe' && preview ? (
            <p className="iso-note" role="status" style={{ margin: 0 }}>
              {preview.request.path === 'ondo'
                ? `Straight from Ondo: on the market this order would move the price more than 0.30%, so it goes to Ondo, with no price to move. The units are held ${treasury.tbills.holdDays} days before you can redeem them.`
                : 'On the market: this order stays within the 0.30% price-moved limit, so it’s bought on the market, with no hold.'}
            </p>
          ) : null}
          {tbill && kind === 'redeem' && !sweep ? (
            <div className="iso-stack" style={{ gap: 6 }}>
              <span className="iso-small">How</span>
              <Segmented
                label="How to redeem"
                options={[
                  { value: 'market', label: 'On the market' },
                  { value: 'ondo', label: 'With Ondo, by wire' },
                ]}
                value={chosenPath}
                onChange={(v) => setPath(v)}
              />
              <span className="iso-small">
                {chosenPath === 'ondo'
                  ? 'With Ondo, US dollars go by bank wire to your company’s bank account, outside Splash. They never land in your Payments account.'
                  : 'On the market: the money lands in your Payments account.'}
              </span>
            </div>
          ) : null}
          {sweep ? null : (
            <div className="iso-stack" style={{ gap: 6 }}>
              <AmountField label="Amount" currency="US$" value={amount} onChange={setAmount} help={preview ? preview.limit.why : paying ? `Available to invest: ${usd(treasury.available.totalMinor)}.` : null} />
              {limit !== null && limit > 0n ? (
                <span>
                  <button type="button" className="iso-btn iso-btn--link" onClick={() => setAmount(minorToInput(limit.toString()))}>
                    Use {usd(limit)}, the most for this order today
                  </button>
                </span>
              ) : null}
            </div>
          )}
          <dl className="iso-dl iso-dl--rows iso-num" aria-live="polite" aria-busy={quoting}>
            <div>
              <dt>From</dt>
              <dd>{fromLine}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd className="iso-sheet__amount">{preview ? usd(preview.request.amountMinor) : minor ? usd(minor) : '–'}</dd>
            </div>
            <div>
              <dt>{preview?.words.unitsLabel ?? (paying ? 'You get about' : 'Units')}</dt>
              <dd>{preview?.words.units ?? '–'}</dd>
            </div>
            <div>
              <dt>{preview?.words.howLabel ?? (tbill ? 'How' : 'Price moved by')}</dt>
              <dd>{preview?.words.how ?? '–'}</dd>
            </div>
            <div>
              <dt>Splash fee</dt>
              <dd>US$0.00</dd>
            </div>
            <div>
              <dt>{preview?.words.landsLabel ?? (paying ? 'Lands in' : 'Money goes to')}</dt>
              <dd>{preview?.words.lands ?? (paying ? 'Investments account' : 'Payments account')}</dd>
            </div>
          </dl>
          {preview ? <p className="iso-note">{preview.note}</p> : null}
          {preview && !preview.ok && !preview.gateOnly && preview.problem ? (
            <p className="iso-note iso-note--danger" role="alert">
              {preview.problem}
            </p>
          ) : null}
          {problem ? (
            <p className="iso-note iso-note--danger" role="alert">
              {problem}
            </p>
          ) : null}
          {needsGate ? (
            company.me.isOwner ? (
              <label className="iso-check">
                <input type="checkbox" checked={tick} onChange={(e) => setTick(e.target.checked)} />
                <span>
                  I confirm: no owner (25% or more), director or approver of {treasury.companyName} is a US person or in a restricted country. Asked once, before the first subscription or buy.
                </span>
              </label>
            ) : (
              <p className="iso-note iso-note--amber" role="status">
                Your company’s owner confirms once that no owner (25% or more), director or approver is a US person or in a restricted country. Ask them to open Treasury.
              </p>
            )
          ) : null}
          <p className="iso-small" style={{ margin: 0 }}>
            <strong>{tbill ? RISK.tbill : RISK.stock}</strong> Splash doesn’t advise on investments.
          </p>
        </div>
      </Sheet>
      {stage === 'approve' && preview ? (
        <OrderApproval
          company={company}
          preview={preview}
          name={name}
          sweep={Boolean(sweep)}
          fromLine={fromLine}
          onCancel={() => setStage('sheet')}
          onDone={() => {
            notifyCompanyChanged();
            onClose();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The approval moment for an order (§5.7, §7.2): the order, its risk line and "Approve on this device".
 * One press: the server writes the order text (valid 60 seconds) after checking the rules and the
 * eligibility gate, this device approves that text, and the server checks the approval and the rules
 * again before the simulator settles it.
 */
function OrderApproval({ company, preview, name, sweep, fromLine, onCancel, onDone }: { company: CompanyDTO; preview: PreviewDTO; name: string; sweep: boolean; fromLine: string; onCancel: () => void; onDone: () => void }) {
  const client = useIsClient();
  const box = useRef<HTMLDivElement>(null);
  const approveRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ receiptId: string | null; lands: string } | null>(null);
  const kind = preview.request.kind as Kind;
  const tbill = preview.request.asset === 'usdy';

  useEffect(() => holdOverlay('approval'), []);
  useFocusTrap(box, client, () => {
    if (!busy) (done ? onDone : onCancel)();
  }, done ? doneRef : approveRef);
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  async function approve() {
    setBusy(true);
    setProblem(null);
    try {
      if (!company.me.canApprove) throw new ApiError('not_an_approver', 'This device can’t approve for your company yet. Finish setup on it.', 0);
      if (!(await existingDeviceKey(company.me.keyId))) throw new ApiError('no_device_key', 'This browser doesn’t hold your device’s approval key. Approve from the browser where you set up this device.', 0);
      const body = preview.request.sweepDraftId ? { sweepDraftId: preview.request.sweepDraftId, path: preview.request.path } : { asset: preview.request.asset, kind, amountMinor: preview.request.amountMinor, path: preview.request.path };
      const prepared = await api<{ order: { id: string }; message: string }>('/treasury/orders', { body });
      const approval = await approveTextWithDevice(company.me.keyId, prepared.message);
      const res = await api<{ order: { receiptId: string | null; landsIn: string } }>(`/treasury/orders/${prepared.order.id}/approve`, { body: { signature: approval } });
      setDone({ receiptId: res.order.receiptId, lands: res.order.landsIn });
      notifyCompanyChanged();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'The order did not go through. Nothing moved. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!client) return null;
  const landed = done?.lands === 'investments' ? 'The units are in your Investments account.' : done?.lands === 'payments' ? 'The money is in your Payments account.' : 'Ondo sends US dollars by bank wire to your company’s bank account, outside Splash.';
  return createPortal(
    <div className="iso iso-modal-root">
      <div ref={box} className="iso-modal">
        <Ticket
          card
          layoutId="treasury-ticket"
          role="dialog"
          aria-modal
          aria-labelledby="tr-approve-title"
          band={
            <span>
              {sweep ? 'Drafted by Zeke from your sweep rule' : `Prepared by ${company.me.personName}`} · <strong>a person approves</strong>
            </span>
          }
          footer={
            done ? (
              <div className="iso-stack">
                <p className="iso-approved" role="status">
                  <span className="iso-tick" aria-hidden="true">
                    <Check size={18} strokeWidth={3} />
                  </span>
                  <span>
                    <strong>Approved by you.</strong> Settled in test mode. {landed}
                  </span>
                </p>
                <div className="iso-actions">
                  {done.receiptId ? (
                    <IsoButton variant="quiet" href={`/dashboard/receipts/${done.receiptId}`}>
                      See the receipt
                    </IsoButton>
                  ) : null}
                  <IsoButton ref={doneRef} variant="primary" size="lg" onClick={onDone}>
                    Done
                  </IsoButton>
                </div>
              </div>
            ) : (
              <div className="iso-stack">
                <div className="iso-actions">
                  <IsoButton ref={approveRef} variant="approve" size="lg" onClick={() => void approve()} busy={busy}>
                    {busy ? 'Approving on this device…' : 'Approve on this device'}
                  </IsoButton>
                  <IsoButton variant="quiet" onClick={onCancel} disabled={busy}>
                    Back
                  </IsoButton>
                </div>
                <p className="iso-small" style={{ margin: 0 }}>
                  Your device asks you to confirm. Before anything settles we check your rules again; if something changed, you’ll see what and why.
                </p>
              </div>
            )
          }
        >
          <div className="iso-row" style={{ justifyContent: 'space-between' }}>
            <h2 id="tr-approve-title" className="iso-h3">
              {APPROVE_TITLE[kind]}
            </h2>
            <button type="button" className="iso-iconbtn" aria-label="Back to the order" onClick={done ? onDone : onCancel} disabled={busy}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <section className="iso-stack" aria-label="The order">
            <div className="iso-row">
              <span>
                {kind === 'subscribe' ? 'Subscribe' : kind === 'redeem' ? 'Redeem' : kind === 'buy' ? 'Buy' : 'Sell'} · {name}
              </span>
              <TestModeBadge inline />
            </div>
            <div className="iso-ticket__perf">
              <span className="iso-small">Amount</span>
              <IsoDisplay size="lg">{usd(preview.request.amountMinor)}</IsoDisplay>
            </div>
            <dl className="iso-dl iso-dl--rows iso-num">
              <div>
                <dt>From</dt>
                <dd>{fromLine}</dd>
              </div>
              <div>
                <dt>{preview.words.unitsLabel}</dt>
                <dd>{preview.words.units}</dd>
              </div>
              <div>
                <dt>{preview.words.howLabel}</dt>
                <dd>{preview.words.how}</dd>
              </div>
              <div>
                <dt>Splash fee</dt>
                <dd>US$0.00</dd>
              </div>
              <div>
                <dt>{preview.words.landsLabel}</dt>
                <dd>{preview.words.lands}</dd>
              </div>
            </dl>
            <p className="iso-note iso-note--amber" style={{ margin: 0 }}>
              <strong>{tbill ? RISK.tbill : RISK.stock}</strong>
            </p>
            {problem ? (
              <p className="iso-note iso-note--danger" role="alert">
                {problem}
              </p>
            ) : null}
            <p className="iso-small" style={{ margin: 0 }}>
              Test mode: no real money moves, and prices are test prices.
            </p>
          </section>
        </Ticket>
      </div>
    </div>,
    document.body,
  );
}
