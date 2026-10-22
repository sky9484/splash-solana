'use client';

import { useState } from 'react';

import { php } from '../client';
import type { Beneficiary } from './StepBeneficiary';

export type Delivery = { amountPhpMinor: string; reference: string };

/** "120,000.50" → "12000050" (centavos), with no floating point. null when not a valid amount. */
export function pesosToCentavos(input: string): string | null {
  const t = input.replace(/[₱,\s]|PHP/gi, '');
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const v = BigInt(m[1]!) * 100n + BigInt((m[2] ?? '0').padEnd(2, '0'));
  return v > 0n ? v.toString() : null;
}

function centavosToInput(minor: string): string {
  const s = minor.padStart(3, '0');
  return `${s.slice(0, -2).replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${s.slice(-2)}`;
}

const REF = /^[A-Za-z0-9][A-Za-z0-9\-/.]*$/;

/**
 * Step 2: how much reaches the recipient, and how. Pesos to their bank account through the payout
 * partner, the one delivery this corridor has. The quote and every fee come at Step 3, before anything
 * is approved.
 */
export function StepDelivery({ beneficiary, value, busy, onBack, onNext }: { beneficiary: Beneficiary; value: Delivery | null; busy: boolean; onBack: () => void; onNext: (d: Delivery) => void }) {
  const [amount, setAmount] = useState(value ? centavosToInput(value.amountPhpMinor) : '');
  const [reference, setReference] = useState(value?.reference ?? '');
  const [tried, setTried] = useState(false);
  const centavos = pesosToCentavos(amount);
  const refOk = reference.trim() === '' || REF.test(reference.trim());

  function next(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!centavos || !refOk) return;
    onNext({ amountPhpMinor: centavos, reference: reference.trim() });
  }

  return (
    <form className="sx-stack-lg" onSubmit={next} aria-labelledby="t-step-title" noValidate>
      <div className="sx-tdeliver" role="radiogroup" aria-label="Delivery">
        <div role="radio" aria-checked="true" tabIndex={0} className="sx-tdeliver-tile">
          <span className="sx-radio" aria-hidden="true" />
          <span>
            <strong>Bank deposit in pesos</strong>
            <span className="sx-muted sx-small">
              To {beneficiary.name} at {beneficiary.bank} <span className="sx-mono">•••• {beneficiary.accountLast4}</span>. The payout partner pays the bank once the USDC reaches it.
            </span>
          </span>
        </div>
      </div>

      <div className="sx-transfer-grid">
        <div className="sx-field">
          <label htmlFor="t-amount">Amount the recipient receives (PHP)</label>
          <div className="sx-tamount">
            <span aria-hidden="true">₱</span>
            <input id="t-amount" className="sx-input sx-num" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="120,000.00" aria-invalid={tried && !centavos ? true : undefined} aria-describedby="t-amount-hint" autoComplete="off" />
          </div>
          <p id="t-amount-hint" className="sx-hint">
            {centavos ? `${php(centavos)} reaches the recipient. You see the USDC cost and every fee at Step 3, before you approve.` : tried ? 'Enter the pesos the recipient receives, up to two decimals.' : 'Pesos the recipient receives, up to two decimals.'}
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

      <div className="sx-row">
        <button type="submit" className="sx-btn" disabled={busy}>
          {busy ? 'Getting the quote…' : 'Get the quote'}
        </button>
        <button type="button" className="sx-btn-link" onClick={onBack}>
          Back to the recipient
        </button>
      </div>
    </form>
  );
}
