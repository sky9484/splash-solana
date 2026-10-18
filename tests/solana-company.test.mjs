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

test('the A4 receipt (prompt 12 §5.4) is built from the records: its number, money that adds up, and a time table of recorded moments only', async () => {
  const { db, client } = await database();
  boot(db);
  const account = await setUpAccount();
  await signedIn(account);
  await svc.syncAccountCompany({ orgId: ORG, companyName: 'Acme Manufacturing', personName: 'Aisyah Rahman', vault: account.vault, deviceKey: account.device.publicKey, place: { city: 'Kuala Lumpur', state: 'Wilayah Persekutuan', country: 'MY' } });
  await svc.fund(ORG);
  const paid = await pay(account);
  const view = await svc.receiptView(paid.receiptId);
  const doc = view.document;
  const e = view.bundle;
  assert.equal(e.kindName, 'corridor_payout');

  // The number: SPL-R-, the issue day in MYT, the first 8 hex of the id.
  const { receiptNumber } = await import('../lib/solana-app/receipt-number.ts');
  assert.equal(doc.number, receiptNumber(paid.receiptId, e.receipt.issuedAt));
  assert.match(doc.number, new RegExp(`^SPL-R-\\d{8}-${paid.receiptId.slice(5, 13).toUpperCase()}$`));

  // Who: the company's profile line and its Payments account, the supplier with the call-back date.
  assert.deepEqual(doc.paidBy, { name: 'Acme Manufacturing', place: 'Kuala Lumpur, Wilayah Persekutuan, Malaysia', account: `${account.vault.vaultPda.slice(0, 4)}…${account.vault.vaultPda.slice(-4)}` });
  assert.equal(doc.paidTo.country, 'Philippines');
  assert.ok(doc.paidTo.verifiedAt, 'verified by call-back, with its date');

  // Money: from the quote that executed, integers, and it adds up: paid = converted + fees, fees = the three parts.
  const q = e.quotedRoute;
  assert.equal(doc.received.amountMinor, q.netLocal.amountMinor);
  assert.equal(doc.paid.amountMinor, q.source.amountMinor);
  assert.equal(doc.paid.feesMinor, doc.paid.splashMinor + doc.paid.partnerMinor + doc.paid.processingMinor);
  assert.equal(doc.paid.convertedMinor + doc.paid.feesMinor, doc.paid.amountMinor);
  assert.deepEqual([doc.paid.splashMinor, doc.paid.partnerMinor, doc.paid.processingMinor], [q.costs.splashMinor, q.costs.partnerMinor, q.costs.routeMinor]);
  for (const v of Object.values(doc.paid)) assert.equal(typeof v, 'bigint');
  assert.deepEqual(doc.rate, { value: q.fx.rate, test: true, lockedAt: q.fx.capturedAt });
  assert.equal(doc.received.bankReference, e.bank.reference);

  // The time table: every row is a recorded moment, in order, and the proof row is the moment it was recorded.
  const p = await svc.getPayment(paid.id);
  const recorded = new Set([p.timeline.approvedAt, p.timeline.sentAt, p.timeline.receivedAt, p.timeline.paidAt, ...(await runtime().payments.transitions(p.id)).map((t) => t.at)]);
  const evidence = (await import('../lib/solana-app/store.ts')).store().evidence.get(paid.receiptId);
  const inv = (await import('../lib/solana-app/store.ts')).store().invoices.get(p.invoiceId);
  recorded.add(evidence.createdAt);
  recorded.add(inv.createdAt);
  assert.deepEqual(doc.events.map((x) => x.what.replace(/ \d+ of \d+/, ' n of n').replace(/to .* •••• \d{4}$/, 'to bank')), ['Invoice read and payment drafted', 'Rules checked, n of n passed', 'Approved', 'Sent from the Payments account', 'Received by the payout partner', 'Paid to bank', 'Proof recorded']);
  for (const ev of doc.events) assert.ok(recorded.has(ev.at), `${ev.what} at ${ev.at} is a recorded time`);
  // Splash's own moments run in order. The mock partner stamps "paid" a second after "received", and this
  // harness delivers both at once, so its paid time may fall after the proof was sealed: shown as recorded.
  const own = doc.events.filter((x) => !x.what.startsWith('Paid to '));
  for (let i = 1; i < own.length; i += 1) assert.ok(own[i - 1].at <= own[i].at, `${own[i - 1].what} before ${own[i].what}`);
  assert.equal(doc.rules.total, p.approval.policy.checks.length);
  assert.equal(doc.rules.passed, p.approval.policy.checks.filter((c) => c.passed).length);
  assert.equal(doc.recorded, true);
  assert.equal(doc.recordedAt, evidence.createdAt);
  assert.deepEqual(doc.proof, { fingerprint: view.leafHex, root: view.batch.rootHex });
  // The approver: a name, a role and a short device form; never the words "device key".
  assert.match(doc.refs.find((r) => r.label === 'Approver').value, /^.+ \((owner|approver)\), approved on device [1-9A-HJ-NP-Za-km-z]{4}…$/);
  assert.doesNotMatch(JSON.stringify(toWire(doc)), /device key/i);
  await client.close();
});

