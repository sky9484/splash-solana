import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import test, { after as afterAll, before } from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '../lib/db/schema.ts';

/**
 * A business that submits its KYB documents a second time gets the same case,
 * not a 500.
 *
 * The upload route mints a fresh case id per request, and the store upserted on
 * that id alone. So the second POST /api/kyb/upload for the same registration
 * number tried to INSERT a second row, `kyb_cases_org_registration_unique`
 * refused it, and the route answered 500 — seen on the dev server for
 * fresh@acme.test (org `fresh-business`, registration 202401012345): one 200,
 * then two 500s.
 *
 * A resubmission is the same company's case: its documents are appended, its
 * audit trail only grows, and it goes back to SUBMITTED for a fresh review.
 * These run the real route on PGlite; only `cookies()`, which exists inside a
 * Next request, is stubbed, as in tests/approved-payout-once.test.mjs.
 */

process.env.DATABASE_URL = 'postgres://pglite.invalid/kyb-resubmission';
process.env.CUSTOMER_SESSION_SECRET = 'kyb-resubmission-session-secret-0123456789abcdef0123456789';
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
delete process.env.REDIS_URL;

const scope = { cookies: new Map() };
globalThis.__kybResubmissionScope = scope;

const stubModule = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const NEXT_HEADERS = stubModule(`
  const jar = () => globalThis.__kybResubmissionScope.cookies;
  export async function cookies() {
    return {
      get: (name) => (jar().has(name) ? { name, value: jar().get(name) } : undefined),
      getAll: () => [...jar()].map(([name, value]) => ({ name, value })),
      has: (name) => jar().has(name),
      set: () => {},
      delete: () => {},
    };
  }
  export async function headers() { return new Headers(); }
`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/headers') return { url: NEXT_HEADERS, shortCircuit: true };
    // Next's package has no exports map, so plain Node needs the file name.
    if (specifier === 'next/server') return nextResolve('next/server.js', context);
    if (context.parentURL?.startsWith('data:')) return nextResolve(specifier, { ...context, parentURL: import.meta.url });
    return nextResolve(specifier, context);
  },
});

const ORIGIN = 'http://localhost:3000';
const ORG = 'fresh-business';

let client;
let route;
let kyb;

before(async () => {
  client = new PGlite();
  const files = (await readdir(new URL('../drizzle', import.meta.url))).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sqlText = await readFile(new URL(`../drizzle/${file}`, import.meta.url), 'utf8');
    for (const statement of sqlText.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }
  globalThis.splashDb = { pool: { end: async () => {} }, db: drizzle(client, { schema }) };

  // The dev seed's new business: REGISTERED, one verified admin.
  await client.exec(`
    INSERT INTO organizations (id, name, kyb_lifecycle) VALUES ('${ORG}', 'Fresh Trading', 'REGISTERED');
    INSERT INTO users (id, email, name, email_verified_at) VALUES ('usr_fresh', 'fresh@acme.test', 'Fresh Operator', now());
    INSERT INTO memberships (id, user_id, org_id, role) VALUES ('mem_fresh', 'usr_fresh', '${ORG}', 'admin');
  `);

  const session = await import('@/lib/auth/customer-session');
  const signedIn = session.createCustomerSessionFromIdentity({ email: 'fresh@acme.test', credentialVersion: 1 });
  scope.cookies = new Map([
    [session.CUSTOMER_SESSION_COOKIE, session.createCustomerSessionToken(signedIn, process.env.CUSTOMER_SESSION_SECRET)],
  ]);

  route = await import('@/app/api/kyb/upload/route');
  kyb = await import('@/lib/server/kyb');
});

afterAll(async () => {
  delete globalThis.splashDb;
  await client?.close();
});

/** What KybSettings posts: the business, its SSM number, and the files. */
function upload(registrationNumber, ...documents) {
  const form = new FormData();
  form.append('businessName', 'Fresh Trading Sdn Bhd');
  form.append('ssmNumber', registrationNumber);
  for (const [name, text] of documents) {
    form.append('documents', new File([text], name, { type: 'application/pdf' }));
  }
  return route.POST(new Request(`${ORIGIN}/api/kyb/upload`, { method: 'POST', headers: { origin: ORIGIN }, body: form }));
}

