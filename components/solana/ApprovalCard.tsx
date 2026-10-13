'use client';

import { dateShort, pctFine, php, usd } from './client';
import type { ApprovalDTO } from './types';

const METHOD: Record<string, string> = {
  'call-back': 'by call-back',
  'supplier-account': "from the supplier's account record",
  'existing-record': 'from your supplier list',
};

export function secondsLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));
}

export function clock(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/**
 * The signing card: the only coral object in the product. Every field comes from the confirmed
 * invoice, the engine's quote and the policy result (I-6). No Zeke text is rendered here; the
 * fixed "Zeke drafted this" label says who prepared it (prompt 07 §5.4), not what Zeke wrote.
 */
export function ApprovalCard({
  card,
  now,
  busy,
  onApprove,
  onCancel,
  onRefresh,
  fundedBy = null,
}: {
  card: ApprovalDTO;
  now: number;
  busy: boolean;
  onApprove: () => void;
  onCancel: () => void;
  onRefresh: () => void;
  /** A transfer's Step 3: where the USDC in the payments vault came from (a deterministic label). */
  fundedBy?: string | null;
}) {
  const left = secondsLeft(card.quoteExpiresAt, now);
  const expired = left === 0;
  const failed = card.policy.checks.filter((c) => !c.passed);
  const disabledReason = expired
    ? 'Quote expired, refresh'
    : !card.verified
      ? 'Verify the bank details first'
      : failed.length > 0
        ? `Blocked by your rules: ${failed[0]!.label.toLowerCase()}`
        : null;
  const receive = php(card.receivePhpMinor);
  const transfer = card.kind === 'transfer';
  const who = transfer ? 'Recipient' : 'Supplier';
  return (
    <section className="sx-approve" aria-label={`Approve payment. ${who} receives ${receive}.`}>
      <p className="sx-visually-hidden">{who} receives {receive}.</p>
      <p className="sx-small sx-muted">{transfer ? `Typed in by ${card.draftedBy}` : `${card.draftedBy} drafted this`} · a person approves</p>
      <p className="sx-approve-supplier">{card.supplierName}</p>
      <p className="sx-muted">
        {card.bank} <span className="sx-mono">•••• {card.accountLast4}</span>
        {card.verified ? (
          <>
            {' '}
            · verified {dateShort(card.verified.at)} {METHOD[card.verified.method] ?? ''}
          </>
        ) : (
          <> · not verified</>
        )}
      </p>
      <div className="sx-approve-amount" aria-hidden="true">
        <p className="sx-big">{receive}</p>
        <p className="sx-muted">{who} receives</p>
      </div>
      <dl>
        <dt>You pay</dt>
        <dd className="sx-num">
          <strong>{usd(card.youPayUsdcMinor)}</strong> from your Solana balance
        </dd>
        <dt>All-in cost</dt>
        <dd className="sx-num">
          {pctFine(card.costs.allInBps)}{' '}
          <span className="sx-muted">
            (route {pctFine(card.costs.routeBps)} · partner {pctFine(card.costs.partnerBps)} · Splash {pctFine(card.costs.splashBps)})
          </span>
        </dd>
        <dt>Arrives</dt>
        <dd>{card.arrives}</dd>
        <dt>Route</dt>
        <dd>
          {card.routeLabel}. {card.laneNote}.
        </dd>
        <dt>Paid to</dt>
        <dd>
          Payout partner deposit <span className="sx-mono">{card.depositAddress.slice(0, 4)}…{card.depositAddress.slice(-4)}</span>
        </dd>
        <dt>{transfer ? 'Reference' : 'Invoice'}</dt>
        <dd>
          <span className="sx-mono">{card.invoiceNumber}</span>
          {card.einvoiceRef ? <> · MyInvois <span className="sx-mono">{card.einvoiceRef.slice(0, 4)}…</span></> : null}{' '}
          {transfer ? (
            <span className="sx-pill sx-pill-sim">no invoice</span>
          ) : card.invoiceMatched ? (
            <span className="sx-pill sx-pill-ok">matched</span>
          ) : (
            <span className="sx-pill sx-pill-warn">amount differs</span>
          )}
        </dd>
        {card.purpose ? (
          <>
            <dt>Purpose</dt>
            <dd>{card.purpose}</dd>
          </>
        ) : null}
        {fundedBy ? (
          <>
            <dt>Paid from</dt>
            <dd>{fundedBy}</dd>
          </>
        ) : null}
        <dt>Quote expires</dt>
        <dd className="sx-num" aria-live={left <= 10 ? 'polite' : 'off'}>
          {expired ? 'Expired' : `in ${clock(left)}`}
        </dd>
      </dl>
      <details style={{ marginTop: 16 }}>
        <summary className="sx-small">
          Rules checked: {card.policy.checks.length - failed.length} of {card.policy.checks.length} passed
        </summary>
        <ul className="sx-checks" style={{ marginTop: 8 }}>
          {card.policy.checks.map((c) => (
            <li key={c.name}>
              <span className={c.passed ? 'ok' : 'no'} aria-hidden="true">
                {c.passed ? '✓' : '✕'}
              </span>
              <span>
                {c.label}
                <span className="sx-visually-hidden">{c.passed ? ': passed' : ': not passed'}</span>
              </span>
            </li>
          ))}
        </ul>
      </details>
      {card.simulated ? <p className="sx-small sx-muted" style={{ marginTop: 12 }}>Simulated · devnet-ready. Mock partner · devnet. The rate is a fixed reference, not a live rate.</p> : null}
      <div className="sx-approve-actions">
        {expired ? (
          <button type="button" className="sx-btn" onClick={onRefresh}>
            Quote expired, refresh
          </button>
        ) : (
          <button type="button" className="sx-btn" onClick={onApprove} disabled={busy || disabledReason !== null} aria-describedby={disabledReason ? 'approve-why' : undefined}>
            {busy ? 'Waiting for this device…' : 'Approve with this device'}
          </button>
        )}
        <button type="button" className="sx-btn-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {disabledReason && !expired ? (
        <p id="approve-why" className="sx-small" style={{ marginTop: 8 }}>
          {disabledReason}
        </p>
      ) : null}
    </section>
  );
}
