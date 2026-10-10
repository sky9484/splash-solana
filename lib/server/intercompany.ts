import { MICRO_DECIMALS, formatMinor, parseMinor } from '../money.ts';
// lib/server/intercompany.ts
// Tracks intercompany USD transfers from Splash US → Splash Labuan
// and Labuan settlement confirmations for audit trail.

export type IntercompanyState =
  | 'INITIATED'
  | 'FX_CONFIRMED'
  | 'USD_SENT'       // USD transferred to Maybank Labuan
  | 'USD_RECEIVED'   // Splash Labuan confirms USD receipt
  | 'USDC_ACQUIRED'  // Splash Labuan has acquired USDC
  | 'SETTLED'        // USDC settled on Sui
  | 'FAILED';

export interface IntercompanyRecord {
  id: string;
  transferIntentId: string;    // links to operations.ts TransferIntentRecord
  amountUsd: string;
  amountUsdc: string;
  usdToUsdcRate: string;
  maybankRef: string;          // Maybank intercompany transfer reference
  labuanSettlementId: string;  // Splash Labuan's internal settlement ID
  state: IntercompanyState;
  createdAt: string;
  updatedAt: string;
}

type IntercompanyStore = Map<string, IntercompanyRecord>;
const globalStore = globalThis as typeof globalThis & { splashIntercompany?: IntercompanyStore };
export const intercompanyStore = globalStore.splashIntercompany ?? new Map<string, IntercompanyRecord>();
globalStore.splashIntercompany = intercompanyStore;

function uid() {
  return `ic_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createIntercompanyTransfer(input: {
  transferIntentId: string;
  amountUsd: string;
  usdToUsdcRate: string;
}): IntercompanyRecord {
  const now = new Date().toISOString();
  const record: IntercompanyRecord = {
    id: uid(),
    transferIntentId: input.transferIntentId,
    amountUsd: input.amountUsd,
    amountUsdc: '0',
    usdToUsdcRate: input.usdToUsdcRate,
    maybankRef: '',
    labuanSettlementId: '',
    state: 'INITIATED',
    createdAt: now,
    updatedAt: now,
  };
  intercompanyStore.set(record.id, record);
  return record;
}

export function updateIntercompany(id: string, patch: Partial<IntercompanyRecord>): void {
  const record = intercompanyStore.get(id);
  if (!record) return;
  Object.assign(record, patch, { updatedAt: new Date().toISOString() });
  intercompanyStore.set(id, record);
}

export function getIntercompanyByTransfer(transferIntentId: string): IntercompanyRecord | null {
  for (const record of intercompanyStore.values()) {
    if (record.transferIntentId === transferIntentId) return record;
  }
  return null;
}

export function listIntercompanyTransfers(): IntercompanyRecord[] {
  return [...intercompanyStore.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/**
 * Daily reconciliation: sum USD in, USDC settled.
 * Returns discrepancy if any.
 */
/**
 * Daily reconciliation: USD paid in against USDC settled out, and the gap
 * between them.
 *
 * The gap is the point of the function — it should be fees and nothing else,
 * so anything unexplained is a signal. Summing the legs as floats put float
 * error into that signal: a hundred rows of "0.10" summed as doubles is
 * 9.999999999999998, and a discrepancy of 2e-15 is indistinguishable from a
 * real one-microunit break at a glance. Both legs are integer micro units
 * now, so a non-zero discrepancy means something actually did not balance.
 *
 * Totals are returned as both minor units and formatted strings: the bigint
 * is what a caller should compare or accumulate, the string is what it should
 * display, and neither invites a float back in.
 */
export function getDailyReconciliation(dateStr?: string): {
  date: string;
  totalUsdInMicro: bigint;
  totalUsdcSettledMicro: bigint;
  totalUsdIn: string;
  totalUsdcSettled: string;
  transferCount: number;
  discrepancyMicro: bigint;
  discrepancy: string;
} {
  const targetDate = dateStr ?? new Date().toISOString().split('T')[0];
  let totalUsdMicro = 0n;
  let totalUsdcMicro = 0n;
  let count = 0;

  for (const record of intercompanyStore.values()) {
    if (record.createdAt.startsWith(targetDate)) {
      totalUsdMicro += parseMinor(record.amountUsd, MICRO_DECIMALS);
      totalUsdcMicro += parseMinor(record.amountUsdc, MICRO_DECIMALS);
      count++;
    }
  }

  // USD out minus USDC in. Near zero by design; the remainder is fees.
  const delta = totalUsdMicro - totalUsdcMicro;
  const discrepancyMicro = delta < 0n ? -delta : delta;

  return {
    date: targetDate,
    totalUsdInMicro: totalUsdMicro,
    totalUsdcSettledMicro: totalUsdcMicro,
    totalUsdIn: formatMinor(totalUsdMicro, MICRO_DECIMALS),
    totalUsdcSettled: formatMinor(totalUsdcMicro, MICRO_DECIMALS),
    transferCount: count,
    discrepancyMicro,
    discrepancy: formatMinor(discrepancyMicro, MICRO_DECIMALS),
  };
}
