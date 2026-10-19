// iso-ui
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, FileJson, Landmark, Link2, Mail } from 'lucide-react';
import clsx from 'clsx';

import { IsoButton, Segmented, Sheet, Tag } from '@/components/iso';
import { radioKeys, tabStop } from '@/components/iso/radio';

import { api, copyText } from '../client';
import { useCompany } from '../useCompany';
import { MytDate } from './Myt';

type Country = 'MY' | 'PH' | 'ID' | 'OTHER';
type Option = 'portal' | 'link' | 'pdf' | 'pack';
type ShareView = { token: string; path: string; createdAt: string; expiresAt: string | null };

/** Each covered country's e-invoice portal: what Splash would send there, and what it needs first (all planned). */
const PORTAL: Record<Exclude<Country, 'OTHER'>, { title: string; portal: string; needs: string }> = {
  MY: {
    title: 'Send to MyInvois as a self-billed e-Invoice',
    portal: 'MyInvois',
    needs: 'A Malaysian buyer paying a foreign supplier issues a self-billed e-Invoice. It needs Splash onboarded to the LHDN API, and the supplier’s TIN.',
  },
  PH: {
    title: 'Send to the BIR e-Invoicing System',
    portal: 'the BIR e-Invoicing System',
    needs: 'For Philippine companies in the EIS rollout. It needs Splash onboarded to BIR’s EIS, and the supplier’s TIN.',
  },
  ID: {
    title: 'Prepare for Coretax (e-Faktur)',
    portal: 'Coretax',
    needs: 'Splash would export the fields Coretax asks for. It needs Splash onboarded to DJP’s Coretax, and the supplier’s TIN.',
  },
};

const COUNTRIES: Array<{ value: Country; label: string }> = [
  { value: 'MY', label: 'MY' },
  { value: 'PH', label: 'PH' },
  { value: 'ID', label: 'ID' },
  { value: 'OTHER', label: 'Other' },
];

/** The business's country from its profile, else Malaysia (every company today pays from Malaysia). */
function defaultCountry(code: string | null | undefined): Country {
  if (!code) return 'MY';
  return code === 'MY' || code === 'PH' || code === 'ID' ? code : 'OTHER';
}

/**
 * Share this receipt (prompt 12 §5.3, decision 10): the e-invoice portal for the company's country
 * (planned, nothing is sent to any government system), a read-only verify link to copy or email (D8:
 * a mailto draft, never a Splash email), the PDF, and the evidence file (D6). The country is the
 * company's own unless the person picks another; the pick is not saved. The Sheet traps focus, closes
 * on Esc and returns focus to the button that opened it.
 */
