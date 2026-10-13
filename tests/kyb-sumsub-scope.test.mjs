import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import test, { after as afterAll, before, beforeEach } from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '../lib/db/schema.ts';

/**
 * POST /api/kyb/sumsub works on the caller's own KYB case and nobody else's.
 *
 * The route took `kybCaseId` from the request body and did two things with it
 * for any signed-in customer: asked Sumsub for an access token as that case's
 * applicant (which lets the holder act as that company in the WebSDK), and
 * wrote the applicant id and a `kyb.sumsub_linked` audit event onto the case
 * through a staff-scoped, cross-tenant write. Nothing asked whose case it was.
 *
 * The real route runs on PGlite. `cookies()` is stubbed, as in
 * tests/kyb-resubmission.test.mjs, and `fetch` answers for the Sumsub host only,
 * so nothing reaches the network and every Sumsub call is counted.
 */

process.env.DATABASE_URL = 'postgres://pglite.invalid/kyb-sumsub-scope';
process.env.CUSTOMER_SESSION_SECRET = 'kyb-sumsub-scope-session-secret-0123456789abcdef0123456789';
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
process.env.SUMSUB_APP_TOKEN = 'sumsub-test-app-token';
process.env.SUMSUB_SECRET_KEY = 'sumsub-test-secret-key';
process.env.SUMSUB_BASE_URL = 'https://sumsub.invalid';
delete process.env.REDIS_URL;

const scope = { cookies: new Map() };
globalThis.__kybSumsubScope = scope;

