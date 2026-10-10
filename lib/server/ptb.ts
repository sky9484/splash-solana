/**
 * Real composed-PTB entry points.
 *
 * Kept as a small compatibility module for callers that historically imported
 * `lib/server/ptb`. The implementation lives beside the operator signer in
 * `sui-settlement.ts`; no fabricated digests are returned from this module.
 */
export {
  anchorAuditHashOnSui,
  confirmComposedPaymentOnSui,
  createPaymentIntentOnSui,
  type ComposedAction,
  type ComposedSettlementResult,
} from '@/lib/server/sui-settlement';
