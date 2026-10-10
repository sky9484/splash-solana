/**
 * KYB onboarding lifecycle (wallet spec §3).
 *
 * "Approved" in a regulated flow is not binary: it needs BOTH a provider
 * verdict (Sumsub — the detective control) AND an accountable human sign-off
 * (Splash staff — the decision a regulator asks to see). This module encodes
 * that as an explicit state machine so neither control can be skipped.
 *
 * The invariant that matters: **only ACTIVE unlocks money movement.** Every
 * other state is read-only, including KYB_PROVIDER_APPROVED — a provider
 * verdict alone never opens the money path.
 *
 * Pure module, zero I/O: persistence lives in the repo layer, on-chain
 * reflection in lib/server/sui-settlement.ts. That keeps the rules unit
 * testable without a database.
 */

export type KybLifecycleState =
  | 'REGISTERED'
  | 'KYB_SUBMITTED'
  | 'KYB_PROVIDER_APPROVED'
  | 'KYB_ADMIN_APPROVED'
  | 'ACTIVE'
  | 'REJECTED'
  | 'SUSPENDED';

/**
 * Who is driving the transition. This is the separation-of-duties half of the
 * machine: the provider can never grant itself the human sign-off, and the
 * webhook can never reach ACTIVE.
 */
export type KybActor = 'SYSTEM' | 'PROVIDER' | 'ADMIN';

export const KYB_LIFECYCLE_STATES: readonly KybLifecycleState[] = [
  'REGISTERED',
  'KYB_SUBMITTED',
  'KYB_PROVIDER_APPROVED',
  'KYB_ADMIN_APPROVED',
  'ACTIVE',
  'REJECTED',
  'SUSPENDED',
];

/** Legal next states, regardless of actor. */
const ALLOWED_TRANSITIONS: Record<KybLifecycleState, readonly KybLifecycleState[]> = {
  REGISTERED: ['KYB_SUBMITTED', 'REJECTED'],
  KYB_SUBMITTED: ['KYB_PROVIDER_APPROVED', 'REJECTED'],
  KYB_PROVIDER_APPROVED: ['KYB_ADMIN_APPROVED', 'REJECTED'],
  KYB_ADMIN_APPROVED: ['ACTIVE', 'SUSPENDED', 'REJECTED'],
  ACTIVE: ['SUSPENDED', 'REJECTED'],
  SUSPENDED: ['ACTIVE', 'REJECTED'],
  // Re-KYB after a decline: back to the start of the document flow, never
  // straight back to ACTIVE.
  REJECTED: ['KYB_SUBMITTED'],
};

/** Which states each actor is permitted to *produce*. */
const ACTOR_CAPABILITIES: Record<KybActor, readonly KybLifecycleState[]> = {
  // Registration + document submission are driven by the product.
  SYSTEM: ['REGISTERED', 'KYB_SUBMITTED'],
  // Sumsub advances the OFF-CHAIN state only, and can never sign off.
  PROVIDER: ['KYB_PROVIDER_APPROVED', 'REJECTED'],
  // The accountable human. Only `admin` role reaches this actor.
  ADMIN: ['KYB_ADMIN_APPROVED', 'ACTIVE', 'SUSPENDED', 'REJECTED'],
};

export class KybTransitionError extends Error {
  readonly from: KybLifecycleState;
  readonly to: KybLifecycleState;
  readonly actor: KybActor;

  constructor(from: KybLifecycleState, to: KybLifecycleState, actor: KybActor, reason: string) {
    super(`KYB transition ${from} → ${to} rejected for ${actor}: ${reason}`);
    this.name = 'KybTransitionError';
    this.from = from;
    this.to = to;
    this.actor = actor;
  }
}

export function isKybLifecycleState(value: unknown): value is KybLifecycleState {
  return typeof value === 'string' && (KYB_LIFECYCLE_STATES as readonly string[]).includes(value);
}

/** Parse a persisted value, defaulting unknown/absent to the safest state. */
export function toKybLifecycleState(value: unknown): KybLifecycleState {
  return isKybLifecycleState(value) ? value : 'REGISTERED';
}

export function canTransition(from: KybLifecycleState, to: KybLifecycleState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: KybLifecycleState, to: KybLifecycleState, actor: KybActor): void {
  if (!ACTOR_CAPABILITIES[actor].includes(to)) {
    throw new KybTransitionError(from, to, actor, `${actor} may not set ${to}`);
  }
  if (!canTransition(from, to)) {
    throw new KybTransitionError(from, to, actor, `${to} is not reachable from ${from}`);
  }
}

/**
 * THE money gate. Deliberately a whitelist of exactly one state — if a new
 * state is ever added, it is read-only until someone consciously adds it here.
 */
export function canMoveMoney(state: KybLifecycleState): boolean {
  return state === 'ACTIVE';
}

/** Operator-facing explanation for a blocked surface. */
export function kybGateReason(state: KybLifecycleState): string {
  switch (state) {
    case 'ACTIVE':
      return '';
    case 'REGISTERED':
      return 'Verification has not started. Complete KYB to enable money movement.';
    case 'KYB_SUBMITTED':
    case 'KYB_PROVIDER_APPROVED':
      return 'Verification is in review. You can explore the desk; money movement unlocks once approval completes.';
    case 'KYB_ADMIN_APPROVED':
      return 'Approved — activation is being finalised. Money movement unlocks shortly.';
    case 'SUSPENDED':
      return 'This workspace is suspended. Contact support to restore money movement.';
    case 'REJECTED':
      return 'Verification was declined. Re-submit KYB to continue.';
  }
}

/**
 * Project the lifecycle onto the coarse legacy `organizations.kyb_status` enum
 * so the two never drift. The enum stays the compatibility surface; the
 * lifecycle column is the authority.
 */
export function coarseKybStatus(state: KybLifecycleState): 'none' | 'pending' | 'basic' | 'full' | 'rejected' {
  switch (state) {
    case 'REGISTERED':
      return 'none';
    case 'KYB_SUBMITTED':
    case 'KYB_PROVIDER_APPROVED':
      return 'pending';
    case 'KYB_ADMIN_APPROVED':
      return 'basic';
    case 'ACTIVE':
      return 'full';
    case 'REJECTED':
      return 'rejected';
    case 'SUSPENDED':
      // Suspension is an operational freeze, not a KYB decline — keep the
      // documents' standing rather than downgrading to 'rejected'.
      return 'basic';
  }
}

/** Map a Sumsub screening verdict to the state a PROVIDER may set. */
export function providerStateForVerdict(verdict: 'CLEAR' | 'REVIEW' | 'BLOCK' | 'ERROR'): KybLifecycleState | null {
  if (verdict === 'CLEAR') return 'KYB_PROVIDER_APPROVED';
  if (verdict === 'BLOCK') return 'REJECTED';
  // REVIEW / ERROR are not decisions — leave the case where it is.
  return null;
}
