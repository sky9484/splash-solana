/**
 * Route-handler helpers for app/api/solana/**: zod-validated JSON in,
 * bigint-safe JSON out, and errors in the product's voice.
 */
import { z } from 'zod';

import { ServiceError } from './errors.ts';
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
    const message = e instanceof Error ? e.message : String(e);
    console.error('[api/solana]', e);
    return jsonResponse({ error: { code: 'server_error', message: `Something went wrong on the server: ${message}` } }, { status: 500 });
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
  verifyBank: z
    .object({
      by: z.string().min(1).max(80),
      method: z.enum(['call-back', 'supplier-account']),
      bank: z.string().min(2).max(120),
      accountLast4: z.string().regex(/^\d{4}$/),
    })
    .strict(),
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
      method: z.enum(['wallet_usdc', 'wallet_swap', 'stripe', 'airwallex']),
      quoteId: z.string().regex(/^rq_[a-z0-9_]+$/).max(80),
      asset: z.enum(['USDC', 'USDT', 'PYUSD', 'USD']).optional(),
      fromAddress: z.string().max(64).nullable().optional(),
      sourceOfFunds: z.enum(['business_revenue', 'owner_capital', 'loan_or_facility', 'customer_payment']),
      declared: z.literal(true),
      rehearsal: z.enum(['none', 'kyt_flag']).optional(),
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
      recipient: z.object({ name: z.string().min(1).max(200), bank: z.string().min(1).max(120), accountLast4: z.string().max(4) }).strict(),
      amountPhpMinor: z.string().regex(/^\d{1,15}$/),
      reference: z.string().max(64).nullable().optional(),
      verification: z.object({ by: z.string().min(1).max(80), method: z.enum(['call-back', 'supplier-account']) }).strict().nullable().optional(),
    })
    .strict(),
  invoiceId: id('inv'),
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
              .strict(),
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
};
