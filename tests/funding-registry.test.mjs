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
import { SOLANA_CONFIG } from '../lib/solana/config.ts';

const baseEnv = {
  FEATURE_DUAL_FUNDING: 'true',
  USE_MOCK_APIS: 'true',
  FUNDING_ASSET_USDC_ENABLED: 'true',
  FUNDING_CCTP_BASE_ENABLED: 'true',
};

test('USDC is the only stablecoin, in the cluster’s native mint, on Solana and through CCTP', () => {
  const registry = getEnabledFundingOptions(baseEnv);
  assert.deepEqual(registry.stablecoinAssets.map((asset) => asset.symbol), ['USDC']);
  const [usdc] = registry.stablecoinAssets;
  assert.equal(usdc.mint, SOLANA_CONFIG.devnet.usdcMint, 'SOLANA_CLUSTER unset is devnet');
  assert.deepEqual(usdc.rails, ['SOLANA', 'CCTP']);
  assert.ok(!usdc.cctpSourceChains.includes('SOLANA'), 'Solana is home, not a CCTP source');

  const mainnet = getEnabledFundingOptions({ ...baseEnv, SOLANA_CLUSTER: 'mainnet-beta' });
  assert.equal(mainnet.stablecoinAssets[0].mint, SOLANA_CONFIG['mainnet-beta'].usdcMint);
});

test('anything other than USDC, or a rail the build does not have, is refused server-side', () => {
  assert.throws(
    () => resolveFundingSelection({ source: 'USDT', type: 'stablecoin', asset: 'USDT', rail: 'SOLANA', feeTier: 'DISCOUNT' }, baseEnv),
    FundingRegistryError,
  );
  assert.throws(
    () => resolveFundingSelection({ source: 'USDC', type: 'stablecoin', asset: 'USDC', rail: 'SUI_NATIVE', feeTier: 'DISCOUNT' }, baseEnv),
    /not enabled/,
  );
});

test('asset and rail combinations are hard-rejected', () => {
  assert.throws(
    () => resolveFundingSelection({ source: 'USDC', type: 'stablecoin', asset: 'USDC', rail: 'CCTP', feeTier: 'DISCOUNT' }, baseEnv),
    /source chain/,
  );
  assert.throws(
    () => resolveFundingSelection({ source: 'USDC', type: 'stablecoin', asset: 'USDC', rail: 'SOLANA', sourceChain: 'BASE', feeTier: 'DISCOUNT' }, baseEnv),
    /only valid for CCTP/,
  );
  assert.doesNotThrow(() => resolveFundingSelection({ source: 'USDC', type: 'stablecoin', asset: 'USDC', rail: 'CCTP', sourceChain: 'BASE', feeTier: 'DISCOUNT' }, baseEnv));
});

test('a rail switched off is not offered', () => {
  const noNative = getEnabledFundingOptions({ ...baseEnv, FUNDING_RAIL_SOLANA_ENABLED: 'false' });
  assert.deepEqual(noNative.stablecoinAssets[0].rails, ['CCTP']);
  const neither = getEnabledFundingOptions({ ...baseEnv, FUNDING_RAIL_SOLANA_ENABLED: 'false', FUNDING_RAIL_CCTP_ENABLED: 'false' });
  assert.deepEqual(neither.stablecoinAssets, [], 'USDC with no rail is not offered at all');
});

test('held balance source is only enabled when balance covers amount due', () => {
  const registry = getEnabledFundingOptions(baseEnv);
  const insufficient = buildFundingSources({ registry, heldBalanceMicro: 5_000_000, amountDueMicro: 10_000_000 });
  const sufficient = buildFundingSources({ registry, heldBalanceMicro: 10_000_000, amountDueMicro: 10_000_000 });
  assert.equal(insufficient.find((source) => source.id === 'SPLASH_BALANCE')?.enabled, false);
  assert.equal(sufficient.find((source) => source.id === 'SPLASH_BALANCE')?.enabled, true);
  assert.equal(sufficient.find((source) => source.id === 'SPLASH_BALANCE')?.label, 'Vault balance', 'the money is in the business’s own vault');
  for (const source of sufficient) {
    assert.doesNotMatch(`${source.label} ${source.description}`, /instant|\bSui\b/i, source.id);
  }
});

test('source helpers create valid selections for each funding source', () => {
  const registry = getEnabledFundingOptions(baseEnv);
  const held = selectionForSource('SPLASH_BALANCE', registry, 'STRIPE');
  const bank = selectionForSource('BANK_USD', registry, 'AIRWALLEX');
  const usdc = selectionForSource('USDC', registry, 'STRIPE');

  assert.deepEqual(held, { source: 'SPLASH_BALANCE', type: 'held', feeTier: 'DISCOUNT' });
  assert.deepEqual(bank, { source: 'BANK_USD', type: 'fiat', provider: 'AIRWALLEX', feeTier: 'STANDARD' });
  assert.deepEqual(usdc, { source: 'USDC', type: 'stablecoin', asset: 'USDC', rail: 'SOLANA', sourceChain: undefined, feeTier: 'DISCOUNT' });
  assert.equal(fundingMethodForSelection(held), 'HELD_BALANCE');
  assert.equal(fundingMethodForSelection(bank), 'BANK_USD');
});

test('stablecoin source must match the selected asset', () => {
  assert.throws(
    () => resolveFundingSelection({ source: 'USDC', type: 'stablecoin', asset: 'USDT', rail: 'SOLANA', feeTier: 'DISCOUNT' }, baseEnv),
    /source must match/,
  );
});

test('Malaysia suggests Airwallex and other regions suggest Stripe', () => {
  const registry = getEnabledFundingOptions(baseEnv);
  assert.equal(suggestedUsdProvider('MY', registry), 'AIRWALLEX');
  assert.equal(suggestedUsdProvider('SG', registry), 'STRIPE');
});
