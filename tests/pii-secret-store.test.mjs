// Prompt 10 Phase S §S.2: one test file, both SecretStore adapters (memory for the offline demo,
// Postgres via PGlite with the real migrations). New details replace the current record; reads are per
// company; the shred job deletes due records only, is idempotent, and keeps last4 and the fingerprint.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '../lib/db/schema.ts';
import { createMemorySecretStore, createPostgresSecretStore } from '../lib/solana-app/bank-secret-store.ts';

async function pg() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const files = (await readdir(new URL('../drizzle', import.meta.url))).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sqlText = await readFile(new URL(`../drizzle/${file}`, import.meta.url), 'utf8');
    for (const s of sqlText.split('--> statement-breakpoint')) if (s.trim()) await client.exec(s.trim());
  }
  return { store: createPostgresSecretStore(db), client, close: () => client.close() };
}

const sealed = (orgId, beneficiaryId, last4 = '7890', fingerprint = 'f'.repeat(64)) => ({
  orgId,
  beneficiaryId,
  ciphertext: new Uint8Array(randomBytes(28)),
  nonce: new Uint8Array(randomBytes(12)),
  wrappedDataKey: new Uint8Array(randomBytes(61)),
  keyId: 'local:test',
  last4,
  fingerprint,
});
const day = (n) => new Date(Date.UTC(2026, 9, 1 + n));

for (const kind of ['memory', 'postgres']) {
  test(`${kind}: new details become current and the old record is marked replaced, in one step`, async () => {
    const h = kind === 'memory' ? { store: createMemorySecretStore(), close() {} } : await pg();
    try {
      const s = h.store;
      assert.equal(s.kind, kind);
      const first = sealed('org_a', 'sup_1', '1111', 'a'.repeat(64));
      const { secret: a, replaced: none } = await s.putCurrent(first, day(0));
      assert.equal(none, null);
      assert.deepEqual(a.ciphertext, first.ciphertext, 'bytes survive the round trip');
      assert.deepEqual(a.wrappedDataKey, first.wrappedDataKey);
      assert.equal(a.last4, '1111');
      const { secret: b, replaced } = await s.putCurrent(sealed('org_a', 'sup_1', '2222', 'b'.repeat(64)), day(1));
      assert.equal(replaced.id, a.id);
      assert.equal(replaced.replacedAt.getTime(), day(1).getTime());
      assert.equal((await s.current('org_a', 'sup_1')).id, b.id);
      assert.deepEqual((await s.history('org_a', 'sup_1')).map((r) => r.last4), ['2222', '1111'], 'newest first');
      assert.equal((await s.findByFingerprint('org_a', 'a'.repeat(64)))[0].id, a.id);
    } finally {
      await h.close();
    }
  });

  test(`${kind}: every read names the company; another company sees nothing`, async () => {
    const h = kind === 'memory' ? { store: createMemorySecretStore(), close() {} } : await pg();
    try {
      const s = h.store;
      const { secret } = await s.putCurrent(sealed('org_a', 'sup_1'), day(0));
      assert.equal(await s.get('org_b', secret.id), null);
      assert.equal(await s.current('org_b', 'sup_1'), null);
      assert.deepEqual(await s.history('org_b', 'sup_1'), []);
      assert.deepEqual(await s.findByFingerprint('org_b', secret.fingerprint), []);
      await s.logReveal({ orgId: 'org_a', beneficiaryId: 'sup_1', secretId: secret.id, userId: 'u1', result: 'refused', reason: 'role viewer', at: day(0) });
      assert.deepEqual(await s.reveals('org_b'), []);
      const [row] = await s.reveals('org_a');
      assert.deepEqual([row.userId, row.result, row.reason, row.secretId], ['u1', 'refused', 'role viewer', secret.id]);
    } finally {
      await h.close();
    }
  });

  test(`${kind}: the shred job deletes due records only, twice is the same as once, and last4 stays`, async () => {
    const h = kind === 'memory' ? { store: createMemorySecretStore(), close() {} } : await pg();
    try {
      const s = h.store;
      await s.putCurrent(sealed('org_a', 'sup_1', '1111'), day(0));
      await s.putCurrent(sealed('org_a', 'sup_1', '2222'), day(1));
      const { secret: keep } = await s.putCurrent(sealed('org_a', 'sup_2', '3333'), day(1));
      assert.equal(await s.scheduleShred('org_a', 'sup_1', day(31)), 2, 'both records of the removed recipient');
      assert.deepEqual(await s.dueForShredAcrossCompanies(day(30)), [], 'not yet');
      const due = await s.dueForShredAcrossCompanies(day(31));
      assert.equal(due.length, 2);
      for (const r of due) assert.equal(await s.shred(r.id, day(31)), true);
      for (const r of due) assert.equal(await s.shred(r.id, day(32)), false, 'idempotent');
      assert.deepEqual(await s.dueForShredAcrossCompanies(day(40)), []);
      const after = await s.history('org_a', 'sup_1');
      assert.deepEqual(after.map((r) => r.last4), ['2222', '1111'], 'last4 kept');
      for (const r of after) {
        assert.equal(r.ciphertext, null);
        assert.equal(r.nonce, null);
        assert.equal(r.wrappedDataKey, null);
        assert.equal(r.shreddedAt.getTime(), day(31).getTime());
        assert.match(r.fingerprint, /^f+$/, 'fingerprint kept');
      }
      const untouched = await s.get('org_a', keep.id);
      assert.ok(untouched.ciphertext && !untouched.shreddedAt, 'another recipient is untouched');
      assert.equal(await s.shred(keep.id, day(100)), false, 'never scheduled, never shredded');
    } finally {
      await h.close();
    }
  });

  test(`${kind}: a rotation re-wraps one record`, async () => {
    const h = kind === 'memory' ? { store: createMemorySecretStore(), close() {} } : await pg();
    try {
      const s = h.store;
      const { secret } = await s.putCurrent(sealed('org_a', 'sup_1'), day(0));
      const wrapped = new Uint8Array(randomBytes(61));
      await s.rewrap('org_b', secret.id, wrapped, 'local:other');
      assert.equal((await s.get('org_a', secret.id)).keyId, 'local:test', 'not from another company');
      await s.rewrap('org_a', secret.id, wrapped, 'local:new');
      const r = await s.get('org_a', secret.id);
      assert.equal(r.keyId, 'local:new');
      assert.deepEqual(r.wrappedDataKey, wrapped);
    } finally {
      await h.close();
    }
  });
}

