/**
 * Bundled sample invoice (fictional supplier) for the offline Reader and the
 * demo. The format is what `extractOffline` in reader.ts understands.
 * The account number is fictional; only its last four digits leave the Reader.
 */
export const SAMPLE_INVOICE_TEXT = `MANILA FREIGHT SERVICES INC.
Unit 1203, Pacific Star Building, Makati Avenue, Makati City 1226, Philippines
TIN: 000-123-456-000

COMMERCIAL INVOICE

Invoice No: INV-0412
Invoice Date: 2026-10-02
Due Date: 2026-10-30

Bill To: Selangor Trading Sdn Bhd, Petaling Jaya, Selangor, Malaysia

Description                                   Amount (PHP)
Sea freight, Port Klang to Manila (2 x 40ft HC)   480,000.00
Customs brokerage and port handling                 80,000.00

Amount Due: PHP 560,000.00

Payment details
Beneficiary: Manila Freight Services Inc.
Bank: BDO Unibank, Inc.
Account Number: 0021-8830-4471
SWIFT: BNORPHMM

Please pay by the due date. Thank you for your business.
`;

/** What the Reader must extract from SAMPLE_INVOICE_TEXT. */
export const SAMPLE_INVOICE_EXPECTED = {
  invoiceNumber: 'INV-0412',
  supplierName: 'Manila Freight Services Inc.',
  supplierBank: 'BDO Unibank, Inc.',
  supplierAccountLast4: '4471',
  amountPhpMinor: 56_000_000n,
  dueDate: '2026-10-30',
} as const;
