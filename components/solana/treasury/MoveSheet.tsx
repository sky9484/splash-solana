// iso-ui
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';

import { AmountField, IsoButton, Segmented, Sheet, TestModeBadge } from '@/components/iso';

import { api, ApiError, existingDeviceKey, signPrepared, usd } from '../client';
import type { CompanyDTO } from '../types';
import { notifyCompanyChanged } from '../useCompany';
import { dollarsToMinor } from './OrderSheet';
import type { TreasuryDTO } from './Treasury';

type From = 'treasury' | 'payments';
type Flow = { paymentsReserve: boolean; reserveInvestments: boolean } | null;
type Move = NonNullable<CompanyDTO['treasury']>['moves'][number];

/** US$ minor units → "7500.25" for the field (a shortfall is rounded up to a whole cent). */
function minorToInput(minor: string): string {
  const cents = (BigInt(minor) + 9_999n) / 10_000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

/**
 * Move money between the company's own Payments account and its Reserve (prompt 10 §7.1): an amount,
 * "All of it", and one approval on this device. Both are accounts of the company's own; Splash holds no
 * key to either. A shortfall from a payment arrives prefilled (?move=, Reserve to Payments), with a way
 * back to the payment (?back=). In test mode the Reserve can take test money.
 */
export function MoveSheet({ open, company, treasury, prefillMinor, back, onFlow, onClose }: { open: boolean; company: CompanyDTO; treasury: TreasuryDTO; prefillMinor: string | null; back: string | null; onFlow: (f: Flow) => void; onClose: () => void }) {
  const [from, setFrom] = useState<From>('treasury');
  const [amount, setAmount] = useState(prefillMinor ? minorToInput(prefillMinor) : '');
  const [busy, setBusy] = useState<null | 'move' | 'fund'>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<Move | null>(null);

  useEffect(() => onFlow(open ? { paymentsReserve: true, reserveInvestments: false } : null), [open, onFlow]);

  const balance: Record<From, bigint> = { treasury: BigInt(treasury.accounts.reserveMinor), payments: BigInt(treasury.accounts.paymentsMinor) };
  const minor = dollarsToMinor(amount);
  const over = minor !== null && BigInt(minor) > balance[from];
  const fromName = from === 'treasury' ? 'Reserve' : 'Payments account';
  const toName = from === 'treasury' ? 'Payments account' : 'Reserve';
  const why = !minor ? 'Enter an amount first.' : over ? `Your ${fromName} holds ${usd(balance[from])}.` : null;

  async function move() {
    if (busy) return;
    setBusy('move');
    setProblem(null);
    setDone(null);
    try {
      if (!company.me.canApprove) throw new ApiError('not_an_approver', 'This device can’t approve for your company yet. Finish setup on it.', 0);
      if (!(await existingDeviceKey(company.me.keyId))) throw new ApiError('no_device_key', 'This browser doesn’t hold your device’s approval key. Approve from the browser where you set up this device.', 0);
      const prepared = await api<{ move: Move; messages: Array<{ id: string; messageBase64: string }> }>('/treasury/moves', { body: { from, amountMinor: minor } });
      const approvals = await signPrepared(company.me.keyId, prepared.messages);
      const res = await api<{ move: Move }>(`/treasury/moves/${prepared.move.id}/approve`, { body: { signatures: approvals } });
      setDone(res.move);
      if (res.move.state === 'confirmed') setAmount('');
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'The move did not go through. Nothing moved. Try again.');
    } finally {
      setBusy(null);
      notifyCompanyChanged();
    }
  }

  async function addTestMoney() {
    setBusy('fund');
    setProblem(null);
    try {
      await api('/treasury/fund', { body: {} });
      notifyCompanyChanged();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Test money was not added. Try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Move money between accounts"
      footer={
        <div className="iso-stack" style={{ gap: 8 }}>
          <IsoButton variant="approve" size="lg" block onClick={() => void move()} busy={busy === 'move'} disabledReason={busy === 'fund' ? 'Adding test money first…' : busy ? null : why}>
            {busy === 'move' ? 'Approving on this device…' : 'Approve on this device'}
          </IsoButton>
          <span className="iso-small">Your device asks you to confirm. Only your team can move this money.</span>
        </div>
      }
    >
      <div className="iso-stack">
        <Segmented
          label="Which way"
          options={[
            { value: 'treasury', label: 'Reserve → Payments' },
            { value: 'payments', label: 'Payments → Reserve' },
          ]}
          value={from}
          onChange={(v) => {
            setFrom(v);
            setDone(null);
          }}
        />
        <div className="iso-stack" style={{ gap: 6 }}>
          <AmountField label={`Amount from your ${fromName}`} currency="US$" value={amount} onChange={setAmount} help={`Your ${fromName} holds ${usd(balance[from])}.`} error={over ? `That’s more than your ${fromName} holds.` : null} />
          {balance[from] > 0n ? (
            <span>
              <button type="button" className="iso-btn iso-btn--link" onClick={() => setAmount(minorToInput((balance[from] / 10_000n * 10_000n).toString()))}>
                All of it
              </button>
            </span>
          ) : null}
        </div>
        <dl className="iso-dl iso-dl--rows iso-num">
          <div>
            <dt>From</dt>
            <dd>{fromName}</dd>
          </div>
          <div>
            <dt>To</dt>
            <dd>{toName}</dd>
          </div>
          <div>
            <dt>Splash fee</dt>
            <dd>US$0.00</dd>
          </div>
        </dl>
        {from === 'payments' && minor && !over ? (
          <p className="iso-note">
            {BigInt(treasury.accounts.waitingMinor) > 0n ? `${usd(treasury.accounts.waitingMinor)} is waiting for approval in your Payments account; leave enough for it. ` : ''}
            The Reserve is kept for what’s due in the next 30 days, plus {treasury.reserve.marginPct}%.
          </p>
        ) : null}
        {done ? (
          <p className={`iso-note ${done.state === 'confirmed' ? 'iso-note--ok' : 'iso-note--amber'}`} role="status">
            {done.state === 'confirmed' ? <Check size={16} aria-hidden="true" /> : null}
            <span>
              {done.state === 'confirmed' ? `Moved ${usd(done.amountMinor)} to your ${done.to === 'payments' ? 'Payments account' : 'Reserve'}.` : done.state === 'checking' ? 'Checking whether the move went through. This page updates when it does.' : (done.problem?.message ?? 'Not moved. Nothing left your account.')}
              {done.state === 'confirmed' && back ? (
                <>
                  {' '}
                  <Link href={back}>Back to your payment</Link>
                </>
              ) : null}
            </span>
          </p>
        ) : null}
        {problem ? (
          <p className="iso-note iso-note--danger" role="alert">
            {problem}
          </p>
        ) : null}
        {treasury.simulator ? (
          <div className="iso-idle">
            <span className="iso-row">
              <TestModeBadge inline /> <strong className="iso-ink">Test money</strong>
            </span>
            <span className="iso-small">Add US$100,000.00 of test money to your Reserve to try moves and investments. No real money moves.</span>
            <span>
              <IsoButton variant="quiet" size="sm" onClick={() => void addTestMoney()} busy={busy === 'fund'} disabledReason={busy === 'move' ? 'A move is in progress.' : null}>
                Add test money to your Reserve
              </IsoButton>
            </span>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
