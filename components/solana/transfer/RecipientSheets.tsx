// iso-ui
'use client';

import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, LockKeyhole } from 'lucide-react';

import { Combobox, IsoButton, MaskedField, Segmented, Sheet, Tag, TextField, groupDigits } from '@/components/iso';
import { radioKeys, tabStop } from '@/components/iso/radio';

import { api, approveTextWithDevice, existingDeviceKey } from '../client';
import type { CompanyDTO } from '../types';
import { createReveal, revealSecondsLeft, type RevealClock, type Revealed } from './reveal';
import { problemOf, shortName, type BankOption, type Problem, type RecipientRow } from './shared';

type CheckWhen = 'now' | 'later';

/** The server's field names, as this form names them. */
const SERVER_FIELD: Record<string, string> = { accountNumber: 'acct', accountNumberAgain: 'again', registration: 'registration', personId: 'personId', holderName: 'holder', addressLine: 'address', city: 'city' };

/**
 * "New bank recipient" (prompt 10 §5.3, frame Flow-T1-Recipient). The full account number is typed
 * twice (paste is off on the second entry) and goes straight to the server, which seals it (Phase S);
 * this page keeps it only while the sheet is open. A recipient checked later can't be paid until
 * someone makes the call-back.
 */
export function NewRecipientSheet({ open, onClose, banks, personName, onSaved }: { open: boolean; onClose: () => void; banks: BankOption[]; personName: string; onSaved: (r: RecipientRow) => void }) {
  const [kind, setKind] = useState<'business' | 'person'>('business');
  const [name, setName] = useState('');
  const [registration, setRegistration] = useState('');
  const [personId, setPersonId] = useState('');
  const [bankCode, setBankCode] = useState<string | null>(null);
  const [acct, setAcct] = useState('');
  const [again, setAgain] = useState('');
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const [holder, setHolder] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [when, setWhen] = useState<CheckWhen>('now');
  const [by, setBy] = useState(personName);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  // A closed sheet forgets what was typed, the account number first.
  useEffect(() => {
    if (open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- clearing a closed form, once per close */
    setAcct('');
    setAgain('');
    setName('');
    setRegistration('');
    setPersonId('');
    setBankCode(null);
    setHolder('');
    setAddress('');
    setCity('');
    setWhen('now');
    setTried(false);
    setProblem(null);
    setPasteNote(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  const bank = banks.find((b) => b.code === bankCode) ?? null;
  const maxDigits = bank ? Math.max(...bank.accountDigits) : 20;
  const lengthOk = bank ? bank.accountDigits.includes(acct.length) : acct.length >= 6;
  const matches = acct.length > 0 && acct === again;
  const serverField = typeof problem?.detail?.field === 'string' ? (problem.detail.field as string) : null;

  const errors = {
    name: name.trim().length < 2 ? (kind === 'business' ? 'Give the business’s name.' : 'Give their full name.') : null,
    registration: kind === 'business' && !/^[A-Za-z0-9-]{5,24}$/.test(registration.trim()) ? 'Give their SEC or DTI registration number.' : null,
    personId: kind === 'person' && personId.trim().length < 3 ? 'Give an ID number, or a date of birth as YYYY-MM-DD.' : null,
    bank: bank ? null : 'Choose their bank.',
    acct: !lengthOk ? (bank ? `Check the number: ${bank.hint}.` : 'Type the full account number.') : null,
    again: pasteNote ?? (again.length === 0 ? 'Type the number a second time.' : matches ? null : 'The two numbers are different. Type it again.'),
    holder: holder.trim().length < 2 ? 'Give the name on the account, as the bank has it.' : null,
    address: address.trim().length < 3 ? 'Give their street address.' : null,
    city: city.trim().length < 2 ? 'Give their city.' : null,
    by: when === 'now' && by.trim().length < 2 ? 'Say who made the call.' : null,
  };
  // The server names the field it refused; its message goes under that field.
  const serverKey = serverField ? (SERVER_FIELD[serverField] ?? null) : null;
  const show = (k: keyof typeof errors): string | null => {
    if (k === serverKey && problem) return problem.message;
    if (k === 'again' && pasteNote) return pasteNote;
    const typedBoth = k === 'again' && again.length > 0 && again.length >= acct.length;
    return tried || typedBoth ? errors[k] : null;
  };
  const valid = Object.values(errors).every((e) => e === null);

  async function save() {
    setTried(true);
    setProblem(null);
    if (!valid || !bank) return;
    setBusy(true);
    try {
      const res = await api<{ recipient: RecipientRow }>('/recipients', {
        body: {
          name: name.trim(),
          kind,
          registration: kind === 'business' ? registration.trim() : null,
          personId: kind === 'person' ? personId.trim() : null,
          bankCode: bank.code,
          accountNumber: acct,
          accountNumberAgain: again,
          holderName: holder.trim(),
          addressLine: address.trim(),
          city: city.trim(),
          check: when === 'now' ? { when: 'now', by: by.trim() } : { when: 'later' },
        },
      });
      setAcct('');
      setAgain('');
      onSaved(res.recipient);
    } catch (e) {
      setProblem(problemOf(e));
    } finally {
      setBusy(false);
    }
  }

  const checkValues: CheckWhen[] = ['now', 'later'];
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New bank recipient"
      footer={
        <>
          <IsoButton variant="primary" onClick={() => void save()} busy={busy}>
            {busy ? 'Saving…' : 'Save recipient'}
          </IsoButton>
          <IsoButton variant="quiet" onClick={onClose}>
            Cancel
          </IsoButton>
        </>
      }
    >
      <div className="iso-field">
        <span className="iso-field__label" id="nr-country">
          Country
        </span>
        <Segmented
          label="Country"
          value="PH"
          onChange={() => undefined}
          disabled={['ID']}
          options={[
            { value: 'PH', label: 'Philippines' },
            { value: 'ID', label: 'Indonesia · next' },
          ]}
        />
      </div>
      <div className="iso-field">
        <span className="iso-field__label">They are</span>
        <Segmented
          label="They are"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'business', label: 'A business' },
            { value: 'person', label: 'A person' },
          ]}
        />
      </div>
      <TextField label={kind === 'business' ? 'Business name' : 'Full name'} value={name} onChange={setName} autoComplete="off" error={show('name')} />
      {kind === 'business' ? (
        <TextField label="SEC or DTI registration number" value={registration} onChange={setRegistration} autoComplete="off" spellCheck={false} error={show('registration')} />
      ) : (
        <TextField label="ID number or date of birth" value={personId} onChange={setPersonId} autoComplete="off" spellCheck={false} help="A government ID number, or a date of birth as YYYY-MM-DD." error={show('personId')} />
      )}
      <Combobox
        label="Bank"
        options={banks.map((b) => ({ value: b.code, label: b.name, meta: b.rails, keywords: b.code }))}
        value={bankCode}
        onChange={(v) => {
          setBankCode(v);
          setAcct((a) => a.slice(0, Math.max(...(banks.find((b) => b.code === v)?.accountDigits ?? [20]))));
          setAgain('');
        }}
        placeholder="Search for a bank"
        error={show('bank')}
      />
      <MaskedField
        label="Full account number"
        value={acct}
        onChange={(v) => {
          setAcct(v);
          setProblem(null);
        }}
        maxDigits={maxDigits}
        help={bank ? `${bank.hint}. We group them so they’re easy to check.` : 'Choose the bank first: it decides how many digits.'}
        error={show('acct')}
      />
      <MaskedField
        label="Type it again"
        value={again}
        onChange={(v) => {
          setAgain(v);
          setPasteNote(null);
          setProblem(null);
        }}
        maxDigits={maxDigits}
        noPaste
        pasteMessage="Pasting is off here, so a copied mistake can’t slip through twice."
        onPasteBlocked={setPasteNote}
        match={matches && lengthOk}
        help={matches && lengthOk ? 'Matches.' : 'Pasting is off here, so a copied mistake can’t slip through twice.'}
        error={show('again')}
      />
      <TextField label="Account holder name" value={holder} onChange={setHolder} autoComplete="off" help="The bank doesn’t check names. A mismatch comes back, so we ask you to confirm by phone." error={show('holder')} />
      <TextField label="Street address" value={address} onChange={setAddress} autoComplete="off" error={show('address')} />
      <TextField label="City" value={city} onChange={setCity} autoComplete="off" error={show('city')} />
      <fieldset className="iso-fieldset">
        <legend className="iso-field__label">Check these details</legend>
        <div className="iso-choices" role="radiogroup" aria-label="Check these details" onKeyDown={radioKeys(checkValues, when, setWhen)}>
          <button type="button" role="radio" aria-checked={when === 'now'} tabIndex={tabStop('now', checkValues, when)} data-radio-value="now" className="iso-choice" onClick={() => setWhen('now')}>
            <span className="iso-choice__title">Now, by phone</span>
            <span className="iso-choice__body">Call them on a number you already have, not one on the invoice.</span>
          </button>
          <button type="button" role="radio" aria-checked={when === 'later'} tabIndex={tabStop('later', checkValues, when)} data-radio-value="later" className="iso-choice" onClick={() => setWhen('later')}>
            <span className="iso-choice__title">Later</span>
            <span className="iso-choice__body">You can save them now, but you can’t pay them until they’re checked.</span>
          </button>
        </div>
      </fieldset>
      {when === 'now' ? <TextField label="Who made the call?" value={by} onChange={setBy} autoComplete="name" error={show('by')} /> : null}
      <p className="iso-note">
        <LockKeyhole size={16} aria-hidden="true" /> The full number is locked away. Only your owner and finance admin can see it, for 30 seconds, after approving on their device. Everyone else sees the last 4 digits.
      </p>
      {problem && !serverKey ? (
        <p className="iso-note iso-note--danger" role="alert">
          {problem.message}
        </p>
      ) : null}
      {tried && !valid ? (
        <p className="iso-sr" role="status">
          Some details need another look.
        </p>
      ) : null}
    </Sheet>
  );
}

