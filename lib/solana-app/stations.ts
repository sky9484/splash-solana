/**
 * Where a payment is, in a person's words (prompt 10 §5.8): one table, used by Overview's
 * pipeline, Transfer's Step 5 and History. Every payment state maps to exactly one station, for
 * each kind of payment: a bank payout, a payment to another Splash business (`peer`, Phase 3) and
 * a treasury order (Phase 5).
 *
 *   Station              Bank payment        Splash business     Treasury
 *   Draft                draft, quoted       draft, quoted       draft, quoted
 *   Waiting approval     checked, proposed   checked, proposed   checked, proposed
 *   Sent                 approved, executed  approved, executed  approved, executed
 *   With partner         confirmed           (none)              (none)
 *   Paid / In account    partner_paid        confirmed           confirmed
 *   Recording proof      evidenced, evidence_failed (proof retried)
 *   Proof recorded       anchored
 *   Stopped              quote_expired, rejected_by_policy, proposal_failed, execute_failed,
 *                        partner_failed, discarded
 *
 * "checked" is the route chosen and the rules passed, before the first approval: it waits for a
 * person exactly as "proposed" does (the next approver on a 2-of-N account), so both are "Waiting
 * approval". A peer payment has no partner leg; partner_paid can't happen to it, and is mapped to
 * its "In their account" station so the table stays total.
 */
import { PAYMENT_STATES, type PaymentState } from './payment-machine.ts';

export type PaymentKind = 'bank' | 'peer' | 'treasury';

export type StationId = 'draft' | 'waiting' | 'sent' | 'partner' | 'paid' | 'recording' | 'recorded' | 'stopped';

export interface StationDef {
  id: StationId;
  /** The words a person reads, per kind. */
  label: Record<PaymentKind, string>;
}

export const STATIONS: readonly StationDef[] = [
  { id: 'draft', label: { bank: 'Draft', peer: 'Draft', treasury: 'Draft' } },
  { id: 'waiting', label: { bank: 'Waiting approval', peer: 'Waiting approval', treasury: 'Waiting approval' } },
  { id: 'sent', label: { bank: 'Sent', peer: 'Sent', treasury: 'Sent' } },
  { id: 'partner', label: { bank: 'With partner', peer: 'With partner', treasury: 'With partner' } },
  { id: 'paid', label: { bank: 'Paid to bank', peer: 'In their account', treasury: 'In Investments' } },
  { id: 'recording', label: { bank: 'Recording proof', peer: 'Recording proof', treasury: 'Recording proof' } },
  { id: 'recorded', label: { bank: 'Proof recorded', peer: 'Proof recorded', treasury: 'Proof recorded' } },
  { id: 'stopped', label: { bank: 'Stopped', peer: 'Stopped', treasury: 'Stopped' } },
];

const COMMON: Record<PaymentState, StationId> = {
  draft: 'draft',
  quoted: 'draft',
  checked: 'waiting',
  proposed: 'waiting',
  approved: 'sent',
  executed: 'sent',
  confirmed: 'partner',
  partner_paid: 'paid',
  evidenced: 'recording',
  evidence_failed: 'recording',
  anchored: 'recorded',
  quote_expired: 'stopped',
  rejected_by_policy: 'stopped',
  proposal_failed: 'stopped',
  execute_failed: 'stopped',
  partner_failed: 'stopped',
  discarded: 'stopped',
};

/** The station a payment in `state` is at. Total over every state, for every kind. */
export function stationOf(state: PaymentState, kind: PaymentKind = 'bank'): StationId {
  if (kind !== 'bank' && (state === 'confirmed' || state === 'partner_paid')) return 'paid';
  return COMMON[state];
}

/** The pipeline a person sees, in order (Overview, Step 5): no Draft, no Stopped; a peer payment has no partner leg. */
export function pipelineFor(kind: PaymentKind = 'bank'): StationId[] {
  const ids: StationId[] = ['waiting', 'sent', 'partner', 'paid', 'recording', 'recorded'];
  return kind === 'bank' ? ids : ids.filter((s) => s !== 'partner');
}

export function stationLabel(id: StationId, kind: PaymentKind = 'bank'): string {
  return STATIONS.find((s) => s.id === id)!.label[kind];
}

/** Money is moving into this station: a wire into it carries coins (Overview, Step 5). */
export function isMovingInto(id: StationId): boolean {
  return id === 'sent' || id === 'partner' || id === 'paid' || id === 'recording';
}

/** Every state maps to exactly one station: the check the tests run (and a guard if a state is added). */
export function assertTotal(): void {
  for (const kind of ['bank', 'peer', 'treasury'] as const) {
    for (const s of PAYMENT_STATES) if (!STATIONS.some((d) => d.id === stationOf(s, kind))) throw new Error(`${s} has no station for ${kind}`);
  }
}
