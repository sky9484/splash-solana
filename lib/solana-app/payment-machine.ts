/**
 * The payment state machine (prompt 07 §5.1). Pure: no I/O, no clock.
 *
 *   draft → quoted → checked → proposed → approved → executed → confirmed
 *         → partner_paid → evidenced → anchored
 *
 * A payment to another business on Splash ('peer') skips partner_paid: confirmed → evidenced.
 *
 * with an explicit failure state for each way out:
 *
 *   quote_expired        the quote ran out before the device prompt or the send
 *   rejected_by_policy   a deterministic rule (limits, screening, duplicate, bank details) said no
 *   proposal_failed      the proposal never reached the vault; nothing moved
 *   execute_failed       the execute did not land before its blockhash expired, or failed on chain
 *   partner_failed       the payout partner returned the payment; the USDC is back in the vault
 *   evidence_failed      the proof could not be saved yet (retried; the money already moved)
 *   discarded            a person dropped it before anything was sent; nothing moved, and it ends here
 *
 * What each happy-path state means, precisely:
 *   proposed   the Squads vault transaction + proposal exist on chain (commitment confirmed),
 *              waiting for the threshold of approvals
 *   approved   the threshold is met on chain; the execute may be sent
 *   executed   the execute transaction is signed and broadcast; its signature is recorded
 *   confirmed  the execute landed at commitment `confirmed`. Not final yet: evidence waits for
 *              `finalized` (tracked separately as `finalizedAt`)
 *
 * Self-transitions (quoted → quoted on a re-quote, checked → checked on a new route choice,
 * proposed → proposed when one more approver signs) exist so every change, even within a state,
 * is a compare-and-set that bumps the record's version.
 */

export const HAPPY_PATH = ['draft', 'quoted', 'checked', 'proposed', 'approved', 'executed', 'confirmed', 'partner_paid', 'evidenced', 'anchored'] as const;
export const FAILURE_STATES = ['quote_expired', 'rejected_by_policy', 'proposal_failed', 'execute_failed', 'partner_failed', 'evidence_failed', 'discarded'] as const;

export type HappyState = (typeof HAPPY_PATH)[number];
export type FailureState = (typeof FAILURE_STATES)[number];
export type PaymentState = HappyState | FailureState;

export const PAYMENT_STATES: readonly PaymentState[] = [...HAPPY_PATH, ...FAILURE_STATES];

const TRANSITIONS: Readonly<Record<PaymentState, readonly PaymentState[]>> = Object.freeze({
  draft: ['quoted', 'discarded'],
  quoted: ['quoted', 'checked', 'rejected_by_policy', 'quote_expired', 'discarded'],
  checked: ['quoted', 'checked', 'rejected_by_policy', 'quote_expired', 'proposed', 'discarded'],
  rejected_by_policy: ['quoted', 'checked', 'rejected_by_policy', 'quote_expired', 'discarded'],
  quote_expired: ['quoted', 'discarded'],
  proposed: ['proposed', 'approved', 'proposal_failed'],
  proposal_failed: ['quoted', 'discarded'],
  approved: ['executed', 'execute_failed'],
  executed: ['confirmed', 'execute_failed'],
  // The execute never landed: rebuilt with a fresh blockhash and signed again (never resent).
  execute_failed: ['approved'],
  confirmed: ['partner_paid', 'partner_failed'],
  partner_paid: ['evidenced', 'evidence_failed'],
  evidence_failed: ['evidenced', 'evidence_failed'],
  evidenced: ['anchored'],
  anchored: [],
  partner_failed: [],
  // A person dropped it before anything was sent. Nothing moved; a discarded payment never comes back.
  discarded: [],
});

/**
 * A payment into another business's Splash account ('peer', prompt 10 §5.2) has no partner: once
 * confirmed it is in their account, so its proof is next. Everything else is the bank payout's table.
 */
export type MachineKind = 'bank' | 'peer';
const PEER_OVERRIDES: Readonly<Partial<Record<PaymentState, readonly PaymentState[]>>> = Object.freeze({
  confirmed: ['evidenced'],
  partner_paid: [],
  partner_failed: [],
});

export function canTransition(from: PaymentState, to: PaymentState, kind: MachineKind = 'bank'): boolean {
  const next = kind === 'peer' ? (PEER_OVERRIDES[from] ?? TRANSITIONS[from]) : TRANSITIONS[from];
  return next?.includes(to) ?? false;
}

export class IllegalTransitionError extends Error {
  readonly from: PaymentState;
  readonly to: PaymentState;
  constructor(from: PaymentState, to: PaymentState) {
    super(`A payment cannot go from ${from} to ${to}`);
    this.name = 'IllegalTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function assertTransition(from: PaymentState, to: PaymentState, kind: MachineKind = 'bank'): void {
  if (!canTransition(from, to, kind)) throw new IllegalTransitionError(from, to);
}

export function nextStates(from: PaymentState): readonly PaymentState[] {
  return TRANSITIONS[from];
}

export function isTerminal(state: PaymentState): boolean {
  return TRANSITIONS[state].length === 0;
}

export function isFailure(state: PaymentState): state is FailureState {
  return (FAILURE_STATES as readonly string[]).includes(state);
}

/** Money has left (or is leaving) the vault: re-quoting or re-selecting is no longer possible. */
export function isCommitted(state: PaymentState): boolean {
  return ['proposed', 'approved', 'executed', 'confirmed', 'execute_failed', 'partner_paid', 'evidenced', 'anchored', 'evidence_failed', 'partner_failed'].includes(state);
}

/** Nothing has been sent yet, so a person may discard it: quoted, ready to approve, or stopped before the vault. */
export const DISCARDABLE_STATES: readonly PaymentState[] = ['draft', 'quoted', 'checked', 'rejected_by_policy', 'quote_expired', 'proposal_failed'];

/** States a resume pass looks at: something on chain may still be in flight. */
export const RESUMABLE_STATES: readonly PaymentState[] = ['proposed', 'approved', 'executed', 'confirmed', 'partner_paid', 'evidence_failed', 'evidenced'];

/** Plain words for the UI. */
export const STATE_LABEL: Readonly<Record<PaymentState, string>> = Object.freeze({
  draft: 'Draft',
  quoted: 'Quoted',
  checked: 'Ready to approve',
  proposed: 'Waiting for approval',
  approved: 'Approved',
  executed: 'Sent',
  confirmed: 'Sent · confirmed',
  partner_paid: 'Paid to the bank',
  evidenced: 'Proof saved',
  anchored: 'Proof recorded',
  quote_expired: 'Quote expired',
  rejected_by_policy: 'Blocked by your rules',
  proposal_failed: 'Not sent',
  execute_failed: 'Send failed',
  partner_failed: 'Returned by the payout partner',
  evidence_failed: 'Proof not saved yet',
  discarded: 'Discarded',
});

/**
 * The idempotency key every chain call carries: `paymentId:step`. Steps:
 *   proposal:<n>   the n-th proposal transaction (create + approve may span two)
 *   approve:<key>  an additional approver's proposalApprove (threshold > 1)
 *   execute:<k>    the execute; k counts rebuilds after an expired blockhash
 *   anchor         the evidence anchor
 */
export function chainCallKey(paymentId: string, step: string): string {
  if (!/^[a-z]+(:[A-Za-z0-9_.-]+)?$/.test(step)) throw new Error(`bad chain call step: ${step}`);
  return `${paymentId}:${step}`;
}
