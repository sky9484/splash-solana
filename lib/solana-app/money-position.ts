/**
 * Where the company's money stands, in the shared money rules' terms (prompt 10 §2.4): the three
 * accounts, what is waiting for approval, approved and not yet sent, and the accepted bills due in the
 * next 30 days. Overview and Treasury read it here, so they never disagree. Integers only.
 */
import { treasuryVaultPda } from './service.ts';
import { isCommitted, type PaymentState } from './payment-machine.ts';
import { runtime } from './runtime.ts';
import { isBill, store, type InvoiceRecord, type OrgRecord, type PaymentRecord } from './store.ts';
import { MOCK_RATE } from '../solana-partner/mock-partner.ts';
import type { Position } from '../treasury/reserve.ts';

const DAY_MS = 86_400_000;
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** PHP centavos to US dollar minor units at the test rate, rounded up (a bill is never under-reserved). */
export function phpToUsdMinor(phpMinor: bigint, rate: string = MOCK_RATE): bigint {
  const [whole, frac = ''] = rate.split('.');
  const rateHundredths = BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2));
  // USD minor = PHP minor / 100 / (rate) * 1e6 = PHP minor * 1e6 / rateHundredths
  const num = phpMinor * 1_000_000n;
  return (num + rateHundredths - 1n) / rateHundredths;
}

export interface Payables {
  all: PaymentRecord[];
  sentFor: Set<string>;
  waiting: PaymentRecord[];
  waitingMinor: bigint;
  approvedUnsentMinor: bigint;
  bills: InvoiceRecord[];
  /** Checked, not yet paid. */
  accepted: InvoiceRecord[];
  billsDue30: InvoiceRecord[];
  billsDueMinor: bigint;
}

/** Payments and bills, as the reserve rules count them. */
export async function payablesOf(org: OrgRecord, now: Date): Promise<Payables> {
  const all = (await runtime().payments.listByOrg(org.id)).filter((p) => p.state !== 'discarded');
  const sentFor = new Set(all.filter((p) => isCommitted(p.state as PaymentState)).map((p) => p.invoiceId));
  const waiting = all.filter((p) => p.state === 'checked' || p.state === 'proposed');
  const waitingMinor = waiting.reduce((n, p) => n + (p.approval?.youPayUsdcMinor ?? 0n), 0n);
  const approvedUnsentMinor = all.filter((p) => p.state === 'approved').reduce((n, p) => n + (p.approval?.youPayUsdcMinor ?? 0n), 0n);
  // Accepted bills: Zeke read them and a person checked them; not sent; due in the next 30 days.
  const horizon30 = utcDay(new Date(now.getTime() + 30 * DAY_MS));
  const bills = [...store().invoices.values()].filter((i) => i.orgId === org.id && isBill(i) && !i.dismissed);
  const accepted = bills.filter((i) => i.confirmed && !sentFor.has(i.id));
  const billsDue30 = accepted.filter((i) => i.confirmed!.dueDate && i.confirmed!.dueDate <= horizon30);
  // A request from a Splash business is in US dollars already; an invoice is in pesos.
  const billsDueMinor = billsDue30.reduce((n, i) => n + (i.request && i.peer ? i.peer.amountUsdMinor : phpToUsdMinor(i.confirmed!.amountPhpMinor)), 0n);
  return { all, sentFor, waiting, waitingMinor, approvedUnsentMinor, bills, accepted, billsDue30, billsDueMinor };
}

/** The Payments account (vault #0) and the Reserve (vault #1), read from the chain. */
export async function accountBalances(org: OrgRecord): Promise<{ paymentsMinor: bigint; reserveMinor: bigint }> {
  if (!org.vault) return { paymentsMinor: 0n, reserveMinor: 0n };
  const chain = runtime().chain;
  return { paymentsMinor: await chain.getUsdcBalance(org.vault.vaultPda), reserveMinor: await chain.getUsdcBalance(treasuryVaultPda(org.vault.multisigPda)) };
}

/** The reserve rules' Position, given the investments' value. */
export function positionFrom(p: { paymentsMinor: bigint; reserveMinor: bigint; investmentsMinor: bigint; stocksMinor: bigint }, payables: Pick<Payables, 'approvedUnsentMinor' | 'billsDueMinor' | 'waitingMinor'>): Position {
  return { ...p, approvedUnsentMinor: payables.approvedUnsentMinor, billsDueMinor: payables.billsDueMinor, waitingMinor: payables.waitingMinor };
}
