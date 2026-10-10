import fs from 'node:fs';
import path from 'node:path';

export type OperatingSettings = {
  perTransferLimitUsd: number;
  dailyLimitUsd: number;
  approvalThresholdUsd: number;
  autoAllocateTreasuryPct: number;
  requireTotp: boolean;
  requireDualApproval: boolean;
  blockHighRiskCorridors: boolean;
  notifyOnSettlement: boolean;
  updatedAt: string;
};

const DATA_DIR = process.env.SPLASH_DATA_DIR ?? path.join(process.cwd(), 'data');
const SETTINGS_PATH = path.join(DATA_DIR, 'operating-settings.json');

const defaults: OperatingSettings = {
  perTransferLimitUsd: 50_000,
  dailyLimitUsd: 250_000,
  approvalThresholdUsd: 10_000,
  autoAllocateTreasuryPct: 1,
  requireTotp: true,
  requireDualApproval: true,
  blockHighRiskCorridors: true,
  notifyOnSettlement: true,
  updatedAt: new Date(0).toISOString(),
};

function finiteNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function readOperatingSettings(): OperatingSettings {
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) as Partial<OperatingSettings>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

export function saveOperatingSettings(input: Partial<OperatingSettings>): OperatingSettings {
  const current = readOperatingSettings();
  const settings: OperatingSettings = {
    perTransferLimitUsd: finiteNumber(input.perTransferLimitUsd, current.perTransferLimitUsd, 1, 10_000_000),
    dailyLimitUsd: finiteNumber(input.dailyLimitUsd, current.dailyLimitUsd, 1, 100_000_000),
    approvalThresholdUsd: finiteNumber(input.approvalThresholdUsd, current.approvalThresholdUsd, 1, 10_000_000),
    autoAllocateTreasuryPct: finiteNumber(input.autoAllocateTreasuryPct, current.autoAllocateTreasuryPct, 0, 100),
    requireTotp: input.requireTotp ?? current.requireTotp,
    requireDualApproval: input.requireDualApproval ?? current.requireDualApproval,
    blockHighRiskCorridors: input.blockHighRiskCorridors ?? current.blockHighRiskCorridors,
    notifyOnSettlement: input.notifyOnSettlement ?? current.notifyOnSettlement,
    updatedAt: new Date().toISOString(),
  };
  if (settings.dailyLimitUsd < settings.perTransferLimitUsd) {
    throw new Error('Daily limit must be greater than or equal to the per-transfer limit.');
  }
  if (settings.approvalThresholdUsd > settings.perTransferLimitUsd) {
    throw new Error('Approval threshold cannot exceed the per-transfer limit.');
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporary = `${SETTINGS_PATH}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, SETTINGS_PATH);
  return settings;
}
