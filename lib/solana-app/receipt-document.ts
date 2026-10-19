/**
 * The receipt as a document (prompt 12 §5.2 and §5.4): who paid whom, how much, the rate, the references,
 * and a time table made only of recorded events. Built from the stored records, integers only: the one
 * sum is "you paid" split into converted plus fees, from the costs the executed quote recorded. The page
 * formats; nothing here formats money or dates.
 *
 * Pure: service.ts passes in the records (evidence, payment, invoice, company, the payment's state
 * changes), so this module reads no store and has no import cycle with it.
 */
import type { ApprovalRecord } from '../solana-evidence/bundle.ts';
import type { TransitionRecord } from './payment-repo.ts';
import { receiptNumber } from './receipt-number.ts';
import type { CompanyPlace, EvidenceRecord, InvoiceRecord, OrgRecord, PaymentRecord } from './store.ts';

export interface DocEvent {
  what: string;
  /** When it was recorded. A step with no recorded time is left out, never estimated. */
  at: string;
  by: string;
  evidence: string | null;
}

export interface DocRef {
  label: string;
  value: string;
  /** A real identifier (invoice number, payment id): set in mono. */
  mono: boolean;
}

export interface ReceiptDocument {
  number: string;
  issuedAt: string;
  kind: 'bank' | 'peer';
  testMode: boolean;
  /** The proof is recorded; recordedAt is when (the moment the root was recorded). */
  recorded: boolean;
  recordedAt: string | null;
  paidBy: { name: string; place: string | null; account: string | null };
  paidTo: { name: string; bank: string | null; last4: string | null; country: string | null; verifiedAt: string | null };
  received: { amountMinor: bigint; currency: 'PHP' | 'USD'; rail: string | null; bankReference: string | null };
  /** You paid = converted + fees; fees = Splash + partner + processing, as the quote recorded them. */
  paid: { amountMinor: bigint; convertedMinor: bigint; feesMinor: bigint; splashMinor: bigint; partnerMinor: bigint; processingMinor: bigint };
  rate: { value: string; test: boolean; lockedAt: string } | null;
  route: string | null;
  purpose: string | null;
  approver: { name: string; role: string; device: string } | null;
  refs: DocRef[];
  events: DocEvent[];
  rules: { passed: number; total: number } | null;
  proof: { fingerprint: string; root: string };
}

const ROLE: Record<ApprovalRecord['role'], string> = {
  admin_device: 'owner',
  approver_device: 'approver',
  recovery_kit_a: 'recovery kit',
  recovery_kit_b: 'recovery kit',
};

/** "6vTL…w9Ad": enough of an address or signature to match it, never the whole. */
export const shortKey = (k: string) => (k.length > 10 ? `${k.slice(0, 4)}…${k.slice(-4)}` : k);

const REGION = new Intl.DisplayNames(['en'], { type: 'region' });

/** "Kuala Lumpur, Wilayah Persekutuan, Malaysia" from the company's profile, or null when it has none. */
export function placeLine(place: CompanyPlace | null | undefined): string | null {
  if (!place) return null;
  let country: string | null = null;
  if (place.country && /^[A-Z]{2}$/.test(place.country)) country = REGION.of(place.country) ?? place.country;
  const parts = [place.city, place.state, country].filter((s): s is string => Boolean(s && s.trim()));
  return parts.length ? parts.join(', ') : null;
}