test('postgres: the table refuses a record that is neither sealed nor shredded, and two current records for one recipient', async () => {
  const h = await pg();
  try {
    await assert.rejects(h.client.exec(`INSERT INTO bank_account_secrets (id, org_id, beneficiary_id, key_id, last4, fingerprint) VALUES ('x', 'o', 'b', 'k', '1234', 'f')`));
    await assert.rejects(h.client.exec(`INSERT INTO bank_account_secrets (id, org_id, beneficiary_id, ciphertext, nonce, wrapped_data_key, key_id, last4, fingerprint) VALUES ('y', 'o', 'b', 'c', 'n', 'w', 'k', '12345', 'f')`), 'last4 is four digits');
    await h.client.exec(`INSERT INTO bank_account_secrets (id, org_id, beneficiary_id, ciphertext, nonce, wrapped_data_key, key_id, last4, fingerprint) VALUES ('z1', 'o', 'b', 'c', 'n', 'w', 'k', '1234', 'f')`);
    await assert.rejects(h.client.exec(`INSERT INTO bank_account_secrets (id, org_id, beneficiary_id, ciphertext, nonce, wrapped_data_key, key_id, last4, fingerprint) VALUES ('z2', 'o', 'b', 'c', 'n', 'w', 'k', '1234', 'f')`), 'one current record per recipient');
  } finally {
    await h.close();
  }
});
