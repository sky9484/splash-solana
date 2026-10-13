'use client';

import Link from 'next/link';
import { useState } from 'react';

import { dateShort, php, usd } from './client';
import { EmptyVaultNotice, ShortfallNotice } from './Shortfall';
import { StatusPill } from './StatusPill';
import type { CompanyDTO } from './types';

export type TransferBody = {
  recipient: { name: string; bank: string; accountLast4: string };
  amountPhpMinor: string;
  reference: string | null;
  verification: { by: string; method: 'call-back' | 'supplier-account' } | null;
};

type Problem = { code: string; message: string; detail?: Record<string, unknown> };

/** "120,000.50" → "12000050" (centavos), with no floating point. null when not a valid amount. */
export function pesosToCentavos(input: string): string | null {
  const t = input.replace(/[₱,\s]|PHP/gi, '');
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const v = BigInt(m[1]!) * 100n + BigInt((m[2] ?? '0').padEnd(2, '0'));
  return v > 0n ? v.toString() : null;
}

const REF = /^[A-Za-z0-9][A-Za-z0-9\-/.]*$/;

/**
 * A transfer with no invoice (Sky, 13 Oct): who, how much, a reference. It is paid from the payments
 * vault like any payment, so an empty vault is funded first. A saved recipient's bank details were
 * verified before; a new one is verified by call-back here, the same rule as a new supplier.
 */
