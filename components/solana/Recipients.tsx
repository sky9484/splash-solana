// iso-ui
'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';

import { IsoButton, IsoSurface, TextField } from '@/components/iso';
import { PageHead } from '@/components/dashboard/PageHead';

import { api, php } from './client';
import { NewRecipientSheet, RecipientSheet } from './transfer/RecipientSheets';
import { problemOf, type Problem, type RecipientRow, type RecipientsDTO } from './transfer/shared';
import { MytDate } from './receipt/Myt';
import { useCompany } from './useCompany';

/** How the bank details were checked, as the record says (the same words as Transfer's list). */
const HOW: Record<string, string> = { 'call-back': 'by call-back', 'supplier-account': 'from their account record', 'existing-record': 'from an earlier record' };

/**
 * Recipients (prompt 12 §6.1, audit A and B12): the saved bank recipients, from the same records
 * Transfer pays from (the old page read another store, so it said "No recipients found" while two
 * suppliers had been paid). Each row: the name, the bank and its last 4 digits, the country, whether
 * the details were checked by call-back and when, and the last payment that reached their bank.
 * "New recipient" is Transfer's sheet; a row's details are Transfer's recipient sheet, whose "Pay …"
 * opens Transfer with that recipient chosen (?recipient=…).
 */
export function Recipients() {
  const router = useRouter();
  const { state } = useCompany();
  const [data, setData] = useState<RecipientsDTO | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<RecipientsDTO>('/recipients'));
      setProblem(null);
    } catch (e) {
      setProblem(problemOf(e));
    }
  }, []);

  useEffect(() => {
    // The list is the server's: read it after mount, as Transfer does.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const rows = useMemo(() => data?.recipients ?? [], [data]);
  const q = query.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.bank.toLowerCase().includes(q) || r.accountLast4.includes(q)) : rows;
  const open = rows.find((r) => r.id === openId) ?? null;
  const company = state.status === 'ready' ? state.company : null;

  const replace = (r: RecipientRow) => setData((d) => (d ? { ...d, recipients: d.recipients.map((x) => (x.id === r.id ? r : x)) } : d));

  return (
    <div className="iso iso-page">
      <PageHead
        title="Recipients"
        context="Who you pay, their bank, and the last payment that reached them. Only recipients checked by call-back can be paid."
        actions={
          <IsoButton variant="primary" onClick={() => setAdding(true)} disabledReason={data ? null : 'Loading your recipients.'}>
            <Plus size={16} aria-hidden="true" /> New recipient
          </IsoButton>
        }
      />

      <IsoSurface pad={false} className="iso-rise iso-rise-2" aria-labelledby="rc-title">
        <div className="iso-surface--head iso-rcp__head">
          <h2 id="rc-title" className="iso-h2">
            Saved recipients{data ? <span className="iso-rcp__count"> ({rows.length})</span> : null}
          </h2>
          {rows.length > 3 ? (
            <div className="iso-rcp__search">
              <TextField label="Search recipients" value={query} onChange={setQuery} type="search" autoComplete="off" placeholder="Name, bank or last 4 digits" end={<Search size={18} aria-hidden="true" className="iso-field__icon" />} />
            </div>
          ) : null}
        </div>

        {problem ? (
          <div className="iso-surface--pad">
            <p className="iso-note iso-note--danger" role="alert">
              {problem.message}
            </p>
          </div>
        ) : !data ? (
          <div className="iso-surface--pad iso-stack" aria-busy="true" aria-label="Loading recipients">
            <span className="iso-skel" style={{ height: 56 }} />
            <span className="iso-skel" style={{ height: 56 }} />
          </div>
        ) : rows.length === 0 ? (
          <div className="iso-surface--pad iso-empty">
            <p className="iso-body" style={{ margin: 0 }}>
              No saved recipients yet. Add one here, or save one the first time you pay them.
            </p>
            <IsoButton variant="quiet" onClick={() => setAdding(true)}>
              <Plus size={16} aria-hidden="true" /> New recipient
            </IsoButton>
          </div>
        ) : shown.length === 0 ? (
          <div className="iso-surface--pad">
            <p className="iso-small" role="status" style={{ margin: 0 }}>
              No saved recipient matches “{query.trim()}”.
            </p>
          </div>
        ) : (
          <table className="iso-table iso-table--stack iso-rcp">
            <thead>
              <tr>
                <th scope="col">Recipient</th>
                <th scope="col">Bank details</th>
                <th scope="col">Last paid</th>
                <th scope="col">
                  <span className="iso-sr">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.name}</strong>
                    <span className="iso-rcp__sub">
                      {r.bank} •••• {r.accountLast4}, {r.country}
                    </span>
                  </td>
                  <td data-label="Bank details">
                    {r.verifiedAt ? (
                      <span className="iso-rcp__checked">
                        Verified {HOW[r.verifiedBy ?? ''] ?? ''}{' '}
                        <span className="iso-rcp__date">
                          <MytDate at={r.verifiedAt} />
                        </span>
                      </span>
                    ) : (
                      <span className="iso-rcp__unchecked">
                        <i aria-hidden="true" />
                        {r.status}
                      </span>
                    )}
                  </td>
                  <td className="iso-num" data-label="Last paid">
                    {r.lastPaidAt && r.lastPaidPhpMinor ? (
                      <>
                        <strong>{php(r.lastPaidPhpMinor)}</strong>
                        <span className="iso-rcp__sub">
                          <MytDate at={r.lastPaidAt} />
                        </span>
                      </>
                    ) : (
                      <span className="iso-rcp__sub">Not paid yet</span>
                    )}
                  </td>
                  <td className="iso-r">
                    <IsoButton variant="quiet" size="sm" onClick={() => setOpenId(r.id)} aria-label={`${r.name}: details`} disabledReason={company ? null : 'Loading your company.'}>
                      Details
                    </IsoButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </IsoSurface>

      {data && company ? (
        <>
          <NewRecipientSheet
            open={adding}
            onClose={() => setAdding(false)}
            banks={data.banks}
            personName={company.me.personName}
            onSaved={(r) => {
              setAdding(false);
              setData((d) => (d ? { ...d, recipients: [r, ...d.recipients.filter((x) => x.id !== r.id)] } : d));
            }}
          />
          <RecipientSheet
            recipient={open}
            open={open !== null}
            onClose={() => setOpenId(null)}
            company={company}
            onChanged={replace}
            onRemoved={(id) => {
              setOpenId(null);
              setData((d) => (d ? { ...d, recipients: d.recipients.filter((x) => x.id !== id) } : d));
            }}
            onPay={(r) => router.push(`/dashboard/transfer?to=bank&recipient=${r.id}`)}
          />
        </>
      ) : null}
    </div>
  );
}
