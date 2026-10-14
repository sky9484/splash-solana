/** A payment's state in the state machine's own words (payment-machine.ts STATE_LABEL); the colour only repeats them. */
export function StatusPill({ state, label }: { state: string; label: string }) {
  const ok = ['partner_paid', 'evidenced', 'anchored'];
  const warn = ['partner_failed', 'proposal_failed', 'execute_failed', 'rejected_by_policy', 'quote_expired', 'evidence_failed'];
  const cls = ok.includes(state) ? 'sx-pill-ok' : warn.includes(state) ? 'sx-pill-warn' : 'sx-pill-pending';
  return <span className={`sx-pill ${cls}`}>{label}</span>;
}
