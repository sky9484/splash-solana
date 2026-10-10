// Browser walkthrough of the offline Solana demo, at 1440 px and 390 px, with screenshots.
// Asserts that no request the page makes carries the recovery words (they stay in the browser).
//
// Needs a running dev server (offline mode) and a Playwright browser:
//   npx next dev -p 3100
//   node --test tests/solana-ui.e2e.mjs
// Env: BASE_URL (default http://localhost:3100), SCREENSHOT_DIR (default docs/solana-build/screenshots),
// PLAYWRIGHT_CORE_PATH (a playwright-core install to use when @playwright/test is not in node_modules).
// Not part of `npm run test:solana` (that glob is tests/solana-*.test.mjs and needs no browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const OUT = process.env.SCREENSHOT_DIR ?? 'docs/solana-build/screenshots';

function loadChromium() {
  const require = createRequire(import.meta.url);
  for (const id of ['@playwright/test', 'playwright', 'playwright-core']) {
    try {
      return require(id).chromium;
    } catch {
      /* try the next */
    }
  }
  const fallback = process.env.PLAYWRIGHT_CORE_PATH ?? '/opt/node-tools/node_modules/playwright-core';
  try {
    return createRequire(path.join(fallback, 'package.json'))(fallback).chromium;
  } catch {
    return null;
  }
}

const chromium = loadChromium();

async function walk(width, height, tag) {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    return await run(browser, width, height, tag);
  } finally {
    await browser.close();
  }
}

