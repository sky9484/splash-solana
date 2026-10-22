/**
 * Route-handler helpers for app/api/solana/**: zod-validated JSON in,
 * bigint-safe JSON out, and errors in the product's voice.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { scrubText } from '../server/log-scrub.ts';
import { ServiceError } from './errors.ts';
import { WALLET_ASSETS, WALLET_NETWORKS } from './funding-router.ts';
import { jsonResponse } from './json.ts';
import { getPayment } from './service.ts';

export async function readBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    const text = await request.text();
    raw = text.trim() === '' ? {} : JSON.parse(text);
  } catch {
    throw new ServiceError('bad_request', 'The request body is not valid JSON.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const where = parsed.error.issues.map((i) => i.path.join('.') || 'body').join(', ');
    throw new ServiceError('bad_request', `Some fields are missing or not valid: ${where}.`, 400);
  }
  return parsed.data;
}

export async function handle(fn: () => Promise<unknown> | unknown, status = 200): Promise<Response> {
  try {
    return jsonResponse(await fn(), { status });
  } catch (e) {
    if (e instanceof ServiceError) {
      return jsonResponse({ error: { code: e.code, message: e.message, ...(e.detail ? { detail: e.detail } : {}) } }, { status: e.status });
    }
    // The browser gets a fixed sentence and a reference; the detail (database, KMS or RPC text, which can
    // name tables, hosts or keys) stays in the server log under that reference (review finding, 16 Oct).
    // Scrubbed even there: an unexpected error must not carry a bank number (prompt 10 §S.1.6).
    const ref = `ERR-${randomUUID().slice(0, 8).toUpperCase()}`;
    console.error(`[api/solana] ${ref}`, scrubText(e instanceof Error ? (e.stack ?? e.message) : String(e)));
    return jsonResponse({ error: { code: 'server_error', message: `Something went wrong on the server. Try again; if it keeps happening, tell support reference ${ref}.` } }, { status: 500 });
  }
}

/** A payment belongs to one org; refuse requests that name another. */
export async function paymentFor(paymentId: string, orgId: string) {
  const p = await getPayment(paymentId);
  if (p.orgId !== orgId) throw new ServiceError('payment_not_found', 'That payment is not on the server for this company.', 404);
  return p;
}

