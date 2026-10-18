// iso-ui
'use client';

import Image from 'next/image';
import { Fragment } from 'react';
import clsx from 'clsx';

import { php, usd } from '../client';
import type { ReceiptDTO } from '../types';
import { ReceiptCheck } from './ReceiptCheck';
import { MytDate, MytDateTime, MytTime, mytDay } from './Myt';

export type ReceiptDoc = NonNullable<ReceiptDTO['document']>;

/**
 * The receipt as one A4 page (prompt 12 §5.4, preview tab 5): the same on "Download PDF", the company's
 * receipt page and the auditor's shared page. Every figure is the record's, formatted here and nothing
 * else; every time is a recorded moment in MYT. The seal says "Verified" only once the proof is recorded
 * and this browser's check has passed. In test mode it says so in the header, the footer and a 5%
 * watermark. Printing keeps only this page (styles/receipt-print.css; the page's own print rules are in
 * styles/iso-ui.css).
 */
export function ReceiptDocument({ doc, verified, shareUrl, heading = 'h2' }: { doc: ReceiptDoc; verified: boolean; shareUrl: string | null; heading?: 'h1' | 'h2' }) {
  const H = heading;
  const sealed = doc.recorded && verified && doc.recordedAt !== null;
  const peer = doc.kind === 'peer';
  const fees = BigInt(doc.paid.feesMinor);
  const processing = BigInt(doc.paid.processingMinor);
  const firstDay = doc.events[0] ? mytDay(doc.events[0].at) : null;
  // References in pairs, two to a row, as the preview sets them.
  const pairs: ReceiptDoc['refs'][] = [];
  for (let i = 0; i < doc.refs.length; i += 2) pairs.push(doc.refs.slice(i, i + 2));

  return (
    <article className={clsx('iso-a4', doc.testMode && 'iso-a4--test')} aria-labelledby="doc-title">

      <div className={clsx('iso-a4__seal', sealed && 'iso-a4__seal--ok')}>
        {sealed ? (
          <>
            <b>Verified</b>
            <span>proof recorded</span>
            <span>
              <MytDate at={doc.recordedAt!} />
            </span>
            <span>
              <MytTime at={doc.recordedAt!} /> MYT
            </span>
          </>
        ) : (
          <b>Not yet verified</b>
        )}
      </div>

      <div className="iso-a4__brand">
        <span className="iso-a4__logo">
          <Image src="/splash-main-icon.png" alt="" width={48} height={47} />
        </span>
        <strong>Splash</strong>
      </div>
      <H id="doc-title" className="iso-a4__title">
        Payment receipt
      </H>
      <p className="iso-a4__meta">
        <span className="iso-mono">{doc.number}</span>
        <span>
          issued <MytDate at={doc.issuedAt} />
        </span>
        {doc.testMode ? <span>Test mode: simulated, no real money moved</span> : null}
      </p>

      <div className="iso-a4__parties">
        <div className="iso-a4__block">
          <span className="iso-a4__label">Paid by</span>
          <strong>{doc.paidBy.name}</strong>
          {doc.paidBy.place ? <span>{doc.paidBy.place}</span> : null}
          {doc.paidBy.account ? (
            <span>
              Payments account <span className="iso-mono">{doc.paidBy.account}</span>
            </span>
          ) : null}
        </div>
        <div className="iso-a4__block">
          <span className="iso-a4__label">Paid to</span>
          <strong>{doc.paidTo.name}</strong>
          {peer ? (
            <span>A business on Splash</span>
          ) : (
            <span>
              {doc.paidTo.bank} <span className="iso-mono">•••• {doc.paidTo.last4}</span>
              {doc.paidTo.country ? `, ${doc.paidTo.country}` : null}
            </span>
          )}
          {doc.paidTo.verifiedAt ? (
            <span>
              Bank details verified by call-back, <MytDate at={doc.paidTo.verifiedAt} />
            </span>
          ) : null}
        </div>
      </div>

      <div className="iso-a4__amounts">
        <div className="iso-a4__block iso-a4__block--cyan">
          <span className="iso-a4__label">{peer ? 'They received' : 'Supplier received'}</span>
          <span className="iso-a4__fig iso-num">{doc.received.currency === 'PHP' ? php(doc.received.amountMinor) : usd(doc.received.amountMinor)}</span>
          <span className="iso-a4__sub">
            <span>{doc.received.currency === 'PHP' ? 'Philippine pesos' : 'US dollars'}</span>
            {doc.received.rail ? <span>by {doc.received.rail}</span> : <span>into their Splash account</span>}
            {doc.received.bankReference ? (
              <span>
                ref <span className="iso-mono">{doc.received.bankReference}</span>
              </span>
            ) : null}
          </span>
        </div>
        <div className="iso-a4__block">
          <span className="iso-a4__label">You paid</span>
          <span className="iso-a4__fig iso-a4__fig--sm iso-num">{usd(doc.paid.amountMinor)}</span>
          {peer ? (
            <span className="iso-a4__sub">
              <span>No conversion and no Splash fee</span>
            </span>
          ) : (
            <span className="iso-a4__sub">
              <span>
                {usd(doc.paid.convertedMinor)} converted + {usd(fees)} in fees
              </span>
              <span>
                Splash {usd(doc.paid.splashMinor)}, partner {usd(doc.paid.partnerMinor)}
                {processing > 0n ? `, processing ${usd(processing)}` : null}
              </span>
            </span>
          )}
        </div>
        <div className="iso-a4__block">
          <span className="iso-a4__label">Rate</span>
          {doc.rate ? (
            <>
              <span className="iso-a4__fig iso-a4__fig--sm iso-num">{doc.rate.value}</span>
              <span className="iso-a4__sub">
                <span>PHP per US$</span>
                {doc.rate.test ? <span>test rate</span> : null}
                <span>
                  locked <MytTime at={doc.rate.lockedAt} />
                </span>
              </span>
            </>
          ) : (
            <>
              <span className="iso-a4__fig iso-a4__fig--sm">None</span>
              <span className="iso-a4__sub">
                <span>No conversion: US dollars in, US dollars out</span>
              </span>
            </>
          )}
        </div>
      </div>

      <table className="iso-a4__table iso-a4__refs">
        <caption className="iso-sr">References</caption>
        <tbody>
          {pairs.map((pair) => (
            <tr key={pair[0].label}>
              {pair.map((r) => (
                <Fragment key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td className={r.mono ? 'iso-mono' : undefined}>{r.value}</td>
                </Fragment>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <table className="iso-a4__table iso-a4__times">
        <caption className="iso-sr">What happened, in Malaysia time</caption>
        <thead>
          <tr>
            <th scope="col">Event</th>
            <th scope="col">Time (MYT)</th>
            <th scope="col">By</th>
            <th scope="col">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {doc.events.map((e, i) => (
            <tr key={`${e.what}-${e.at}`}>
              <td data-label="Event">{e.what}</td>
              <td data-label="Time (MYT)" className="iso-num">
                {i === 0 || mytDay(e.at) !== firstDay ? <MytDateTime at={e.at} /> : <MytTime at={e.at} />}
              </td>
              <td data-label="By">{e.by}</td>
              <td data-label="Evidence" className="iso-a4__evidence">
                {e.evidence ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ReceiptCheck shareUrl={shareUrl} recordedAt={doc.recordedAt} fingerprint={doc.proof.fingerprint} root={doc.proof.root} />

      <footer className="iso-a4__foot">
        <span>
          Splash is in sandbox and is not yet a licensed money-services business.
          {doc.testMode ? ' This receipt describes a simulated payment on a test network.' : null}
        </span>
      </footer>
    </article>
  );
}
