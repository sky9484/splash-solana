import { isUsdtConfigured, USDT_BUFFER_ID, USDT_TYPE } from '@/lib/sui';

export type UsdtTtlGuardResult = {
  configured: boolean;
  action: 'skipped' | 'monitor' | 'sweep_required';
  bufferId: string | null;
  usdtType: string | null;
  ageMs: number;
  sweepTriggerMs: number;
};

const SWEEP_TRIGGER_MS = 27 * 60 * 1000;

export async function runUsdtTtlGuard(ageMs = Number.parseInt(process.env.USDT_BUFFER_AGE_MS ?? '0', 10)): Promise<UsdtTtlGuardResult> {
  if (!isUsdtConfigured()) {
    return {
      configured: false,
      action: 'skipped',
      bufferId: null,
      usdtType: null,
      ageMs: 0,
      sweepTriggerMs: SWEEP_TRIGGER_MS,
    };
  }

  return {
    configured: true,
    action: ageMs >= SWEEP_TRIGGER_MS ? 'sweep_required' : 'monitor',
    bufferId: USDT_BUFFER_ID,
    usdtType: USDT_TYPE,
    ageMs,
    sweepTriggerMs: SWEEP_TRIGGER_MS,
  };
}
