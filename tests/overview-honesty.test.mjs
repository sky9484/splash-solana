import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';

import { hrefsIn, resolvesToPage } from './helpers/app-routes.mjs';
import { loadTsx } from './helpers/render-tsx.mjs';

/**
 * The overview is read as a reading.
 *
 * It is the first screen after sign-in and it looks like an instrument panel, so every figure on it is
 * believed. An earlier overview showed a volume, a pipeline, a settlement window and a KYB verdict
 * that were not read from anything (see this file's history). Prompt 10's Overview shows more (the
 * money position, what needs you, this month's pipeline, recent payments, where you can pay, checks
 * and limits), and every figure is still read from the company: one read
 * (GET /api/solana/overview, lib/solana-app/overview.ts), formatted, never typed in.
 *
 * Rewritten for prompt 10 Phase 2. Same intent; the old string checks ("Simulated test USDC",
 * "Devnet test USDC", "Fund your payments vault", `<BalanceHeader balance=…`) gave way to the new
 * copy ("Test mode" in the shell, "Add money", the money position).
 */

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');
/** Comments describe what was removed, so assertions run against code only. */
const codeOnly = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const overview = async () => codeOnly((await read('app/dashboard/page.tsx')) + (await read('components/solana/Overview.tsx')));

test('no invented figures in the rendered code: every amount is formatted from a read', async () => {
  const code = await overview();
  // A currency figure typed into the page, rather than formatted from data, is invented.
  assert.doesNotMatch(code, /US\$\s?\d|₱\s?\d|\$\d[\d,]*\.\d{2}/, 'no literal money on the page');
  assert.doesNotMatch(code, /\+\d+(\.\d+)?%/, 'no invented growth');
  assert.match(code, /php\(big\(p\.theyGetPhpMinor\)\)/);
  assert.match(code, /usd\(big\(p\.youPaidUsdMinor\)\)/);
  assert.match(code, /<CountUp minor=\{total\} format=\{usd\} \/>/, 'the total is the server’s sum of the accounts');
});

test('compliance is not asserted here: the overview states no KYB verdict at all', async () => {
  const code = await overview();
  // "Approved" as a verdict word in copy; the approvals counter is data, not copy. "Verified" for the
  // company check is shown only as the server read it (lib/solana-app/overview.ts maps the state).
  assert.doesNotMatch(code, /KYB|Sumsub|risk tier|verified business|\bApproved\b/);
  const agg = codeOnly(await read('lib/solana-app/overview.ts'));
  assert.match(agg, /check === 'ACTIVE'\s*\?\s*\{ tone: 'ok' as const, label: 'Verified' \}/, 'Verified only when the read says ACTIVE');
  // The lifecycle states it reads (KYB_SUBMITTED…) are data; no label it shows names KYB or a verdict.
  assert.doesNotMatch(agg, /label: '[^']*(?:KYB|Sumsub|risk tier|\bApproved\b)/);
});