test('the monthly statement (prompt 12 §5.5) adds up in integer cents, matches the Payments account, and an empty month still prints', async () => {
  const { db, client } = await database();
  boot(db);
  const account = await setUpAccount();
  const org = await signedIn(account);
  await svc.fund(ORG);
  const paid = await pay(account);
  const { statementFor, mytMonth } = await import('../lib/solana-app/statement.ts');
  const { accountBalances } = await import('../lib/solana-app/money-position.ts');
  const month = mytMonth(new Date().toISOString());

  const s = await statementFor(ORG, month, 'payments');
  const sum = s.summary;
  // opening + in − payments out − fees + interest ± moves (± results) = closing, all bigint.
  assert.equal(s.openingMinor + sum.inMinor - sum.paymentsOutMinor - sum.feesMinor + sum.interestMinor + sum.movesMinor + sum.resultsMinor, s.closingMinor);
  for (const v of [s.openingMinor, s.closingMinor, ...Object.values(sum)]) assert.equal(typeof v, 'bigint');
  assert.equal(sum.interestMinor, 0n, 'no interest on the Payments account');
  // Rebuilt from the records, the Payments account closes at what it really holds.
  assert.equal(s.closingMinor, (await accountBalances(org)).paymentsMinor);
  assert.equal(s.lines.at(-1).balanceAfterMinor, s.closingMinor);
  // Each line's balance follows from the one before.
  let running = s.openingMinor;
  for (const l of s.lines) {
    running += l.inMinor - l.outMinor;
    assert.equal(l.balanceAfterMinor, running, l.description);
  }
  // The payment and its fees: two lines, each with the receipt number; together what the approval card showed.
  const p = await svc.getPayment(paid.id);
  const mine = s.lines.filter((l) => l.receiptId === paid.receiptId);
  assert.equal(mine.length, 2);
  for (const l of mine) assert.match(l.receiptNumber, /^SPL-R-\d{8}-[0-9A-F]{8}$/);
  assert.equal(mine.reduce((n, l) => n + l.outMinor, 0n), p.approval.youPayUsdcMinor);
  assert.equal(sum.feesMinor, p.approval.costs.routeMinor + p.approval.costs.partnerMinor + p.approval.costs.splashMinor);

  // An empty month the company existed in: no lines, and opening equals closing.
  const store = (await import('../lib/solana-app/store.ts')).store();
  store.orgs.get(ORG).createdAt = new Date(Date.now() - 70 * 86_400_000).toISOString();
  const first = (await statementFor(ORG, month, 'payments')).months[0];
  const empty = await statementFor(ORG, first, 'payments');
  assert.notEqual(first, month);
  assert.deepEqual(empty.lines, []);
  assert.equal(empty.openingMinor, empty.closingMinor);
  assert.equal(empty.openingMinor, 0n);
  // A month the company did not exist in is refused, never guessed.
  await assert.rejects(statementFor(ORG, '2020-01', 'payments'), (e) => e.code === 'bad_request');
  await assert.rejects(statementFor(ORG, month, 'savings'), (e) => e.code === 'bad_request');
  await client.close();
});