const base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,88}$/);
const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9a-f]{16}$`));

/**
 * Request bodies. None carries an orgId: which company a request acts for comes from the session and
 * the membership row (lib/server/solana-company.ts), never from what the browser sends.
 */
export const schemas = {
  empty: z.object({}).strict(),
  invoice: z
    .object({
      sample: z.boolean().optional(),
      text: z.string().max(20_000).optional(),
      source: z.enum(['paste', 'upload']).optional(),
    })
    .strict()
    .refine((v) => v.sample === true || (typeof v.text === 'string' && v.text.trim().length > 0), { message: 'text or sample required' }),
  confirm: z
    .object({
      fields: z
        .object({
          invoiceNumber: z.string().max(64),
          supplierName: z.string().max(200),
          supplierBank: z.string().max(120),
          supplierAccountLast4: z.string().max(4),
          amountPhpMinor: z.string().regex(/^\d{1,15}$/),
          dueDate: z.string().max(10),
          einvoiceRef: z.string().max(64).nullable().optional(),
        })
        .strict(),
      confirmed: z.array(z.enum(['invoiceNumber', 'supplierName', 'supplierBank', 'supplierAccountLast4', 'amountPhpMinor', 'dueDate', 'einvoiceRef'])).max(7),
    })
    .strict(),
  quote: z.object({ invoiceId: id('inv'), allowShort: z.boolean().optional() }).strict(),
  requote: z.object({ allowShort: z.boolean().optional() }).strict(),
  fundingId: id('fnd'),
  /** Step 3 of a transfer: bring the route's USDC into the payments vault from outside the vaults. */
  fund: z
    .object({
      /** A route from lib/solana-app/funding-router.ts: 'bank_card', or 'wallet:<asset>:<network>'. */
      source: z.string().regex(new RegExp(`^(?:bank_card|wallet:(?:${WALLET_ASSETS.join('|')}):(?:${WALLET_NETWORKS.join('|')}))$`)),
      quoteId: z.string().regex(/^rq_[a-z0-9_]+$/).max(80),
      fromAddress: z.string().max(64).nullable().optional(),
      sourceOfFunds: z.enum(['business_revenue', 'owner_capital', 'loan_or_facility', 'customer_payment']),
      declared: z.literal(true),
      rehearsal: z.enum(['none', 'kyt_flag', 'kyt_unavailable']).optional(),
    })
    .strict(),
  /** Balance › Add money: an amount (US$, 6-decimal minor units) and the way in, with no payment attached. */
  topUp: z
    .object({
      source: z.string().regex(new RegExp(`^(?:bank_card|wallet:(?:${WALLET_ASSETS.join('|')}):(?:${WALLET_NETWORKS.join('|')}))$`)),
      amountMinor: z.string().regex(/^\d{1,16}$/),
      fromAddress: z.string().max(64).nullable().optional(),
      sourceOfFunds: z.enum(['business_revenue', 'owner_capital', 'loan_or_facility', 'customer_payment']),
      declared: z.literal(true),
      rehearsal: z.enum(['none', 'kyt_flag', 'kyt_unavailable']).optional(),
    })
    .strict(),
  select: z
    .object({ quoteId: z.string().regex(/^rq_[a-z0-9_]+$/).max(80), rehearsal: z.enum(['none', 'kyt_flag', 'partner_return']).optional() })
    .strict(),
  approve: z
    .object({
      signatures: z.array(z.object({ id: z.string().regex(/^m\d{1,2}$/), signature: base58 }).strict()).max(8).optional(),
    })
    .strict(),
  webhook: z
    .object({
      partnerId: z.string().max(64),
      paymentId: id('pay'),
      status: z.enum(['received', 'paid', 'returned']),
      bankReference: z.string().max(80).optional(),
      amountPhpMinor: z.string().regex(/^\d{1,15}$/),
      at: z.string().max(40),
      signature: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .strict(),
  receiptId: id('rcpt'),
  batchId: id('bat'),
  batchCreate: z
    .object({ csv: z.string().max(100_000).optional(), sample: z.boolean().optional() })
    .strict()
    .refine((v) => v.sample === true || (typeof v.csv === 'string' && v.csv.trim().length > 0), { message: 'csv or sample required' }),
  batchPrepare: z.object({ chunk: z.number().int().min(0).max(99).optional(), rehearsal: z.enum(['none', 'drop_chunk']).optional() }).strict(),
  batchApprove: z
    .object({ signatures: z.array(z.object({ id: z.string().regex(/^c\d{1,2}(p\d|x)$/), signature: base58 }).strict()).min(1).max(40) })
    .strict(),
  shareToken: z.string().regex(/^shr_[0-9a-f]{32}$/),
  /** A transfer with no invoice: who, how much (centavos), an optional reference, and the call-back for a new recipient. */
  transfer: z
    .object({
      /** A saved recipient, by id (prompt 10 §5.3). Or, as before, the details typed in. */
      recipientId: z.string().regex(/^sup_[0-9a-f-]{36}$/).optional(),
      recipient: z.object({ name: z.string().min(1).max(200), bank: z.string().min(1).max(120), accountLast4: z.string().max(4) }).strict().optional(),
      amountPhpMinor: z.string().regex(/^\d{1,15}$/),
      reference: z.string().max(64).nullable().optional(),
      verification: z.object({ by: z.string().min(1).max(80), method: z.enum(['call-back', 'supplier-account']) }).strict().nullable().optional(),
    })
    .strict()
    .refine((b) => (b.recipientId ? !b.recipient : Boolean(b.recipient)), { message: 'a saved recipient or the details, not both' }),
  invoiceId: id('inv'),
  /** A saved recipient to take off the verified list, by its id (prompt 10 §S.1.0). */
  supplierRemove: z.object({ id: z.string().regex(/^sup_[0-9a-f-]{36}$/) }).strict(),
  /** A new bank recipient (prompt 10 §5.3). The account number travels in this body only, once. */
  recipientCreate: z
    .object({
      name: z.string().min(1).max(120),
      kind: z.enum(['business', 'person']),
      registration: z.string().max(24).nullable().optional(),
      personId: z.string().max(40).nullable().optional(),
      bankCode: z.string().regex(/^[A-Z]{2,6}$/),
      accountNumber: z.string().min(1).max(32),
      accountNumberAgain: z.string().min(1).max(32),
      holderName: z.string().min(1).max(120),
      addressLine: z.string().min(1).max(160),
      city: z.string().min(1).max(80),
      check: z.discriminatedUnion('when', [z.object({ when: z.literal('now'), by: z.string().min(1).max(120) }).strict(), z.object({ when: z.literal('later') }).strict()]),
    })
    .strict(),
  /** "Let other Splash businesses find us" (prompt 10 §5.4). */
  directorySetting: z.object({ on: z.boolean(), handle: z.string().max(40).nullable().optional() }).strict(),
  /** A payment to another business on Splash: which business, how much (US$, minor), and a note. */
  peerTransfer: z
    .object({
      payeeOrgId: z.string().min(1).max(80),
      amountUsdMinor: z.string().regex(/^\d{1,15}$/),
      note: z.string().max(140).nullable().optional(),
      reference: z.string().max(64).nullable().optional(),
    })
    .strict(),
  /** "Record the call-back" on a bill (prompt 10 §6.2): who answered, and the number called from the company's own records. */
  callBack: z.object({ spokeTo: z.string().min(2).max(80), numberCalled: z.string().min(6).max(24) }).strict(),
  /** "Confirm and pay" a bill: the fields as checked (an invoice only) and which were ticked. A request from a Splash business sends {}. */
  payBill: z
    .object({
      fields: z
        .object({
          invoiceNumber: z.string().max(64),
          supplierName: z.string().max(200),
          supplierBank: z.string().max(120),
          supplierAccountLast4: z.string().max(4),
          amountPhpMinor: z.string().regex(/^\d{1,15}$/),
          dueDate: z.string().max(10),
          einvoiceRef: z.string().max(64).nullable().optional(),
        })
        .strict()
        .optional(),
      confirmed: z.array(z.enum(['invoiceNumber', 'supplierName', 'supplierBank', 'supplierAccountLast4', 'amountPhpMinor', 'dueDate', 'einvoiceRef'])).max(7).optional(),
    })
    .strict(),
  /** Get paid (prompt 10 §6.3): a new request. Lines are quantity × unit price, US$ minor units (6 decimals). */
  paymentRequest: z
    .object({
      payer: z.discriminatedUnion('kind', [
        // The business that pays, by its directory id; the requester is always the session's company.
        z.object({ kind: z.literal('splash'), payerOrgId: z.string().min(1).max(80) }).strict(),
        z.object({ kind: z.literal('external'), name: z.string().min(2).max(120), email: z.string().min(5).max(254) }).strict(),
      ]),
      number: z.string().min(1).max(32),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      lines: z
        .array(z.object({ description: z.string().min(1).max(120), quantity: z.string().regex(/^\d{1,6}$/), unitMinor: z.string().regex(/^\d{1,13}$/) }).strict())
        .min(1)
        .max(20),
      myInvoisRef: z.string().max(64).nullable().optional(),
      note: z.string().max(280).nullable().optional(),
      send: z.boolean(),
    })
    .strict(),
  /** "Save as template" on a paid transfer (prompt 10 §5.8). */
  templateSave: z.object({ paymentId: id('pay') }).strict(),
  /** The call-back on a recipient passed. */
  recipientVerify: z.object({ by: z.string().min(1).max(120) }).strict(),
  /** See a full bank number (prompt 10 §S.1.5): ask for a device challenge, then answer it. */
  reveal: z.discriminatedUnion('step', [
    z.object({ step: z.literal('challenge') }).strict(),
    z.object({ step: z.literal('reveal'), nonce: z.string().regex(/^[0-9a-f]{64}$/), signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/) }).strict(),
  ]),
  /** Step 3 of a transfer: the same details as last time for this recipient, or every answer given again. */
  transferDetails: z.union([
    z.object({ reuse: z.literal(true) }).strict(),
    z
      .object({
        details: z
          .object({
            purpose: z.enum(['goods', 'services']),
            description: z.string().max(140),
            relationship: z.enum(['supplier', 'related_company', 'contractor']),
            sourceOfFunds: z.enum(['business_revenue', 'owner_capital', 'loan_or_facility', 'customer_payment']),
            /** Optional for a saved recipient whose details were given in the "New bank recipient" sheet. */
            recipient: z
              .object({
                type: z.enum(['business', 'individual']),
                registrationNumber: z.string().max(40).nullable(),
                idNumber: z.string().max(40).nullable(),
                dateOfBirth: z.string().max(10).nullable(),
                addressLine1: z.string().max(160),
                addressCity: z.string().max(80),
                addressCountry: z.literal('PH'),
                accountName: z.string().max(140),
              })
              .strict()
              .optional(),
          })
          .strict(),
      })
      .strict(),
  ]),
  moveId: id('mov'),
  /** A move between the company's own vaults; amountMinor in USDC minor units. A retry names the failed move instead. */
  movePrepare: z.union([
    z.object({ from: z.enum(['treasury', 'payments']), amountMinor: z.string().regex(/^\d{1,15}$/) }).strict(),
    z.object({ retryMoveId: id('mov') }).strict(),
  ]),
  moveApprove: z
    .object({ signatures: z.array(z.object({ id: z.string().regex(/^(p\d|x)$/), signature: base58 }).strict()).min(1).max(4) })
    .strict(),
  /** Treasury (prompt 10 §7.4). T-bills are subscribed and redeemed; stocks are bought and sold. Whole cents. */
  treasuryOrder: z.union([
    z
      .object({
        asset: z.enum(['usdy', 'spy', 'qqq', 'nvda', 'googl', 'tsla']),
        kind: z.enum(['subscribe', 'redeem', 'buy', 'sell']),
        amountMinor: z.string().regex(/^\d{1,15}$/),
        path: z.enum(['market', 'ondo']).optional(),
      })
      .strict(),
    z.object({ sweepDraftId: z.string().regex(/^swp_[0-9a-f]{16}$/), path: z.enum(['market', 'ondo']).optional() }).strict(),
  ]),
  orderId: id('ord'),
  /** A sweep or quarter-interest draft (prompt 11 §4.3). */
  sweepDraftId: z.string().regex(/^swp_[0-9a-f]{16}$/),
  orderApprove: z.object({ signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/) }).strict(),
  sweepRule: z.object({ on: z.boolean(), cushionMinor: z.string().regex(/^\d{1,13}$/).optional() }).strict(),
  eligibility: z.object({ confirm: z.literal(true) }).strict(),
};
