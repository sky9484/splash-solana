import fs from 'node:fs';
import path from 'node:path';

import type { OrgPolicy, UnsignedProposal } from '../agent/types.ts';

export type CircuitState = 'ARMED' | 'PAUSED';

export interface CircuitBreakerSnapshot {
  orgId: string;
  globalState: CircuitState;
  perCorridorState: Record<string, CircuitState>;
  updatedAt: string;
  updatedBy: string;
  reason?: string;
}

export type CircuitBreakerDecision =
  | { armed: true }
  | { armed: false; reason: string; scope: 'global' | 'corridor'; corridor?: string };

const DATA_DIR = process.env.SPLASH_DATA_DIR ?? path.join(process.cwd(), 'data');
const CIRCUIT_PATH = path.join(DATA_DIR, 'circuit-breakers.json');

const globalCircuitStore = globalThis as typeof globalThis & {
  oxwalCircuitBreakers?: Map<string, CircuitBreakerSnapshot>;
};

function readPersistedCircuitBreakers() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CIRCUIT_PATH, 'utf8')) as CircuitBreakerSnapshot[];
    return new Map(parsed.filter((item) => item?.orgId).map((item) => [item.orgId, item]));
  } catch {
    return new Map<string, CircuitBreakerSnapshot>();
  }
}

const breakers = globalCircuitStore.oxwalCircuitBreakers ?? readPersistedCircuitBreakers();
globalCircuitStore.oxwalCircuitBreakers = breakers;

function persistCircuitBreakers() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tempPath = `${CIRCUIT_PATH}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify([...breakers.values()], null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, CIRCUIT_PATH);
}

function defaultSnapshot(orgId: string): CircuitBreakerSnapshot {
  return {
    orgId,
    globalState: 'ARMED',
    perCorridorState: {},
    updatedAt: new Date(0).toISOString(),
    updatedBy: 'system',
  };
}

export function readCircuitBreaker(orgId: string) {
  return breakers.get(orgId) ?? defaultSnapshot(orgId);
}

export function listCircuitBreakers() {
  return [...breakers.values()].sort((a, b) => a.orgId.localeCompare(b.orgId));
}

export function setGlobalCircuitBreaker(input: {
  orgId: string;
  state: CircuitState;
  actor: string;
  reason?: string;
}) {
  const current = readCircuitBreaker(input.orgId);
  const next: CircuitBreakerSnapshot = {
    ...current,
    globalState: input.state,
    updatedAt: new Date().toISOString(),
    updatedBy: input.actor,
    reason: input.reason,
  };
  breakers.set(input.orgId, next);
  persistCircuitBreakers();
  console.info('[0xwal.circuit_breaker]', {
    orgId: input.orgId,
    scope: 'global',
    state: input.state,
    actor: input.actor,
    reason: input.reason,
  });
  return next;
}

export function setCorridorCircuitBreaker(input: {
  orgId: string;
  corridor: string;
  state: CircuitState;
  actor: string;
  reason?: string;
}) {
  const current = readCircuitBreaker(input.orgId);
  const next: CircuitBreakerSnapshot = {
    ...current,
    perCorridorState: {
      ...current.perCorridorState,
      [input.corridor]: input.state,
    },
    updatedAt: new Date().toISOString(),
    updatedBy: input.actor,
    reason: input.reason,
  };
  breakers.set(input.orgId, next);
  persistCircuitBreakers();
  console.info('[0xwal.circuit_breaker]', {
    orgId: input.orgId,
    scope: 'corridor',
    corridor: input.corridor,
    state: input.state,
    actor: input.actor,
    reason: input.reason,
  });
  return next;
}

export function policyWithCircuitBreaker(policy: OrgPolicy): OrgPolicy {
  const breaker = readCircuitBreaker(policy.orgId);
  return {
    ...policy,
    globalState: breaker.globalState,
    perCorridorState: {
      ...policy.perCorridorState,
      ...breaker.perCorridorState,
    },
  };
}

export function circuitBreakerDecision(input: {
  proposal: Pick<UnsignedProposal, 'orgId' | 'corridor'>;
  policy: OrgPolicy;
}): CircuitBreakerDecision {
  const policy = policyWithCircuitBreaker(input.policy);
  if (policy.globalState === 'PAUSED') {
    return { armed: false, scope: 'global', reason: 'circuit breaker' };
  }
  const corridor = input.proposal.corridor;
  if (corridor && policy.perCorridorState[corridor] === 'PAUSED') {
    return { armed: false, scope: 'corridor', corridor, reason: 'circuit breaker' };
  }
  return { armed: true };
}

export function resetCircuitBreakersForTesting() {
  breakers.clear();
  persistCircuitBreakers();
}
