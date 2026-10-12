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
// again. Env: BASE_URL (default http://localhost:3100), SCREENSHOT_DIR (default
// docs/solana-build/screenshots), CHROME_PATH. Not part of `npm test` (that glob is *.test.mjs).
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { findChrome, launch } from './helpers/cdp-browser.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const OUT = process.env.SCREENSHOT_DIR ?? 'docs/solana-build/screenshots';
// The seeded demo password, read from the seed itself so it lives in one place.
const DEMO_PASSWORD = /const DEMO_PASSWORD = '([^']+)'/.exec(readFileSync('scripts/dev-db.mjs', 'utf8'))?.[1];
const chrome = findChrome();

const DESKTOP = [1440, 900];
const PHONE = [390, 844];

async function walk(email) {
  mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  try {
    const page = await browser.newPage({ width: DESKTOP[0], height: DESKTOP[1] });
    return await run(page, email);
  } finally {
    await browser.close();
  }
}

async function run(page, email) {
  let n = 0;
  /** The current step at both widths: desktop-NN-name.webp and mobile-NN-name.webp. */
  const shot = async (name) => {
    n += 1;
    const nn = String(n).padStart(2, '0');
    await page.screenshot(path.join(OUT, `desktop-${nn}-${name}.webp`));
    await page.setViewport(...PHONE);
    await page.screenshot(path.join(OUT, `mobile-${nn}-${name}.webp`));
    await page.setViewport(...DESKTOP);
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

  // Fund.
  await page.goto(`${BASE}/dashboard/fund`);
  await page.click('button', 'Add 25,000 test USDC (simulated)');
  await page.find('text', /US\$25,000\.00/);
  await shot('balance-funded');

  // Pay: start → check → route → approve → progress → done.
  await page.goto(`${BASE}/dashboard/transfer`);
  await page.find('button', 'Use the sample invoice');
  await shot('pay-start');
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
  await page.goto(`${BASE}/dashboard/transfer`);
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

  // Secrets: nothing the page sent contains the recovery words.
  // 1. No request (URL, body, headers) carries the phrase, or any two neighbouring words of it.
  // 2. In every Solana API request body, no free-text value contains any single recovery word. Enum
  //    fields the app itself sends (role: "device" / "kit", method: "call-back", ...) are skipped,
  //    since some are BIP39 words by coincidence; invoice text is ordinary English and gets check 1.
  const phrase = words.map((w) => w.toLowerCase());
  const word = new RegExp(`\\b(${phrase.join('|')})\\b`, 'i');
  const ENUM_KEYS = new Set(['role', 'method', 'source', 'rehearsal', 'purpose', 'status', 'sample']);
  const INVOICE_TEXT_KEYS = new Set(['text', 'fields', 'csv']);
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
  return { requests: page.requests.length, apiPosts: apiPosts.length, shots: n };
}

const skip = (!chrome && 'no Chrome, Edge or Chromium found (set CHROME_PATH)') || (!DEMO_PASSWORD && 'no seeded demo password in scripts/dev-db.mjs');

test('dashboard, 1440 px and 390 px: setup to verified receipt, a paid batch, a phone payment; recovery words never sent', { skip, timeout: 420_000 }, async () => {
  const r = await walk('demo@acme.test');
  assert.ok(r.shots >= 20, `${r.shots} screenshots per width`);
});
