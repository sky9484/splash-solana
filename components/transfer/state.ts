/**
 * The retired transfer wizard's state, from the build before Solana. The wizard (components/transfer/Step*.tsx) is no longer
 * on any page: /dashboard/transfer is the Solana pay flow (components/solana/transfer/TransferFlow.tsx). Kept only
 * until the source-level tests that still read these files are retired with them.
 */
import type { TravelRulePayment } from './TravelRuleFields';
import type { FundingSelection } from '@/lib/funding/registry';
import type { RecipientTier, TravelRuleBeneficiary } from '@/lib/server/operations';

export type TransferState = {
  step: 1 | 2 | 3 | 4 | 5;
  invoiceId?: string;
  recipient: {
    name: string;
    country: 'MY' | 'PH' | 'ID' | 'SG' | 'VN' | 'TH' | 'EU' | 'GB';
    rail: 'bank';
    bank?: { swift: string; account: string };
    /** The FATF R.16 beneficiary half. What each corridor requires comes
     *  from `lib/compliance/travel-rule.ts`, not from this type. */
    travelRule?: TravelRuleBeneficiary;
  };
  /** Context belonging to the payment rather than the beneficiary:
   *  purpose, source of funds, relationship. */
  travelRulePayment?: TravelRulePayment;
  amount: { value: string; sourceCurrency: 'USD'; targetCurrency: 'MYR' | 'PHP' | 'IDR' | 'SGD' | 'VND' | 'THB' | 'EUR' | 'GBP' };
  quote?: { fxRate: number; netReceived: string; fee: string };
  funding: {
    selection: FundingSelection;
    sessionId?: string;
    sessionStatus?: string;
    depositAddress?: string;
    qrDataUrl?: string | null;
    demoMode?: boolean;
  };
  txDigest?: string;
  txStatus?: 'pending' | 'success' | 'failed';
  transferIntentId?: string;
  receiptObjectId?: string;
  paymentIntentId?: string;
  intentCreateDigest?: string;
  walrusBlobId?: string;
  auditAnchorId?: string;
  composedActions?: Array<{
    kind: 'paid' | 'allocated' | 'anchored';
    label: string;
    eventType: string;
    data: Record<string, unknown>;
  }>;
  deliveryTier: RecipientTier;
  rateHold?: {
    id: string;
    corridorCurrency: string;
    rate: string;
    feeBps: number;
    holdUntil: string;
    state: 'ACTIVE' | 'EXECUTED' | 'EXPIRED' | 'CANCELLED';
  };
};
