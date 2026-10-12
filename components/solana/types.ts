/** Wire shapes the Solana pages receive (bigint arrives as a decimal string). Types only. */
import type { Wire } from '@/lib/solana-app/json';
import type { invoiceView, orgSummary, paymentView, receiptView } from '@/lib/solana-app/service';

export type OrgDTO = Wire<Awaited<ReturnType<typeof orgSummary>>>;
export type PaymentDTO = Wire<Awaited<ReturnType<typeof paymentView>>>;
export type InvoiceDTO = Wire<ReturnType<typeof invoiceView>>;
export type ReceiptDTO = Wire<Awaited<ReturnType<typeof receiptView>>>;
export type RouteCardDTO = PaymentDTO['cards'][number];
export type ApprovalDTO = NonNullable<PaymentDTO['approval']>;
