// Browser walkthrough of the signed-in Solana dashboard (offline mode), with a screenshot of every
// step at 1440 px and at 390 px. Asserts that no request the page makes carries the recovery words
// (they stay in the browser), and that the page logs no errors.
//
// One company, one browser: a company has one vault and the device key lives in this browser's
// IndexedDB, so the walk runs once at 1440 px and shoots each step at both widths. Then it pays a
// second invoice entirely at 390 px, so the phone layout is clicked through, not only looked at.
//
// Needs a fresh in-memory dev database and a dev server in offline mode, then an installed Chrome,
// Edge or Chromium (no npm package, no browser download: tests/helpers/cdp-browser.mjs):
//   node --experimental-strip-types --import ./scripts/alias-hook.mjs scripts/dev-db.mjs
//   SPLASH_SOLANA_MODE=offline npx next dev -p 3100
//   node --test tests/solana-ui.e2e.mjs
// It signs in as the seeded demo@acme.test and starts at setup, so restart the dev database to run it
// again. It ends in the staff console (prompt 07 §7), with the dev staff login.
//
// Never point it at a dev server someone is using: it takes over demo@acme.test's company. Run its own
// beside it instead, with its own database and output folder (next.config.ts NEXT_DIST_DIR):
//   DEV_DB_PORT=5434 node --experimental-strip-types --import ./scripts/alias-hook.mjs scripts/dev-db.mjs
//   NEXT_DIST_DIR=.next-e2e DATABASE_URL=postgres://postgres@127.0.0.1:5434/postgres?sslmode=disable \
//     SPLASH_SOLANA_MODE=offline npx next dev -p 3200
//   BASE_URL=http://localhost:3200 node --test tests/solana-ui.e2e.mjs
// (next dev adds the .next-e2e folders to tsconfig.json's include; restore it afterwards.)
// Env: BASE_URL (default http://localhost:3100), SCREENSHOT_DIR (default
// docs/solana-build/screenshots), CHROME_PATH. Not part of `npm test` (that glob is *.test.mjs).
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { findChrome, launch } from './helpers/cdp-browser.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const OUT = process.env.SCREENSHOT_DIR ?? 'docs/solana-build/screenshots';
// The seeded demo password, read from the seed itself so it lives in one place.
const DEMO_PASSWORD = /const DEMO_PASSWORD = '([^']+)'/.exec(readFileSync('scripts/dev-db.mjs', 'utf8'))?.[1];
// The dev staff login: ADMIN_EMAIL / ADMIN_PASSWORD when set, else the dev fallback in admin-auth.ts.
const adminSource = readFileSync('lib/server/admin-auth.ts', 'utf8');
const ADMIN = {
  email: process.env.ADMIN_EMAIL ?? /const fallbackEmail = '([^']+)'/.exec(adminSource)?.[1],
  password: process.env.ADMIN_PASSWORD ?? /const fallbackPassword = '([^']+)'/.exec(adminSource)?.[1],
};
const chrome = findChrome();

const DESKTOP = [1440, 900];
const PHONE = [390, 844];

/**
 * A fresh `next dev` compiles each route on its first request, and with the dev cache off that can
 * take 15 s or more a route. On the money path that is long enough for a 60 s quote to lapse between
 * "Review" and "Approve". So every Solana API route is compiled first (an unauthenticated GET: it
 * answers 401 or 405 and changes nothing), and the walk then times only the product.
 */
async function warmRoutes() {
  const routes = [];
  const walkDir = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walkDir(full);
      else if (name === 'route.ts') routes.push(`/${path.relative('app', dir).split(path.sep).join('/').replace(/\[[^\]]+\]/g, 'warm')}`);
    }
  };
  for (const root of ['app/api/solana', 'app/api/setup', 'app/api/auth']) walkDir(root);
  const started = Date.now();
  // One at a time, the pages first: compiling several at once can leave a page pointing at a chunk
  // the dev server is still rebuilding.
  for (const r of ['/', '/login', ...routes]) await fetch(`${BASE}${r}`, { redirect: 'manual' }).then((res) => res.arrayBuffer()).catch(() => null);
  await new Promise((r) => setTimeout(r, 3000));
  console.log(`[walk] compiled ${routes.length} API routes and the first pages in ${Math.round((Date.now() - started) / 1000)}s`);
}

