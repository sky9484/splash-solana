import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * WS6 — Phase-0 custody gates.
 *
 * Phase 0 pays out. Holding customer funds — a STORED_BALANCE or SWEEP_ACCOUNT
 * delivery, and the treasury — is Phase 2, and needs a money-broking licence
 * Splash does not hold. Until the custody package is configured, every one of
 * those must refuse with a plain, licence-named error, and nothing on the
 * treasury surfaces may show demo balances or transactions as if they were
 * confirmed.
 *
 * Red before green: on the tree before the fix the gate module does not
 * exist, the transfer route accepts `deliveryTier: 'STORED_BALANCE'` with no
 * custody configured, `/api/treasury` serves a seeded demo ledger, and the
 * treasury page renders $24,500 and six "confirmed" transactions from a
 * constant before its first fetch returns.
 */

const gate = () => import('../lib/server/custody-phase.ts');

async function source(relative) {
  const raw = await readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

/* ── The gate ──────────────────────────────────────────────────────────── */

test('the custody phase is decided by the custody package alone, and PAYOUT_ONLY is the only Phase-0 tier', async () => {
  const { custodyPhaseEnabled, deliveryTierAllowed, PHASE0_DELIVERY_TIERS } = await gate();

  assert.equal(custodyPhaseEnabled({ custodyEnabled: false }), false);
  assert.equal(custodyPhaseEnabled({}), false);
  assert.equal(custodyPhaseEnabled({}), false);
  assert.equal(custodyPhaseEnabled({ custodyEnabled: true }), true);

  assert.deepEqual([...PHASE0_DELIVERY_TIERS], ['PAYOUT_ONLY']);
  for (const tier of ['STORED_BALANCE', 'SWEEP_ACCOUNT']) {
    assert.equal(deliveryTierAllowed(tier, { custodyEnabled: false }), false, `${tier} holds funds`);
    assert.equal(deliveryTierAllowed(tier, { custodyEnabled: true }), true);
  }
  assert.equal(deliveryTierAllowed('PAYOUT_ONLY', { custodyEnabled: false }), true);
  assert.equal(deliveryTierAllowed('anything-else', { custodyEnabled: true }), false, 'an unknown tier is never allowed');
});

test('the refusal names the licence, the phase, and the tier that is allowed — and never claims a licence', async () => {
  const { custodyPhaseResponse, CUSTODY_PHASE_REASON, CUSTODY_PHASE_CODE } = await gate();

  const response = custodyPhaseResponse();
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.json();
  assert.equal(body.code, CUSTODY_PHASE_CODE);
  assert.equal(body.error, CUSTODY_PHASE_REASON);
  assert.deepEqual(body.allowedDeliveryTiers, ['PAYOUT_ONLY']);

  assert.match(CUSTODY_PHASE_REASON, /money-broking licence/i, 'the licence is named');
  assert.match(CUSTODY_PHASE_REASON, /Phase 2/, 'the phase is named');
  assert.match(CUSTODY_PHASE_REASON, /does not hold/i, 'and it is stated plainly that Splash does not hold it');
  assert.doesNotMatch(CUSTODY_PHASE_REASON, /\blicensed\b/i, 'claims discipline: never "licensed" about Splash');
});

/* ── Delivery tiers ────────────────────────────────────────────────────── */

test('a recipient cannot be created with a fund-holding tier in Phase 0 either', async () => {
  const route = await source('app/api/recipients/route.ts');
  assert.ok(route.indexOf('deliveryTierAllowed(') < route.indexOf('persistRecipient('));
  assert.match(route, /custodyPhaseResponse\(\)/);
});

/* ── The treasury ──────────────────────────────────────────────────────── */

test('the treasury page shows no demo balance or transaction as confirmed, and says when treasury arrives', async () => {
  const page = await source('app/dashboard/treasury/page.tsx');

  assert.doesNotMatch(page, /SEED_HISTORY/, 'the six hardcoded transactions are gone');
  assert.doesNotMatch(page, /useState\(11140/, 'no hardcoded available balance');
  assert.doesNotMatch(page, /useState\(24500/, 'no hardcoded treasury balance');
  assert.doesNotMatch(page, /useState\(98\.72/, 'no hardcoded accrued yield');
  assert.doesNotMatch(page, /tx_t00[1-9]/, 'no seeded transaction ids');
  assert.doesNotMatch(page, /'Audited/, 'nothing is described as audited without a source');
  assert.doesNotMatch(page, /earns a floating T-bill rate/, 'no yield promise in the header');

  assert.match(page, /Treasury arrives with our licence/, 'the Phase-0 state is plain about why');
  assert.match(page, /custody_not_licensed/, 'the page recognises the gate response');
  assert.match(page, /<MoneyPathPanel \/>/, 'the money-path panel still mounts (pinned by tests/money-path.test.mjs)');
});

test('the overview card and the copilot stop presenting treasury numbers in Phase 0', async () => {
  const overview = await source('app/dashboard/overview/page.tsx');
  assert.doesNotMatch(overview, /useState\(24500\)/);
  assert.doesNotMatch(overview, /useState\(98\.72\)/);
  assert.doesNotMatch(overview, /\+\$3\.22/, 'no invented daily yield');
  assert.match(overview, /Treasury arrives with our licence/);
  assert.match(overview, /custody_not_licensed/);

  // The treasury route that served the numbers is gone on the Solana build
  // (prompt 07 §4.2), so nothing can serve them in any phase.
  await assert.rejects(source('app/api/treasury/route.ts'), /ENOENT/);
});
