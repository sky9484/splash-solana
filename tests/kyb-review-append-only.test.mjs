import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test, { after as afterAll, before } from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '../lib/db/schema.ts';

/**
 * A reviewer's decision appends to the KYB audit trail; it never rewrites it.
 *
 * `reviewKybCase` and `attachSumsubApplicant` used to read the case, rebuild
 * the whole record and write every column back. A merchant resubmission that
 * landed between that read and that write was erased: its documents and its
 * `kyb.submitted` event went back to how they were when the reviewer opened
 * the case. The audit trail is supposed to be append-only, and on that path it
 * was "last writer wins".
 *
 * Each overlap below is started in both orders. The store runs on PGlite as it
 * runs on Postgres, and then on the memory backend `npm run dev` uses without
 * a database.
 */

process.env.DATABASE_URL = 'postgres://pglite.invalid/kyb-review-append-only';

const ORG = 'fresh-business';
let client;
let kyb;
let sequence = 0;

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
  await client.exec(`INSERT INTO organizations (id, name) VALUES ('${ORG}', 'Fresh Trading')`);
  kyb = await import('@/lib/server/kyb');
});

afterAll(async () => {
  delete globalThis.splashDb;
  await client?.close();
});

const doc = (name) => ({
  name,
  kind: 'COMPANY_DOCUMENT',
  type: 'application/pdf',
  size: 1,
  sha256: '0'.repeat(64),
  storageKey: `kyb/${name}`,
  virusScanResult: 'PENDING',
  uploadedAt: new Date().toISOString(),
});

/** A business's first filing, under a registration number no other test uses. */
async function filed(orgId = ORG) {
  const registrationNumber = `2024010${String(++sequence).padStart(5, '0')}`;
  const submit = (name) =>
    kyb.recordKybSubmission({
      caseId: `kyb_review_${sequence}_${name}`,
      orgId,
      businessName: 'Fresh Trading Sdn Bhd',
      registrationNumber,
      documents: [doc(name)],
    });
  const first = await submit('form-9.pdf');
  return { id: first.id, resubmit: submit };
}

const actions = (record) => record.auditTrail.map((e) => e.action).sort();

for (const reviewFirst of [true, false]) {
  const order = reviewFirst ? 'review started first' : 'resubmission started first';

  test(`a review that overlaps a resubmission keeps both (${order})`, async () => {
    const { id, resubmit } = await filed();
    const review = () =>
      kyb.reviewKybCase(id, { state: 'NEEDS_INFORMATION', actor: 'compliance@splash.finance', note: 'Missing UBO evidence' });
    const again = () => resubmit('ubo-chart.pdf');
    await Promise.all(reviewFirst ? [review(), again()] : [again(), review()]);

    const record = await kyb.readKybCase(ORG, id);
    assert.deepEqual(record.documents.map((d) => d.name).sort(), ['form-9.pdf', 'ubo-chart.pdf']);
    assert.deepEqual(actions(record), ['kyb.needs_information', 'kyb.submitted', 'kyb.submitted']);
    assert.equal(record.reviewNotes, 'Missing UBO evidence');
  });

  test(`a Sumsub link that overlaps a resubmission keeps both (${order})`, async () => {
    const { id, resubmit } = await filed();
    const link = () => kyb.attachSumsubApplicant(id, 'sumsub_applicant_1');
    const again = () => resubmit('director-id.pdf');
    await Promise.all(reviewFirst ? [link(), again()] : [again(), link()]);

    const record = await kyb.readKybCase(ORG, id);
    assert.equal(record.sumsubApplicantId, 'sumsub_applicant_1');
    assert.deepEqual(record.documents.map((d) => d.name).sort(), ['director-id.pdf', 'form-9.pdf']);
    assert.deepEqual(actions(record), ['kyb.submitted', 'kyb.submitted', 'kyb.sumsub_linked']);
  });
}