export function receiptDocument(input: {
  evidence: EvidenceRecord;
  payment: PaymentRecord;
  invoice: InvoiceRecord;
  org: OrgRecord;
  transitions: TransitionRecord[];
  partnerLabel: string;
  testMode: boolean;
}): ReceiptDocument {
  const { evidence: e, payment: p, invoice: inv, org, transitions, partnerLabel, testMode } = input;
  const b = e.bundle;
  const c = inv.confirmed!;
  const recorded = e.anchor.status === 'anchored';
  const approval = p.approvals.find((a) => a.action === 'approve') ?? p.approvals[0] ?? null;
  const approverName = approval ? (org.memberNames?.[approval.keyPublic] ?? approval.who) : null;

  let peerName: string | null = null;
  let received: ReceiptDocument['received'];
  let paid: ReceiptDocument['paid'];
  let rate: ReceiptDocument['rate'] = null;
  if (b.kindName === 'corridor_payout') {
    const q = b.quotedRoute;
    const fees = q.costs.splashMinor + q.costs.partnerMinor + q.costs.routeMinor;
    received = { amountMinor: q.netLocal.amountMinor, currency: 'PHP', rail: b.bank.rail, bankReference: b.bank.reference };
    paid = { amountMinor: q.source.amountMinor, convertedMinor: q.source.amountMinor - fees, feesMinor: fees, splashMinor: q.costs.splashMinor, partnerMinor: q.costs.partnerMinor, processingMinor: q.costs.routeMinor };
    rate = { value: q.fx.rate, test: testMode, lockedAt: q.fx.capturedAt };
  } else if (b.kindName === 'peer_transfer') {
    peerName = b.payee.name;
    received = { amountMinor: b.amount.amountMinor, currency: 'USD', rail: null, bankReference: null };
    paid = { amountMinor: b.amount.amountMinor, convertedMinor: b.amount.amountMinor, feesMinor: 0n, splashMinor: 0n, partnerMinor: 0n, processingMinor: 0n };
  } else {
    throw new Error(`receiptDocument: not a payment receipt (${b.kindName})`);
  }
  const peer = peerName !== null;

  const checks = p.approval?.policy.checks ?? [];
  const rules = checks.length ? { passed: checks.filter((x) => x.passed).length, total: checks.length } : null;
  const route = peer ? 'Inside Splash, no conversion' : p.approval ? `${p.approval.policyLabel}, paid out by ${received.rail ?? partnerLabel}` : null;
  const purpose = p.approval?.purpose ?? null;
  const bankLine = `${c.supplierBank} •••• ${c.supplierAccountLast4}`;
  const device = approval ? `${approval.keyPublic.slice(0, 4)}…` : null;

  // The time table: each row only when its moment was recorded.
  const events: DocEvent[] = [];
  const read = inv.source === 'sample' || inv.source === 'paste' || inv.source === 'upload';
  events.push(read
    ? { what: 'Invoice read and payment drafted', at: inv.createdAt, by: 'Zeke (draft only)', evidence: `invoice ${c.invoiceNumber}` }
    : { what: 'Payment drafted', at: inv.createdAt, by: c.confirmedBy, evidence: null });
  // The rules run when the route is chosen: the payment's last move to "checked" is that moment.
  const checked = [...transitions].reverse().find((t) => t.to === 'checked');
  if (checked && rules) events.push({ what: `Rules checked, ${rules.passed} of ${rules.total} passed`, at: checked.at, by: 'Splash rules', evidence: 'rule log' });
  if (p.timeline.approvedAt) events.push({ what: 'Approved', at: p.timeline.approvedAt, by: approverName ? `${approverName}, on their device` : 'On a device', evidence: device ? `approved on device ${device}` : null });
  if (p.timeline.sentAt) {
    const sent = p.signatures.find((s) => s.purpose === 'squads_vault_execute') ?? p.signatures.at(-1) ?? null;
    events.push({ what: 'Sent from the Payments account', at: p.timeline.sentAt, by: 'Payments account', evidence: sent ? `transaction ${shortKey(sent.signature)}` : null });
  }
  if (!peer && p.timeline.receivedAt) events.push({ what: 'Received by the payout partner', at: p.timeline.receivedAt, by: partnerLabel, evidence: 'partner confirmation' });
  const paidAt = peer ? (p.execution.confirmedAt ?? null) : (p.timeline.paidAt ?? null);
  if (paidAt) {
    events.push(peer
      ? { what: `Paid into ${peerName}’s Splash account`, at: paidAt, by: 'Splash', evidence: null }
      : { what: `Paid to ${bankLine}`, at: paidAt, by: received.rail ?? partnerLabel, evidence: received.bankReference });
  }
  if (recorded) events.push({ what: 'Proof recorded', at: e.createdAt, by: 'Splash evidence service', evidence: `root ${shortKey(e.batch.rootHex)}` });

  const refs: DocRef[] = [{ label: peer ? 'Reference' : 'Supplier invoice', value: c.invoiceNumber, mono: true }];
  if (purpose) refs.push({ label: peer ? 'Note' : 'Purpose', value: purpose, mono: false });
  if (route) refs.push({ label: 'Route', value: route, mono: false });
  refs.push({ label: 'Splash payment id', value: p.id, mono: true });
  if (approval && approverName && device) refs.push({ label: 'Approver', value: `${approverName} (${ROLE[approval.role]}), approved on device ${device}`, mono: false });

  return {
    number: receiptNumber(e.receiptId, b.receipt.issuedAt),
    issuedAt: b.receipt.issuedAt,
    kind: peer ? 'peer' : 'bank',
    testMode,
    recorded,
    recordedAt: recorded ? e.createdAt : null,
    paidBy: { name: org.companyName, place: placeLine(org.place), account: org.vault ? shortKey(org.vault.vaultPda) : null },
    paidTo: {
      name: peerName ?? c.supplierName,
      bank: peer ? null : c.supplierBank,
      last4: peer ? null : c.supplierAccountLast4,
      country: peer ? null : 'Philippines',
      // A business on Splash is paid into its own account: no bank details, so no call-back to show.
      verifiedAt: peer ? null : (c.bankDetailsVerified?.at ?? null),
    },
    received,
    paid,
    rate,
    route,
    purpose,
    approver: approval && approverName && device ? { name: approverName, role: ROLE[approval.role], device } : null,
    refs,
    events,
    rules,
    proof: { fingerprint: e.leafHex, root: e.batch.rootHex },
  };
}
