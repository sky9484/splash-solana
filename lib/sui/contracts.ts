import { Transaction } from "@mysten/sui/transactions"

import {
  CONTRACT_MAX_FEE_BPS,
  FALLBACK_FEE_BPS,
  getCorridorFeeBps,
} from "@/lib/fx/corridors"
import { getContractConfig } from "@/lib/server/contract-config"
import { executeSponsoredTransaction } from "@/lib/sui/gas"

function clampFeeBps(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return FALLBACK_FEE_BPS
  }
  return Math.min(Math.floor(value), CONTRACT_MAX_FEE_BPS)
}

export function buildUpdatePriceTx(usdcPrice: number, usdtPrice: number): Transaction {
  const cfg = getContractConfig();
  const usdcDevPpm = Math.max(0, Math.round(Math.abs(usdcPrice - 1.0) * 1_000_000));
  const usdtDevPpm = Math.max(0, Math.round(Math.abs(usdtPrice - 1.0) * 1_000_000));

  const tx = new Transaction();
  tx.moveCall({
    target: `${cfg.packageId}::peg_monitor::update_peg`,
    arguments: [
      tx.object(cfg.pegStateId),
      tx.object(cfg.adminCapId),
      tx.pure.u64(usdcDevPpm),
      tx.pure.u64(usdtDevPpm),
      tx.object('0x6'),
    ],
  });

  return tx;
}

export type KybApplicationInput = {
  ssmNumber: string
  kybCid?: string
  owner?: string
}

export type BatchPayment = {
  employeeName: string
  wallet: string
  amountUsd: number
  status: "Ready" | "Queued" | "Executed"
}

export async function submitBusinessApplication(input: KybApplicationInput) {
  return executeSponsoredTransaction({
    kind: "business_account::submit_application",
    sender: input.owner ?? "0xmerchant",
    payload: {
      module: "splash_core::business_account",
      function: "submit_application",
      arguments: [input.ssmNumber, input.kybCid ?? "ipfs://pending"],
    },
  })
}

export function buildSubmitBusinessApplicationTx(input: Required<Pick<KybApplicationInput, "ssmNumber" | "kybCid">>) {
  const cfg = getContractConfig()
  const tx = new Transaction()

  tx.moveCall({
    // business_account is a splash_core module.
    target: `${cfg.corePackageId || cfg.packageId}::business_account::submit_application`,
    arguments: [
      tx.pure.string(input.ssmNumber),
      tx.pure.string(input.kybCid),
      // Phase 6: the account carries a 24h payout window, whose first bucket
      // is stamped at creation. `0x6` is the shared Clock.
      tx.object('0x6'),
    ],
  })

  return tx
}

export async function executeBatchSettlement(
  payments: BatchPayment[],
  options: { targetCurrency?: string; feeBps?: number } = {},
) {
  const feeBps = clampFeeBps(
    typeof options.feeBps === "number"
      ? options.feeBps
      : options.targetCurrency
        ? getCorridorFeeBps(options.targetCurrency)
        : undefined,
  )

  return executeSponsoredTransaction({
    kind: "settlement::settle_batch",
    sender: "0xmerchant",
    payload: {
      module: "splash_custody::settlement",
      function: "settle_batch",
      businessAccount: "0xbusiness_account",
      feeBps,
      targetCurrency: options.targetCurrency,
      payments: payments.map((payment) => ({
        recipient: payment.wallet,
        amountMist: Math.round(payment.amountUsd * 1_000_000),
      })),
    },
  })
}
