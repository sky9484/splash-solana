'use client';

import { useState } from 'react';

import { dateShort } from '../client';
import type { DetailsDTO, DetailsOptionsDTO } from '../types';

type Purpose = DetailsDTO['purpose'];
type Relationship = DetailsDTO['relationship'];
type Source = DetailsDTO['sourceOfFunds'];
type RecipientType = DetailsDTO['recipient']['type'];

export type DetailsBody =
  | { reuse: true }
  | {
      details: {
        purpose: Purpose;
        description: string;
        relationship: Relationship;
        sourceOfFunds: Source;
        recipient: { type: RecipientType; registrationNumber: string | null; idNumber: string | null; dateOfBirth: string | null; addressLine1: string; addressCity: string; addressCountry: 'PH'; accountName: string };
      };
    };

/** The answers, as the partner will read them. */
export function DetailsSummary({ d }: { d: DetailsDTO }) {
  const r = d.recipient;
  return (
    <dl className="sx-kv sx-tdetails-kv">
      <dt>Purpose</dt>
      <dd>
        <strong>{d.purposeLabel}</strong>: {d.description}
      </dd>
      <dt>Relationship</dt>
      <dd>{d.relationshipLabel}</dd>
      <dt>Money from</dt>
      <dd>{d.sourceOfFundsLabel}</dd>
      <dt>Recipient</dt>
      <dd>
        {r.type === 'business' ? 'Business' : 'Individual'}
        {r.registrationNumber ? (
          <>
            {' '}
            · registration <span className="sx-mono">{r.registrationNumber}</span>
          </>
        ) : null}
        {r.idNumber ? (
          <>
            {' '}
            · ID <span className="sx-mono">{r.idNumber}</span>
          </>
        ) : null}
        {r.dateOfBirth ? <> · born {r.dateOfBirth}</> : null}
        <br />
        {r.addressLine1}, {r.addressCity}, Philippines
        <br />
        Account holder: {r.accountName}
      </dd>
    </dl>
  );
}

/**
 * Step 3.1: what the payout partner needs with this transfer. The first transfer to a recipient asks
 * everything; the next one asks "Same details as before?". Yes copies them; no asks every question
 * again, on an empty form.
 */
export function PaymentDetails({
  recipientName,
  given,
  previous,
  options,
  busy,
  error,
  onSave,
  onChange,
}: {
  recipientName: string;
  given: DetailsDTO | null;
  previous: DetailsDTO | null;
  options: DetailsOptionsDTO;
  busy: boolean;
  error: { message: string; missing?: string[] } | null;
  onSave: (body: DetailsBody) => void;
  onChange: () => void;
}) {
  const [answerAgain, setAnswerAgain] = useState(false);

  if (given) {
    return (
      <div className="sx-stack">
        <p className="sx-tok">
          <span aria-hidden="true">✓</span> {given.reused ? 'Same details as before, confirmed by ' : 'Given by '}
          {given.givenBy}. The payout partner receives these with the payment.
        </p>
        <DetailsSummary d={given} />
        <button type="button" className="sx-btn-link" onClick={onChange} disabled={busy}>
          Change these details
        </button>
      </div>
    );
  }

  if (previous && !answerAgain) {
    return (
      <div className="sx-stack">
        <div className="sx-tsame">
          <h4 id="t-same">Same details as before?</h4>
          <p className="sx-small sx-muted">
            You paid {recipientName} before. These went with that payment on {dateShort(previous.givenAt)}.
          </p>
        </div>
        <DetailsSummary d={previous} />
        <div className="sx-row" role="group" aria-labelledby="t-same">
          <button type="button" className="sx-btn" disabled={busy} onClick={() => onSave({ reuse: true })}>
            {busy ? 'Saving…' : 'Yes, same details'}
          </button>
          <button type="button" className="sx-btn sx-btn-ghost" disabled={busy} onClick={() => setAnswerAgain(true)}>
            No, answer again
          </button>
        </div>
        {error ? (
          <p className="sx-small" role="alert">
            {error.message}
          </p>
        ) : null}
      </div>
    );
  }

  return <DetailsForm recipientName={recipientName} firstTime={!previous} options={options} busy={busy} error={error} onSave={onSave} />;
}

