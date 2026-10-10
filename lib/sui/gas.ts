export type SponsoredTransactionKind =
  | "business_account::submit_application"
  | "settlement::settle_batch"
  | "peg_monitor::update_peg"

export type SponsoredTransactionRequest = {
  kind: SponsoredTransactionKind
  sender: string
  payload: unknown
  userSignature?: string
}

export type SponsoredTransactionResult = {
  digest: string
  sponsored: boolean
  networkFee: "Sponsored"
  sponsor: "shinami" | "mock"
  latencyMs: number
  status: "success" | "queued"
}

export type ShinamiGasSponsor = {
  sponsorTransaction: (request: SponsoredTransactionRequest) => Promise<{
    sponsorSignature: string
    transactionBytes: string
  }>
  executeTransaction: (request: {
    transactionBytes: string
    userSignature: string
    sponsorSignature: string
  }) => Promise<{ digest: string }>
}

function createMockDigest(kind: SponsoredTransactionKind) {
  const seed = `${kind}:${Date.now()}`
  return `DEMO_SPONSORED_${createHash("sha256").update(seed).digest("hex").slice(0, 40)}`
}

export async function executeSponsoredTransaction(
  request: SponsoredTransactionRequest,
  sponsor?: ShinamiGasSponsor
): Promise<SponsoredTransactionResult> {
  const startedAt = performance.now()

  if (!sponsor || !request.userSignature) {
    if (process.env.USE_MOCK_APIS !== "true" && process.env.SUI_SETTLEMENT_MODE !== "simulate") {
      throw new Error(
        "Sponsored Sui execution is not configured. Provide a sponsor and user signature, or use the server-side operator signer for live protocol calls.",
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 400))

    return {
      digest: createMockDigest(request.kind),
      sponsored: true,
      networkFee: "Sponsored",
      sponsor: "mock",
      latencyMs: Math.round(performance.now() - startedAt),
      status: "success",
    }
  }

  const sponsored = await sponsor.sponsorTransaction(request)
  const executed = await sponsor.executeTransaction({
    transactionBytes: sponsored.transactionBytes,
    userSignature: request.userSignature,
    sponsorSignature: sponsored.sponsorSignature,
  })

  return {
    digest: executed.digest,
    sponsored: true,
    networkFee: "Sponsored",
    sponsor: "shinami",
    latencyMs: Math.round(performance.now() - startedAt),
    status: "success",
  }
}
import { createHash } from "node:crypto"
