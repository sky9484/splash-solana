// iso-ui
'use client';

import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { Search, UserPlus } from 'lucide-react';
import clsx from 'clsx';

import { IsoButton, IsoSurface, Segmented, Tag, TextField } from '@/components/iso';
import { radioKeys, tabStop } from '@/components/iso/radio';

import { api, copyText } from '../client';
import type { CompanyDTO } from '../types';
import { NewRecipientSheet, RecipientSheet } from './RecipientSheets';
import { SoFar, TxGrid, type SoFarRow } from './SoFar';
import { countryName, problemOf, type Payee, type Problem, type RecipientRow, type RecipientsDTO, type To } from './shared';

const SUFFIX = /^(?:inc\.?|incorporated|corp\.?|corporation|co\.?|company|ltd\.?|limited|llc|plc|sdn|bhd\.?|pt|the)$/i;

/** "Manila Freight Services Inc." → "MF": the tile on a recipient's row. */
export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w && !SUFFIX.test(w));
  return (words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?').slice(0, 2);
}

/** A bank recipient's second line: "BDO Unibank •••• 4471 · Philippines" (every bank on the list is in the Philippines). */
export const bankLine = (r: Pick<RecipientRow, 'bank' | 'accountLast4'>) => `${r.bank} •••• ${r.accountLast4} · Philippines`;