async function run(browser, width, height, tag) {
  const context = await browser.newContext({ viewport: { width, height } });
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  const requests = [];
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), body: r.postData() ?? '', headers: JSON.stringify(r.headers()) }));
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|fonts\.g|webpack-hmr|_next\/webpack/i.test(m.text())) consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  let n = 0;
  const shot = async (name) => {
    n += 1;
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, `${tag}-${String(n).padStart(2, '0')}-${name}.png`), fullPage: true });
  };

  // Landing
  await page.goto(`${BASE}/solana`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await shot('landing');

  // Onboarding
  await page.getByRole('link', { name: 'Start the demo' }).click();
  await page.getByLabel('Company name').fill('Selangor Trading Sdn Bhd');
  await page.getByLabel('Your name').fill('Aisyah Rahman');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Your recovery kit' }).waitFor();
  await shot('recovery-kit-hidden');
  await page.getByRole('button', { name: 'Show words' }).click();
  const words = await page.locator('.sx-words li').allInnerTexts();
  assert.equal(words.length, 24);
  assert.ok(words.every((w) => /^[a-z]+$/.test(w.trim())), 'shown words are plain BIP39 words');
  await shot('recovery-kit-shown');
  await page.getByRole('button', { name: 'I’ve saved them' }).click();
  const labels = await page.locator('form label[for^="w"]').allInnerTexts();
  for (const label of labels) {
    const idx = Number(label.replace(/\D/g, '')) - 1;
    await page.getByLabel(label, { exact: true }).fill(words[idx].trim());
  }
  await shot('three-word-check');
  await page.getByRole('button', { name: 'Check words' }).click();
  await page.getByRole('heading', { name: 'A key for this device' }).waitFor();
  await shot('device-key');
  await page.getByRole('button', { name: 'Create the key on this device' }).click();
  await page.getByRole('heading', { name: 'Create your vault' }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Create vault' }).click();
  await page.getByRole('heading', { name: 'Your vault is ready' }).waitFor({ timeout: 30_000 });
  assert.match(await page.locator('.sx-kv').innerText(), /Config authority: none/);
  await shot('vault-ready');

  // Fund
  await page.getByRole('link', { name: 'Add test USDC' }).click();
  await page.getByRole('button', { name: 'Add 25,000 test USDC (simulated)' }).click();
  await page.locator('.sx-balance-total', { hasText: 'US$25,000.00' }).waitFor();
  await shot('balance-funded');

  // Pay: start → check → route → approve → progress → done
  await page.getByRole('link', { name: 'Pay a supplier' }).first().click();
  await page.getByRole('button', { name: 'Use the sample invoice' }).waitFor();
  await shot('pay-start');
  await page.getByRole('button', { name: 'Use the sample invoice' }).click();
  await page.getByRole('heading', { name: 'Zeke’s draft' }).waitFor();
  await shot('check-invoice');
  await page.getByRole('button', { name: 'Mark verified' }).click();
  await page.getByRole('heading', { name: 'Bank details verified' }).waitFor();
  for (const box of await page.locator('.sx-tick input[type=checkbox]').all()) await box.check();
  await shot('check-invoice-confirmed');
  await page.getByRole('button', { name: 'Confirm and compare routes' }).click();
  await page.getByRole('radiogroup', { name: 'Routes' }).waitFor();
  const cards = await page.locator('.sx-route').allInnerTexts();
  assert.ok(cards.length >= 2 && cards.length <= 3, `2-3 route cards, got ${cards.length}`);
  assert.ok(cards.some((c) => c.includes("You don't need SOL")));
  assert.ok(cards.some((c) => c.includes('Needs 0.01 SOL in the vault (test pending)')));
  await page.getByText('Zeke suggests Cheapest. You choose.').waitFor();
  await shot('choose-route');
  await page.getByRole('button', { name: /^Review / }).click();
  const approveCard = page.locator('.sx-approve');
  await approveCard.waitFor();
  assert.match(await approveCard.innerText(), /₱560,000\.00/);
  assert.match(await approveCard.innerText(), /Manila Freight Services Inc\./);
  await shot('approve-card');
  await page.getByRole('button', { name: 'Approve with this device' }).click();
  await page.getByRole('list', { name: 'Payment progress' }).waitFor({ timeout: 30_000 });
  await shot('progress');
  await page.getByRole('heading', { name: /^Paid\. / }).waitFor({ timeout: 30_000 });
  await shot('done-evidence');

  // Receipt: verify, then tamper
  await page.getByRole('link', { name: 'Open receipt' }).click();
  await page.getByRole('heading', { name: 'Verify this receipt' }).waitFor();
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await page.getByText('Verified. This record matches the anchored root.').waitFor();
  await shot('receipt-verified');
  await page.getByLabel('Tamper with a field (demo)').check();
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await page.getByText('Does not verify.').waitFor();
  await shot('receipt-tampered');

  // Problems: the same invoice again is blocked as a duplicate; a new one with the screening rehearsal is blocked.
  await page.getByRole('link', { name: 'Pay a supplier' }).first().click();
  await page.getByLabel('Invoice text').fill(
    'MANILA FREIGHT SERVICES INC.\nInvoice No: INV-0413\nDue Date: 2026-10-30\nAmount Due: PHP 120,000.00\nBeneficiary: Manila Freight Services Inc.\nBank: BDO Unibank, Inc.\nAccount Number: 0021-8830-4471\n',
  );
  await page.getByRole('button', { name: 'Read this invoice' }).click();
  await page.getByRole('heading', { name: 'Zeke’s draft' }).waitFor();
  for (const box of await page.locator('.sx-tick input[type=checkbox]').all()) await box.check();
  await page.getByRole('button', { name: 'Confirm and compare routes' }).click();
  await page.getByRole('radiogroup', { name: 'Routes' }).waitFor();
  await page.getByLabel('Rehearse a problem (offline only)').selectOption('kyt_flag');
  await page.getByRole('button', { name: /^Review / }).click();
  await page.getByText("Screening flagged this supplier's wallet. Payment blocked.").first().waitFor();
  assert.equal(await page.getByRole('button', { name: 'Approve with this device' }).isDisabled(), true);
  await shot('problem-screening');

  await page.getByRole('link', { name: 'Rules' }).click();
  await page.getByRole('heading', { name: 'Rules', exact: true }).waitFor();
  await shot('policy');
  await page.getByRole('link', { name: 'Zeke' }).click();
  await page.getByRole('heading', { name: 'Zeke', exact: true }).waitFor();
  await shot('zeke');

  // Secrets: nothing the page sent contains the recovery words.
  // 1. No request (URL, body, headers) carries the phrase, or any two neighbouring words of it.
  // 2. In every API request body, no free-text value contains any single recovery word. Enum fields
  //    the app itself sends (role: "device" / "kit", method: "call-back", ...) are skipped, since
  //    some are BIP39 words by coincidence; invoice text is ordinary English and gets check 1 only.
  const phrase = words.map((w) => w.trim().toLowerCase());
  const word = new RegExp(`\\b(${phrase.join('|')})\\b`, 'i');
  const ENUM_KEYS = new Set(['role', 'method', 'source', 'rehearsal', 'purpose', 'status', 'sample']);
  const INVOICE_TEXT_KEYS = new Set(['text', 'fields']);
  const strings = (v, key, out) => {
    if (typeof v === 'string') {
      if (!ENUM_KEYS.has(key) && !INVOICE_TEXT_KEYS.has(key)) out.push(v);
    } else if (Array.isArray(v)) v.forEach((x) => strings(x, key, out));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!INVOICE_TEXT_KEYS.has(k)) strings(x, k, out);
    return out;
  };
  for (const r of requests) {
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
      const values = parsed ? strings(parsed, '', []) : [r.body];
      for (const v of values) {
        const m = word.exec(v);
        assert.equal(m, null, `request ${r.method} ${r.url} carries recovery word "${m?.[0]}" in "${v.slice(0, 40)}"`);
      }
    }
  }
  const apiPosts = requests.filter((r) => r.method === 'POST' && r.url.includes('/api/solana/'));
  assert.ok(apiPosts.length >= 10, 'the walkthrough exercised the API');
  assert.deepEqual(consoleErrors, [], 'no page errors');
  return { requests: requests.length, apiPosts: apiPosts.length };
}

test('offline demo at 1440 px: onboarding to verified receipt; recovery words never sent', { skip: !chromium && 'no Playwright browser available', timeout: 240_000 }, async () => {
  const r = await walk(1440, 900, 'desktop');
  assert.ok(r.apiPosts > 0);
});

test('offline demo at 390 px', { skip: !chromium && 'no Playwright browser available', timeout: 240_000 }, async () => {
  const r = await walk(390, 844, 'mobile');
  assert.ok(r.apiPosts > 0);
});
