import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFundingSources,
  FundingRegistryError,
  fundingMethodForSelection,
  getEnabledFundingOptions,
  resolveFundingSelection,
  selectionForSource,
  suggestedUsdProvider,
} from '../lib/funding/registry.ts';

const baseEnv = {
  FEATURE_DUAL_FUNDING: 'true',
  USE_MOCK_APIS: 'true',
  FUNDING_ASSET_USDC_ENABLED: 'true',
  FUNDING_ASSET_USDSUI_ENABLED: 'true',
  FUNDING_ASSET_USDT_ENABLED: 'false',
  USDC_TYPE: '0x1::usdc::USDC',
  USDSUI_TYPE: '0x2::usdsui::USDSUI',
  USDT_TYPE: '0x3::usdt::USDT',
};

test('disabled stablecoins are omitted and rejected server-side', () => {
  const registry = getEnabledFundingOptions(baseEnv);
  assert.deepEqual(registry.stablecoinAssets.map((asset) => asset.symbol), ['USDC', 'USDSUI']);
  assert.throws(
    () => resolveFundingSelection({ source: 'USDT', type: 'stablecoin', asset: 'USDT', rail: 'SUI_NATIVE', feeTier: 'DISCOUNT' }, baseEnv),
    FundingRegistryError,
  );
});

test('asset and rail combinations are hard-rejected', () => {
  assert.throws(
    () => resolveFundingSelection({ source: 'USDSUI', type: 'stablecoin', asset: 'USDSUI', rail: 'CCTP', sourceChain: 'BASE', feeTier: 'DISCOUNT' }, baseEnv),
    /not enabled/,
  );
  assert.throws(
    () => resolveFundingSelection({ source: 'USDC', type: 'stablecoin', asset: 'USDC', rail: 'CCTP', feeTier: 'DISCOUNT' }, baseEnv),
    /source chain/,
  );
});

test('held balance source is only enabled when balance covers amount due', () => {
  const registry = getEnabledFundingOptions(baseEnv);
  const insufficient = buildFundingSources({ registry, heldBalanceMicro: 5_000_000, amountDueMicro: 10_000_000 });
  const sufficient = buildFundingSources({ registry, heldBalanceMicro: 10_000_000, amountDueMicro: 10_000_000 });
  assert.equal(insufficient.find((source) => source.id === 'SPLASH_BALANCE')?.enabled, false);
  assert.equal(sufficient.find((source) => source.id === 'SPLASH_BALANCE')?.enabled, true);
});

test('source helpers create valid selections for each funding source', () => {
  const registry = getEnabledFundingOptions(baseEnv);
  const held = selectionForSource('SPLASH_BALANCE', registry, 'STRIPE');
  const bank = selectionForSource('BANK_USD', registry, 'AIRWALLEX');
  const usdc = selectionForSource('USDC', registry, 'STRIPE');

  assert.deepEqual(held, { source: 'SPLASH_BALANCE', type: 'held', feeTier: 'DISCOUNT' });
  assert.deepEqual(bank, { source: 'BANK_USD', type: 'fiat', provider: 'AIRWALLEX', feeTier: 'STANDARD' });
  assert.equal(usdc?.type, 'stablecoin');
  assert.equal(fundingMethodForSelection(held), 'HELD_BALANCE');
  assert.equal(fundingMethodForSelection(bank), 'BANK_USD');
});

test('stablecoin source must match the selected asset', () => {
  assert.throws(
    () => resolveFundingSelection({ source: 'USDC', type: 'stablecoin', asset: 'USDSUI', rail: 'SUI_NATIVE', feeTier: 'DISCOUNT' }, baseEnv),
    /source must match/,
  );
});

test('USDT only appears when the flag and coin type are present', () => {
  const registry = getEnabledFundingOptions({ ...baseEnv, FUNDING_ASSET_USDT_ENABLED: 'true' });
  assert.equal(registry.stablecoinAssets.at(-1)?.symbol, 'USDT');
});

test('Malaysia suggests Airwallex and other regions suggest Stripe', () => {
  const registry = getEnabledFundingOptions(baseEnv);
  assert.equal(suggestedUsdProvider('MY', registry), 'AIRWALLEX');
  assert.equal(suggestedUsdProvider('SG', registry), 'STRIPE');
});
