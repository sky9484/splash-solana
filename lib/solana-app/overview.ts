/**
 * Overview, in one read (prompt 10 Phase 2): everything the screen shows, from the company's own
 * state, typed, integers only. The screen does no sums of its own; the money rules come from
 * lib/treasury/reserve.ts and "where a payment is" from stations.ts.
 *
 * What a finance manager opens it for, and where it answers:
 *   Can we pay what's due?        money (the three accounts, covered or short, waiting)
 *   What needs me?                needs (needs-you.ts)
 *   Where is our money right now? pipeline (this month's payments by station)
 *   Can I prove it?               recent (with receipts)
 *   What did it cost?             month (paid, fees, average all-in)
 *   Where can we pay, and within what rules? corridors, checks
 */
import { billHref } from '../dashboard/links.ts';
import { formatPhp, formatUsd } from '../solana-zeke/router.ts';
import { CORRIDORS } from '../solana-partner/registry.ts';
import { MOCK_RATE } from '../solana-partner/mock-partner.ts';
import { availableToInvest, isCovered, payablesDue, reserveFloor, sharesPct, shortfall, type Position } from '../treasury/reserve.ts';
import { needsYou, type NeedRow, type SetupIn } from './needs-you.ts';
import { isCommitted, type PaymentState } from './payment-machine.ts';
import { runtime } from './runtime.ts';
import { DEMO_LIMITS, getOrg, treasuryVaultPda } from './service.ts';
import { overdueRequests } from './requests.ts';
import { isMovingInto, pipelineFor, stationLabel, stationOf, type StationId } from './stations.ts';
import { isBill, store, type InvoiceRecord, type PaymentRecord } from './store.ts';

const DAY_MS = 86_400_000;
/** Above this a payment needs a second approver: a rule that isn't built yet, so it shows as Planned. */
export const SECOND_APPROVER_ABOVE_MINOR = 10_000_000_000n;

/** PHP centavos to US dollar minor units at the test rate, rounded up (a bill is never under-reserved). */
export function phpToUsdMinor(phpMinor: bigint, rate: string = MOCK_RATE): bigint {
  const [whole, frac = ''] = rate.split('.');
  const rateHundredths = BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2));
  // USD minor = PHP minor / 100 / (rate) * 1e6 = PHP minor * 1e6 / rateHundredths
  const num = phpMinor * 1_000_000n;
  return (num + rateHundredths - 1n) / rateHundredths;
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const monthKey = (iso: string) => iso.slice(0, 7);
const shortDate = (iso: string) => {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};
/** "Tuesday, 14 Oct". */
const longDay = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Asia/Kuala_Lumpur' });

/** A basis-point figure with two decimals of a percent, from integers: 27 bps → "0.27%". */
export function bpsText(bpsTimes100: bigint): string {
  const v = bpsTimes100 < 0n ? 0n : bpsTimes100;
  // bpsTimes100 is hundredths of a basis point; a percent is 100 bps.
  const hundredthsOfPct = (v + 50n) / 100n;
  return `${hundredthsOfPct / 100n}.${String(hundredthsOfPct % 100n).padStart(2, '0')}%`;
}

export interface OverviewInput {
  orgId: string;
  now?: Date;
  /** The company check (business verification) as the server read it (its lifecycle state); null when unreadable. */
  companyCheck: string | null;
  /** Account setup's steps that are not done yet (from lib/server/onboarding.ts), for "Needs you". */
  setupOpen: SetupIn[];
}

function invoiceOf(p: PaymentRecord): InvoiceRecord | undefined {
  return store().invoices.get(p.invoiceId);
}

/** Where a payment's stations come from: a bank payout, or a payment into a Splash business's account. */
const kindOfPayment = (p: PaymentRecord) => p.kind ?? 'bank';

/** Transfer follows every payment, an invoice's too (prompt 10 §6.2: one engine, one approval card). */
function payHref(p: PaymentRecord): string {
  return `/dashboard/transfer?payment=${p.id}`;
}

/** The status chip a payment shows: approval coral, warnings amber, proof ok, the rest ink. */
function tagFor(p: PaymentRecord): { tone: 'coral' | 'amber' | 'ok' | 'ink' | 'danger'; label: string } {
  const st = stationOf(p.state, kindOfPayment(p));
  if (st === 'waiting') return { tone: 'coral', label: 'Waiting approval' };
  if (st === 'recorded') return { tone: 'ok', label: 'Paid · proof recorded' };
  if (st === 'recording') return { tone: 'ok', label: 'Paid · recording proof' };
  if (st === 'paid') return { tone: 'ok', label: stationLabel('paid', kindOfPayment(p)) };
  if (st === 'stopped') return { tone: p.state === 'quote_expired' ? 'amber' : 'danger', label: p.state === 'quote_expired' ? 'Quote expired' : 'Stopped' };
  if (st === 'draft') return { tone: 'ink', label: 'Draft' };
  return { tone: 'ink', label: stationLabel(st) };
}

