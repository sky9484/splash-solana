/**
 * Enforce the operating ceilings the dashboard already displays.
 *
 * Audit finding: `perTransferLimitUsd`, `dailyLimitUsd`, `approvalThresholdUsd`
 * and `requireDualApproval` were validated on save, persisted, cross-checked
 * against each other and rendered as operator controls — and read by no
 * authorization path. The only amount rule the money routes applied was
 * `checkMinimumSettlement`, a FLOOR. So the console showed a $1,000 per-transfer
 * limit while a $40,000 transfer settled.
 *
 * The daily figure is computed from the ledger rather than a counter, so it
 * cannot drift out of sync with what actually moved, and it counts DEBITs only
 * (money leaving the account) — a deposit does not consume the payout budget.
 */
import type { OperatingSettings } from '@/lib/server/operating-settings';

export type LimitCheck =
  | { ok: true; requiresSecondApproval: boolean; spentTodayUsd: number }
  | {
      ok: false;
      code: 'above_per_transfer_limit' | 'above_daily_limit';
      message: string;
      limitUsd: number;
      spentTodayUsd?: number;
    };

export type LedgerDebit = { direction: 'CREDIT' | 'DEBIT'; amountUsdcMicro: number; createdAt: string };

/** UTC day boundary. Explicit so the window cannot shift with server locale. */
export function startOfUtcDay(nowMs: number): number {
  return Date.UTC(
    new Date(nowMs).getUTCFullYear(),
    new Date(nowMs).getUTCMonth(),
    new Date(nowMs).getUTCDate(),
  );
}

/** USD already debited from this account since 00:00 UTC. */
export function spentTodayUsd(entries: readonly LedgerDebit[], nowMs: number): number {
  const dayStart = startOfUtcDay(nowMs);
  const micro = entries.reduce((total, entry) => {
    if (entry.direction !== 'DEBIT') return total;
    const at = Date.parse(entry.createdAt);
    if (!Number.isFinite(at) || at < dayStart) return total;
    return total + entry.amountUsdcMicro;
  }, 0);
  return micro / 1_000_000;
}

function money(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

export function checkAuthorizationLimits(input: {
  amountUsd: number;
  settings: OperatingSettings;
  /** Ledger entries for the PAYING account. Pass [] when no ledger applies. */
  ledger: readonly LedgerDebit[];
  nowMs?: number;
}): LimitCheck {
  const nowMs = input.nowMs ?? Date.now();
  const { amountUsd, settings } = input;

  if (amountUsd > settings.perTransferLimitUsd) {
    return {
      ok: false,
      code: 'above_per_transfer_limit',
      message: `This authorization is ${money(amountUsd)}, above the ${money(settings.perTransferLimitUsd)} per-transfer limit set in Settings.`,
      limitUsd: settings.perTransferLimitUsd,
    };
  }

  const spent = spentTodayUsd(input.ledger, nowMs);
  if (spent + amountUsd > settings.dailyLimitUsd) {
    return {
      ok: false,
      code: 'above_daily_limit',
      message:
        `This authorization would take today's total to ${money(spent + amountUsd)}, above the ` +
        `${money(settings.dailyLimitUsd)} daily limit set in Settings (${money(spent)} already sent today).`,
      limitUsd: settings.dailyLimitUsd,
      spentTodayUsd: spent,
    };
  }

  return {
    ok: true,
    // Above the threshold the operator asked for a second pair of eyes. The
    // caller routes these into the existing maker-checker queue instead of
    // settling straight through.
    requiresSecondApproval: settings.requireDualApproval && amountUsd >= settings.approvalThresholdUsd,
    spentTodayUsd: spent,
  };
}
