'use client';

import { shortKey, timeShort } from './client';
import type { PaymentDTO } from './types';

/** Approved → Sent → Partner received → Paid to bank. The line drawing is the product's one motion moment. */
export function ProgressLine({ payment }: { payment: PaymentDTO }) {
  const t = payment.timeline;
  const exec = payment.signatures.find((s) => s.purpose === 'squads_vault_execute');
  const approve = payment.signatures.find((s) => s.purpose === 'squads_proposal_approve');
  const paid = payment.partnerEvents.find((e) => e.status === 'paid');
  const stops = [
    { key: 'approved', label: 'Approved', at: t.approvedAt, sig: approve },
    { key: 'sent', label: 'Sent', at: t.sentAt, sig: exec },
    { key: 'received', label: 'Partner received', at: t.receivedAt, note: payment.partnerLabel },
    { key: 'paid', label: 'Paid to bank', at: t.paidAt, note: paid?.bankReference ?? undefined },
  ];
  const done = stops.filter((s) => s.at).length;
  const fraction = done <= 1 ? 0 : (done - 1) / (stops.length - 1);
  const current = stops.find((s) => !s.at);
  return (
    <div className="sx-progress" style={{ ['--p' as string]: fraction }}>
      <div className="sx-progress-track" aria-hidden="true" />
      <div className="sx-progress-fill" aria-hidden="true" />
      <ol aria-label="Payment progress">
        {stops.map((s, i) => (
          <li key={s.key} className="sx-stop" data-step={s.key} data-done={s.at ? 'true' : undefined} data-filled={stops[i + 1]?.at ? 'true' : undefined} data-current={current?.key === s.key ? 'true' : undefined}>
            <span className="sx-dot" aria-hidden="true" />
            <div>
              <span className="sx-stop-label">
                {s.label}
                <span className="sx-visually-hidden">{s.at ? `, done at ${timeShort(s.at)}` : ', waiting'}</span>
              </span>
              <span className="sx-stop-meta">{s.at ? timeShort(s.at) : current?.key === s.key ? 'Waiting…' : ''}</span>
              {s.at && s.sig ? (
                s.sig.explorerUrl ? (
                  <a className="sx-stop-meta" href={s.sig.explorerUrl} target="_blank" rel="noreferrer">
                    View transaction
                  </a>
                ) : (
                  <span className="sx-stop-meta" title={s.sig.signature}>
                    <span className="sx-mono">{shortKey(s.sig.signature, 5)}</span> {s.sig.simulated ? '(simulated)' : ''}
                  </span>
                )
              ) : null}
              {s.at && s.note ? (
                <span className="sx-stop-meta">
                  <span className={s.key === 'paid' ? 'sx-mono' : undefined}>{s.note}</span>
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
