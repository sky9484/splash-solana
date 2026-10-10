import type { SweepJob } from '@/lib/server/operations';

export interface PayoutPartnerAdapter {
  quote(currency: string, usdcMicro: number): Promise<{ fxRate: string; partnerFeeBps: number }>;
  payout(job: SweepJob): Promise<{ partnerPayoutRef: string }>;
}

export class PayoutPartnerNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayoutPartnerNotConfiguredError';
  }
}

export const mockPdaxAdapter: PayoutPartnerAdapter = {
  async quote(currency) {
    return { fxRate: currency === 'PHP' ? String(process.env.PHP_PER_USDC ?? '56.5') : '1', partnerFeeBps: 20 };
  },
  async payout(job) {
    const delay = 1800;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return { partnerPayoutRef: `DEMO_PDAX_${job.id}_${delay}` };
  },
};

export const livePdaxAdapter: PayoutPartnerAdapter = {
  async quote() {
    throw new PayoutPartnerNotConfiguredError('Live PDAX quote adapter is not configured.');
  },
  async payout() {
    throw new PayoutPartnerNotConfiguredError('Live PDAX payout adapter is not configured.');
  },
};

export const pdaxAdapter =
  process.env.USE_MOCK_APIS === 'true' || !process.env.PDAX_API_KEY ? mockPdaxAdapter : livePdaxAdapter;
