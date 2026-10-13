import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkStablecoinAllowance,
  laneAccess,
  MIN_STABLECOIN_TRANSFER_MINOR,
  normaliseSolanaAddress,
  NETWORK_FEE_LINE,
  parseUsdcMinor,
  quoteStablecoinTransfer,
  stablecoinFeeMinor,
  anchorFeeEnabled,
  describeStablecoinFee,
  ANCHOR_FEE_BPS,
  ANCHOR_FEE_MIN_MINOR,
  ANCHOR_FEE_CAP_MINOR,
  stablecoinLimitsFor,
  STABLECOIN_WINDOW_MS,
  UNVERIFIED_STABLECOIN_CAP_MINOR,
} from '../lib/payments/stablecoin-lane.ts';
import { SOLANA_CONFIG } from '../lib/solana/config.ts';

/**
 * The stablecoin lane's rules and arithmetic. Real money runs through these
 * numbers, so the boundaries are tested at the unit, not near it.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);
const usdc = (s) => parseUsdcMinor(s);

test('settlement is Circle native USDC on Solana, with the published mints, and nobody needs SOL', () => {
  assert.equal(SOLANA_CONFIG['mainnet-beta'].usdcMint, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  assert.equal(SOLANA_CONFIG.devnet.usdcMint, '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
  assert.match(NETWORK_FEE_LINE, /You don't need SOL/);
  assert.doesNotMatch(NETWORK_FEE_LINE, /gasless|free gas|no gas/i);
});

const OFF = { destination: 'EXTERNAL', anchorFeeOn: false };

test('stablecoin transfers are free: out of Splash while the anchor fee is off, and to a Splash user always', () => {
  const out = quoteStablecoinTransfer(usdc('1000'), OFF);
  assert.equal(out.principalMinor, usdc('1000'), 'the recipient receives exactly what was entered');
  assert.equal(out.feeMinor, 0n);
  assert.equal(out.totalDebitMinor, usdc('1000'));
  assert.equal(out.feeKind, 'FREE');
  assert.equal(describeStablecoinFee(out), 'Free');

  // A Splash user's wallet is free even with the anchor fee switched on.
  const internal = quoteStablecoinTransfer(usdc('1000'), { destination: 'SPLASH', anchorFeeOn: true });
  assert.equal(internal.feeMinor, 0n);
  assert.equal(describeStablecoinFee(internal), 'Free: to another Splash user');
});

test('the audit-anchor fee, when on: 0.02% on top, never below 0.05 or above 5 USDC', () => {
  const on = (amount) => stablecoinFeeMinor(usdc(amount), 'EXTERNAL', true);
  assert.equal(on('100'), usdc('0.05'), '0.02% of 100 is 0.02: the 0.05 floor applies');
  assert.equal(on('250'), usdc('0.05'), 'exactly the floor');
  assert.equal(on('1000'), usdc('0.2'));
  assert.equal(on('25000'), usdc('5'), 'exactly the cap');
  assert.equal(on('1000000'), usdc('5'), '0.02% would be 200: the 5 USDC cap applies');
  assert.equal(stablecoinFeeMinor(usdc('1000'), 'SPLASH', true), 0n);
  assert.equal(stablecoinFeeMinor(usdc('1000'), 'EXTERNAL', false), 0n);
  // Rounded half-up at the micro-unit: 2 bps of 1,000.0025 is 0.2000005.
  assert.equal(stablecoinFeeMinor(1_000_002_500n, 'EXTERNAL', true), 200_001n);

  const q = quoteStablecoinTransfer(usdc('1000'), { destination: 'EXTERNAL', anchorFeeOn: true });
  assert.equal(q.totalDebitMinor, usdc('1000.2'), 'on top: the business pays principal + fee');
  assert.equal(q.feeKind, 'AUDIT_ANCHOR');
  assert.equal(describeStablecoinFee(q), 'Audit-anchor fee 0.20 USDC (0.02%, min 0.05, max 5)');
  assert.deepEqual([ANCHOR_FEE_BPS, ANCHOR_FEE_MIN_MINOR, ANCHOR_FEE_CAP_MINOR], [2, 50_000n, 5_000_000n]);
});

test('the audit-anchor fee is off unless switched on by name', () => {
  assert.equal(anchorFeeEnabled({}), false);
  assert.equal(anchorFeeEnabled({ STABLECOIN_ANCHOR_FEE: 'off' }), false);
  assert.equal(anchorFeeEnabled({ STABLECOIN_ANCHOR_FEE: 'yes' }), false);
  assert.equal(anchorFeeEnabled({ STABLECOIN_ANCHOR_FEE: ' ON ' }), true);
});

test('below 1 USDC a wallet transfer is refused, and amounts are never silently rounded', () => {
  assert.throws(() => quoteStablecoinTransfer(MIN_STABLECOIN_TRANSFER_MINOR - 1n, OFF), /minimum wallet transfer is 1\.000000 USDC/);
  assert.doesNotThrow(() => quoteStablecoinTransfer(MIN_STABLECOIN_TRANSFER_MINOR, OFF));
  assert.equal(usdc('1250.5'), 1_250_500_000n);
  assert.throws(() => usdc('1.0000001'), /fraction digits/);
});

test('an unverified business may send exactly 5,000 USDC in 30 days, and not one micro-unit more', () => {
  const prior = [{ principalMinor: usdc('4000'), atMs: NOW - 10 * DAY }];
  const exact = checkStablecoinAllowance({ state: 'REGISTERED', principalMinor: usdc('1000'), prior, nowMs: NOW });
  assert.equal(exact.ok, true);
  assert.equal(exact.remainingMinor, usdc('1000'));

  const over = checkStablecoinAllowance({ state: 'REGISTERED', principalMinor: usdc('1000') + 1n, prior, nowMs: NOW });
  assert.equal(over.ok, false);
  assert.match(over.reason, /up to 5000\.000000 USDC in any 30 days/);
  assert.match(over.reason, /Finish verification/);
});

test('the window is rolling: the calendar-month reset trick does not work', () => {
  // 5,000 sent late on the 30th of a month...
  const prior = [{ principalMinor: UNVERIFIED_STABLECOIN_CAP_MINOR, atMs: NOW - 1 * DAY }];
  // ...and 1 more USDC the next day is refused, month boundary or not.
  const r = checkStablecoinAllowance({ state: 'REGISTERED', principalMinor: usdc('1'), prior, nowMs: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.remainingMinor, 0n);
});

test('outflows older than the window stop counting — at the boundary exactly', () => {
  const atBoundary = [{ principalMinor: UNVERIFIED_STABLECOIN_CAP_MINOR, atMs: NOW - STABLECOIN_WINDOW_MS }];
  assert.equal(checkStablecoinAllowance({ state: 'REGISTERED', principalMinor: usdc('5000'), prior: atBoundary, nowMs: NOW }).ok, true);

  const justInside = [{ principalMinor: UNVERIFIED_STABLECOIN_CAP_MINOR, atMs: NOW - STABLECOIN_WINDOW_MS + 1 }];
  assert.equal(checkStablecoinAllowance({ state: 'REGISTERED', principalMinor: usdc('1'), prior: justInside, nowMs: NOW }).ok, false);
});

test('the cap is shared: x402 payments and transfers draw from one allowance', () => {
  const prior = [
    { principalMinor: usdc('4999.99'), atMs: NOW - 2 * DAY }, // a transfer
    { principalMinor: usdc('0.01'), atMs: NOW - DAY }, // an x402 payment
  ];
  const r = checkStablecoinAllowance({ state: 'KYB_SUBMITTED', principalMinor: usdc('0.01'), prior, nowMs: NOW });
  assert.equal(r.ok, false, 'a cent over, counting the x402 cent');
});

test('suspended and rejected businesses get no allowance at all', () => {
  for (const state of ['SUSPENDED', 'REJECTED']) {
    assert.equal(stablecoinLimitsFor(state), null);
    const r = checkStablecoinAllowance({ state, principalMinor: usdc('1'), prior: [], nowMs: NOW });
    assert.equal(r.ok, false, `${state} must not inherit the unverified allowance`);
    for (const lane of ['FIAT_IN_USD', 'FIAT_OUT_LOCAL', 'STABLECOIN_WALLET', 'X402', 'TREASURY']) {
      assert.equal(laneAccess(state, lane).allowed, false, `${state} ${lane}`);
    }
  }
});

test('onboarding businesses: stablecoin and x402 open, USD-in and local payouts and treasury locked', () => {
  for (const state of ['REGISTERED', 'KYB_SUBMITTED', 'KYB_PROVIDER_APPROVED', 'KYB_ADMIN_APPROVED']) {
    assert.equal(laneAccess(state, 'STABLECOIN_WALLET').allowed, true);
    assert.equal(laneAccess(state, 'X402').allowed, true);
    assert.equal(laneAccess(state, 'FIAT_IN_USD').allowed, false);
    assert.equal(laneAccess(state, 'FIAT_OUT_LOCAL').allowed, false);
    assert.match(laneAccess(state, 'FIAT_OUT_LOCAL').reason, /unlock when your business is verified/);
    assert.equal(laneAccess(state, 'TREASURY').allowed, false);
  }
});

test('verified businesses get the on-chain Tier 3 defaults on this lane', () => {
  const l = stablecoinLimitsFor('ACTIVE');
  assert.equal(l.perTransferMinor, usdc('20000'));
  assert.equal(l.windowCapMinor, usdc('500000'));
  assert.equal(checkStablecoinAllowance({ state: 'ACTIVE', principalMinor: usdc('20000'), prior: [], nowMs: NOW }).ok, true);
  const tooBig = checkStablecoinAllowance({ state: 'ACTIVE', principalMinor: usdc('20000') + 1n, prior: [], nowMs: NOW });
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.reason, /at most 20000\.000000 USDC/);
});

test('a Solana address is accepted exactly as typed; another chain’s address is refused, never converted', () => {
  // Real addresses: the devnet vault from the proof run and the USDC mint.
  const vault = '9fZ34EK7nfX5f3aR8yfXq9oQb8Dqv2Km2h1T4mQ7bKGx';
  for (const address of [vault, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr']) {
    assert.equal(normaliseSolanaAddress(`  ${address} `), address, 'trimmed, never re-cased: base58 is case-sensitive');
  }

  const evm = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';
  assert.throws(() => normaliseSolanaAddress(evm), /That is an Ethereum address/);
  assert.throws(() => normaliseSolanaAddress('0x' + 'ab'.repeat(32)), /another network/);
  assert.throws(() => normaliseSolanaAddress('11111111111111111111111111111111'), /system address/);
  assert.throws(() => normaliseSolanaAddress('9fZ34EK7'), /base58/, 'too short to be 32 bytes');
  assert.throws(() => normaliseSolanaAddress('9fZ34EK7nfX5f3aR8yfXq9oQb8Dqv2Km2h1T4mQ7bKG0'), /base58/, '0 is not a base58 character');
  assert.throws(() => normaliseSolanaAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1vEPjF'), /base58/, 'decodes to more than 32 bytes');
});
