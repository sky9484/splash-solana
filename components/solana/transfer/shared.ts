/**
 * Transfer's shared words, shapes and small helpers (prompt 10 Phase 3). Formatting only: every
 * amount arrives from the server as integer minor units in a decimal string, and leaves it that way.
 */
import type { listRecipients } from '@/lib/server/bank-recipients';
import type { DirectoryHit } from '@/lib/server/splash-directory';
import type { Wire } from '@/lib/solana-app/json';
import type { Estimate } from '@/lib/solana-app/transfer-estimate';

import { ApiError, php, usd } from '../client';

export type To = 'bank' | 'splash';
export type StepId = 'recipient' | 'amount' | 'quote' | 'approve' | 'track';
export const STEP_ORDER: readonly StepId[] = ['recipient', 'amount', 'quote', 'approve', 'track'];
export const STEP_LABEL: Record<StepId, string> = { recipient: 'Recipient', amount: 'Amount', quote: 'Quote & send', approve: 'Approve', track: 'Track' };

export type RecipientsDTO = Wire<Awaited<ReturnType<typeof listRecipients>>>;
export type RecipientRow = RecipientsDTO['recipients'][number];
export type BankOption = RecipientsDTO['banks'][number];
export type DetailsOptions = RecipientsDTO['detailsOptions'];
export type Payee = DirectoryHit;
export type EstimateDTO = Wire<Estimate>;

/** What Step 2 hands to Step 3: the amount and, for a bank, what the payout partner asks. */
export interface AmountDraft {
  /** Bank: what they receive, PHP centavos. */
  phpMinor: string | null;
  /** What you send: before fees for a bank, the whole payment for a business on Splash. 6-decimal US$. */
  usdMinor: string;
  reference: string;
  purpose: 'goods' | 'services';
  description: string;
  relationship: 'supplier' | 'related_company' | 'contractor' | null;
  sourceOfFunds: 'business_revenue' | 'owner_capital' | 'loan_or_facility' | 'customer_payment' | null;
  /** A business on Splash: on both receipts. */
  note: string;
}

export type Problem = { code: string; message: string; detail?: Record<string, unknown> };

export function problemOf(e: unknown): Problem {
  if (e instanceof ApiError) return { code: e.code, message: e.message, detail: e.detail };
  return { code: 'error', message: e instanceof Error ? e.message : String(e) };
}

const SUFFIX = /^(?:inc\.?|incorporated|corp\.?|corporation|co\.?|company|ltd\.?|limited|llc|plc|sdn|bhd\.?|services|trading|enterprises?)$/i;

/** "Manila Freight Services" → "Manila Freight": how a title names a business (never shorter than one word). */
export function shortName(name: string): string {
  const words = name.trim().split(/\s+/);
  while (words.length > 1 && SUFFIX.test(words[words.length - 1]!)) words.pop();
  return words.join(' ');
}

const COUNTRIES: Record<string, string> = { MY: 'Malaysia', PH: 'Philippines', SG: 'Singapore', ID: 'Indonesia', VN: 'Vietnam', TH: 'Thailand' };

/** "MY" → "Malaysia"; a name already spelled out stays as it is. */
export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  return COUNTRIES[code.toUpperCase()] ?? code;
}

/** "₱287,000" when there are no centavos, "₱287,000.50" when there are. */
export function phpWhole(minor: string | bigint): string {
  const s = php(minor);
  return s.endsWith('.00') ? s.slice(0, -3) : s;
}

/** "US$5,000" when there are no cents. */
export function usdWhole(minor: string | bigint): string {
  const s = usd(minor);
  return s.endsWith('.00') ? s.slice(0, -3) : s;
}


/** The typed text of an amount ("287,000.50") → minor units, or null for nothing or zero. String math only. */
export function minorFromTyped(text: string, decimals: 2 | 6): string | null {
  const s = text.replace(/,/g, '').trim();
  if (!/^\d+(?:\.\d{0,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const cents = `${whole}${frac.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  const minor = decimals === 2 ? cents : `${cents}0000`.replace(/^0+(?=\d)/, '');
  return /^0+$/.test(minor) ? null : minor;
}

/** Minor units → what the amount field shows ("287,000.00" → "287,000"; cents kept when there are any). */
export function typedFromMinor(minor: string | null, decimals: 2 | 6): string {
  if (!minor) return '';
  const cents = decimals === 2 ? BigInt(minor) : BigInt(minor) / 10_000n;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = cents % 100n;
  return frac === 0n ? whole : `${whole}.${frac.toString().padStart(2, '0')}`;
}

/** Build a Transfer URL from the current one: `?to=bank&step=quote&payment=pay_…`. */
export function transferHref(current: URLSearchParams, next: { to?: To | null; step?: StepId | null; payment?: string | null; recipient?: string | null }): string {
  const sp = new URLSearchParams(current.toString());
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) continue;
    if (v === null) sp.delete(k);
    else sp.set(k, v);
  }
  const q = sp.toString();
  return `/dashboard/transfer${q ? `?${q}` : ''}`;
}