export function TransferStart({ org, busy, error, retryInvoiceId, onStart, onRetry }: { org: CompanyDTO; busy: boolean; error: Problem | null; retryInvoiceId: string | null; onStart: (b: TransferBody) => void; onRetry: () => void }) {
  const saved = org.suppliers;
  const [who, setWho] = useState<'saved' | 'new'>(saved.length > 0 ? 'saved' : 'new');
  const [pick, setPick] = useState(0);
  const [name, setName] = useState('');
  const [bank, setBank] = useState('');
  const [last4, setLast4] = useState('');
  const [verifier, setVerifier] = useState(org.me.personName);
  const [method, setMethod] = useState<'call-back' | 'supplier-account'>('call-back');
  const [called, setCalled] = useState(false);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');

  const balance = BigInt(org.balance.totalMinor);
  const treasury = org.treasury ? org.treasury.balanceMinor : '0';
  const centavos = pesosToCentavos(amount);
  const refOk = reference.trim() === '' || REF.test(reference.trim());
  const recipient = who === 'saved' && saved[pick] ? { name: saved[pick]!.name, bank: saved[pick]!.bank, accountLast4: saved[pick]!.accountLast4 } : { name: name.trim(), bank: bank.trim(), accountLast4: last4.trim() };
  const recipientOk = recipient.name.length >= 2 && recipient.bank.length >= 2 && /^\d{4}$/.test(recipient.accountLast4);
  const verifiedOk = who === 'saved' || called;
  const ready = balance > 0n && recipientOk && verifiedOk && centavos !== null && refOk;
  const transfers = org.payments.filter((p) => p.kind === 'transfer').slice(0, 5);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || !centavos) return;
    onStart({
      recipient,
      amountPhpMinor: centavos,
      reference: reference.trim() || null,
      verification: who === 'new' ? { by: verifier.trim() || org.me.personName, method } : null,
    });
  }

  return (
    <div className="sx-stack-lg">
      <div className="sx-transfer-funds">
        <div>
          <p className="sx-small sx-muted">Paid from your payments vault</p>
          <p className="sx-transfer-balance sx-num">{usd(org.balance.totalMinor)}</p>
        </div>
        <div>
          <p className="sx-small sx-muted">In your treasury</p>
          <p className="sx-num">
            {usd(treasury)} <Link href="/dashboard/treasury">Move to payments</Link>
          </p>
        </div>
      </div>
      {balance === 0n ? <EmptyVaultNotice treasuryMinor={treasury} /> : null}

      <form className="sx-card sx-stack-lg" onSubmit={submit} aria-label="Recipient and amount">
        <div className="sx-stack" role="group" aria-labelledby="t-who-title">
          <h3 id="t-who-title" className="sx-group-title">
            Who receives it
          </h3>
          {saved.length > 0 ? (
            <div className="sx-segmented" role="group" aria-label="Recipient">
              <button type="button" aria-pressed={who === 'saved'} onClick={() => setWho('saved')}>
                Saved recipient
              </button>
              <button type="button" aria-pressed={who === 'new'} onClick={() => setWho('new')}>
                New recipient
              </button>
            </div>
          ) : null}
          {who === 'saved' && saved.length > 0 ? (
            <div className="sx-field">
              <label htmlFor="t-saved">Recipient</label>
              <select id="t-saved" value={pick} onChange={(e) => setPick(Number(e.target.value))}>
                {saved.map((s, i) => (
                  <option key={`${s.name}-${s.accountLast4}`} value={i}>
                    {s.name} · {s.bank} •••• {s.accountLast4}
                  </option>
                ))}
              </select>
              {saved[pick] ? (
                <p className="sx-hint">
                  Bank details verified {dateShort(saved[pick]!.verifiedAt)} by {saved[pick]!.method === 'call-back' ? 'call-back' : saved[pick]!.method === 'existing-record' ? 'an earlier record' : 'the supplier’s account record'}.
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <div className="sx-transfer-grid">
                <div className="sx-field">
                  <label htmlFor="t-name">Recipient name</label>
                  <input id="t-name" className="sx-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="organization" />
                </div>
                <div className="sx-field">
                  <label htmlFor="t-bank">Bank</label>
                  <input id="t-bank" className="sx-input" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="e.g. BDO Unibank, Inc." />
                </div>
                <div className="sx-field">
                  <label htmlFor="t-last4">Account ending</label>
                  <input id="t-last4" className="sx-input sx-mono" value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="4 digits" aria-invalid={last4 !== '' && !/^\d{4}$/.test(last4) ? true : undefined} />
                </div>
              </div>
              <div className="sx-notice sx-notice-warn sx-stack">
                <div>
                  <h3>New bank details. Verify by phone before paying.</h3>
                  <p className="sx-small">Call the recipient on a number you already have, not one they just sent you.</p>
                </div>
                <div className="sx-row" style={{ alignItems: 'end' }}>
                  <div style={{ flex: '1 1 160px' }}>
                    <label htmlFor="t-verifier">Verified by</label>
                    <input id="t-verifier" className="sx-input" value={verifier} onChange={(e) => setVerifier(e.target.value)} />
                  </div>
                  <div style={{ flex: '1 1 180px' }}>
                    <label htmlFor="t-method">How</label>
                    <select id="t-method" value={method} onChange={(e) => setMethod(e.target.value as 'call-back' | 'supplier-account')}>
                      <option value="call-back">Call-back to a known number</option>
                      <option value="supplier-account">Recipient&rsquo;s account record</option>
                    </select>
                  </div>
                </div>
                <label className="sx-tick" data-on={called ? 'true' : undefined}>
                  <input type="checkbox" checked={called} onChange={(e) => setCalled(e.target.checked)} />
                  I verified these bank details
                </label>
              </div>
            </>
          )}
        </div>

        <div className="sx-transfer-grid" role="group" aria-label="Amount and reference">
          <div className="sx-field">
            <label htmlFor="t-amount">Amount (PHP)</label>
            <input id="t-amount" className="sx-input sx-num" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="120,000.00" aria-invalid={amount !== '' && !centavos ? true : undefined} aria-describedby="t-amount-hint" />
            <p id="t-amount-hint" className="sx-hint">
              {centavos ? `${php(centavos)} reaches the recipient. You see the USDC cost and every fee before you approve.` : 'Pesos the recipient receives, up to two decimals.'}
            </p>
          </div>
          <div className="sx-field">
            <label htmlFor="t-ref">Reference (optional)</label>
            <input id="t-ref" className="sx-input sx-mono" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="PO-1182" maxLength={64} aria-invalid={!refOk ? true : undefined} aria-describedby="t-ref-hint" />
            <p id="t-ref-hint" className="sx-hint">
              {refOk ? 'Shown on the receipt. Left empty, Splash makes one (TRF-date-code).' : 'Letters, digits, and - / . only, starting with a letter or digit.'}
            </p>
          </div>
        </div>

        {error && error.code === 'insufficient_balance' ? (
          <ShortfallNotice detail={error.detail} back={`/dashboard/transfer?quote=${retryInvoiceId ?? ''}`} onRetry={retryInvoiceId ? onRetry : undefined} busy={busy} />
        ) : error ? (
          <div className="sx-notice sx-notice-error" role="alert">
            <p>{error.message}</p>
          </div>
        ) : null}

        <div className="sx-row">
          <button type="submit" className="sx-btn" disabled={busy || !ready}>
            {busy ? 'Getting quotes…' : 'Compare routes'}
          </button>
          {!ready && balance > 0n ? (
            <span className="sx-hint">{!recipientOk ? 'Add who receives it.' : !verifiedOk ? 'Verify the new bank details first.' : !centavos ? 'Add the amount.' : !refOk ? 'Fix the reference.' : ''}</span>
          ) : null}
        </div>
      </form>

      <section aria-labelledby="transfers-title" className="sx-stack">
        <div className="sx-row" style={{ justifyContent: 'space-between' }}>
          <h2 id="transfers-title">Recent transfers</h2>
          <Link href="/dashboard/history">All payments</Link>
        </div>
        {transfers.length === 0 ? (
          <p className="sx-muted">No transfers yet. Payments with an invoice are under Invoices.</p>
        ) : (
          <ul className="sx-verify">
            {transfers.map((p) => (
              <li key={p.id} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                <span>
                  {p.supplierName} <span className="sx-num">{php(p.amountPhpMinor)}</span> <span className="sx-mono sx-small sx-muted">{p.invoiceNumber}</span>
                </span>
                <span>
                  <StatusPill state={p.state} label={p.stateLabel} /> {p.receiptId ? <Link href={`/dashboard/receipts/${p.receiptId}`}>Receipt</Link> : <Link href={`/dashboard/transfer?payment=${p.id}`}>Open</Link>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