export async function overviewFor(input: OverviewInput) {
  const now = input.now ?? new Date();
  const org = getOrg(input.orgId);
  const rt = runtime();

  /* ── The accounts ───────────────────────────────────────────── */
  const paymentsMinor = org.vault ? await rt.chain.getUsdcBalance(org.vault.vaultPda) : 0n;
  const reserveMinor = org.vault ? await rt.chain.getUsdcBalance(treasuryVaultPda(org.vault.multisigPda)) : 0n;
  // Investments (vault #2) arrive in Phase 5; until then none, and the row says "Not set up yet".
  const investmentsMinor = 0n;
  const stocksMinor = 0n;

  const all = (await rt.payments.listByOrg(org.id)).filter((p) => p.state !== 'discarded');
  const sentFor = new Set(all.filter((p) => isCommitted(p.state as PaymentState)).map((p) => p.invoiceId));
  const waiting = all.filter((p) => p.state === 'checked' || p.state === 'proposed');
  const waitingMinor = waiting.reduce((n, p) => n + (p.approval?.youPayUsdcMinor ?? 0n), 0n);
  const approvedUnsentMinor = all.filter((p) => p.state === 'approved').reduce((n, p) => n + (p.approval?.youPayUsdcMinor ?? 0n), 0n);

  // Accepted bills: Zeke read them and a person checked them; not sent; due in the next 30 days.
  const horizon30 = utcDay(new Date(now.getTime() + 30 * DAY_MS));
  const horizon7 = utcDay(new Date(now.getTime() + 7 * DAY_MS));
  const bills = [...store().invoices.values()].filter((i) => i.orgId === org.id && isBill(i) && !i.dismissed);
  const accepted = bills.filter((i) => i.confirmed && !sentFor.has(i.id));
  const billsDue30 = accepted.filter((i) => i.confirmed!.dueDate && i.confirmed!.dueDate <= horizon30);
  const billsDueMinor = billsDue30.reduce((n, i) => n + phpToUsdMinor(i.confirmed!.amountPhpMinor), 0n);

  const position: Position = { paymentsMinor, reserveMinor, investmentsMinor, stocksMinor, approvedUnsentMinor, billsDueMinor, waitingMinor };
  const payables = payablesDue(position);
  const [pPct, rPct, iPct] = sharesPct([paymentsMinor, reserveMinor, investmentsMinor]);

  /* ── Needs you ──────────────────────────────────────────────── */
  const verifications = bills
    .filter((i) => i.bankStatus === 'changed' && !i.bankVerification && !sentFor.has(i.id))
    .map((i) => {
      const f = i.confirmed ?? i.draft.fields;
      return { invoiceId: i.id, supplierName: f.supplierName, bank: f.supplierBank, last4: f.supplierAccountLast4, href: billHref(i.id) };
    });
  const dueSoon = accepted
    .filter((i) => i.confirmed!.dueDate && i.confirmed!.dueDate <= horizon7)
    .map((i) => ({ supplierName: i.confirmed!.supplierName, dueDate: i.confirmed!.dueDate, dueLabel: shortDate(i.confirmed!.dueDate), amountPhpMinor: i.confirmed!.amountPhpMinor }));
  const needs = needsYou({
    now,
    approvals: waiting.map((p) => {
      const inv = invoiceOf(p);
      return {
        paymentId: p.id,
        supplierName: p.approval?.supplierName ?? inv?.confirmed?.supplierName ?? 'Payment',
        reference: inv?.confirmed?.invoiceNumber ?? null,
        theyGet: inv?.peer ? formatUsd(inv.peer.amountUsdMinor) : formatPhp(p.payout.amountPhpMinor),
        youPay: p.approval ? formatUsd(p.approval.youPayUsdcMinor) : null,
        quoteExpiresAt: p.approval?.quoteExpiresAt ?? null,
        href: payHref(p),
      };
    }),
    verifications,
    dueSoon,
    overdue: overdueRequests(org.id, now),
    sweep: null,
    setup: input.setupOpen,
    php: formatPhp,
  });
  const readToday = bills.filter((i) => utcDay(new Date(i.createdAt)) === utcDay(now)).length;

  /* ── This month: the pipeline, what was paid, what it cost ──── */
  const month = monthKey(now.toISOString());
  const thisMonth = all.filter((p) => monthKey(p.createdAt) === month);
  const pipeline = pipelineFor('bank').map((id: StationId) => {
    const here = thisMonth.filter((p) => stationOf(p.state, kindOfPayment(p)) === id);
    return {
      id,
      label: stationLabel(id),
      count: here.length,
      amountPhpMinor: here.reduce((n, p) => n + p.payout.amountPhpMinor, 0n),
      /** Coins on the wire into this station: payments are moving into it right now. */
      moving: isMovingInto(id) && here.length > 0,
      href: `/dashboard/history?station=${id}`,
    };
  });
  const paid = thisMonth.filter((p) => ['paid', 'recording', 'recorded'].includes(stationOf(p.state, kindOfPayment(p))));
  const paidUsdMinor = paid.reduce((n, p) => n + (p.approval?.youPayUsdcMinor ?? 0n), 0n);
  const verified = paid.filter((p) => p.state === 'anchored').length;
  const fees = paid.reduce(
    (acc, p) => {
      const c = p.approval?.costs;
      if (!c) return acc;
      const fee = c.routeMinor + c.partnerMinor + c.splashMinor;
      return { splash: acc.splash + c.splashMinor, partner: acc.partner + c.partnerMinor, route: acc.route + c.routeMinor, fee: acc.fee + fee, ticket: acc.ticket + (p.approval!.youPayUsdcMinor - fee) };
    },
    { splash: 0n, partner: 0n, route: 0n, fee: 0n, ticket: 0n },
  );

  /* ── Recent payments ───────────────────────────────────────── */
  const recent = [...all]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, 5)
    .map((p) => {
      const inv = invoiceOf(p);
      const st = stationOf(p.state, kindOfPayment(p));
      return {
        id: p.id,
        name: p.approval?.supplierName ?? inv?.confirmed?.supplierName ?? 'Payment',
        reference: inv?.confirmed?.invoiceNumber ?? null,
        date: shortDate(p.createdAt),
        theyGetPhpMinor: p.payout.amountPhpMinor,
        /** A payment to a Splash business: what landed in its account, US$ (no PHP). */
        theyGetUsdMinor: inv?.peer ? inv.peer.amountUsdMinor : null,
        youPaidUsdMinor: p.approval?.youPayUsdcMinor ?? null,
        tag: tagFor(p),
        receiptHref: p.receiptId ? `/dashboard/receipts/${p.receiptId}` : null,
        reviewHref: st === 'waiting' || st === 'draft' || st === 'stopped' ? payHref(p) : null,
      };
    });

  /* ── Checks and limits ──────────────────────────────────────── */
  const usedToday = org.dailyDebits[utcDay(now)] ?? 0n;
  const check = input.companyCheck;
  // Shown only as read: Verified for ACTIVE and nothing else (never the gate's own default).
  const companyCheck =
    check === 'ACTIVE'
      ? { tone: 'ok' as const, label: 'Verified' }
      : check === 'KYB_SUBMITTED' || check === 'KYB_PROVIDER_APPROVED' || check === 'KYB_ADMIN_APPROVED'
        ? { tone: 'amber' as const, label: 'In review' }
        : check === 'REJECTED'
          ? { tone: 'danger' as const, label: 'Needs attention' }
          : check === 'SUSPENDED'
            ? { tone: 'danger' as const, label: 'Suspended' }
            : check === 'REGISTERED'
              ? { tone: 'ink' as const, label: 'Not started' }
              : { tone: 'ink' as const, label: 'Not read' };

  return {
    today: longDay(now),
    needsCount: needs.total,
    money: {
      totalMinor: paymentsMinor + reserveMinor + investmentsMinor,
      paymentsMinor,
      reserveMinor,
      investmentsMinor,
      investmentsSetUp: false,
      shares: { payments: pPct, reserve: rPct, investments: iPct },
      payablesDueMinor: payables,
      floorMinor: reserveFloor(payables),
      covered: isCovered(position),
      shortMinor: shortfall(position),
      waitingMinor,
      availableMinor: availableToInvest(position).totalMinor,
    },
    needs: { rows: needs.rows as NeedRow[], more: needs.more as NeedRow[], total: needs.total, readToday },
    pipeline,
    month: {
      paidUsdMinor,
      paidCount: paid.length,
      verifiedCount: verified,
      fees: paid.length && fees.ticket > 0n
        ? { totalMinor: fees.fee, splashMinor: fees.splash, partnerMinor: fees.partner, processingMinor: fees.route, avgAllIn: bpsText((fees.fee * 1_000_000n) / fees.ticket) }
        : null,
    },
    recent,
    corridors: CORRIDORS.map((c) => ({ route: c.route, detail: c.detail, status: c.status })),
    checks: {
      companyCheck,
      perPaymentMinor: DEMO_LIMITS.perPaymentUsdcMinor,
      dailyMinor: DEMO_LIMITS.dailyUsdcMinor,
      usedTodayMinor: usedToday,
      secondApproverAboveMinor: SECOND_APPROVER_ABOVE_MINOR,
      secondApproverBuilt: false,
    },
  };
}

export type Overview = Awaited<ReturnType<typeof overviewFor>>;
