/** Wire shapes the Solana screens receive (bigint arrives as a decimal string). Types only. */
import type { Wire } from '@/lib/solana-app/json';
import type { invoiceView, orgSummary, paymentView, receiptView } from '@/lib/solana-app/service';

export type OrgDTO = Wire<Awaited<ReturnType<typeof orgSummary>>>;
/** GET /api/solana/company: the signed-in member's company, and who is asking. */
export type CompanyDTO = OrgDTO & {
  me: {
    personName: string;
    isOwner: boolean;
    /** This member's device key on record, or null before setup. */
    deviceKey: string | null;
    /** Where that key sits in this browser's IndexedDB. */
    keyId: string;
    /** The device is a member of the vault, so it can approve. */
    canApprove: boolean;
  };
};
export type PaymentDTO = Wire<Awaited<ReturnType<typeof paymentView>>>;
export type InvoiceDTO = Wire<ReturnType<typeof invoiceView>>;
export type ReceiptDTO = Wire<Awaited<ReturnType<typeof receiptView>>>;
export type RouteCardDTO = PaymentDTO['cards'][number];
export type ApprovalDTO = NonNullable<PaymentDTO['approval']>;

/* A transfer's Step 3: the partner's details, and how the USDC reaches the payments vault. */
import type { fundingOptions, fundingView } from '@/lib/solana-app/funding-service';
import type { DETAILS_OPTIONS, detailsView } from '@/lib/solana-app/transfer-details';
export type FundingOptionsDTO = Wire<Awaited<ReturnType<typeof fundingOptions>>>;
export type FundingDTO = Wire<ReturnType<typeof fundingView>>;
export type DetailsDTO = Wire<NonNullable<ReturnType<typeof detailsView>>>;
export type DetailsOptionsDTO = typeof DETAILS_OPTIONS;