test('auditor links expire after 90 days (D7): a link opens until then, an older link without an expiry keeps opening, and stopping a link is final', async () => {
  const { db, client } = await database();
  boot(db);
  const account = await setUpAccount();
  await signedIn(account);
  await svc.fund(ORG);
  const paid = await pay(account);
  const made = new Date('2026-10-18T02:00:00.000Z');
  const share = svc.shareReceipt(ORG, paid.receiptId, 'Aisyah Rahman', made);
  assert.equal(share.expiresAt, '2027-01-16T02:00:00.000Z', 'createdAt + 90 days');
  assert.equal(svc.SHARE_TTL_MS, 90 * 86_400_000);
  const at = (ms) => new Date(made.getTime() + ms);

  // The boundary: 89 days and 23 hours opens; 90 days and a second refuses, with the same message as any bad link.
  assert.equal(svc.openShare(share.token, at(89 * 86_400_000 + 23 * 3_600_000)).token, share.token);
  for (const late of [at(90 * 86_400_000), at(90 * 86_400_000 + 1000)]) {
    assert.throws(() => svc.openShare(share.token, late), (e) => e.code === 'receipt_not_found' && e.message === 'This receipt link is not valid. Ask the business that shared it for a new one.');
  }
  // An expired link is not handed out again: sharing after it ran out makes a new one.
  assert.equal(svc.liveShareOf(ORG, paid.receiptId, at(90 * 86_400_000 + 1000)), null);
  const fresh = svc.shareReceipt(ORG, paid.receiptId, 'Aisyah Rahman', at(90 * 86_400_000 + 1000));
  assert.notEqual(fresh.token, share.token);
  assert.equal(svc.shareReceipt(ORG, paid.receiptId, 'Someone else', at(91 * 86_400_000)).token, fresh.token, 'the live one is reused');

  // A link made before expiry existed (no expiresAt) keeps opening, years on.
  const old = { token: `shr_${'a'.repeat(32)}`, receiptId: paid.receiptId, orgId: ORG, createdAt: '2026-09-01T00:00:00.000Z', createdBy: 'Aisyah Rahman', revokedAt: null };
  (await import('../lib/solana-app/store.ts')).store().shares.set(old.token, old);
  assert.equal(svc.openShare(old.token, new Date('2031-01-01T00:00:00.000Z')).token, old.token);

  // Stop sharing: every live link to the receipt stops, at once; again changes nothing; a stopped link is never reused.
  const now = at(92 * 86_400_000);
  assert.deepEqual(svc.stopSharing(ORG, paid.receiptId, now), { stopped: 2 });
  assert.deepEqual(svc.stopSharing(ORG, paid.receiptId, now), { stopped: 0 }, 'idempotent');
  for (const token of [fresh.token, old.token]) assert.throws(() => svc.openShare(token, now), (e) => e.code === 'receipt_not_found');
  assert.equal(svc.liveShareOf(ORG, paid.receiptId, now), null);
  const after = svc.shareReceipt(ORG, paid.receiptId, 'Aisyah Rahman', now);
  assert.ok(![share.token, fresh.token, old.token].includes(after.token), 'a stopped link is not reused');
  // Another company can neither read nor stop this receipt's links.
  assert.throws(() => svc.stopSharing('northwind', paid.receiptId, now), (e) => e.code === 'receipt_not_found');
  assert.throws(() => svc.liveShareOf('northwind', paid.receiptId, now), (e) => e.code === 'receipt_not_found');

  // Revoked and expiry survive a restart: they are fields of the share document.
  await saveCompany(ORG);
  resetStore();
  await assert.rejects(sharedReceipt(fresh.token), (e) => e.code === 'receipt_not_found');
  assert.equal((await sharedReceipt(after.token)).share.expiresAt, new Date(now.getTime() + svc.SHARE_TTL_MS).toISOString());
  await client.close();
});

test('stop sharing is for an owner or admin: the route checks the bank-number rule, and the shared read says when the link expires', async () => {
  const revoke = await readFile(new URL('../app/api/solana/receipts/[id]/share/revoke/route.ts', import.meta.url), 'utf8');
  assert.match(revoke, /if \(!mayRevealBankNumbers\(ctx\)\) throw new ServiceError\('not_authorized', 'Only an owner or admin can stop sharing\.', 403\);/);
  assert.ok(revoke.indexOf('mayRevealBankNumbers(ctx)') < revoke.indexOf('stopSharing('), 'the check runs before anything changes');
  const { mayRevealBankNumbers } = await import('../lib/server/bank-details.ts');
  assert.equal(mayRevealBankNumbers({ isOwner: true, role: 'admin' }), true);
  assert.equal(mayRevealBankNumbers({ isOwner: false, role: 'admin' }), true);
  for (const role of ['maker', 'checker', 'viewer']) assert.equal(mayRevealBankNumbers({ isOwner: false, role }), false, `a ${role} cannot stop sharing`);
  const share = await readFile(new URL('../app/api/solana/receipts/[id]/share/route.ts', import.meta.url), 'utf8');
  assert.match(share, /mayStopSharing: mayRevealBankNumbers\(ctx\)/);
  assert.match(share, /expiresAt: share\.expiresAt \?\? null/);
  const shared = await readFile(new URL('../app/api/solana/shared/[token]/route.ts', import.meta.url), 'utf8');
  assert.match(shared, /share: \{ expiresAt: share\.expiresAt \?\? null \}/);
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
