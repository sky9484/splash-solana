/**
 * Recorded fixture: one US$10,000-equivalent PHP payout (PHP 574,000.00 at the
 * mock's 57.40), priced by the mock partner on Solana and Polygon. Deterministic
 * for a given `now`; used by tests and by the offline demo.
 */
import { createMockPartner } from '../solana-partner/mock-partner.ts';
import type { EngineInput } from './quote.ts';

export const FIXTURE_NOW = new Date('2026-10-11T03:00:00.000Z');
export const FIXTURE_PAYMENT_ID = 'pay_fixture_10k';
export const FIXTURE_PHP_MINOR = 57_400_000n; // PHP 574,000.00 = US$10,000.00 at 57.40
export const FIXTURE_WEBHOOK_SECRET = 'fixture-webhook-secret-not-for-production';
export const FIXTURE_FAST_FEE_BPS = '1.3';

export function tenThousandUsdPhpFixture(now: Date = FIXTURE_NOW, overrides: Partial<EngineInput> = {}) {
  const partner = createMockPartner({ webhookSecret: FIXTURE_WEBHOOK_SECRET, seed: 'fixture' });
  const partnerQuotes = (['solana', 'polygon'] as const).map((network) => partner.quote({ amountPhpMinor: FIXTURE_PHP_MINOR }, { network, now }));
  const payout = partner.createPayout({
    paymentId: FIXTURE_PAYMENT_ID,
    amountPhpMinor: FIXTURE_PHP_MINOR,
    expectedUsdcMinor: partnerQuotes[0].grossUsdcMinor,
    beneficiary: { bank: 'BDO Unibank, Inc.', accountLast4: '4471' },
    now,
  });
  const deposits = Object.fromEntries(payout.deposits.map((d) => [d.network, d.address]));
  const input: EngineInput = {
    paymentId: FIXTURE_PAYMENT_ID,
    amount: { amountPhpMinor: FIXTURE_PHP_MINOR },
    senderBalanceUsdcMinor: 25_000_000_000n,
    partner: partner.entry,
    partnerQuotes,
    deposits,
    fastTransferFeeBps: FIXTURE_FAST_FEE_BPS,
    now,
    homeChain: 'solana',
    ...overrides,
  };
  return { partner, payout, input };
}
