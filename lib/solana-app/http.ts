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

export const schemas = {
  orgId: id('org'),
  createOrg: z.object({ companyName: z.string().min(2).max(120), personName: z.string().max(80).optional() }).strict(),
  challenge: z
    .object({
      orgId: id('org'),
      keys: z.array(z.object({ role: z.enum(['device', 'kit']), publicKey: base58 }).strict()).min(1).max(2),
    })
    .strict(),
  keys: z
    .object({
      orgId: id('org'),
      proofs: z
        .array(z.object({ role: z.enum(['device', 'kit']), publicKey: base58, nonce: z.string().regex(/^[0-9a-f]{64}$/), signature: base58 }).strict())
        .min(1)
        .max(2),
    })
    .strict(),
  orgOnly: z.object({ orgId: id('org') }).strict(),
  invoice: z
    .object({
      orgId: id('org'),
      sample: z.boolean().optional(),
      text: z.string().max(20_000).optional(),
      source: z.enum(['paste', 'upload']).optional(),
    })
    .strict()
    .refine((v) => v.sample === true || (typeof v.text === 'string' && v.text.trim().length > 0), { message: 'text or sample required' }),
  verifyBank: z
    .object({
      orgId: id('org'),
      by: z.string().min(1).max(80),
      method: z.enum(['call-back', 'supplier-account']),
      bank: z.string().min(2).max(120),
      accountLast4: z.string().regex(/^\d{4}$/),
    })
    .strict(),
  confirm: z
    .object({
      orgId: id('org'),
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
      confirmedBy: z.string().max(80).optional(),
    })
    .strict(),
  quote: z.object({ orgId: id('org'), invoiceId: id('inv') }).strict(),
  select: z
    .object({ orgId: id('org'), quoteId: z.string().regex(/^rq_[a-z0-9_]+$/).max(80), rehearsal: z.enum(['none', 'kyt_flag', 'partner_return']).optional() })
    .strict(),
  approve: z
    .object({
      orgId: id('org'),
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
};