async function casesFor(registrationNumber) {
  const { rows } = await client.query(
    'SELECT id, state, documents, audit_trail FROM kyb_cases WHERE org_id = $1 AND registration_number = $2',
    [ORG, registrationNumber],
  );
  return rows;
}

test('a second upload for the same registration number updates the one case', async () => {
  const first = await upload('202401012345', ['form-9.pdf', 'form 9 bytes']);
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.lifecycle, 'KYB_SUBMITTED');

  const second = await upload('202401012345', ['director-id.pdf', 'director id bytes']);
  assert.equal(second.status, 200, 'the resubmission is not a 500');
  const secondBody = await second.json();

  // The client polls the case and starts Sumsub with this id, so it must be
  // the case that exists, not the id this request minted and never wrote.
  assert.equal(secondBody.kybCaseId, firstBody.kybCaseId);

  const rows = await casesFor('202401012345');
  assert.equal(rows.length, 1, 'one company, one case');
  const [row] = rows;
  assert.equal(row.id, firstBody.kybCaseId);
  assert.equal(row.state, 'SUBMITTED');
  assert.deepEqual(row.documents.map((d) => d.name), ['form-9.pdf', 'director-id.pdf']);
  assert.deepEqual(row.documents.map((d) => d.kind), ['COMPANY_DOCUMENT', 'DIRECTOR_ID']);
  // Both uploads are filed under the case they belong to.
  for (const document of row.documents) assert.ok(document.storageKey.startsWith(`kyb/${row.id}/`), document.storageKey);
  assert.deepEqual(row.audit_trail.map((e) => e.action), ['kyb.submitted', 'kyb.submitted']);

  // A third, as on the dev server, still lands in the same case.
  const third = await upload('202401012345', ['form-9.pdf', 'form 9 bytes']);
  assert.equal(third.status, 200);
  assert.equal((await third.json()).kybCaseId, firstBody.kybCaseId);
  assert.equal((await casesFor('202401012345'))[0].documents.length, 3);
});

test('resubmitting after review reopens the case and keeps what the reviewer wrote', async () => {
  const first = await upload('202401099999', ['form-9.pdf', 'form 9']);
  const { kybCaseId } = await first.json();
  await kyb.reviewKybCase(kybCaseId, {
    state: 'NEEDS_INFORMATION',
    actor: 'compliance@splash.finance',
    note: 'Missing UBO evidence',
    assignedTo: 'compliance@splash.finance',
  });

  const again = await upload('202401099999', ['ubo-chart.pdf', 'ubo chart']);
  assert.equal(again.status, 200);

  const record = await kyb.readKybCase(ORG, kybCaseId);
  assert.equal(record.state, 'SUBMITTED', 'new documents are a new review');
  assert.equal(record.riskTier, 'UNASSIGNED');
  assert.equal(record.corridorAccess, 'LOCKED');
  assert.equal(record.assignedTo, 'compliance@splash.finance');
  assert.equal(record.reviewNotes, 'Missing UBO evidence');
  assert.deepEqual(record.documents.map((d) => d.name), ['form-9.pdf', 'ubo-chart.pdf']);
  // Append-only: the reviewer's request is still there, before the answer.
  assert.deepEqual(
    record.auditTrail.map((e) => e.action),
    ['kyb.submitted', 'kyb.needs_information', 'kyb.submitted'],
  );
});

// ── The org lifecycle on a resubmission ─────────────────────────────────────

async function setLifecycle(state) {
  await client.query('UPDATE organizations SET kyb_lifecycle = $1 WHERE id = $2', [state, ORG]);
}

async function lifecycleNow() {
  const { rows } = await client.query('SELECT kyb_lifecycle FROM organizations WHERE id = $1', [ORG]);
  return rows[0].kyb_lifecycle;
}

/** How many times the route reported that the org did not advance. */
const notAdvancedReports = (errorMock) =>
  errorMock.mock.calls.filter((call) => String(call.arguments[0]).includes('org state did not advance')).length;

