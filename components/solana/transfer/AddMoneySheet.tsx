// iso-ui
'use client';

import { useEffect, useState } from 'react';
import { Check, CircleDashed, ShieldAlert } from 'lucide-react';

import { AmountField, Combobox, IsoButton, Sheet, TestModeBadge } from '@/components/iso';
import { radioKeys, tabStop } from '@/components/iso/radio';

import { api, usd } from '../client';
import type { FundingDTO, FundingOptionsDTO } from '../types';
import { notifyCompanyChanged } from '../useCompany';
import { CryptoWallet, FIRST_ASSET, type Asset } from './CryptoWallet';
import { minorFromTyped, problemOf, type Problem } from './shared';

type Way = 'bank_card' | 'wallet';
const WAYS: Way[] = ['bank_card', 'wallet'];

/** What the sheet reads: a payment's options (Step 3) and Balance's top-up options have this shape. */
export type SheetOptions = Pick<FundingOptionsDTO, 'vaults' | 'neededMinor' | 'routes' | 'shortMinor' | 'priced' | 'sourcesOfFunds' | 'fundings' | 'simulated'>;

/** For a payment (Transfer, Step 3), or a top-up from Balance with an amount the person types. */
export type AddMoneyTarget = { kind: 'payment'; paymentId: string; quoteId: string; options: SheetOptions } | { kind: 'topup' };

/**
 * "Add money another way" (prompt 10 §5.6): a bank or card top-up, or a crypto wallet. The money lands
 * in the company's own Payments account and only counts after a funds check (screening fails closed,
 * and a person says where it comes from). The third party's charge is shown first; Splash's fee to add
 * money is US$0. Every way in is test mode in this build.
 */
