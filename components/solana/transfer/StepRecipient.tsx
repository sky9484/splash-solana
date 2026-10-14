// iso-ui
'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, UserPlus } from 'lucide-react';

import { ActionBar, IsoBlock, IsoButton, IsoSurface, Tag, TextField } from '@/components/iso';
import { radioKeys, tabStop } from '@/components/iso/radio';

import { api, copyText } from '../client';
import type { CompanyDTO } from '../types';
import { NewRecipientSheet, RecipientSheet } from './RecipientSheets';
import { countryName, problemOf, shortName, type Payee, type Problem, type RecipientRow, type RecipientsDTO, type To } from './shared';

const DESTINATIONS: To[] = ['bank', 'splash'];

/**
 * Step 1, "Who are you paying?" (prompt 10 §5.1, §5.3, §5.4; frame Flow-T1-Recipient): a bank account
 * in the Philippines, from the saved and checked list or a new one, or another business on Splash,
 * found in the directory. Only a checked recipient can be paid; a payee on Splash is a verified
 * company that chose to be found.
 */
export function StepRecipient({
  company,
  to,
  onTo,
  recipients,
  onRecipients,
  recipient,
  onRecipient,
  payee,
  onPayee,
  onContinue,
}: {
  company: CompanyDTO;
  to: To | null;
  onTo: (to: To) => void;
  recipients: RecipientsDTO | null;
  onRecipients: (r: RecipientsDTO) => void;
  recipient: RecipientRow | null;
  onRecipient: (r: RecipientRow | null) => void;
  payee: Payee | null;
  onPayee: (p: Payee | null) => void;
  onContinue: () => void;
}) {
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loadProblem, setLoadProblem] = useState<Problem | null>(null);

  useEffect(() => {
    if (to !== 'bank' || recipients) return;
    let stop = false;
    api<RecipientsDTO>('/recipients')
      .then((r) => !stop && onRecipients(r))
      .catch((e) => !stop && setLoadProblem(problemOf(e)));
    return () => {
      stop = true;
    };
  }, [to, recipients, onRecipients]);

  const rows = useMemo(() => {
    const all = recipients?.recipients ?? [];
    const q = query.trim().toLowerCase();
    return q ? all.filter((r) => `${r.name} ${r.bank} ${r.accountLast4}`.toLowerCase().includes(q)) : all;
  }, [recipients, query]);

  const open = recipients?.recipients.find((r) => r.id === openId) ?? null;

  function replace(r: RecipientRow) {
    if (!recipients) return;
    const list = recipients.recipients.some((x) => x.id === r.id) ? recipients.recipients.map((x) => (x.id === r.id ? r : x)) : [r, ...recipients.recipients];
    onRecipients({ ...recipients, recipients: list });
    if (recipient?.id === r.id) onRecipient(r);
  }

  const summary =
    to === 'splash' ? (
      payee ? (
        <>
          Paying <strong>{shortName(payee.name)}</strong> · into their Splash account
        </>
      ) : (
        'Find the business you’re paying.'
      )
    ) : recipient ? (
      <>
        Paying <strong>{recipient.name}</strong> · {recipient.bank} •••• {recipient.accountLast4} · {recipient.payable ? recipient.status.replace(/^Verified \d+ \w+ /, 'checked ') : 'not checked yet'}
      </>
    ) : (
      'Choose who you’re paying.'
    );
  const blocked = to === 'splash' ? (payee ? null : 'Choose a business first.') : !recipient ? 'Choose a recipient first.' : recipient.payable ? null : 'Check their bank details first: only checked recipients can be paid.';

  return (
    <>
      <div className="iso-dest iso-rise iso-rise-2" role="radiogroup" aria-label="Where the money goes" onKeyDown={radioKeys(DESTINATIONS, to, onTo)}>
        <button type="button" role="radio" aria-checked={to === 'bank'} tabIndex={tabStop('bank', DESTINATIONS, to)} data-radio-value="bank" className="iso-choice iso-dest__card" onClick={() => onTo('bank')}>
          <IsoBlock glyph="bank" size={64} />
          <span>
            <span className="iso-choice__title">A bank account</span>
            <span className="iso-choice__body">Pesos to a supplier’s bank in the Philippines, by InstaPay or PESONet.</span>
          </span>
        </button>
        <button type="button" role="radio" aria-checked={to === 'splash'} tabIndex={tabStop('splash', DESTINATIONS, to)} data-radio-value="splash" className="iso-choice iso-dest__card" onClick={() => onTo('splash')}>
          <IsoBlock glyph="business" size={64} />
          <span>
            <span className="iso-choice__title">A business on Splash</span>
            <span className="iso-choice__body">Straight to their Splash account. No Splash fee.</span>
          </span>
        </button>
      </div>

      {to === 'bank' ? (
        <IsoSurface className="iso-rise iso-rise-3" aria-labelledby="t1-saved">
          <div className="iso-surface--head">
            <h2 id="t1-saved" className="iso-h2">
              Saved bank recipients
            </h2>
            <IsoButton variant="quiet" size="sm" onClick={() => setAdding(true)} disabled={!recipients}>
              <UserPlus size={16} aria-hidden="true" /> Add a new recipient
            </IsoButton>
          </div>
          <div className="iso-surface--pad iso-stack">
            {recipients && recipients.recipients.length > 0 ? (
              <TextField label="Search recipients" value={query} onChange={setQuery} type="search" autoComplete="off" placeholder="Name, bank or last 4 digits" end={<Search size={18} aria-hidden="true" className="iso-field__icon" />} />
            ) : null}
            {loadProblem ? (
              <p className="iso-note iso-note--danger" role="alert">
                {loadProblem.message}
              </p>
            ) : !recipients ? (
              <div className="iso-stack" aria-busy="true" aria-label="Loading recipients">
                <span className="iso-skel" style={{ height: 64 }} />
                <span className="iso-skel" style={{ height: 64 }} />
              </div>
            ) : recipients.recipients.length === 0 ? (
              <div className="iso-empty">
                <strong>No saved recipients yet.</strong>
                <p className="iso-small" style={{ margin: 0 }}>
                  Add the first one: their bank, the full account number typed twice, and a call-back on a number you already have.
                </p>
                <div>
                  <IsoButton variant="primary" onClick={() => setAdding(true)}>
                    Add a new recipient
                  </IsoButton>
                </div>
              </div>
            ) : rows.length === 0 ? (
              <p className="iso-small" role="status">
                No saved recipient matches “{query.trim()}”.
              </p>
            ) : (
              <ul className="iso-list iso-recips" aria-label="Saved bank recipients">
                {rows.map((r) => {
                  const chosen = recipient?.id === r.id;
                  return (
                    <li key={r.id} className={chosen ? 'iso-recips__row iso-recips__row--on' : 'iso-recips__row'}>
                      <div className="iso-list__main">
                        <button type="button" className="iso-recips__name" onClick={() => setOpenId(r.id)} aria-label={`${r.name}: details`}>
                          {r.name}
                        </button>
                        <div className="iso-list__detail iso-num">
                          {r.bank} <span className="iso-num">•••• {r.accountLast4}</span>
                        </div>
                        <div className="iso-row iso-recips__meta">
                          <Tag tone={r.payable ? 'ok' : 'amber'} tick={r.payable}>
                            {r.status}
                          </Tag>
                          <span className="iso-small">{r.lastPaid}</span>
                        </div>
                      </div>
                      {chosen ? (
                        <span className="iso-recips__chosen" aria-label={`${r.name} is selected`}>
                          Selected
                        </span>
                      ) : r.payable ? (
                        <IsoButton
                          variant="quiet"
                          size="sm"
                          aria-label={`Pay ${r.name}`}
                          onClick={() => {
                            onRecipient(r);
                            onContinue();
                          }}
                        >
                          Pay
                        </IsoButton>
                      ) : (
                        <IsoButton variant="quiet" size="sm" aria-label={`Verify ${r.name} first`} onClick={() => setOpenId(r.id)}>
                          Verify first
                        </IsoButton>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="iso-small" style={{ margin: 0 }}>
              Only checked recipients can be paid. Changed bank details always need a fresh call-back.
            </p>
          </div>
          {recipients ? (
            <>
              <NewRecipientSheet
                open={adding}
                onClose={() => setAdding(false)}
                banks={recipients.banks}
                personName={company.me.personName}
                onSaved={(r) => {
                  replace(r);
                  setAdding(false);
                  if (r.payable) onRecipient(r);
                }}
              />
              <RecipientSheet
                recipient={open}
                open={open !== null}
                onClose={() => setOpenId(null)}
                company={company}
                onChanged={replace}
                onRemoved={(id) => {
                  onRecipients({ ...recipients, recipients: recipients.recipients.filter((x) => x.id !== id) });
                  if (recipient?.id === id) onRecipient(null);
                  setOpenId(null);
                }}
                onPay={(r) => {
                  setOpenId(null);
                  onRecipient(r);
                  onContinue();
                }}
              />
            </>
          ) : null}
        </IsoSurface>
      ) : null}

      {to === 'splash' ? <FindBusiness payee={payee} onPayee={onPayee} onContinue={onContinue} onBank={() => onTo('bank')} /> : null}

      <ActionBar summary={summary} label="Who you’re paying">
        <IsoButton variant="onink" href="/dashboard">
          Cancel
        </IsoButton>
        <IsoButton variant="paper" size="lg" onClick={onContinue} disabledReason={to ? blocked : 'Choose where the money goes first.'}>
          Continue
        </IsoButton>
      </ActionBar>
    </>
  );
}

/** "Find a business on Splash" (§5.4): by name, Splash handle or registration number. */
function FindBusiness({ payee, onPayee, onContinue, onBank }: { payee: Payee | null; onPayee: (p: Payee | null) => void; onContinue: () => void; onBank: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Payee[] | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a short query shows nothing, at once
      setHits(null);
      return;
    }
    let stop = false;
    const t = window.setTimeout(async () => {
      try {
        const res = await api<{ results: Payee[] }>(`/directory?q=${encodeURIComponent(term)}`);
        if (!stop) {
          setHits(res.results);
          setProblem(null);
        }
      } catch (e) {
        if (!stop) setProblem(problemOf(e));
      }
    }, 250);
    return () => {
      stop = true;
      window.clearTimeout(t);
    };
  }, [q]);

  async function invite() {
    setCopied(await copyText(`${window.location.origin}/signup`));
  }

  return (
    <IsoSurface className="iso-rise iso-rise-3" aria-labelledby="t1-find">
      <div className="iso-surface--head">
        <h2 id="t1-find" className="iso-h2">
          Find a business on Splash
        </h2>
      </div>
      <div className="iso-surface--pad iso-stack">
        <TextField label="Company name, Splash handle or registration number" value={q} onChange={setQ} type="search" autoComplete="off" spellCheck={false} end={<Search size={18} aria-hidden="true" className="iso-field__icon" />} />
        {problem ? (
          <p className="iso-note iso-note--danger" role="alert">
            {problem.message}
          </p>
        ) : null}
        {payee && !hits ? <BusinessCard hit={payee} chosen onPay={onContinue} /> : null}
        {hits && hits.length > 0 ? (
          <ul className="iso-list iso-recips" aria-label="Businesses on Splash">
            {hits.map((h) => (
              <li key={h.orgId}>
                <BusinessCard
                  hit={h}
                  chosen={payee?.orgId === h.orgId}
                  onPay={() => {
                    onPayee(h);
                    onContinue();
                  }}
                />
              </li>
            ))}
          </ul>
        ) : null}
        <p className="iso-small" role="status" aria-live="polite" style={{ margin: 0 }}>
          {hits && hits.length === 0 ? `No business on Splash matches “${q.trim()}”. ` : null}
          Only verified companies that chose “Let other Splash businesses find us” show here. Not listed?{' '}
          <button type="button" className="iso-btn iso-btn--link" onClick={() => void invite()}>
            {copied ? 'Invite link copied' : 'Invite them'}
          </button>{' '}
          or{' '}
          <button type="button" className="iso-btn iso-btn--link" onClick={onBank}>
            pay their bank instead
          </button>
          .
        </p>
      </div>
    </IsoSurface>
  );
}

function BusinessCard({ hit, chosen, onPay }: { hit: Payee; chosen: boolean; onPay: () => void }) {
  return (
    <div className={chosen ? 'iso-recips__row iso-recips__row--on' : 'iso-recips__row'}>
      <IsoBlock glyph="business" size={48} />
      <div className="iso-list__main">
        <div className="iso-list__title">{hit.name}</div>
        <div className="iso-list__detail">
          {[countryName(hit.country), hit.handle ? `@${hit.handle}` : null].filter(Boolean).join(' · ')}
          {hit.country || hit.handle ? ' · ' : ''}gets paid into its own Splash account
        </div>
        <div className="iso-row iso-recips__meta">
          <Tag tone="ok" tick>
            Verified company
          </Tag>
        </div>
      </div>
      {chosen ? (
        <span className="iso-recips__chosen">Selected</span>
      ) : (
        <IsoButton variant="quiet" size="sm" aria-label={`Pay ${hit.name}`} onClick={onPay}>
          Pay
        </IsoButton>
      )}
    </div>
  );
}