async function walk(email) {
  mkdirSync(OUT, { recursive: true });
  await warmRoutes();
  const browser = await launch();
  try {
    const page = await browser.newPage({ width: DESKTOP[0], height: DESKTOP[1] });
    try {
      return await run(page, email);
    } catch (e) {
      // Leave evidence of where it stopped: the screen, and any error it shows.
      await page.screenshot(path.join(OUT, 'FAILED.webp')).catch(() => {});
      const shown = await page.evaluate(() => [...document.querySelectorAll('[role=alert], .sx-notice-error, .iso-note--danger')].map((el) => el.innerText.trim()).filter(Boolean)).catch(() => []);
      console.log(`[walk] stopped at ${await page.evaluate(() => location.pathname + location.search).catch(() => '?')}; on screen: ${JSON.stringify(shown)}; page errors: ${JSON.stringify(page.errors.slice(-5))}`);
      throw e;
    }
  } finally {
    await browser.close();
  }
}

async function run(page, email) {
  let n = 0;
  /** The current step at both widths: desktop-NN-name.webp and mobile-NN-name.webp. */
  const shot = async (name) => {
    console.log(`[walk] ${new Date().toISOString().slice(11, 19)} ${name}`);
    n += 1;
    const nn = String(n).padStart(2, '0');
    await page.screenshot(path.join(OUT, `desktop-${nn}-${name}.webp`));
    await page.setViewport(...PHONE);
    await page.screenshot(path.join(OUT, `mobile-${nn}-${name}.webp`));
    await page.setViewport(...DESKTOP);
  };
  /** One width only: a state that exists only on a desktop (the collapsed rail) or on a phone (its menu). */
  const shotOne = async (name, width) => {
    console.log(`[walk] ${new Date().toISOString().slice(11, 19)} ${name} (${width})`);
    n += 1;
    const nn = String(n).padStart(2, '0');
    if (width === 'mobile') await page.setViewport(...PHONE);
    await page.screenshot(path.join(OUT, `${width}-${nn}-${name}.webp`));
    if (width === 'mobile') await page.setViewport(...DESKTOP);
  };

  // Landing, signed out.
  await page.goto(`${BASE}/`);
  await page.find('heading', 'Pay suppliers abroad. Prove every payment.');
  await shot('landing');

  // Sign in.
  await page.goto(`${BASE}/login`);
  await page.fill('Business email', email);
  await page.fill('Password', DEMO_PASSWORD);
  await page.click('button', 'Sign in', { exact: true });
  await page.waitFor(() => location.pathname.startsWith('/dashboard'), [], { what: 'the dashboard after sign-in' });
  await page.waitIdle();

  // Setup: recovery kit → three words → device key and vault.
  await page.goto(`${BASE}/dashboard/setup`);
  await page.click('button', 'Make the 24 words');
  await page.find('heading', 'Your recovery kit');
  await shot('recovery-kit-hidden');
  await page.click('button', 'Show words', { exact: true });
  const words = (await page.text('.sx-words li')).map((w) => w.replace(/^\d+\.?\s*/, '').trim());
  assert.equal(words.length, 24);
  assert.ok(words.every((w) => /^[a-z]+$/.test(w)), `shown words are plain BIP39 words: ${words.slice(0, 2).join(' ')}…`);
  await shot('recovery-kit-shown');
  await page.click('button', 'I’ve written them down');
  await page.find('heading', 'Check three words');
  const labels = await page.evaluate(() => [...document.querySelectorAll('form label[for^="w"]')].map((l) => l.innerText.trim()));
  assert.equal(labels.length, 3);
  for (const label of labels) await page.fill(label, words[Number(label.replace(/\D/g, '')) - 1]);
  await shot('three-word-check');
  await page.click('button', 'Check words', { exact: true });
  await page.find('heading', 'A key for this device, and your vault');
  await shot('device-key');
  await page.click('button', 'Create the key and the vault');
  await page.find('heading', 'Your vault is ready', { timeoutMs: 60_000 });
  assert.match((await page.text('.sx-kv')).join('\n'), /Config authority: none/);
  await shot('vault-ready');

  // The shell (prompt 10 Phase 1): Overview, then Pay, Money, Contacts and Control; the setup card;
  // the top row; Zeke floating, quiet while nothing waits.
  await page.goto(`${BASE}/dashboard`);
  await page.waitFor(() => !!document.querySelector('.iso-zk__launch') && !!document.querySelector('.iso-ratestrip'), [], { what: 'the shell' });
  const groups = await page.evaluate(() => [...document.querySelectorAll('aside .iso-navgroup')].map((g) => [...g.querySelectorAll('.iso-navgroup__title, .iso-navitem__label')].map((e) => e.textContent.trim()).join('|')));
  assert.deepEqual(groups, ['Overview', 'Pay|Transfer|Invoices|Batch payout', 'Money|Balance|Treasury|History', 'Contacts|Recipients', 'Control|Rules|Zeke']);
  assert.match((await page.text('.iso-ratestrip')).join(' '), /USD → PHP 57\.40\s*test rate/);
  assert.equal(await page.evaluate(() => document.querySelector('.iso-zk__nudge')), null, 'no nudge while nothing waits');
  await shot('shell-sidebar');
  await page.click('button', 'Collapse navigation');
  await page.evaluate(() => document.querySelector('a.iso-navitem[href="/dashboard/zeke"]')?.focus());
  await page.sleep(400);
  await shotOne('shell-collapsed', 'desktop');
  await page.click('button', 'Expand navigation');
  await page.setViewport(...PHONE);
  await page.click('button', 'Open navigation');
  await page.find('text', 'Contacts');
  await page.screenshot(path.join(OUT, `mobile-${String(++n).padStart(2, '0')}-shell-phone-menu.webp`));
  await page.click('button', 'Close navigation');
  await page.setViewport(...DESKTOP);
  // Zeke opens on the page it's on, and has no approve control.
  await page.click('button', 'Open Zeke');
  await page.find('text', /Looking at:\s*Overview/);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.iso-zk__panel button')].filter((b) => /approve/i.test(b.textContent)).length), 0, 'no approve button in the floating panel');
  await shot('zeke-open');
  await page.click('button', 'Close Zeke');
  await page.goto(`${BASE}/dashboard/zeke`);
  await page.waitIdle();
  assert.equal(await page.evaluate(() => document.querySelector('.iso-zk')), null, 'the floating Zeke steps aside on the Zeke page');

  // Treasury: operating cash in vault #1, then a move that funds the payments vault (#0).
  await page.goto(`${BASE}/dashboard/treasury`);
  await page.click('button', 'Add 100,000 test USDC (simulated)');
  await page.find('text', /US\$100,000\.00/);
  await shot('treasury-funded');
  await page.fill('Amount (USDC)', '30,000');
  await page.click('button', 'Move with this device', { exact: true });
  await page.find('text', 'Moved US$30,000.00 to your payments vault.', { timeoutMs: 60_000 });
  await page.waitFor(() => document.querySelectorAll('section[aria-labelledby="moves-title"] li').length >= 1, [], { what: 'the move in the list' });
  await shot('treasury-moved');
  await page.goto(`${BASE}/dashboard/fund`);
  await page.find('text', /US\$30,000\.00/);
  await shot('balance-funded');

  // An invoice round the loop: start → check → route → approve → progress → done.
  await page.goto(`${BASE}/dashboard/invoices`);
  await page.find('heading', 'The invoice loop');
  await page.find('button', 'Use the sample invoice');
  await shot('invoices-start');
  await page.click('button', 'Use the sample invoice');
  await page.find('heading', 'Zeke’s draft');
  await shot('check-invoice');
  await page.click('button', 'Mark verified');
  await page.find('heading', 'Bank details verified');
  await page.evaluate(() => document.querySelectorAll('.sx-tick input[type=checkbox]').forEach((b) => b.checked || b.click()));
  await shot('check-invoice-confirmed');
  await page.click('button', 'Confirm and compare routes');
  await page.waitFor(() => document.querySelectorAll('.sx-route').length >= 2, [], { what: 'route cards' });
  const cards = await page.text('.sx-route');
  assert.ok(cards.length >= 2 && cards.length <= 3, `2-3 route cards, got ${cards.length}`);
  assert.ok(cards.some((c) => c.includes('You don’t need SOL') || c.includes("You don't need SOL")), 'a route that needs no SOL');
  await shot('choose-route');
  await page.click('button', /^Review /);
  await page.waitFor(() => !!document.querySelector('.sx-approve'), [], { what: 'the approval card' });
  // The payment now waits for approval: Zeke's one nudge and the Overview badge, from the server's count.
  await page.waitFor(() => /1 draft needs your approval/.test(document.querySelector('.iso-zk__nudge')?.textContent ?? ''), [], { what: "Zeke's nudge" });
  assert.equal(await page.evaluate(() => document.querySelector('a.iso-navitem[href="/dashboard"] .iso-navbadge')?.textContent.trim()), '1');
  await shotOne('zeke-nudge', 'desktop');
  const approve = (await page.text('.sx-approve')).join('\n');
  assert.match(approve, /₱560,000\.00/);
  assert.match(approve, /Manila Freight Services Inc\./);
  await shot('approve-card');
  await page.click('button', 'Approve with this device');
  await page.find('heading', /^Paid\. /, { timeoutMs: 60_000 });
  await shot('done-evidence');

  // Receipt: verify, trace on Solscan, then tamper.
  await page.click('link', 'Open receipt');
  await page.find('heading', 'Verify this receipt');
  await page.click('button', 'Verify', { exact: true });
  await page.find('heading', /^Verified\. This record matches/);
  const receiptPath = await page.evaluate(() => location.pathname);
  // The trace names the memo on every payment transaction. Offline the signatures exist on no
  // network, so it says so and links none of them: a Solscan link to a simulated signature would 404.
  await page.find('heading', 'Trace it on Solscan');
  const trace = (await page.text('section[aria-labelledby="trace-title"]')).join('\n');
  assert.match(trace, /splash:pay:v1:\S+/, 'the memo is shown');
  assert.match(trace, /offline simulator, so they are on no network/);
  const links = await page.evaluate(() => [...document.querySelectorAll('section[aria-labelledby="trace-title"] a')].map((a) => a.href));
  assert.ok(links.every((h) => /^https:\/\/solscan\.io\/(tx|account)\/\w+(\?cluster=devnet)?$/.test(h)), `only Solscan links: ${links.join(', ')}`);
  await shot('receipt-verified');
  await page.check('Tamper with a field (demo)');
  await page.click('button', 'Verify', { exact: true });
  await page.find('heading', /^Does not verify\./);
  await shot('receipt-tampered');

  // The auditor's view: a share link opens this receipt only, read-only.
  const receiptId = receiptPath.split('/').pop();
  const share = await page.evaluate(async (id) => {
    const res = await fetch(`/api/solana/receipts/${id}/share`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    return res.json();
  }, receiptId);
  assert.match(share.path, /^\/receipt\/shr_[0-9a-f]{32}$/);
  await page.goto(`${BASE}${share.path}`);
  await page.find('text', 'Read-only receipt');
  await page.click('button', 'Verify', { exact: true });
  await page.find('heading', /^Verified\. This record matches/);
  await shot('receipt-shared-auditor');

  // The invoice now sits on the loop with its proof.
  await page.goto(`${BASE}/dashboard/invoices`);
  await page.waitFor(() => document.querySelectorAll('.sx-inbox li').length >= 1, [], { what: 'the invoice in the inbox' });
  assert.match((await page.text('.sx-inbox li')).join('\n'), /INV-0412/);
  await shot('invoices-loop');

  // Transfer, in the five steps of the earlier "Send a payout" flow (Sky, 13 Oct), to the supplier
  // saved (and verified) by the first payment. Its first transfer asks what the payout partner needs.
  const declare = () => page.evaluate(() => { const b = document.querySelector('.sx-tdeclare input'); if (b && !b.checked) b.click(); });
  await page.goto(`${BASE}/dashboard/transfer`);
  await page.find('heading', 'Send a transfer');
  await page.find('heading', 'Who receives it');
  await shot('transfer-beneficiary');
  await page.click('button', 'Continue to delivery');
  await page.find('heading', 'How much, and how it arrives');
  await page.fill('Amount the recipient receives (PHP)', '50,000');
  await page.fill('Reference (optional)', 'PO-1182');
  await shot('transfer-delivery');
  await page.click('button', 'Get the quote');
  await page.find('heading', /About this payment$/);
  // The settlement engine is hidden until asked for, fades in, and fades out again.
  assert.equal(await page.evaluate(() => !!document.getElementById('t-engine')), false, 'the engine takes no room until asked for');
  await page.click('button', 'Settlement engine');
  await page.waitFor(() => document.getElementById('t-engine')?.dataset.open === 'true', [], { what: 'the settlement engine, faded in' });
  await page.sleep(500);
  await shot('transfer-engine');
  await page.click('button', 'Settlement engine');
  await page.waitFor(() => !document.getElementById('t-engine'), [], { what: 'the settlement engine, faded out' });
  // 3.1 The first transfer to this recipient: every question.
  await page.click('button', 'Purchase of services');
  await page.fill('What was bought', 'Sea freight, October shipment');
  await page.fill('Your relationship to the recipient', 'supplier');
  await page.fill('Where the money comes from', 'business_revenue');
  await page.click('button', 'Business', { exact: true });
  await page.fill('Company registration number (SEC or DTI)', 'CS201912345');
  await page.fill('Street address', 'Pier 4, North Harbor');
  await page.fill('City', 'Manila');
  await shot('transfer-details-first-time');
  await page.click('button', 'Save these details');
  await page.find('text', /^✓ Given by/);
  // 3.3 Paid from the vaults: already checked, so nothing to declare.
  await page.click('button', 'Pay from your vaults');
  await page.find('text', /Your payments vault covers this/);
  await shot('transfer-quote-send');
  await page.click('button', 'Review and approve');
  await page.waitFor(() => !!document.querySelector('.sx-approve'), [], { what: 'the transfer approval card' });
  const transferCard = (await page.text('.sx-approve')).join('\n');
  assert.match(transferCard, /Typed in by/);
  assert.match(transferCard, /PO-1182/);
  assert.match(transferCard, /no invoice/);
  assert.match(transferCard, /Purchase of services: Sea freight, October shipment/);
  assert.match(transferCard, /Your vaults, already checked/);
  await shot('transfer-approve');
  await page.click('button', 'Approve with this device');
  await page.find('heading', /^Paid\. Manila Freight Services Inc\. received ₱50,000\.00/, { timeoutMs: 60_000 });
  await shot('transfer-done');

  // Batch: twelve suppliers, quoted in chunks, one approval, paid chunk by chunk.
  await page.goto(`${BASE}/dashboard/batch`);
  await page.find('button', 'Quote the sample batch');
  await shot('batch-start');
  await page.click('button', 'Quote the sample batch');
  await page.find('heading', /^12 suppliers in \d+ chunks?$/i);
  await shot('batch-review');
  await page.click('button', /^Approve (the batch|all \d+ chunks) with this device$/i);
  await page.find('heading', /^12 of 12 suppliers paid$/i, { timeoutMs: 90_000 });
  await shot('batch-paid');

  // Zeke, history, rules, and the overview with everything in it.
  await page.goto(`${BASE}/dashboard/zeke`);
  await page.find('heading', 'Zeke’s agents');
  await shot('zeke');
  await page.goto(`${BASE}/dashboard/history`);
  await page.waitFor(() => document.querySelectorAll('.sx-table tbody tr').length >= 1, [], { what: 'the payment row' });
  await shot('history');
  await page.goto(`${BASE}/dashboard/settings/policy`);
  await page.waitIdle();
  await shot('policy');
  await page.goto(`${BASE}/dashboard`);
  await page.find('heading', 'Your vault');
  await shot('overview');

  // A second invoice, clicked through on a phone from start to paid.
  await page.setViewport(...PHONE);
  await page.goto(`${BASE}/dashboard/invoices`);
  await page.fill(
    'Invoice text',
    'MANILA FREIGHT SERVICES INC.\nInvoice No: INV-0413\nDue Date: 2026-10-30\nAmount Due: PHP 120,000.00\nBeneficiary: Manila Freight Services Inc.\nBank: BDO Unibank, Inc.\nAccount Number: 0021-8830-4471\n',
  );
  await page.click('button', 'Read this invoice');
  await page.find('heading', 'Zeke’s draft');
  await page.evaluate(() => document.querySelectorAll('.sx-tick input[type=checkbox]').forEach((b) => b.checked || b.click()));
  await page.click('button', 'Confirm and compare routes');
  await page.waitFor(() => document.querySelectorAll('.sx-route').length >= 2, [], { what: 'route cards on a phone' });
  await page.click('button', /^Review /);
  await page.click('button', 'Approve with this device');
  await page.find('heading', /^Paid\. Manila Freight Services Inc\. received ₱120,000\.00/, { timeoutMs: 60_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `no sideways scroll at 390 px (${overflow}px over)`);
  await page.setViewport(...DESKTOP);

  // The same recipient again: "Same details as before?" Yes. The payments vault is short, so the
  // treasury tops it up in place, with one approval on this device.
  await page.goto(`${BASE}/dashboard/transfer`);
  await page.click('button', 'Continue to delivery');
  await page.fill('Amount the recipient receives (PHP)', '1,000,000');
  await page.fill('Reference (optional)', 'PO-1190');
  await page.click('button', 'Get the quote');
  await page.find('heading', 'Same details as before?');
  await shot('transfer-same-details');
  await page.click('button', 'Yes, same details');
  await page.find('text', /^✓ Same details as before, confirmed by/);
  await page.click('button', 'Pay from your vaults');
  await page.find('button', /^Move US\$[\d,]+\.\d{2} from your treasury$/);
  await shot('transfer-short');
  await page.click('button', /^Move US\$[\d,]+\.\d{2} from your treasury$/);
  await page.find('text', /Your payments vault covers this/, { timeoutMs: 60_000 });
  await page.click('button', 'Review and approve');
  await page.waitFor(() => !!document.querySelector('.sx-approve'), [], { what: 'the topped-up transfer approval card' });
  await page.click('button', 'Approve with this device');
  await page.find('heading', /^Paid\. Manila Freight Services Inc\. received ₱1,000,000\.00/, { timeoutMs: 60_000 });
  await shot('transfer-funded-paid');

  // A new recipient, funded another way: USD through Stripe (sandbox). A funds check and a declaration
  // come first, then the same approval pays it from the payments vault.
  await page.goto(`${BASE}/dashboard/transfer`);
  await page.click('button', 'New recipient');
  await page.fill('Recipient name', 'Cebu Logistics Inc.');
  await page.fill('Bank', 'BPI');
  await page.fill('Account ending', '7781');
  await page.evaluate(() => { const b = [...document.querySelectorAll('.sx-tick input')].find((x) => x.closest('label')?.innerText.includes('I verified these bank details')); if (b && !b.checked) b.click(); });
  await page.click('button', 'Continue to delivery');
  await page.fill('Amount the recipient receives (PHP)', '75,000');
  await page.fill('Reference (optional)', 'PO-1201');
  await page.click('button', 'Get the quote');
  await page.find('heading', /About this payment$/);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('h4')].some((h) => h.innerText.includes('Same details as before'))), false, 'a new recipient is asked afresh');
  await page.click('button', 'Purchase of goods');
  await page.fill('What was bought', 'Pallets and stretch film');
  await page.fill('Your relationship to the recipient', 'supplier');
  await page.fill('Where the money comes from', 'business_revenue');
  await page.click('button', 'Business', { exact: true });
  await page.fill('Company registration number (SEC or DTI)', 'CS202054321');
  await page.fill('Street address', '12 Osmeña Boulevard');
  await page.fill('City', 'Cebu City');
  await page.click('button', 'Save these details');
  await page.find('text', /^✓ Given by/);
  await page.click('button', 'Fund it another way');
  await page.click('button', /^USD by card or bank, through Stripe/);
  await declare();
  await shot('transfer-fund-another-way');
  await page.click('button', /^Bring in US\$/);
  await page.find('text', 'In your payments vault', { timeoutMs: 30_000 });
  await shot('transfer-funds-checked');
  await page.click('button', 'Review and approve');
  await page.waitFor(() => !!document.querySelector('.sx-approve'), [], { what: 'the externally funded transfer approval card' });
  assert.match((await page.text('.sx-approve')).join('\n'), /through Stripe, checked and in your payments vault/);
  await page.click('button', 'Approve with this device');
  await page.find('heading', /^Paid\. Cebu Logistics Inc\. received ₱75,000\.00/, { timeoutMs: 60_000 });
  await shot('transfer-external-paid');

  // Secrets: nothing the page sent contains the recovery words.
  // 1. No request (URL, body, headers) carries the phrase, or any two neighbouring words of it.
  // 2. In every Solana API request body, no free-text value contains any single recovery word. Enum
  //    fields the app itself sends (role: "device" / "kit", method: "call-back", ...) are skipped,
  //    since some are BIP39 words by coincidence; invoice text is ordinary English and gets check 1.
  const phrase = words.map((w) => w.toLowerCase());
  const word = new RegExp(`\\b(${phrase.join('|')})\\b`, 'i');
  const ENUM_KEYS = new Set(['role', 'method', 'source', 'rehearsal', 'purpose', 'status', 'sample', 'from', 'step', 'sourceOfFunds', 'relationship', 'type', 'asset']);
  // What a person typed about a supplier or recipient (invoice text, transfer details) is ordinary English: check 1 only.
  const INVOICE_TEXT_KEYS = new Set(['text', 'fields', 'csv', 'recipient', 'reference', 'verification', 'details']);
  const strings = (v, key, out) => {
    if (typeof v === 'string') {
      if (!ENUM_KEYS.has(key) && !INVOICE_TEXT_KEYS.has(key)) out.push(v);
    } else if (Array.isArray(v)) v.forEach((x) => strings(x, key, out));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!INVOICE_TEXT_KEYS.has(k)) strings(x, k, out);
    return out;
  };
  for (const r of page.requests) {
    if (r.url.startsWith('data:')) continue;
    const hay = `${r.url}\n${r.body}\n${r.headers}`.toLowerCase();
    assert.ok(!hay.includes(phrase.join(' ')), `request ${r.url} carries the phrase`);
    for (let i = 0; i + 1 < phrase.length; i++) {
      const pair = new RegExp(`\\b${phrase[i]}[^a-z]{1,4}${phrase[i + 1]}\\b`);
      assert.ok(!pair.test(hay), `request ${r.method} ${r.url} carries words ${i + 1} and ${i + 2}`);
    }
    if (r.url.includes('/api/solana/') && r.body) {
      let parsed = null;
      try {
        parsed = JSON.parse(r.body);
      } catch {
        parsed = null;
      }
      for (const v of parsed ? strings(parsed, '', []) : [r.body]) {
        const m = word.exec(v);
        assert.equal(m, null, `request ${r.method} ${r.url} carries recovery word "${m?.[0]}" in "${v.slice(0, 40)}"`);
      }
    }
  }
  const apiPosts = page.requests.filter((r) => r.method === 'POST' && r.url.includes('/api/solana/'));
  assert.ok(apiPosts.length >= 10, `the walkthrough exercised the API (${apiPosts.length} posts)`);
  const errors = page.errors.filter((e) => !/Failed to load resource|fonts\.g|webpack-hmr|_next\/webpack|Download the React DevTools/i.test(e));
  assert.deepEqual(errors, [], 'no page errors');

  // The staff console (prompt 07 §7): the six sections, over what this walkthrough just did.
  await page.goto(`${BASE}/admin/login`);
  await page.fill('Staff email', ADMIN.email);
  await page.fill('Password', ADMIN.password);
  await page.click('button', 'Enter staff console');
  await page.waitFor(() => location.pathname === '/admin' || location.pathname === '/admin/', [], { what: 'the staff console' });
  // A webhook with a forged signature, so the webhooks section shows a refusal next to the real ones.
  const forged = await page.evaluate(async () => {
    const res = await fetch('/api/solana/partner/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ partnerId: 'mock-partner', paymentId: 'pay_0123456789abcdef', status: 'paid', amountPhpMinor: '100', at: new Date().toISOString(), signature: '0'.repeat(64) }),
    });
    return res.status;
  });
  assert.equal(forged, 401, 'a forged webhook is refused');
  await page.goto(`${BASE}/admin/orgs`);
  await page.find('heading', 'Orgs and vaults');
  assert.match((await page.text('table')).join('\n'), /none/, 'the config authority reads none, from the chain');
  await shot('admin-orgs');
  await page.goto(`${BASE}/admin/payments`);
  await page.find('heading', 'Payments');
  await shot('admin-payments');
  await page.goto(`${BASE}/admin/fee-payer`);
  await page.find('heading', 'Fee payer (Kora)');
  await shot('admin-fee-payer');
  await page.goto(`${BASE}/admin/evidence`);
  await page.find('heading', 'Evidence');
  await shot('admin-evidence');
  await page.goto(`${BASE}/admin/webhooks`);
  await page.find('heading', 'Partner webhooks');
  assert.match((await page.text('table')).join('\n'), /refused/, 'the forged webhook is in the log');
  await shot('admin-webhooks');
  await page.goto(`${BASE}/admin/compliance`);
  await page.find('heading', 'Refuse service');
  await page.fill('Reason for the audit log', 'KYB documents expired (walkthrough)');
  await page.click('button', /^Suspend /);
  await page.waitFor(() => [...document.querySelectorAll('table td')].some((td) => td.innerText.includes('KYB documents expired (walkthrough)')), [], { what: 'the suspension in the audit log' });
  await shot('admin-compliance');
  await page.fill('Reason for the audit log', 'Restored after the walkthrough');
  await page.click('button', /^Restore service for /);
  await page.waitFor(() => [...document.querySelectorAll('table td')].some((td) => td.innerText.includes('Restored after the walkthrough')), [], { what: 'the restore in the audit log' });

  return { requests: page.requests.length, apiPosts: apiPosts.length, shots: n };
}

const skip = (!chrome && 'no Chrome, Edge or Chromium found (set CHROME_PATH)') || (!DEMO_PASSWORD && 'no seeded demo password in scripts/dev-db.mjs');

test('dashboard, 1440 px and 390 px: setup to verified receipt, a paid batch, a phone payment; recovery words never sent', { skip, timeout: 900_000 }, async () => {
  const r = await walk('demo@acme.test');
  assert.ok(r.shots >= 20, `${r.shots} screenshots per width`);
});