test('the numbers come from one read, so the panels cannot disagree', async () => {
  const code = await overview();
  assert.equal((code.match(/api<OverviewDTO>\('\/overview'\)/g) ?? []).length, 1, 'one aggregator read feeds every panel');
  assert.doesNotMatch(code, /fetch\(/, 'no second source');
  assert.doesNotMatch(code, /useCompany\(\)/, 'not a second read beside it');
});

test('an empty account and an empty list say so, and say what to do', async () => {
  const code = await overview();
  assert.match(code, /Nothing needs you\./);
  assert.match(code, /No payments yet\./);
  assert.match(code, /Add money/);
  assert.match(code, /Pay your first supplier invoice/);
});

test('rendered from a fixture, every amount on the screen is one the read gave it', async () => {
  const { OverviewView } = await loadTsx('components/solana/Overview.tsx');
  const fixture = FIXTURE();
  const html = renderToStaticMarkup(createElement(OverviewView, { data: fixture }));
  // The fixture's own figures appear, formatted.
  for (const s of ['US$12,345.67', 'US$1,111.11', '₱98,765.43', 'US$4,321.09', 'US$777.77']) assert.ok(html.includes(s), `${s} is on the screen`);
  // And nothing else: every money figure in the markup is one of the fixture's.
  const allowed = new Set(['US$12,345.67', 'US$9,012.34', 'US$3,333.33', 'US$0.00', 'US$1,111.11', 'US$2,222.22', '₱98,765.43', 'US$4,321.09', 'US$777.77', 'US$20,000.00', 'US$100,000.00', 'US$10,000.00', 'US$1.23', 'US$4.56', 'US$7.89', 'US$13.68']);
  const shown = [...html.matchAll(/(?:US\$|₱)[\d,]+\.\d{2}/g)].map((m) => m[0]);
  const stray = shown.filter((s) => !allowed.has(s));
  assert.deepEqual(stray, [], 'no figure that the read did not give');
  assert.match(html, /Enough for everything due in the next 30 days\./);
  assert.match(html, /<strong>US\$777\.77<\/strong> is waiting for your approval/);
  assert.match(html, /Payments 73%, reserve 27%/);
  assert.match(html, /Not set up yet/, 'Investments before Phase 5');
  assert.equal((html.match(/class="iso-extrude/g) ?? []).length, 1, 'one extruded number on the screen');

  // Empty: no money, nothing waiting, no payments.
  const empty = renderToStaticMarkup(createElement(OverviewView, { data: FIXTURE({ empty: true }) }));
  assert.match(empty, /No money in your accounts yet\./);
  assert.match(empty, /Nothing needs you\./);
  assert.match(empty, /No payments yet\./);
});

test('what is simulated is labelled: "Test mode" sits above every dashboard page, Overview included', async () => {
  // Was: the balance header carried "Simulated test USDC" / "Devnet test USDC" and checked its parts
  // summed to the total. Prompt 10 moves the label to the shell's top row (one badge, every page), and
  // the sum is the server's (tests/solana-overview.test.mjs: total = payments + reserve + investments).
  const shell = codeOnly(await read('components/dashboard/DashboardShell.tsx'));
  assert.match(shell, /const testMode = !solana \|\| solana\.mode === 'offline' \|\| solana\.cluster !== 'mainnet-beta';/, 'offline and devnet are both test mode');
  assert.match(shell, /<ShellTopRow [^>]*testMode=\{testMode\}/);
  assert.match(codeOnly(await read('components/dashboard/ShellTopRow.tsx')), /\{testMode \? <TestModeBadge \/> : null\}/);
  assert.match(await read('app/dashboard/layout.tsx'), /DashboardShell/, 'the Overview renders inside the shell');
});

test('every link on the Overview lands on a page that exists today', async () => {
  // Phase 4 builds /dashboard/invoices/pay and /get; until then the links go where the pages are
  // (lib/dashboard/links.ts), and "Get paid" isn't offered. A 404 from the first screen is a broken promise.
  const { OverviewView } = await loadTsx('components/solana/Overview.tsx');
  const pages = [FIXTURE(), FIXTURE({ empty: true }), FIXTURE({ crowded: true })].map((data) => renderToStaticMarkup(createElement(OverviewView, { data })));
  const hrefs = [...new Set(pages.flatMap(hrefsIn))];
  assert.ok(hrefs.length >= 10, `found ${hrefs.length} links`);
  assert.deepEqual(hrefs.filter((h) => !resolvesToPage(h)), [], 'every link resolves to an app page');
  const { INVOICE_LINKS } = await import('../lib/dashboard/links.ts');
  if (!INVOICE_LINKS.get) assert.ok(pages.every((html) => !/>Get paid</.test(html)), 'no "Get paid" before its page exists');
});

test('Needs you shows five rows, then "See all" opens the rest in place', async () => {
  const { OverviewView } = await loadTsx('components/solana/Overview.tsx');
  const html = renderToStaticMarkup(createElement(OverviewView, { data: FIXTURE({ crowded: true }) }));
  assert.equal((html.match(/class="iso-row-btn"/g) ?? []).length, 5, 'five rows to start');
  assert.match(html, /<button type="button" class="iso-btn iso-btn--link" aria-expanded="false">See all 7<\/button>/);
  assert.doesNotMatch(html, /href="\/dashboard\/history">See all/, 'not a link to History: these are not payments');
});

function FIXTURE({ empty = false, crowded = false } = {}) {
  const z = (v) => (empty ? '0' : v);
  return {
    today: 'Tuesday, 13 Oct',
    needsCount: empty ? 0 : 1,
    money: {
      totalMinor: z('12345670000'),
      paymentsMinor: z('9012340000'),
      reserveMinor: z('3333330000'),
      investmentsMinor: '0',
      investmentsSetUp: false,
      shares: { payments: empty ? '0' : '73', reserve: empty ? '0' : '27', investments: '0' },
      payablesDueMinor: z('1111110000'),
      floorMinor: z('1222221000'),
      covered: true,
      shortMinor: '0',
      waitingMinor: z('777770000'),
      availableMinor: z('2222220000'),
    },
    needs: empty
      ? { rows: [], more: [], total: 0, readToday: 0 }
      : crowded
        ? {
            rows: [1, 2, 3, 4, 5].map((n) => ({ kind: 'approve', tag: { tone: 'coral', label: 'Approve' }, title: `Supplier ${n} · ₱98,765.43`, detail: `INV-${n}`, action: { label: 'Review', href: `/dashboard/invoices?payment=pay_${n}` } })),
            more: [
              { kind: 'sweep', tag: { tone: 'gold', label: 'Sweep' }, title: 'Sweep drafted', detail: 'Into T-bills', action: { label: 'Review', href: '/dashboard/treasury' } },
              { kind: 'setup', tag: { tone: 'ink', label: 'Set up' }, title: 'Add a second approver', detail: 'Optional', action: { label: 'Open', href: '/dashboard/settings/devices' } },
            ],
            total: 7,
            readToday: 0,
          }
        : {
          rows: [{ kind: 'approve', tag: { tone: 'coral', label: 'Approve' }, title: 'Fixture Supplier · ₱98,765.43', detail: 'INV-1 · you pay US$777.77', action: { label: 'Review', href: '/dashboard/invoices?payment=pay_1' } }],
          more: [],
          total: 1,
          readToday: 2,
        },
    pipeline: ['waiting', 'sent', 'partner', 'paid', 'recording', 'recorded'].map((id) => ({ id, label: id, count: empty ? 0 : id === 'waiting' ? 1 : 0, amountPhpMinor: !empty && id === 'waiting' ? '9876543' : '0', moving: false, href: `/dashboard/history?station=${id}` })),
    month: empty ? { paidUsdMinor: '0', paidCount: 0, verifiedCount: 0, fees: null } : { paidUsdMinor: '4321090000', paidCount: 1, verifiedCount: 1, fees: { totalMinor: '13680000', splashMinor: '1230000', partnerMinor: '4560000', processingMinor: '7890000', avgAllIn: '0.32%' } },
    recent: empty ? [] : [{ id: 'pay_1', name: 'Fixture Supplier', reference: 'INV-1', date: '13 Oct', theyGetPhpMinor: '9876543', youPaidUsdMinor: '777770000', tag: { tone: 'coral', label: 'Waiting approval' }, receiptHref: null, reviewHref: '/dashboard/invoices?payment=pay_1' }],
    corridors: [{ route: 'Malaysia → Philippines', detail: 'Any bank by InstaPay or PESONet', status: 'test' }],
    checks: { companyCheck: { tone: 'ok', label: 'Verified' }, perPaymentMinor: '20000000000', dailyMinor: '100000000000', usedTodayMinor: '0', secondApproverAboveMinor: '10000000000', secondApproverBuilt: false },
  };
}