/**
 * Step 1, "Who are you paying?" (prompt 11 §2.3): a bank account in the Philippines, from the saved and
 * checked list or a new one, or another business on Splash, found in the directory. One click picks a
 * row; a double-click (or Enter on the picked row) picks it and goes on to the amount. Only a checked
 * recipient can be paid; a business on Splash is a verified company that chose to be found.
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
  rows,
  lead,
}: {
  company: CompanyDTO;
  to: To;
  onTo: (to: To) => void;
  recipients: RecipientsDTO | null;
  onRecipients: (r: RecipientsDTO) => void;
  recipient: RecipientRow | null;
  onRecipient: (r: RecipientRow | null) => void;
  payee: Payee | null;
  onPayee: (p: Payee | null) => void;
  onContinue: () => void;
  rows: SoFarRow[];
  /** "Pay again" and any problem, above the card. */
  lead?: ReactNode;
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

  const shown = useMemo(() => {
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

  const blocked =
    to === 'splash'
      ? payee
        ? null
        : 'Pick a business to continue'
      : !recipient
        ? 'Pick a recipient to continue'
        : recipient.payable
          ? null
          : `Check ${recipient.name}’s bank details first: only checked recipients can be paid.`;

  const main = (
    <>
      {lead}
      <IsoSurface pad={false} className="iso-pickcard" aria-labelledby="t1-title">
        <div className="iso-surface--head">
          <h2 id="t1-title" className="iso-h2" data-step-heading>
            Who are you paying?
          </h2>
          <Segmented
            label="Who you’re paying"
            value={to}
            onChange={onTo}
            options={[
              { value: 'bank', label: 'Bank account' },
              { value: 'splash', label: 'Splash business' },
            ]}
          />
        </div>
        {to === 'bank' ? (
          <div className="iso-surface--pad iso-stack">
            {recipients && recipients.recipients.length > 4 ? (
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
              </div>
            ) : shown.length === 0 ? (
              <p className="iso-small" role="status">
                No saved recipient matches “{query.trim()}”.
              </p>
            ) : (
              <PickList
                label="Saved bank recipients"
                items={shown.map((r) => ({
                  id: r.id,
                  name: r.name,
                  line: bankLine(r),
                  tag: r.payable ? (
                    <Tag tone="ok" tick>
                      Verified
                    </Tag>
                  ) : (
                    <Tag tone="amber">Not checked</Tag>
                  ),
                  details: (
                    <button type="button" className="iso-pick__more" aria-label={`${r.name}: details`} onClick={() => setOpenId(r.id)}>
                      Details
                    </button>
                  ),
                }))}
                chosen={recipient?.id ?? null}
                onPick={(id) => onRecipient(recipients.recipients.find((x) => x.id === id) ?? null)}
                onGo={(id) => {
                  const r = recipients.recipients.find((x) => x.id === id) ?? null;
                  onRecipient(r);
                  if (r?.payable) onContinue();
                }}
              />
            )}
            <div className="iso-row">
              <IsoButton variant="quiet" onClick={() => setAdding(true)} disabled={!recipients}>
                <UserPlus size={16} aria-hidden="true" /> New recipient
              </IsoButton>
              <span className="iso-small">Double-click a saved recipient to go straight to the amount. Only checked recipients can be paid.</span>
            </div>
          </div>
        ) : (
          <FindBusiness payee={payee} onPayee={onPayee} onContinue={onContinue} onBank={() => onTo('bank')} />
        )}
        {to === 'bank' && recipients ? (
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
    </>
  );

  return (
    <TxGrid
      main={main}
      rail={
        <SoFar
          rows={rows}
          action={
            <IsoButton variant="primary" size="lg" block onClick={onContinue} disabledReason={blocked}>
              Continue to amount
            </IsoButton>
          }
        />
      }
    />
  );
}

interface PickItem {
  id: string;
  name: string;
  line: string;
  tag: ReactNode;
  details?: ReactNode;
}

/**
 * Recipients as rows (prompt 11 §2.3): the initials tile, the name, its line and a tag. A radio group:
 * the arrows move the pick; one click picks; a double-click, or Enter on the picked row, goes on.
 */
function PickList({ label, items, chosen, onPick, onGo }: { label: string; items: PickItem[]; chosen: string | null; onPick: (id: string) => void; onGo: (id: string) => void }) {
  const ids = items.map((i) => i.id);
  return (
    <div className="iso-picks" role="radiogroup" aria-label={label} onKeyDown={radioKeys(ids, chosen, onPick)}>
      {items.map((it) => {
        const on = it.id === chosen;
        return (
          <div key={it.id} className={clsx('iso-pick', on && 'iso-pick--on')}>
            <button
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={tabStop(it.id, ids, chosen)}
              data-radio-value={it.id}
              className="iso-pick__main"
              onClick={(e: MouseEvent<HTMLButtonElement>) => {
                // Enter or Space on the row already picked (a keyboard click has no pointer detail) goes on.
                if (on && e.detail === 0) onGo(it.id);
                else onPick(it.id);
              }}
              onDoubleClick={() => onGo(it.id)}
            >
              <span className="iso-pick__tile" aria-hidden="true">
                {initials(it.name)}
              </span>
              <span className="iso-pick__text">
                <span className="iso-pick__name">{it.name}</span>
                <span className="iso-pick__line iso-num">{it.line}</span>
              </span>
              <span className="iso-pick__tag">{it.tag}</span>
            </button>
            {it.details}
          </div>
        );
      })}
    </div>
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

  // The business picked stays listed when the search is cleared.
  const list = hits ?? (payee ? [payee] : []);
  const line = (h: Payee) => [countryName(h.country), h.handle ? `@${h.handle}` : null, 'into their own Splash account'].filter(Boolean).join(' · ');
  return (
    <div className="iso-surface--pad iso-stack">
      <TextField label="Company name, Splash handle or registration number" value={q} onChange={setQ} type="search" autoComplete="off" spellCheck={false} end={<Search size={18} aria-hidden="true" className="iso-field__icon" />} />
      {problem ? (
        <p className="iso-note iso-note--danger" role="alert">
          {problem.message}
        </p>
      ) : null}
      {list.length > 0 ? (
        <PickList
          label="Businesses on Splash"
          items={list.map((h) => ({ id: h.orgId, name: h.name, line: line(h), tag: <Tag tone="ok">No payout fee</Tag> }))}
          chosen={payee?.orgId ?? null}
          onPick={(id) => onPayee(list.find((h) => h.orgId === id) ?? null)}
          onGo={(id) => {
            onPayee(list.find((h) => h.orgId === id) ?? null);
            onContinue();
          }}
        />
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
  );
}
