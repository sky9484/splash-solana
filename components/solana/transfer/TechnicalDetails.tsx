// iso-ui
// copy: technical
'use client';

import { Details } from '@/components/iso';
import LocalTime from '@/components/LocalTime';

import { shortKey } from '../client';
import type { PaymentDTO } from '../types';

/** A moment in the reader's own time zone (LocalTime is the one client formatter of dates). */
function when(iso: string | null | undefined) {
  if (!iso) return '—';
  return <LocalTime value={iso} options={{ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }} />;
}

/**
 * A receipt's "Technical details" (prompt 10 §5.8 and §0.6): the one place on Track that names the
 * network, the transfer and its explorer link, the proof record and the timestamps.
 */
export function TechnicalDetails({ payment, bankReference }: { payment: PaymentDTO; bankReference: string | null }) {
  const execute = payment.signatures.find((s) => s.purpose === 'squads_vault_execute') ?? payment.signatures.at(-1) ?? null;
  return (
    <Details summary="Technical details">
      <dl className="iso-dl iso-dl--rows iso-num">
        <div>
          <dt>Network</dt>
          <dd>{payment.simulated ? 'Solana devnet (test mode, simulated)' : 'Solana devnet (test mode)'}</dd>
        </div>
        {execute ? (
          <div>
            <dt>Transfer</dt>
            <dd>
              <span className="iso-mono">{shortKey(execute.signature)}</span>
              {execute.explorerUrl ? (
                <>
                  {' · '}
                  <a href={execute.explorerUrl} target="_blank" rel="noreferrer">
                    open in explorer
                  </a>
                </>
              ) : execute.simulated ? (
                ' · simulated, not on a public network'
              ) : null}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Proof record</dt>
          <dd className="iso-mono">{payment.trace.memo}</dd>
        </div>
        {bankReference ? (
          <div>
            <dt>Bank reference</dt>
            <dd className="iso-mono">{bankReference}</dd>
          </div>
        ) : null}
        <div>
          <dt>Approved</dt>
          <dd>{when(payment.timeline.approvedAt)}</dd>
        </div>
        <div>
          <dt>{payment.kind === 'peer' ? 'Sent' : 'Paid to bank'}</dt>
          <dd>{when(payment.kind === 'peer' ? payment.timeline.sentAt : payment.timeline.paidAt)}</dd>
        </div>
      </dl>
    </Details>
  );
}