test('a resubmission while the org is already submitted is quiet', async (t) => {
  await setLifecycle('KYB_SUBMITTED');
  const errors = t.mock.method(console, 'error', () => {});

  // KYB_SUBMITTED → KYB_SUBMITTED is not a transition, so the machine refuses
  // it; that used to be logged as an error on every resubmission.
  for (const name of ['form-9.pdf', 'director-id.pdf']) {
    const response = await upload('202401033333', [name, name]);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).lifecycle, 'KYB_SUBMITTED', 'the org is reported where it is');
  }
  assert.equal(notAdvancedReports(errors), 0);
  assert.equal(await lifecycleNow(), 'KYB_SUBMITTED');
});

test('a resubmission after a rejection still moves the org back to KYB_SUBMITTED', async (t) => {
  await setLifecycle('REJECTED');
  const errors = t.mock.method(console, 'error', () => {});

  const response = await upload('202401044444', ['form-9.pdf', 'form 9 again']);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).lifecycle, 'KYB_SUBMITTED');
  assert.equal(await lifecycleNow(), 'KYB_SUBMITTED', 'REJECTED → KYB_SUBMITTED is re-KYB, a real transition');
  assert.equal(notAdvancedReports(errors), 0);
});

test('documents from an org past review are recorded, and the org staying put is still reported', async (t) => {
  await setLifecycle('ACTIVE');
  const errors = t.mock.method(console, 'error', () => {});

  // Only the already-submitted case is quiet. An ACTIVE business uploading
  // KYB documents does not go back into review, and that stays visible.
  const response = await upload('202401066666', ['form-9.pdf', 'new form 9']);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).lifecycle, null);
  assert.equal(await lifecycleNow(), 'ACTIVE');
  assert.equal(notAdvancedReports(errors), 1);
  await setLifecycle('KYB_SUBMITTED');
});

test('two first submissions racing each other make one case with both uploads', async () => {
  // Neither sees the other's row before writing; the upsert on (org,
  // registration number) is what makes the second one a merge, not a 500.
  const [a, b] = await Promise.all([
    kyb.recordKybSubmission({
      caseId: 'kyb_race_a',
      orgId: ORG,
      businessName: 'Fresh Trading Sdn Bhd',
      registrationNumber: '202401077777',
      documents: [{ name: 'a.pdf', kind: 'COMPANY_DOCUMENT', type: 'application/pdf', size: 1, sha256: 'a'.repeat(64), storageKey: 'kyb/a', virusScanResult: 'PENDING', uploadedAt: new Date().toISOString() }],
    }),
    kyb.recordKybSubmission({
      caseId: 'kyb_race_b',
      orgId: ORG,
      businessName: 'Fresh Trading Sdn Bhd',
      registrationNumber: '202401077777',
      documents: [{ name: 'b.pdf', kind: 'DIRECTOR_ID', type: 'application/pdf', size: 1, sha256: 'b'.repeat(64), storageKey: 'kyb/b', virusScanResult: 'PENDING', uploadedAt: new Date().toISOString() }],
    }),
  ]);

  assert.equal(a.id, b.id, 'both callers are told the same case');
  const rows = await casesFor('202401077777');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].documents.map((d) => d.name).sort(), ['a.pdf', 'b.pdf']);
  assert.equal(rows[0].audit_trail.length, 2);
});

test('without a database, a resubmission merges the same way', async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const doc = (name) => ({ name, kind: 'COMPANY_DOCUMENT', type: 'application/pdf', size: 1, sha256: '0'.repeat(64), storageKey: `kyb/${name}`, virusScanResult: 'PENDING', uploadedAt: new Date().toISOString() });
    const input = { orgId: 'memory-org', businessName: 'Memory Sdn Bhd', registrationNumber: '202401055555' };
    const first = await kyb.recordKybSubmission({ ...input, caseId: 'kyb_memory_1', documents: [doc('one.pdf')] });
    const second = await kyb.recordKybSubmission({ ...input, caseId: 'kyb_memory_2', documents: [doc('two.pdf')] });

    assert.equal(second.id, first.id);
    assert.equal((await kyb.listKybCases('memory-org')).length, 1);
    assert.deepEqual(second.documents.map((d) => d.name), ['one.pdf', 'two.pdf']);
    assert.equal(second.auditTrail.length, 2);
    assert.equal(second.submittedAt, first.submittedAt);
  } finally {
    process.env.DATABASE_URL = previous;
  }
});