function DetailsForm({
  recipientName,
  firstTime,
  options,
  busy,
  error,
  onSave,
}: {
  recipientName: string;
  firstTime: boolean;
  options: DetailsOptionsDTO;
  busy: boolean;
  error: { message: string; missing?: string[] } | null;
  onSave: (body: DetailsBody) => void;
}) {
  const [purpose, setPurpose] = useState<Purpose | ''>('');
  const [description, setDescription] = useState('');
  const [relationship, setRelationship] = useState<Relationship | ''>('');
  const [source, setSource] = useState<Source | ''>('');
  const [type, setType] = useState<RecipientType | ''>('');
  const [registration, setRegistration] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [dob, setDob] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [accountName, setAccountName] = useState(recipientName);
  const [tried, setTried] = useState(false);

  const missing: string[] = [];
  if (!purpose) missing.push('Purpose of payment');
  if (description.trim().length < 3) missing.push('What was bought');
  if (!relationship) missing.push('Your relationship to the recipient');
  if (!source) missing.push('Where the money comes from');
  if (!type) missing.push('Business or individual');
  if (type === 'business' && registration.trim().length < 3) missing.push('Company registration number');
  if (type === 'individual' && idNumber.trim().length < 3 && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) missing.push('Date of birth or ID number');
  if (address.trim().length < 3 || city.trim().length < 2) missing.push('Recipient address');
  if (accountName.trim().length < 2) missing.push('Account holder name');
  const shown = tried ? missing : [];
  const bad = (label: string) => (shown.includes(label) ? true : undefined);

  function save(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (missing.length || !purpose || !relationship || !source || !type) return;
    onSave({
      details: {
        purpose,
        description: description.trim(),
        relationship,
        sourceOfFunds: source,
        recipient: {
          type,
          registrationNumber: type === 'business' ? registration.trim() : null,
          idNumber: type === 'individual' ? idNumber.trim() || null : null,
          dateOfBirth: type === 'individual' ? dob || null : null,
          addressLine1: address.trim(),
          addressCity: city.trim(),
          addressCountry: 'PH',
          accountName: accountName.trim(),
        },
      },
    });
  }

  return (
    <form className="sx-stack-lg" onSubmit={save} aria-label="About this payment" noValidate>
      <fieldset className="sx-tfield">
        <legend>Why are you sending this?</legend>
        <div className="sx-tchoice" role="radiogroup" aria-label="Purpose of payment">
          {options.purposes.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={purpose === o.value} className="sx-tchoice-tile" data-invalid={bad('Purpose of payment') ? 'true' : undefined} onClick={() => setPurpose(o.value as Purpose)}>
              <span className="sx-radio" aria-hidden="true" />
              <span>
                <strong>{o.label}</strong>
                <span className="sx-small sx-muted">{o.value === 'goods' ? 'Products, materials, stock' : 'Freight, design, maintenance, consulting'}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="sx-field" style={{ marginTop: 14 }}>
          <label htmlFor="d-desc">What was bought</label>
          <input id="d-desc" className="sx-input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={140} placeholder={purpose === 'services' ? 'e.g. Sea freight, October shipment' : 'e.g. Corrugated cartons, October order'} aria-invalid={bad('What was bought')} />
          <p className="sx-hint">A few words the partner can match to the invoice or contract.</p>
        </div>
      </fieldset>

      <div className="sx-transfer-grid">
        <div className="sx-field">
          <label htmlFor="d-rel">Your relationship to the recipient</label>
          <select id="d-rel" value={relationship} onChange={(e) => setRelationship(e.target.value as Relationship)} aria-invalid={bad('Your relationship to the recipient')}>
            <option value="">Choose…</option>
            {options.relationships.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="sx-field">
          <label htmlFor="d-src">Where the money comes from</label>
          <select id="d-src" value={source} onChange={(e) => setSource(e.target.value as Source)} aria-invalid={bad('Where the money comes from')}>
            <option value="">Choose…</option>
            {options.sourcesOfFunds.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="sx-tfield">
        <legend>About the recipient</legend>
        {firstTime ? <p className="sx-small sx-muted">The first payment to {recipientName}. The partner asks once who receives it; next time you can say “same details as before”.</p> : <p className="sx-small sx-muted">Answer again for {recipientName}. These replace what was given last time.</p>}
        <div className="sx-segmented" role="group" aria-label="Business or individual" style={{ marginTop: 10 }}>
          <button type="button" aria-pressed={type === 'business'} onClick={() => setType('business')}>
            Business
          </button>
          <button type="button" aria-pressed={type === 'individual'} onClick={() => setType('individual')}>
            Individual
          </button>
        </div>
        {bad('Business or individual') ? <p className="sx-hint">Choose business or individual.</p> : null}
        {type === 'business' ? (
          <div className="sx-field" style={{ marginTop: 14 }}>
            <label htmlFor="d-reg">Company registration number (SEC or DTI)</label>
            <input id="d-reg" className="sx-input sx-mono" value={registration} onChange={(e) => setRegistration(e.target.value)} maxLength={40} placeholder="CS201912345" aria-invalid={bad('Company registration number')} />
          </div>
        ) : null}
        {type === 'individual' ? (
          <div className="sx-transfer-grid" style={{ marginTop: 14 }}>
            <div className="sx-field">
              <label htmlFor="d-dob">Date of birth</label>
              <input id="d-dob" type="date" className="sx-input" value={dob} onChange={(e) => setDob(e.target.value)} aria-invalid={bad('Date of birth or ID number')} />
            </div>
            <div className="sx-field">
              <label htmlFor="d-id">or national ID number</label>
              <input id="d-id" className="sx-input sx-mono" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} maxLength={40} aria-invalid={bad('Date of birth or ID number')} />
            </div>
          </div>
        ) : null}
        <div className="sx-transfer-grid" style={{ marginTop: 14 }}>
          <div className="sx-field">
            <label htmlFor="d-addr">Street address</label>
            <input id="d-addr" className="sx-input" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={160} autoComplete="off" placeholder="88 Quimpo Boulevard" aria-invalid={bad('Recipient address')} />
          </div>
          <div className="sx-field">
            <label htmlFor="d-city">City</label>
            <input id="d-city" className="sx-input" value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} autoComplete="off" placeholder="Davao City" aria-invalid={bad('Recipient address')} />
            <p className="sx-hint">Philippines</p>
          </div>
        </div>
        <div className="sx-field" style={{ marginTop: 4 }}>
          <label htmlFor="d-acct">Account holder name, as the bank has it</label>
          <input id="d-acct" className="sx-input" value={accountName} onChange={(e) => setAccountName(e.target.value)} maxLength={140} aria-invalid={bad('Account holder name')} />
          <p className="sx-hint">Banks return payments when this does not match the account.</p>
        </div>
      </fieldset>

      {shown.length || error ? (
        <div className="sx-notice sx-notice-warn" role="alert">
          <p className="sx-small">{shown.length ? `Still needed: ${shown.join(', ')}.` : error?.message}</p>
        </div>
      ) : null}

      <div className="sx-row">
        <button type="submit" className="sx-btn" disabled={busy}>
          {busy ? 'Saving…' : 'Save these details'}
        </button>
      </div>
    </form>
  );
}