export function ShareSheet({ open, onClose, receiptId, number, onPdf, packHref }: { open: boolean; onClose: () => void; receiptId: string; number: string; onPdf: () => void; packHref: string }) {
  const { state } = useCompany();
  const companyCountry = state.status === 'ready' ? state.company.org.country : null;
  const [picked, setPicked] = useState<Country | null>(null);
  const country = picked ?? defaultCountry(companyCountry);
  const [chosen, setChosen] = useState<Option | null>(null);
  const option: Option = chosen ?? (country === 'OTHER' ? 'link' : 'portal');
  const [share, setShare] = useState<ShareView | null>(null);
  const [mayStop, setMayStop] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const read = useCallback(async () => {
    try {
      const r = await api<{ share: ShareView | null; mayStopSharing: boolean }>(`/receipts/${receiptId}/share`);
      setShare(r.share);
      setMayStop(r.mayStopSharing);
    } catch (e) {
      setNote({ tone: 'danger', text: (e as Error).message });
    }
  }, [receiptId]);

  useEffect(() => {
    // The live link, if any, is read when the sheet opens (it may have changed since).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void read();
  }, [open, read]);

  function pickCountry(c: Country) {
    setPicked(c);
    // "Other" has no portal option: fall back to the link.
    if (c === 'OTHER' && option === 'portal') setChosen('link');
  }

  async function ensureShare(): Promise<ShareView> {
    if (share) return share;
    const made = await api<ShareView>(`/receipts/${receiptId}/share`, { body: {} });
    setShare(made);
    return made;
  }

  async function copyLink() {
    setBusy(true);
    try {
      const s = await ensureShare();
      const ok = await copyText(`${window.location.origin}${s.path}`);
      setNote(ok ? { tone: 'ok', text: 'Link copied. It opens this receipt only, read-only.' } : { tone: 'danger', text: 'The link couldn’t be copied. Select it below and copy it.' });
    } catch (e) {
      setNote({ tone: 'danger', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function emailLink() {
    setBusy(true);
    try {
      const s = await ensureShare();
      const url = `${window.location.origin}${s.path}`;
      window.location.href = `mailto:?subject=${encodeURIComponent(`Payment receipt ${number}`)}&body=${encodeURIComponent(url)}`;
      setNote({ tone: 'ok', text: 'Your email app opened a draft with the link. You send it.' });
    } catch (e) {
      setNote({ tone: 'danger', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      await api(`/receipts/${receiptId}/share/revoke`, { body: {} });
      setShare(null);
      setNote({ tone: 'ok', text: 'Sharing stopped. The old link now says it isn’t valid.' });
    } catch (e) {
      setNote({ tone: 'danger', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const options: Array<{ value: Option; icon: typeof Mail; title: string; planned?: boolean }> = [
    ...(country === 'OTHER' ? [] : [{ value: 'portal' as const, icon: Landmark, title: PORTAL[country].title, planned: true }]),
    { value: 'link', icon: Link2, title: 'Read-only link' },
    { value: 'pdf', icon: Download, title: 'Download the receipt (PDF)' },
    { value: 'pack', icon: FileJson, title: 'Download the evidence file (JSON)' },
  ];
  const values = options.map((o) => o.value);
  const shareUrl = share ? `${typeof window === 'undefined' ? '' : window.location.origin}${share.path}` : null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        <>
          Share this receipt
          <span className="iso-share__sub">
            Receipt <span className="iso-mono">{number}</span>
          </span>
        </>
      }
    >
      <div className="iso-stack">
        <div className="iso-share__country">
          <span className="iso-share__label" id="share-country">
            Your company’s country
          </span>
          <Segmented label="Your company’s country" options={COUNTRIES} value={country} onChange={pickCountry} />
          {country === 'OTHER' ? <p className="iso-small">Your country’s e-invoice portal isn’t covered yet. Send the PDF and the link.</p> : null}
        </div>

        <div className="iso-share__opts" role="radiogroup" aria-label="How to share it" onKeyDown={radioKeys(values, option, setChosen)}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={option === o.value}
              tabIndex={tabStop(o.value, values, option)}
              data-radio-value={o.value}
              className={clsx('iso-share__opt', option === o.value && 'iso-share__opt--on')}
              onClick={() => setChosen(o.value)}
            >
              <o.icon size={18} aria-hidden="true" />
              <span className="iso-share__opttitle">{o.title}</span>
              {o.planned ? <Tag tone="gold">Planned</Tag> : null}
            </button>
          ))}
        </div>

        <div className="iso-share__panel" aria-live="polite">
          {option === 'portal' && country !== 'OTHER' ? (
            <>
              <p className="iso-body">{PORTAL[country].needs}</p>
              <p className="iso-small">Nothing is sent to {PORTAL[country].portal} or any other government system yet.</p>
              <IsoButton variant="primary" disabledReason="Planned: not built yet.">
                {PORTAL[country].title}
              </IsoButton>
            </>
          ) : null}

          {option === 'link' ? (
            <>
              <div className="iso-actions">
                <IsoButton variant="primary" onClick={() => void copyLink()} busy={busy}>
                  <Link2 size={16} aria-hidden="true" /> Copy a read-only link
                </IsoButton>
                <IsoButton variant="quiet" onClick={() => void emailLink()} busy={busy}>
                  <Mail size={16} aria-hidden="true" /> Email it
                </IsoButton>
              </div>
              <p className="iso-small">
                Read-only. Opens this receipt and nothing else.{' '}
                {share ? (
                  share.expiresAt ? (
                    <>
                      Expires <MytDate at={share.expiresAt} />.
                    </>
                  ) : (
                    'This older link has no expiry.'
                  )
                ) : (
                  'Expires in 90 days.'
                )}
              </p>
              {shareUrl ? (
                <p className="iso-share__url">
                  <span className="iso-mono">{shareUrl}</span>
                </p>
              ) : null}
              {share ? (
                <IsoButton variant="quiet" onClick={() => void stop()} busy={busy} disabledReason={mayStop ? null : 'Only an owner or admin can stop sharing.'}>
                  Stop sharing
                </IsoButton>
              ) : null}
            </>
          ) : null}

          {option === 'pdf' ? (
            <>
              <p className="iso-body">One A4 page: who paid whom, how much, when, and how anyone can check it.</p>
              <IsoButton variant="primary" onClick={onPdf}>
                <Download size={16} aria-hidden="true" /> Download the receipt (PDF)
              </IsoButton>
            </>
          ) : null}

          {option === 'pack' ? (
            <>
              <p className="iso-body">The record behind this receipt, with what a checker needs to recompute it, as one JSON file.</p>
              <a className="iso-btn iso-btn--primary" href={packHref} download>
                <FileJson size={16} aria-hidden="true" /> Download the evidence file (JSON)
              </a>
            </>
          ) : null}
        </div>

        {note ? (
          <p className={note.tone === 'ok' ? 'iso-note iso-note--ok' : 'iso-note iso-note--danger'} role={note.tone === 'ok' ? 'status' : 'alert'}>
            {note.text}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