/** The browser's clock, for the reveal (a test passes a fake one). */
const BROWSER_CLOCK: RevealClock = { now: () => Date.now(), setTimeout: (f, ms) => window.setTimeout(f, ms), clearTimeout: (h) => window.clearTimeout(h as number) };

/** The reveal, wired to this page: real timers, the tab's visibility, and masking on close. */
function useReveal(open: boolean) {
  const [shown, setShown] = useState<Revealed | null>(null);
  const [now, setNow] = useState(() => BROWSER_CLOCK.now());
  const ctl = useMemo(() => createReveal(BROWSER_CLOCK, (s) => setShown(s)), []);
  useEffect(() => {
    const onVisibility = () => ctl.visibility(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      ctl.close();
    };
  }, [ctl]);
  useEffect(() => {
    if (!open) ctl.close();
  }, [open, ctl]);
  useEffect(() => {
    if (!shown) return;
    const t = window.setInterval(() => setNow(BROWSER_CLOCK.now()), 250);
    return () => window.clearInterval(t);
  }, [shown]);
  return { shown, left: revealSecondsLeft(shown, now), ctl };
}

/**
 * One saved recipient: its bank, the last 4 digits, and for the owner or a finance admin "Show number"
 * (a device approval, then 30 seconds). Record a call-back for one not yet checked; an owner may remove it.
 */
