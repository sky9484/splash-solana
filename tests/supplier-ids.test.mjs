// Prompt 10 Phase S §S.1.0: every saved recipient gets a stable id the first time it is read, and it is
// saved back, so the next process reads the same id. Running it twice changes nothing. Removing a
// recipient goes by id, and the route schedules its bank number's destruction.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { beforeEach, test } from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '../lib/db/schema.ts';
import { loadCompany, saveCompany } from '../lib/solana-app/company.ts';
import { createPostgresDocStore } from '../lib/solana-app/doc-store.ts';
import { resetRuntime, runtime } from '../lib/solana-app/runtime.ts';
import * as svc from '../lib/solana-app/service.ts';
import { ensureSupplierIds, resetStore, store } from '../lib/solana-app/store.ts';

async function database() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const files = (await readdir(new URL('../drizzle', import.meta.url))).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sqlText = await readFile(new URL(`../drizzle/${file}`, import.meta.url), 'utf8');
    for (const s of sqlText.split('--> statement-breakpoint')) if (s.trim()) await client.exec(s.trim());
  }
  return { db, client };
}

beforeEach(() => {
  delete process.env.SPLASH_SOLANA_MODE;
  process.env.SOLANA_PAYMENT_STORE = 'memory';
  resetStore();
  resetRuntime();
});

const verified = { by: 'Aisyah', method: 'call-back', at: '2026-10-01T00:00:00.000Z' };

test('ensureSupplierIds gives each recipient a UUID once; a second run changes nothing', () => {
  const org = { suppliers: [{ name: 'Manila Freight', bank: 'BPI', accountLast4: '4471', verified }, { id: 'sup_kept', name: 'Cebu Packaging', bank: 'BDO', accountLast4: '2290', verified }] };
  assert.equal(ensureSupplierIds(org), 1);
  assert.match(org.suppliers[0].id, /^sup_[0-9a-f-]{36}$/);
  assert.equal(org.suppliers[1].id, 'sup_kept');
  const before = JSON.stringify(org);
  assert.equal(ensureSupplierIds(org), 0);
  assert.equal(JSON.stringify(org), before, 'idempotent');
});

test('a company saved before ids existed gets them on first read, and they are saved back and kept', async () => {
  const { db, client } = await database();
  try {
    const rt = runtime();
    rt.docs = createPostgresDocStore(db);
    const org = svc.createOrg({ companyName: 'Old Co', personName: 'Aisyah' });
    // As a company document written before Phase S: a recipient with no id.
    await rt.docs.save([{ kind: 'org', id: org.id, orgId: org.id, body: { ...org, suppliers: [{ name: 'Manila Freight', bank: 'BPI', accountLast4: '4471', verified }] } }]);

    // A new process reads it.
    resetStore();
    await loadCompany(org.id);
    const id = store().orgs.get(org.id).suppliers[0].id;
    assert.match(id, /^sup_/);
    await saveCompany(org.id);

    // And the next one reads the same id: it was written back.
    resetStore();
    await loadCompany(org.id);
    assert.equal(store().orgs.get(org.id).suppliers[0].id, id);
    await saveCompany(org.id);
    resetStore();
    await loadCompany(org.id);
    assert.equal(store().orgs.get(org.id).suppliers[0].id, id, 'running it again changes nothing');
  } finally {
    await client.close();
  }
});

test('the company summary names recipients by id, and removal goes by id', () => {
  const org = svc.createOrg({ companyName: 'Selangor Trading Sdn Bhd', personName: 'Aisyah' });
  org.suppliers.push({ id: 'sup_a', name: 'Manila Freight', bank: 'BPI', accountLast4: '4471', verified });
  org.suppliers.push({ id: 'sup_b', name: 'Manila Freight', bank: 'BPI', accountLast4: '4471', verified });
  assert.throws(() => svc.removeSupplier(org.id, 'sup_missing'), (e) => e.status === 404);
  const { removed, remaining } = svc.removeSupplier(org.id, 'sup_a');
  assert.equal(removed.id, 'sup_a');
  assert.equal(remaining, 1);
  assert.deepEqual(svc.getOrg(org.id).suppliers.map((s) => s.id), ['sup_b'], 'only that one, even with the same name and digits');
});
