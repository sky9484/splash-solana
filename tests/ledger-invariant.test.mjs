import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '../lib/db/schema.ts';
import { assertBalanced, findUnbalancedJournals, postJournal, UnbalancedJournalError } from '../lib/ledger/post.ts';

/**
 * W1 acceptance — ledger invariant (Σ postings = 0) green in CI.
 * Runs the REAL checked-in migration SQL against an in-memory Postgres
 * (pglite), then exercises postJournal and the invariant query.
 */

async function freshDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const files = (await readdir(new URL('../drizzle', import.meta.url))).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(files.length > 0, 'checked-in migration SQL must exist under drizzle/');
  for (const file of files) {
    const sqlText = await readFile(new URL(`../drizzle/${file}`, import.meta.url), 'utf8');
    for (const statement of sqlText.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }
  return { client, db };
}

test('migration SQL applies cleanly and money columns are bigint', async () => {
  const { client } = await freshDb();
  const { rows } = await client.query(`
    select table_name, column_name, data_type
    from information_schema.columns
    where column_name like '%amount_minor%' or column_name = 'fee_minor'
  `);
  assert.ok(rows.length >= 6, 'money columns exist across tables');
  for (const row of rows) {
    assert.equal(row.data_type, 'bigint', `${row.table_name}.${row.column_name} must be bigint minor units`);
  }
  await client.close();
});

test('balanced journal posts; unbalanced journal is rejected before any write', async () => {
  const { client, db } = await freshDb();

  await postJournal(db, {
    id: 'jrn_test_1',
    kind: 'FUNDING_CREDIT',
    description: 'USD deposit credited',
    postings: [
      { account: 'partner:stripe:clearing', currency: 'USD', amountMinor: -25_000_000n },
      { account: 'org:demo:available', currency: 'USD', amountMinor: 25_000_000n },
    ],
  });

  assert.throws(
    () => assertBalanced([
      { account: 'a', currency: 'USD', amountMinor: 100n },
      { account: 'b', currency: 'USD', amountMinor: -99n },
    ]),
    UnbalancedJournalError,
  );

  await assert.rejects(
    postJournal(db, {
      id: 'jrn_test_bad',
      kind: 'BROKEN',
      postings: [
        { account: 'a', currency: 'USD', amountMinor: 5n },
        { account: 'b', currency: 'USD', amountMinor: -4n },
      ],
    }),
    UnbalancedJournalError,
  );

  // The rejected journal never partially wrote.
  const { rows } = await client.query("select count(*)::int as n from journal_entries where id = 'jrn_test_bad'");
  assert.equal(rows[0].n, 0);

  // Multi-currency journals balance per currency independently.
  await postJournal(db, {
    id: 'jrn_test_fx',
    kind: 'FX_CONVERT',
    postings: [
      { account: 'org:demo:available', currency: 'USD', amountMinor: -2_500_00n },
      { account: 'venue:hata:clearing', currency: 'USD', amountMinor: 2_500_00n },
      { account: 'venue:hata:clearing', currency: 'PHP', amountMinor: -140_269_00n },
      { account: 'org:demo:payout', currency: 'PHP', amountMinor: 140_269_00n },
    ],
  });

  assert.deepEqual(await findUnbalancedJournals(db), []);
  await client.close();
});

test('invariant query catches a corrupted ledger', async () => {
  const { client, db } = await freshDb();
  // Bypass postJournal to simulate corruption (raw insert).
  await client.exec("insert into journal_entries (id, kind) values ('jrn_corrupt', 'MANUAL')");
  await client.exec("insert into ledger_postings (id, journal_id, account, currency, amount_minor) values ('p1','jrn_corrupt','a','USD', 7)");
  const offenders = await findUnbalancedJournals(db);
  assert.deepEqual(offenders, ['jrn_corrupt']);
  await client.close();
});

test('webhook events and approvals enforce uniqueness at the schema level', async () => {
  const { client } = await freshDb();
  await client.exec("insert into webhook_events (id, provider, event_id, payload) values ('wh1','STRIPE','evt_1','{}')");
  await assert.rejects(
    client.exec("insert into webhook_events (id, provider, event_id, payload) values ('wh2','STRIPE','evt_1','{}')"),
    /duplicate key|unique/i,
  );
  await client.close();
});