export function RecipientSheet({ recipient, open, onClose, company, onChanged, onRemoved, onPay }: { recipient: RecipientRow | null; open: boolean; onClose: () => void; company: CompanyDTO; onChanged: (r: RecipientRow) => void; onRemoved: (id: string) => void; onPay: (r: RecipientRow) => void }) {
  const { shown, left, ctl } = useReveal(open);
  const [by, setBy] = useState(company.me.personName);
  const [busy, setBusy] = useState<null | 'reveal' | 'verify' | 'remove'>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- a closed sheet starts fresh next time */
    setProblem(null);
    setConfirmRemove(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  if (!recipient) return null;
  const r = recipient;

  async function reveal() {
    setBusy('reveal');
    setProblem(null);
    try {
      if (!(await existingDeviceKey(company.me.keyId))) throw new Error('This browser can’t approve for you. Use the browser where you set up this device.');
      const ch = await api<{ nonce: string; message: string; expiresAt: string }>(`/recipients/${r.id}/reveal`, { body: { step: 'challenge' } });
      const approval = await approveTextWithDevice(company.me.keyId, ch.message);
      const res = await api<{ accountNumber: string; last4: string; expiresAt: string }>(`/recipients/${r.id}/reveal`, { body: { step: 'reveal', nonce: ch.nonce, signature: approval } });
      ctl.show(res.accountNumber, res.expiresAt);
    } catch (e) {
      setProblem(problemOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function verify() {
    setBusy('verify');
    setProblem(null);
    try {
      const res = await api<{ recipient: RecipientRow }>(`/recipients/${r.id}/verify`, { body: { by: by.trim() } });
      onChanged({ ...res.recipient, lastPaid: r.lastPaid, lastPaidAt: r.lastPaidAt, lastAnswers: r.lastAnswers });
    } catch (e) {
      setProblem(problemOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('remove');
    setProblem(null);
    try {
      await api('/suppliers', { method: 'DELETE', body: { id: r.id } });
      ctl.close();
      onRemoved(r.id);
    } catch (e) {
      setProblem(problemOf(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={r.name}
      footer={
        <>
          {r.payable ? (
            <IsoButton variant="primary" onClick={() => onPay(r)}>
              Pay {shortName(r.name)}
            </IsoButton>
          ) : null}
          <IsoButton variant="quiet" onClick={onClose}>
            Close
          </IsoButton>
        </>
      }
    >
      <dl className="iso-dl iso-dl--rows">
        <div>
          <dt>Bank</dt>
          <dd>{r.bank}</dd>
        </div>
        <div>
          <dt>Account</dt>
          <dd>
            <span className={shown ? 'iso-mono' : 'iso-num'} aria-live="polite">
              {shown ? groupDigits(shown.number) : `•••• ${r.accountLast4}`}
            </span>
          </dd>
        </div>
        <div>
          <dt>Checked</dt>
          <dd>
            <Tag tone={r.payable ? 'ok' : 'amber'} tick={r.payable}>
              {r.status}
            </Tag>
          </dd>
        </div>
        <div>
          <dt>Last paid</dt>
          <dd>{r.lastPaid}</dd>
        </div>
      </dl>
      {r.canReveal ? (
        shown ? (
          <div className="iso-row">
            <span className="iso-small iso-num" role="timer" aria-live="off">
              Hidden again in 0:{String(left).padStart(2, '0')}
            </span>
            <IsoButton variant="quiet" size="sm" onClick={() => ctl.close()}>
              <EyeOff size={16} aria-hidden="true" /> Hide now
            </IsoButton>
          </div>
        ) : (
          <div className="iso-stack">
            <IsoButton variant="quiet" onClick={() => void reveal()} busy={busy === 'reveal'}>
              <Eye size={16} aria-hidden="true" /> {busy === 'reveal' ? 'Approving on this device…' : 'Show number'}
            </IsoButton>
            <p className="iso-small">You approve on this device first. It shows for 30 seconds, and every look is recorded.</p>
          </div>
        )
      ) : null}
      {!r.payable ? (
        <div className="iso-stack">
          <h3 className="iso-h3">Record the call-back</h3>
          <p className="iso-small">Call them on a number you already have, not one on the invoice, and read back the bank and the last 4 digits.</p>
          <TextField label="Who made the call?" value={by} onChange={setBy} autoComplete="name" />
          <div>
            <IsoButton variant="primary" onClick={() => void verify()} busy={busy === 'verify'} disabledReason={by.trim().length < 2 ? 'Say who made the call.' : null}>
              Mark as checked
            </IsoButton>
          </div>
        </div>
      ) : null}
      {r.canRemove ? (
        confirmRemove ? (
          <div className="iso-note iso-note--amber iso-stack" role="group" aria-label="Remove this recipient">
            <p style={{ margin: 0 }}>
              Remove {r.name}? Payments already made stay on record. Paying them again starts with a call-back.
            </p>
            <div className="iso-actions">
              <IsoButton variant="primary" size="sm" onClick={() => void remove()} busy={busy === 'remove'}>
                Remove
              </IsoButton>
              <IsoButton variant="quiet" size="sm" onClick={() => setConfirmRemove(false)}>
                Keep
              </IsoButton>
            </div>
          </div>
        ) : (
          <div>
            <IsoButton variant="link" size="sm" onClick={() => setConfirmRemove(true)}>
              Remove recipient
            </IsoButton>
          </div>
        )
      ) : null}
      {problem ? (
        <p className="iso-note iso-note--danger" role="alert">
          {problem.message}
        </p>
      ) : null}
    </Sheet>
  );
}