test('two reviewers deciding at once both reach the trail', async () => {
  const { id } = await filed();
  await Promise.all([
    kyb.reviewKybCase(id, { state: 'IN_REVIEW', actor: 'first@splash.finance', assignedTo: 'first@splash.finance' }),
    kyb.reviewKybCase(id, { state: 'NEEDS_INFORMATION', actor: 'second@splash.finance', note: 'Need SSM profile' }),
  ]);
  const record = await kyb.readKybCase(ORG, id);
  assert.deepEqual(record.auditTrail.map((e) => e.actor).sort(), ['first@splash.finance', 'second@splash.finance', 'system']);
});

test('a review changes only what it decides', async () => {
  const { id } = await filed();
  await kyb.reviewKybCase(id, {
    state: 'NEEDS_INFORMATION',
    actor: 'compliance@splash.finance',
    note: 'Missing UBO evidence',
    assignedTo: 'compliance@splash.finance',
  });

  // No note, no assignee: the notes, the reason and the reviewer stand.
  let record = await kyb.reviewKybCase(id, { state: 'IN_REVIEW', actor: 'compliance@splash.finance' });
  assert.equal(record.state, 'IN_REVIEW');
  assert.equal(record.reviewNotes, 'Missing UBO evidence');
  assert.equal(record.decisionReason, 'Missing UBO evidence');
  assert.equal(record.assignedTo, 'compliance@splash.finance');
  assert.equal(record.riskTier, 'UNASSIGNED');
  assert.equal(record.corridorAccess, 'LOCKED');
  assert.deepEqual(record.documents.map((d) => d.name), ['form-9.pdf']);

  record = await kyb.reviewKybCase(id, { state: 'APPROVED', actor: 'compliance@splash.finance' });
  assert.equal(record.decisionReason, null, 'an approval carries no reason for refusal');
  assert.equal(record.riskTier, 'TIER_1');
  assert.equal(record.corridorAccess, 'FULL');

  record = await kyb.reviewKybCase(id, { state: 'REJECTED', actor: 'compliance@splash.finance', note: 'Adverse media' });
  assert.equal(record.decisionReason, 'Adverse media');
  assert.equal(record.reviewNotes, 'Adverse media');
  assert.equal(record.riskTier, 'RESTRICTED');
  assert.equal(record.corridorAccess, 'LOCKED');

  // Every decision is on the trail, in order, after the filing.
  assert.deepEqual(
    record.auditTrail.map((e) => e.action),
    ['kyb.submitted', 'kyb.needs_information', 'kyb.in_review', 'kyb.approved', 'kyb.rejected'],
  );
});

test('a review of a case that does not exist writes nothing', async () => {
  assert.equal(await kyb.reviewKybCase('kyb_nobody', { state: 'APPROVED', actor: 'compliance@splash.finance' }), null);
  assert.equal(await kyb.attachSumsubApplicant('kyb_nobody', 'sumsub_applicant_1'), null);
  const { rows } = await client.query(`SELECT 1 FROM kyb_cases WHERE id = 'kyb_nobody'`);
  assert.equal(rows.length, 0);
});

test('without a database, an overlapping review and resubmission keep both too', async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    for (const reviewFirst of [true, false]) {
      const { id, resubmit } = await filed('memory-org');
      const review = () => kyb.reviewKybCase(id, { state: 'IN_REVIEW', actor: 'compliance@splash.finance' });
      const link = () => kyb.attachSumsubApplicant(id, 'sumsub_memory');
      const again = () => resubmit('ubo-chart.pdf');
      await Promise.all(reviewFirst ? [review(), link(), again()] : [again(), link(), review()]);

      const record = await kyb.readKybCase('memory-org', id);
      assert.deepEqual(record.documents.map((d) => d.name).sort(), ['form-9.pdf', 'ubo-chart.pdf']);
      assert.deepEqual(actions(record), ['kyb.in_review', 'kyb.submitted', 'kyb.submitted', 'kyb.sumsub_linked']);
    }
  } finally {
    process.env.DATABASE_URL = previous;
  }
});
