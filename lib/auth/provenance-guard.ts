/**
 * Track A §1.3 — reject provenance violations loudly.
 *
 * Invariant #8: the client is never authoritative over balances or proposal
 * state. Any authority-shaped field arriving in a request body is treated as
 * probing, rejected with 400 before the route's own parsing, and counted so
 * a spike is visible in logs.
 */

export const FORBIDDEN_BODY_FIELDS = [
  'actorRole', 'role', 'signedBy', 'orgId', 'actorId', 'userId',
  'policy', 'thresholds', 'whitelistedActions', 'autonomyTier',
  'compliance', 'complianceResult', 'kytStatus', 'sanctionsResult',
] as const;

export class ProvenanceViolationError extends Error {
  readonly fields: string[];

  constructor(fields: string[]) {
    super(`request body contains server-owned authority fields: ${fields.join(', ')}`);
    this.name = 'ProvenanceViolationError';
    this.fields = fields;
  }
}

let violationCount = 0;

/** Monotonic per-process counter — a spike means someone is probing. */
export function provenanceViolationCount() {
  return violationCount;
}

export function assertCleanBody(body: unknown, route = 'unknown'): void {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return;
  const found = FORBIDDEN_BODY_FIELDS.filter((field) => field in (body as Record<string, unknown>));
  if (found.length > 0) {
    violationCount += 1;
    console.warn(
      `[provenance] rejected authority-shaped body fields on ${route}: ${found.join(', ')} (count=${violationCount})`,
    );
    throw new ProvenanceViolationError(found);
  }
}

export function provenanceViolationResponse(error: ProvenanceViolationError) {
  return new Response(
    JSON.stringify({
      error: 'ProvenanceViolation: authority fields are derived server-side and must not be sent by the client',
      code: 'provenance_violation',
      fields: error.fields,
    }),
    { status: 400, headers: { 'Content-Type': 'application/json' } },
  );
}
