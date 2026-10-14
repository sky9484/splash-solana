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

test('the treasury page shows no demo balance or transaction as confirmed, and no yield', async () => {
  // Sky, 13 Oct: treasury is back, as the company's own operating cash in vault #1 of its multisig
  // (lib/solana-app/treasury-service.ts). It is not the Sui build's Smart Treasury: no yield, no rate,
  // no ledger of Splash's, and every balance is read from the chain.
  const page = (await source('app/dashboard/treasury/page.tsx')) + (await source('components/solana/TreasuryDesk.tsx'));

  assert.doesNotMatch(page, /SEED_HISTORY/, 'the six hardcoded transactions are gone');
  assert.doesNotMatch(page, /useState\(11140/, 'no hardcoded available balance');
  assert.doesNotMatch(page, /useState\(24500/, 'no hardcoded treasury balance');
  assert.doesNotMatch(page, /useState\(98\.72/, 'no hardcoded accrued yield');
  assert.doesNotMatch(page, /tx_t00[1-9]/, 'no seeded transaction ids');
  assert.doesNotMatch(page, /'Audited/, 'nothing is described as audited without a source');
  assert.doesNotMatch(page, /earns a floating T-bill rate/, 'no yield promise in the header');

  assert.doesNotMatch(page, /fetch\(['`]\/api\/treasury/, 'nothing reads the old treasury ledger');
  assert.doesNotMatch(page, /useState\(\d/, 'no number the page made up');
  assert.doesNotMatch(page, /\byield\b|\bAPY\b|USDY|interest|T-bill/i, 'no yield or rate wording');
  assert.match(page, /useCompany\(\)/, 'every balance comes from the company read (the chain)');
  assert.match(page, /t\.balanceMinor/, 'the treasury balance is the vault #1 token account');
  assert.match(page, /Splash holds no key to either/, 'it says who can move the money');
});

test('the overview presents no made-up treasury numbers, in any phase', async () => {
  // The overview is the vaults' balances, read from their token accounts (prompt 07 §6.2). The treasury
  // line (now "Reserve") is vault #1's balance; never a yield, a rate or a projection.
  // Prompt 10 Phase 2: the page reads one aggregator (GET /api/solana/overview) instead of
  // useCompany(), and the aggregator reads vault #1's token account. Same intent, new place.
  const overview = (await source('app/dashboard/page.tsx')) + (await source('components/solana/Overview.tsx'));
  assert.doesNotMatch(overview, /useState\(\d/, 'no number the page made up');
  assert.doesNotMatch(overview, /\/api\/treasury/, 'the overview reads no treasury ledger');
  assert.doesNotMatch(overview, /\byield\b|\bAPY\b|USDY|interest/i, 'no yield or rate wording');
  assert.match(overview, /api<OverviewDTO>\('\/overview'\)/, 'every figure comes from the one overview read');
  const aggregator = await source('lib/solana-app/overview.ts');
  assert.match(aggregator, /getUsdcBalance\(treasuryVaultPda\(org\.vault\.multisigPda\)\)/, 'the reserve figure is vault #1’s token account');
  assert.doesNotMatch(aggregator, /\/api\/treasury|\byield\b|\bAPY\b|USDY|interest/i, 'the aggregator reads no treasury ledger and states no rate');

  // The treasury route that served the numbers is gone on the Solana build
  // (prompt 07 §4.2), so nothing can serve them in any phase.
  await assert.rejects(source('app/api/treasury/route.ts'), /ENOENT/);
});
