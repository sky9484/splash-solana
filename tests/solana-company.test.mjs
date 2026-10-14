// Prompt 07 §6.2: the dashboard's organization IS the Solana company. Its documents (company record,
// invoices, evidence, share links) live in solana_documents, so a payment, its receipt and its share
// link survive a restart of the app, and of the offline simulator. Which company a request acts for
// comes from the session, never the body: every company route goes through lib/server/solana-company.ts.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, test } from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '../lib/db/schema.ts';
import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords } from '../lib/solana/recovery-kit.ts';
import { loadCompany, saveCompany } from '../lib/solana-app/company.ts';
import { countDocuments, createPostgresDocStore } from '../lib/solana-app/doc-store.ts';
import { createPostgresSecretStore } from '../lib/solana-app/bank-secret-store.ts';
import { toWire } from '../lib/solana-app/json.ts';
import { createPostgresPaymentRepo } from '../lib/solana-app/payment-repo.ts';
import { resetRuntime, runtime } from '../lib/solana-app/runtime.ts';
import { sharedReceipt } from '../lib/solana-app/shared-receipt.ts';
import { resetStore } from '../lib/solana-app/store.ts';
import * as svc from '../lib/solana-app/service.ts';
import { anchoredRootFromMemo, verifyBundle } from '../lib/solana-evidence/verify.ts';

const ORG = 'demo-business';
const FIELDS = ['invoiceNumber', 'supplierName', 'supplierBank', 'supplierAccountLast4', 'amountPhpMinor', 'dueDate'];

async function database() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const files = (await readdir(new URL('../drizzle', import.meta.url))).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sqlText = await readFile(new URL(`../drizzle/${file}`, import.meta.url), 'utf8');
    for (const statement of sqlText.split('--> statement-breakpoint')) if (statement.trim()) await client.exec(statement.trim());
  }
  return { db, client };
}

/** The app process: an offline runtime whose payments and documents are in the given database. */
function boot(db) {
  const rt = runtime();
  rt.payments = createPostgresPaymentRepo(db);
  rt.docs = createPostgresDocStore(db);
  // Sealed bank numbers live in the same database (prompt 10 Phase S): a supplier saved by a paid invoice
  // keeps its number across the restart, as it does in production.
  rt.secrets = createPostgresSecretStore(db);
  return rt;
}

beforeEach(() => {
  delete process.env.SPLASH_SOLANA_MODE;
  process.env.SOLANA_PAYMENT_STORE = 'memory';
  resetStore();
  resetRuntime();
});

/** What lib/server/solana-company.ts does on every request, from the records account setup wrote. */
async function signedIn(account) {
  await loadCompany(ORG);
  return svc.syncAccountCompany({ orgId: ORG, companyName: 'Acme Manufacturing', personName: 'Aisyah Rahman', vault: account.vault, deviceKey: account.device.publicKey });
}

async function setUpAccount() {
  const keys = createMemoryDeviceKeyStore();
  const device = await createDeviceKey(keys, ORG);
  const kit = deriveRecoveryKey(generateRecoveryWords());
  const vault = await svc.createAutonomousVault({ devicePublicKey: device.publicKey, kitPublicKey: kit.publicKey, sponsorTag: ORG });
  kit.destroy();
  return { keys, device, vault };
}

async function pay(account, number = 'INV-0412') {
  const { invoice } = await svc.readInvoiceDraft(ORG, { sample: true });
  if (number !== 'INV-0412') invoice.draft.fields.invoiceNumber = number;
  svc.verifyBank(ORG, invoice.id, { by: 'Aisyah Rahman', method: 'call-back', bank: invoice.draft.fields.supplierBank, accountLast4: invoice.draft.fields.supplierAccountLast4 });
  svc.confirmInvoice(ORG, invoice.id, { fields: toWire(invoice.draft.fields), confirmed: [...FIELDS], confirmedBy: 'Aisyah Rahman' });
  const quoted = await svc.quote(ORG, invoice.id);
  const direct = (await svc.paymentView(quoted.id)).cards.find((c) => c.kind === 'solana_direct');
  await svc.selectRoute(quoted.id, { quoteId: direct.quoteId });
  const prepared = await svc.prepareApproval(quoted.id, { signer: account.device.publicKey });
  const signatures = [];
  for (const m of prepared.messages) signatures.push({ id: m.id, signature: bs58.encode(await signWithDeviceKey(account.keys, ORG, new Uint8Array(Buffer.from(m.messageBase64, 'base64')))) });
  let p = await svc.submitApproval(quoted.id, { signatures, who: 'Aisyah Rahman' });
  await svc.deliverPartnerEvents(p.id);
  p = await svc.resumePayment(p.id, { timeoutMs: 0 });
  return p;
}

test('a signed-in company pays; after the app restarts its payment, invoice, evidence and approver are still there', async () => {
  const { db, client } = await database();
  boot(db);
  const account = await setUpAccount();
  await signedIn(account);
  await svc.fund(ORG);
  const paid = await pay(account);
  assert.equal(paid.state, 'anchored');
  await saveCompany(ORG);
  assert.equal(await countDocuments(db, ORG, ['org', 'invoice', 'evidence']), 3, 'the company, its invoice and its evidence are documents');

  // The app restarts; the simulator (same runtime) does not.
  resetStore();
  await signedIn(account);
  const view = await svc.paymentView(paid.id);
  assert.equal(view.state, 'anchored');
  assert.equal(view.invoice.confirmed.invoiceNumber, 'INV-0412');
  const receipt = await svc.receiptView(paid.receiptId);
  assert.deepEqual([...new Set(receipt.bundle.approvals.map((a) => a.who))], ['Aisyah Rahman'], 'the approval records who was signed in');
  const result = verifyBundle({ bundle: receipt.bundle, proof: receipt.proof, anchor: anchoredRootFromMemo(receipt.anchor.memo, { signature: receipt.anchor.signature, simulated: true }) });
  assert.ok(result.ok, 'the reloaded receipt still verifies');
  await client.close();
});