export function AddMoneySheet({
  open,
  onClose,
  target,
  sourceOfFunds: given,
  onLanded,
  initialWay = 'bank_card',
}: {
  open: boolean;
  onClose: () => void;
  target: AddMoneyTarget;
  /** Which way in is chosen when the sheet opens (Balance has a button for each). */
  initialWay?: Way;
  sourceOfFunds: string | null;
  onLanded: () => void;
}) {
  const topup = target.kind === 'topup';
  const [typed, setTyped] = useState('');
  const [topOptions, setTopOptions] = useState<SheetOptions | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const amountMinor = topup ? (minorFromTyped(typed, 6) ?? '0') : null;
  // Balance: every way in, priced on the server for the amount typed (300 ms after the last key).
  useEffect(() => {
    if (!topup || !open) return;
    let stop = false;
    const t = window.setTimeout(async () => {
      try {
        const res = await api<SheetOptions>(`/topups?amountMinor=${amountMinor}`);
        if (!stop) setTopOptions(res);
      } catch (e) {
        if (!stop) setProblem(problemOf(e));
      }
    }, 300);
    return () => {
      stop = true;
      window.clearTimeout(t);
    };
  }, [topup, open, amountMinor]);
  const options: SheetOptions | null = target.kind === 'payment' ? target.options : topOptions;
  const live = target.kind === 'payment' ? (target.options.fundings.filter((x) => x.state !== 'held').at(-1) ?? null) : null;
  const [way, setWay] = useState<Way>(initialWay);
  const [asset, setAsset] = useState<Asset>(FIRST_ASSET);
  const [network, setNetwork] = useState<string | null>('solana');
  const [fromAddress, setFromAddress] = useState('');
  const [sourceOfFunds, setSourceOfFunds] = useState<string | null>(given);
  const [declared, setDeclared] = useState(false);
  const [funding, setFunding] = useState<FundingDTO | null>(live);
  const [busy, setBusy] = useState(false);

  // Read a funding under its check until it lands or is held. Reading never credits twice.
  useEffect(() => {
    if (!funding || (funding.state !== 'checking' && funding.state !== 'crediting')) return;
    let stop = false;
    const t = window.setInterval(async () => {
      try {
        const res = await api<{ funding: FundingDTO }>(`/fundings/${funding.id}`);
        if (stop) return;
        if (res.funding.state !== funding.state) setFunding(res.funding);
        if (res.funding.state === 'in_vault') {
          notifyCompanyChanged();
          onLanded();
        }
      } catch {
        /* keep reading */
      }
    }, 700);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [funding, onLanded]);

  // Every figure here is the server's: what to add, and each way in priced for it.
  const short = options && (!topup || options.shortMinor === amountMinor) ? options.shortMinor : '0';
  const routeId = way === 'bank_card' ? 'bank_card' : network ? `wallet:${asset}:${network}` : null;
  const route = options?.routes.find((r) => r.id === routeId) ?? null;
  const priced = options?.priced.find((p) => p.id === routeId) ?? null;
  const charge = priced?.chargeMinor ?? '0';
  const total = priced?.totalMinor ?? short;
  const addressOk = way === 'bank_card' || (route?.network === 'solana' ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(fromAddress.trim()) : /^0x[0-9a-fA-F]{40}$/.test(fromAddress.trim()));
  const why = short === '0' ? (topup ? (amountMinor === '0' ? 'Type how much to add.' : 'Working out the cost…') : 'Your Payments account already covers this payment.') : !route ? 'Choose how the money comes in.' : !route.available ? (route.unavailableReason ?? 'Not available yet.') : !addressOk ? 'Give the address of the wallet you send from.' : !sourceOfFunds ? 'Say where this money comes from.' : !declared ? 'Tick the declaration first.' : null;

  async function start() {
    if (why || !route) return;
    setBusy(true);
    setProblem(null);
    try {
      const fromWallet = way === 'wallet' ? fromAddress.trim() : null;
      const res =
        target.kind === 'payment'
          ? await api<{ funding: FundingDTO }>(`/payments/${target.paymentId}/fund`, { body: { source: route.id, quoteId: target.quoteId, fromAddress: fromWallet, sourceOfFunds, declared: true } })
          : await api<{ funding: FundingDTO }>('/topups', { body: { source: route.id, amountMinor: short, fromAddress: fromWallet, sourceOfFunds, declared: true } });
      setFunding(res.funding);
    } catch (e) {
      setProblem(problemOf(e));
    } finally {
      setBusy(false);
    }
  }

  const done = funding?.state === 'in_vault';
  const held = funding?.state === 'held';
  const going = funding && !done && !held;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add money"
      footer={
        done || held ? (
          <IsoButton variant="primary" onClick={onClose}>
            {done ? (topup ? 'Done' : 'Back to the payment') : 'Close'}
          </IsoButton>
        ) : (
          <>
            <IsoButton variant="primary" onClick={() => void start()} busy={busy || Boolean(going)} disabledReason={going ? null : why}>
              {going ? 'Checking the funds…' : way === 'wallet' ? `Approve ${usd(total)} in your wallet` : `Add ${usd(short)}`}
            </IsoButton>
            <IsoButton variant="quiet" onClick={onClose}>
              Cancel
            </IsoButton>
          </>
        )
      }
    >
      <p className="iso-small" style={{ margin: 0 }}>
        It lands in your own Payments account{topup ? '' : ', then pays this transfer'}. Splash fee to add money: <strong>US$0</strong>.
      </p>
      {topup && !funding ? <AmountField label="How much to add" currency="US$" value={typed} onChange={setTyped} help="From US$1.00. The provider’s charge is shown before anything is sent." /> : null}
      <dl className="iso-dl iso-dl--rows iso-num">
        <div>
          <dt>Your Payments account</dt>
          <dd>{options ? `${usd(options.vaults.paymentsMinor)} now` : '—'}</dd>
        </div>
        {topup ? null : (
          <>
            <div>
              <dt>This payment needs</dt>
              <dd>{options?.neededMinor ? usd(options.neededMinor) : '—'}</dd>
            </div>
            <div className="iso-dl__total">
              <dt>To add</dt>
              <dd>{usd(short)}</dd>
            </div>
          </>
        )}
      </dl>

      {funding ? (
        <ol className="iso-fundsteps" aria-live="polite">
          <li data-state="done">
            <Check size={16} aria-hidden="true" /> {usd(funding.amountMinor)} on its way · {funding.methodLabel}
          </li>
          <li data-state={funding.state === 'checking' || funding.state === 'crediting' ? 'now' : held ? 'stop' : 'done'}>
            {held ? <ShieldAlert size={16} aria-hidden="true" /> : funding.state === 'checking' || funding.state === 'crediting' ? <CircleDashed size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />} Funds check: {funding.checkWords}
          </li>
          <li data-state={done ? 'done' : held ? 'stop' : 'next'}>
            {done ? <Check size={16} aria-hidden="true" /> : <CircleDashed size={16} aria-hidden="true" />} {held ? 'Held: nothing reached your Payments account.' : 'Landed in your Payments account'}
          </li>
        </ol>
      ) : (
        <>
          <div className="iso-choices" role="radiogroup" aria-label="How the money comes in" onKeyDown={radioKeys(WAYS, way, setWay)}>
            <button type="button" role="radio" aria-checked={way === 'bank_card'} tabIndex={tabStop('bank_card', WAYS, way)} data-radio-value="bank_card" className="iso-choice" onClick={() => setWay('bank_card')}>
              <span className="iso-choice__title">
                Bank or card top-up <TestModeBadge inline />
              </span>
              <span className="iso-choice__body">Pay by bank transfer or card. It lands as US dollars in your Payments account.</span>
            </button>
            <button type="button" role="radio" aria-checked={way === 'wallet'} tabIndex={tabStop('wallet', WAYS, way)} data-radio-value="wallet" className="iso-choice" onClick={() => setWay('wallet')}>
              <span className="iso-choice__title">From a crypto wallet</span>
              <span className="iso-choice__body">From a wallet you control, on most networks. It lands as US dollars in your account.</span>
            </button>
          </div>
          {way === 'bank_card' && route ? (
            <dl className="iso-dl iso-dl--rows iso-num">
              <div>
                <dt>{route.chargeLabel}</dt>
                <dd>{usd(charge)}</dd>
              </div>
              <div>
                <dt>Splash fee</dt>
                <dd>US$0.00</dd>
              </div>
              <div className="iso-dl__total">
                <dt>You pay the provider</dt>
                <dd>{usd(total)}</dd>
              </div>
            </dl>
          ) : null}
          {way === 'wallet' ? (
            <CryptoWallet
              routes={options?.routes ?? []}
              asset={asset}
              onAsset={(a) => {
                setAsset(a);
                setFromAddress('');
              }}
              network={network}
              onNetwork={(n) => {
                setNetwork(n);
                setFromAddress('');
              }}
              fromAddress={fromAddress}
              onFromAddress={setFromAddress}
              amountLabel={usd(total)}
              disabled={busy}
            />
          ) : null}
          <Combobox
            label="Where this money comes from"
            options={(options?.sourcesOfFunds ?? []).map((o) => ({ value: o.value, label: o.label }))}
            value={sourceOfFunds}
            onChange={setSourceOfFunds}
            placeholder="Choose one"
          />
          <label className="iso-check">
            <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} />
            <span>I confirm this money belongs to the company and comes from where I said.</span>
          </label>
        </>
      )}
      {held ? (
        <p className="iso-note iso-note--danger" role="alert">
          The funds check held this money: {funding?.checkWords.toLowerCase()}. Nothing reached your Payments account. Try another way in, or talk to us.
        </p>
      ) : null}
      {problem ? (
        <p className="iso-note iso-note--danger" role="alert">
          {problem.message}
        </p>
      ) : null}
    </Sheet>
  );
}
