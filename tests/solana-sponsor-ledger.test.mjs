import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { beforeEach, test } from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '../lib/db/schema.ts';
import { createMemorySponsorLedger, createPostgresSponsorLedger } from '../lib/solana-app/sponsor-ledger.ts';

/** Prompt 07 §5.6: a per-org daily cap on sponsored transactions, enforced before Kora is asked. */

async function pg() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const files = (await readdir(new URL('../drizzle', import.meta.url))).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sqlText = await readFile(new URL(`../drizzle/${file}`, import.meta.url), 'utf8');
    for (const statement of sqlText.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }
  return { ledger: createPostgresSponsorLedger(db), close: () => client.close() };
}

for (const kind of ['memory', 'postgres']) {
  const open = async () => (kind === 'memory' ? { ledger: createMemorySponsorLedger(), close: async () => {} } : pg());

  test(`${kind}: slots up to the cap, then refused; per org and per day; release gives one back`, async () => {
    const { ledger, close } = await open();
    for (let i = 1; i <= 3; i++) assert.deepEqual(await ledger.reserve('org_a', '2026-10-13', 3), { ok: true, count: i });
    assert.deepEqual(await ledger.reserve('org_a', '2026-10-13', 3), { ok: false, count: 3 });
    assert.equal((await ledger.reserve('org_b', '2026-10-13', 3)).ok, true, 'another org has its own count');
    assert.equal((await ledger.reserve('org_a', '2026-10-14', 3)).ok, true, 'a new day starts again');
    await ledger.release('org_a', '2026-10-13');
    assert.equal(await ledger.count('org_a', '2026-10-13'), 2);
    assert.equal((await ledger.reserve('org_a', '2026-10-13', 3)).ok, true);
    assert.equal((await ledger.reserve('org_z', '2026-10-13', 0)).ok, false, 'a zero cap allows nothing');
    await close();
  });

  test(`${kind}: ten workers race for the last two slots; exactly two get one`, async () => {
    const { ledger, close } = await open();
    for (let i = 0; i < 48; i++) await ledger.reserve('org_r', '2026-10-13', 50);
    const results = await Promise.all(Array.from({ length: 10 }, () => ledger.reserve('org_r', '2026-10-13', 50)));
    assert.equal(results.filter((r) => r.ok).length, 2);
    assert.equal(await ledger.count('org_r', '2026-10-13'), 50, 'never past the cap');
    await close();
  });
}

/* ------------------------------------------------------------------ through the service */

import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } from '../lib/solana/recovery-kit.ts';
import { utcDay } from '../lib/solana/kora.ts';
import { resetRuntime, runtime } from '../lib/solana-app/runtime.ts';
import { resetStore } from '../lib/solana-app/store.ts';
import { toWire } from '../lib/solana-app/json.ts';
import * as svc from '../lib/solana-app/service.ts';
import bs58 from 'bs58';

beforeEach(() => {
  delete process.env.SPLASH_SOLANA_MODE;
  process.env.SOLANA_PAYMENT_STORE = 'memory';
  resetStore();
  resetRuntime();
});

test('service: a company at its daily cap gets no fee-payer signature; nothing is sent and nothing is recorded', async () => {
  const org = svc.createOrg({ companyName: 'Cap Co' });
  const kit = deriveRecoveryKey(generateRecoveryWords());
  const keys = createMemoryDeviceKeyStore();
  const device = await createDeviceKey(keys, org.id);
  const proofs = [];
  for (const c of svc.issueChallenges(org.id, [{ role: 'device', publicKey: device.publicKey }, { role: 'kit', publicKey: kit.publicKey }])) {
    const signer = c.role === 'kit' ? kit : { sign: (m) => signWithDeviceKey(keys, org.id, m) };
    proofs.push({ role: c.role, publicKey: c.publicKey, nonce: c.nonce, signature: await signPossessionChallenge(signer, c) });
  }
  await svc.registerKeys(org.id, proofs);
  await svc.createVault(org.id);
  assert.equal(await runtime().sponsors.count(org.id, utcDay(new Date())), 1, 'creating the vault used one slot');
  await svc.fund(org.id);
  const { invoice } = await svc.readInvoiceDraft(org.id, { sample: true });
  svc.verifyBank(org.id, invoice.id, { by: 'A', method: 'call-back', bank: invoice.draft.fields.supplierBank, accountLast4: invoice.draft.fields.supplierAccountLast4 });
  svc.confirmInvoice(org.id, invoice.id, { fields: toWire(invoice.draft.fields), confirmed: ['invoiceNumber', 'supplierName', 'supplierBank', 'supplierAccountLast4', 'amountPhpMinor', 'dueDate'] });
  const p = await svc.quote(org.id, invoice.id);
  await svc.selectRoute(p.id, { quoteId: (await svc.paymentView(p.id)).cards.find((c) => c.kind === 'solana_direct').quoteId });
  const prepared = await svc.prepareApproval(p.id);
  const sigs = [];
  for (const m of prepared.messages) sigs.push({ id: m.id, signature: bs58.encode(await signWithDeviceKey(keys, org.id, new Uint8Array(Buffer.from(m.messageBase64, 'base64')))) });

  // Use up the rest of today's slots.
  while ((await runtime().sponsors.reserve(org.id, utcDay(new Date()), 50)).ok) { /* fill */ }
  const events = runtime().chain.events.length;
  await assert.rejects(svc.submitApproval(p.id, { signatures: sigs }), (e) => e.code === 'sponsor_cap' && e.status === 429);
  assert.equal(runtime().chain.events.length, events, 'nothing reached the chain');
  assert.deepEqual(await runtime().payments.listCalls(p.id), [], 'nothing was signed by the fee payer');
});