test('the same invoice cannot be paid twice across a restart: the salt and the paid commitments are the company’s documents', async () => {
  const { db, client } = await database();
  boot(db);
  const account = await setUpAccount();
  const before = await signedIn(account);
  const salt = before.saltHex;
  await svc.fund(ORG);
  await pay(account);
  await saveCompany(ORG);
  resetStore();
  const after = await signedIn(account);
  assert.equal(after.saltHex, salt, 'the per-company salt survives, so commitments are reproducible');
  await assert.rejects(pay(account), (e) => e.code === 'wrong_state', 'paying INV-0412 again never reaches the device prompt');
  const again = (await runtime().payments.listByOrg(ORG)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  assert.equal(again.state, 'rejected_by_policy');
  assert.equal(again.problem?.code, 'duplicate_invoice', 'refused as a duplicate, because the paid commitment was reloaded');
  await client.close();
});

test('offline, a recorded vault comes back after the simulator restarts: same members, next transaction index, no simulated money', async () => {
  const { db, client } = await database();
  boot(db);
  const account = await setUpAccount();
  await signedIn(account);
  await svc.fund(ORG);
  const first = await pay(account);
  await saveCompany(ORG);

  resetStore();
  resetRuntime(); // the whole process: the simulator's ledger is gone
  const rt = boot(db);
  assert.equal(await rt.chain.getMultisig(new PublicKey(account.vault.multisigPda)), null);
  const org = await signedIn(account);
  const ms = await rt.chain.getMultisig(new PublicKey(account.vault.multisigPda));
  assert.ok(ms, 'the vault is back in the simulator');
  assert.equal(ms.transactionIndex, 1n, 'at the last index a payment used');
  assert.deepEqual(ms.members.map((m) => m.publicKey).sort(), account.vault.members.map((m) => m.publicKey).sort());
  assert.equal(await rt.chain.getUsdcBalance(account.vault.vaultPda), 0n);
  assert.deepEqual(org.fundings, [], 'old simulated fundings are not shown as money in the vault');
  await svc.fund(ORG);
  const second = await pay(account, 'INV-0413');
  assert.equal(second.state, 'anchored');
  assert.equal(second.transactionIndex, first.transactionIndex + 1n);
  await client.close();
});

test('share with auditor: the token opens this receipt after a restart, nothing else, and only its company can mint it', async () => {
  const { db, client } = await database();
  boot(db);
  const account = await setUpAccount();
  await signedIn(account);
  await svc.fund(ORG);
  const paid = await pay(account);
  const share = svc.shareReceipt(ORG, paid.receiptId, 'Aisyah Rahman');
  assert.match(share.token, /^shr_[0-9a-f]{32}$/);
  assert.equal(svc.shareReceipt(ORG, paid.receiptId, 'Someone else').token, share.token, 'one live link per receipt');
  assert.throws(() => svc.shareReceipt('northwind', paid.receiptId, 'Mallory'), (e) => e.code === 'receipt_not_found');
  assert.throws(() => svc.assertReceiptOf(paid.receiptId, 'northwind'), (e) => e.code === 'receipt_not_found');
  await saveCompany(ORG);

  resetStore();
  const opened = await sharedReceipt(share.token);
  assert.equal(opened.receipt.receiptId, paid.receiptId);
  assert.equal(opened.receipt.trace.memo, `splash:pay:v1:${paid.id}`);
  await assert.rejects(sharedReceipt(`shr_${'0'.repeat(32)}`), (e) => e.code === 'receipt_not_found');
  await assert.rejects(sharedReceipt('rcpt_0123456789abcdef'), (e) => e.code === 'receipt_not_found');
  await client.close();
});

test('every company route takes the company from the session: no route reads an orgId the browser sent', async () => {
  const root = new URL('../app/api/solana/', import.meta.url);
  const routes = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name === 'route.ts') routes.push(full);
    }
  };
  await walk(root);
  assert.ok(routes.length >= 15);
  // Public by design: the partner's signed webhook, and the auditor's share link.
  const PUBLIC = [/partner[\\/]webhook[\\/]route\.ts$/, /shared[\\/]\[token\][\\/]/];
  for (const url of routes) {
    const file = decodeURIComponent(url.pathname);
    const source = await readFile(url, 'utf8');
    const rel = path.relative(process.cwd(), file.replace(/^\/([A-Za-z]:)/, '$1'));
    assert.doesNotMatch(source, /body\.orgId|searchParams\.get\('orgId'\)|params\b[^\n]*orgId/, `${rel} reads an orgId from the request`);
    if (PUBLIC.some((re) => re.test(file))) continue;
    assert.match(source, /from '@\/lib\/server\/solana-company'/, `${rel} must bind the company through lib/server/solana-company.ts`);
  }
  const http = await readFile(new URL('../lib/solana-app/http.ts', import.meta.url), 'utf8');
  const schemas = http.slice(http.indexOf('export const schemas'));
  assert.doesNotMatch(schemas, /orgId/, 'no request schema accepts an orgId');
});
