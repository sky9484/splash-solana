'use client';

import { useState } from 'react';

import { api, ApiError, dateShort } from '../client';
import type { CompanyDTO } from '../types';
import { notifyCompanyChanged } from '../useCompany';

export type Beneficiary = {
  name: string;
  bank: string;
  accountLast4: string;
  /** A saved recipient was verified before; a new one carries its call-back. */
  saved: boolean;
  verification: { by: string; method: 'call-back' | 'supplier-account' } | null;
};

const HOW: Record<string, string> = { 'call-back': 'call-back', 'existing-record': 'an earlier record', 'supplier-account': 'the recipient’s account record' };

/**
 * Step 1: who receives it. A saved recipient's bank details were verified before; new bank details are
 * verified by a call-back to a number already on file, the same rule as a new supplier.
 */
export function StepBeneficiary({ org, value, onNext }: { org: CompanyDTO; value: Beneficiary | null; onNext: (b: Beneficiary) => void }) {
  const saved = org.suppliers;
  const startPick = value?.saved ? Math.max(0, saved.findIndex((s) => s.name === value.name && s.accountLast4 === value.accountLast4)) : 0;
  const [who, setWho] = useState<'saved' | 'new'>(value ? (value.saved ? 'saved' : 'new') : saved.length > 0 ? 'saved' : 'new');
  const [pick, setPick] = useState(startPick);
  const [name, setName] = useState(value && !value.saved ? value.name : '');
  const [bank, setBank] = useState(value && !value.saved ? value.bank : '');
  const [last4, setLast4] = useState(value && !value.saved ? value.accountLast4 : '');
  const [verifier, setVerifier] = useState(value?.verification?.by ?? org.me.personName);
  const [method, setMethod] = useState<'call-back' | 'supplier-account'>(value?.verification?.method ?? 'call-back');
  const [called, setCalled] = useState(!!value?.verification);
  const [tried, setTried] = useState(false);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  /** Take a saved recipient off the verified list: an owner's decision, confirmed first. */
  async function remove(i: number) {
    const s = saved[i];
    if (!s) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await api('/suppliers', { method: 'DELETE', body: { id: s.id } });
      setConfirming(null);
      setPick(0);
      notifyCompanyChanged();
    } catch (e) {
      setRemoveError(e instanceof ApiError ? e.message : 'The recipient could not be removed. Try again.');
    } finally {
      setRemoving(false);
    }
  }

  const chosen = who === 'saved' ? saved[pick] : null;
  const fresh = { name: name.trim(), bank: bank.trim(), accountLast4: last4.trim() };
  const newOk = fresh.name.length >= 2 && fresh.bank.length >= 2 && /^\d{4}$/.test(fresh.accountLast4);
  const ready = who === 'saved' ? !!chosen : newOk && called;
  const missing = who === 'saved' ? (chosen ? null : 'Choose a recipient.') : !newOk ? 'Add the name, bank and the last four digits of the account.' : !called ? 'Verify the new bank details by phone first.' : null;

  function next(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!ready) return;
    if (chosen) onNext({ name: chosen.name, bank: chosen.bank, accountLast4: chosen.accountLast4, saved: true, verification: null });
    else onNext({ ...fresh, saved: false, verification: { by: verifier.trim() || org.me.personName, method } });
  }

  return (
    <form className="sx-stack-lg" onSubmit={next} aria-labelledby="t-step-title" noValidate>
      {saved.length > 0 ? (
        <div className="sx-segmented" role="group" aria-label="Recipient">
          <button type="button" aria-pressed={who === 'saved'} onClick={() => setWho('saved')}>
            Saved recipient <span className="sx-muted">{saved.length}</span>
          </button>
          <button type="button" aria-pressed={who === 'new'} onClick={() => setWho('new')}>
            New recipient
          </button>
        </div>
      ) : null}

      {who === 'saved' && saved.length > 0 ? (
        <div className="sx-stack">
          <div className="sx-tpick" role="radiogroup" aria-label="Saved recipients">
            {saved.map((s, i) => (
              <div key={`${s.name}-${s.bank}-${s.accountLast4}`} className="sx-tpick-item">
                <button type="button" role="radio" aria-checked={pick === i} className="sx-tpick-row" onClick={() => setPick(i)}>
                  <span className="sx-radio" aria-hidden="true" />
                  <span className="sx-tpick-who">
                    <strong>{s.name}</strong>
                    <span className="sx-muted sx-small">
                      {s.bank} <span className="sx-mono">•••• {s.accountLast4}</span>
                    </span>
                  </span>
                  <span className="sx-pill sx-pill-ok">Verified {dateShort(s.verifiedAt)} by {HOW[s.method] ?? s.method}</span>
                </button>
                {org.me.isOwner ? (
                  confirming === i ? (
                    <span className="sx-tpick-confirm" role="group" aria-label={`Remove ${s.name}?`}>
                      <span className="sx-small">Remove {s.name}?</span>
                      <button type="button" className="sx-btn sx-btn-sm" disabled={removing} onClick={() => void remove(i)}>
                        {removing ? 'Removing…' : 'Yes, remove'}
                      </button>
                      <button type="button" className="sx-btn-link sx-small" disabled={removing} onClick={() => setConfirming(null)}>
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="sx-btn-link sx-small" onClick={() => { setConfirming(i); setRemoveError(null); }} aria-label={`Remove ${s.name} from saved recipients`}>
                      Remove
                    </button>
                  )
                ) : null}
              </div>
            ))}
          </div>
          {confirming !== null ? (
            <p className="sx-hint">Past payments keep their records. Paying this recipient again needs a new call-back, and the payout partner’s questions are asked again.</p>
          ) : null}
          {removeError ? (
            <p className="sx-small" role="alert">
              {removeError}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="sx-stack">
          <div className="sx-transfer-grid">
            <div className="sx-field">
              <label htmlFor="t-name">Recipient name</label>
              <input id="t-name" className="sx-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="organization" placeholder="e.g. Davao Packaging Corp." aria-invalid={tried && fresh.name.length < 2 ? true : undefined} />
            </div>
            <div className="sx-field">
              <label htmlFor="t-bank">Bank</label>
              <input id="t-bank" className="sx-input" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="e.g. BDO Unibank, Inc." aria-invalid={tried && fresh.bank.length < 2 ? true : undefined} />
            </div>
            <div className="sx-field">
              <label htmlFor="t-last4">Account ending</label>
              <input id="t-last4" className="sx-input sx-mono" value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="4 digits" aria-invalid={tried && !/^\d{4}$/.test(last4) ? true : undefined} />
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
              <div style={{ flex: '1 1 200px' }}>
                <label htmlFor="t-method">How</label>
                <select id="t-method" value={method} onChange={(e) => setMethod(e.target.value as 'call-back' | 'supplier-account')}>
                  <option value="call-back">Call-back to a known number</option>
                  <option value="supplier-account">Recipient’s account record</option>
                </select>
              </div>
            </div>
            <label className="sx-tick" data-on={called ? 'true' : undefined}>
              <input type="checkbox" checked={called} onChange={(e) => setCalled(e.target.checked)} />I verified these bank details
            </label>
          </div>
        </div>
      )}

      <div className="sx-row">
        <button type="submit" className="sx-btn">
          Continue to delivery
        </button>
        {tried && missing ? (
          <span className="sx-hint" role="status">
            {missing}
          </span>
        ) : null}
      </div>
    </form>
  );
}