const stubModule = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const NEXT_HEADERS = stubModule(`
  const jar = () => globalThis.__kybSumsubScope.cookies;
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
const ACME = { email: 'ops@acme.test', orgId: 'acme' };
const NORTHWIND = { email: 'ops@northwind.test', orgId: 'northwind' };
/** Signed up, documents uploaded, no membership yet: a new business. */
const NEWCOMER = { email: 'founder@freshco.test' };
/** Signed up and nothing else: no membership, no workspace, no case. */
const STRANGER = { email: 'someone@nowhere.test' };

let client;
let route;
let kyb;
let session;
let acmeCaseId;
let newcomerCaseId;

/** Every request the route made to Sumsub, in order. */
const sumsubCalls = [];

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

  const { workspaceForEmail } = await import('@/lib/auth/signup-org');
  NEWCOMER.orgId = workspaceForEmail(NEWCOMER.email).orgId;

  await client.exec(`
    INSERT INTO organizations (id, name) VALUES
      ('${ACME.orgId}', 'Acme Trading'), ('${NORTHWIND.orgId}', 'Northwind'), ('${NEWCOMER.orgId}', 'freshco.test');
    INSERT INTO users (id, email, name, email_verified_at) VALUES
      ('usr_acme', '${ACME.email}', 'Acme Ops', now()),
      ('usr_northwind', '${NORTHWIND.email}', 'Northwind Ops', now()),
      ('usr_newcomer', '${NEWCOMER.email}', 'Founder', now()),
      ('usr_stranger', '${STRANGER.email}', 'Someone', now());
    INSERT INTO memberships (id, user_id, org_id, role) VALUES
      ('mem_acme', 'usr_acme', '${ACME.orgId}', 'admin'),
      ('mem_northwind', 'usr_northwind', '${NORTHWIND.orgId}', 'admin');
  `);

  kyb = await import('@/lib/server/kyb');
  session = await import('@/lib/auth/customer-session');
  route = await import('@/app/api/kyb/sumsub/route');

  const document = { name: 'form-9.pdf', kind: 'COMPANY_DOCUMENT', type: 'application/pdf', size: 1, sha256: '0'.repeat(64), storageKey: 'kyb/form-9.pdf', virusScanResult: 'PENDING', uploadedAt: new Date().toISOString() };
  acmeCaseId = (await kyb.recordKybSubmission({
    caseId: 'kyb_acme_case',
    orgId: ACME.orgId,
    businessName: 'Acme Trading Sdn Bhd',
    registrationNumber: '202401012345',
    documents: [document],
  })).id;
  newcomerCaseId = (await kyb.recordKybSubmission({
    caseId: 'kyb_newcomer_case',
    orgId: NEWCOMER.orgId,
    businessName: 'Freshco Sdn Bhd',
    registrationNumber: '202401054321',
    documents: [document],
  })).id;

  // After PGlite is up, so its own loading is untouched.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== process.env.SUMSUB_BASE_URL) return realFetch(input, init);
    sumsubCalls.push({ path: url.pathname, body: init?.body ? JSON.parse(init.body) : null });
    if (url.pathname === '/resources/applicants') return Response.json({ id: `applicant_${sumsubCalls.length}` });
    if (url.pathname === '/resources/accessTokens') return Response.json({ token: 'sumsub-test-access-token' });
    return new Response('unexpected Sumsub path', { status: 500 });
  };
});

afterAll(async () => {
  delete globalThis.splashDb;
  await client?.close();
});

beforeEach(() => {
  sumsubCalls.length = 0;
});

/** POST /api/kyb/sumsub as `person`, with the body KybSettings sends. */
function requestSession(person, body) {
  const signedIn = session.createCustomerSessionFromIdentity({ email: person.email, credentialVersion: 1 });
  scope.cookies = new Map([
    [session.CUSTOMER_SESSION_COOKIE, session.createCustomerSessionToken(signedIn, process.env.CUSTOMER_SESSION_SECRET)],
  ]);
  return route.POST(
    new Request(`${ORIGIN}/api/kyb/sumsub`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify(body),
    }),
  );
}

async function caseRow(id) {
  const { rows } = await client.query('SELECT sumsub_applicant_id, audit_trail FROM kyb_cases WHERE id = $1', [id]);
  return rows[0];
}

test('another org cannot open a Sumsub session on a case, or write to it', async () => {
  const response = await requestSession(NORTHWIND, {
    kybCaseId: acmeCaseId,
    businessName: 'Acme Trading Sdn Bhd',
    registrationNumber: '202401012345',
  });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'KYB case not found');

  // No access token was issued for Acme's applicant, and Acme's case is as it was.
  assert.equal(sumsubCalls.length, 0);
  const row = await caseRow(acmeCaseId);
  assert.equal(row.sumsub_applicant_id, null);
  assert.deepEqual(row.audit_trail.map((e) => e.action), ['kyb.submitted']);
});

test('the owning org can, and Sumsub is asked about the company on the case', async () => {
  const response = await requestSession(ACME, {
    kybCaseId: acmeCaseId,
    // Whatever the body says, the company verified is the one on file.
    businessName: 'Someone Else Ltd',
    registrationNumber: '000000000000',
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.configured, true);
  assert.equal(body.accessToken, 'sumsub-test-access-token');

  const applicant = sumsubCalls.find((call) => call.path === '/resources/applicants');
  assert.equal(applicant.body.externalUserId, acmeCaseId);
  assert.deepEqual(applicant.body.fixedInfo.companyInfo, {
    companyName: 'Acme Trading Sdn Bhd',
    registrationNumber: '202401012345',
  });

  const row = await caseRow(acmeCaseId);
  assert.equal(row.sumsub_applicant_id, body.applicantId);
  assert.deepEqual(row.audit_trail.map((e) => e.action), ['kyb.submitted', 'kyb.sumsub_linked']);
});

test('a new sign-up with no membership reaches its own case, and only that one', async () => {
  // Its upload filed the case under the workspace its email maps to; Sumsub is
  // the next step of the same onboarding, so it has to work here.
  const own = await requestSession(NEWCOMER, { kybCaseId: newcomerCaseId });
  assert.equal(own.status, 200);
  assert.equal((await caseRow(newcomerCaseId)).sumsub_applicant_id, (await own.json()).applicantId);

  sumsubCalls.length = 0;
  const other = await requestSession(NEWCOMER, { kybCaseId: acmeCaseId });
  assert.equal(other.status, 404);
  assert.equal(sumsubCalls.length, 0);
});

test('a session with no workspace finds no case, and none is created for it', async () => {
  const response = await requestSession(STRANGER, { kybCaseId: acmeCaseId });
  assert.equal(response.status, 404);
  assert.equal(sumsubCalls.length, 0);
  const { rows } = await client.query('SELECT id FROM organizations ORDER BY id');
  assert.deepEqual(rows.map((r) => r.id), [ACME.orgId, NORTHWIND.orgId, NEWCOMER.orgId].sort());
});

test('a case id is required', async () => {
  const response = await requestSession(ACME, { businessName: 'Acme Trading Sdn Bhd', registrationNumber: '202401012345' });
  assert.equal(response.status, 400);
  assert.equal(sumsubCalls.length, 0);
});

test('the store refuses the link for another org too, with and without a database', async () => {
  assert.equal(await kyb.attachSumsubApplicant(NORTHWIND.orgId, acmeCaseId, 'applicant_northwind'), null);
  assert.notEqual((await caseRow(acmeCaseId)).sumsub_applicant_id, 'applicant_northwind');

  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const memoryCase = await kyb.recordKybSubmission({
      caseId: 'kyb_memory_case',
      orgId: 'memory-acme',
      businessName: 'Memory Sdn Bhd',
      registrationNumber: '202401011111',
      documents: [],
    });
    assert.equal(await kyb.attachSumsubApplicant('memory-northwind', memoryCase.id, 'applicant_x'), null);
    const untouched = await kyb.readKybCase('memory-acme', memoryCase.id);
    assert.equal(untouched.sumsubApplicantId, null);
    assert.equal(untouched.auditTrail.length, 1);
    assert.equal((await kyb.attachSumsubApplicant('memory-acme', memoryCase.id, 'applicant_x')).sumsubApplicantId, 'applicant_x');
  } finally {
    process.env.DATABASE_URL = previous;
  }
});
