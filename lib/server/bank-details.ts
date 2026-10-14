import { randomBytes } from 'node:crypto';

import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

import { CHALLENGE_PREFIX } from '@/lib/solana/recovery-kit';
import { ServiceError } from '@/lib/solana-app/errors';
import { openForPayout } from '@/lib/solana-app/payout-number';
import { runtime } from '@/lib/solana-app/runtime';
import { getOrg } from '@/lib/solana-app/service';
import { store, type SupplierRecord } from '@/lib/solana-app/store';
import { kmsFromEnv, type Kms } from '@/lib/server/kms';
import { openNumber, sealNumber, VaultError } from '@/lib/server/pii-vault';

/**
 * A recipient's full bank account number, end to end (prompt 10 Phase S; decision 15):
 *
 *   save       sealed into bank_account_secrets; the recipient keeps only the record's id and last4.
 *              New details for a recipient are a new record; the old one is marked replaced, and the
 *              recipient can't be paid until a call-back passes again.
 *   invoice    the number printed on a supplier's invoice is sealed under the invoice's id when Zeke
 *              reads it (lib/solana-app/invoice-number.ts) and shown the same way (prompt 10 §6.2).
 *   reveal     a person: owner or finance admin (`admin`), a device approval made seconds ago (a
 *              server challenge signed by this member's device key, single use, 60 seconds), and the
 *              number shown for 30 seconds. Every attempt is logged, allowed or refused.
 *   payout     the payout path, only while it builds the partner's instruction.
 *   shred      a removed recipient's records are destroyed 30 days after its last payment settles.
 *
 * Zeke never: its context carries `•••• 4471`. Nothing here logs a number or puts one in an error.
 */

export const REVEAL_SECONDS = 30;
export const STEP_UP_SECONDS = 60;
export const SHRED_AFTER_DAYS = 30;

const kms = (): Kms => kmsFromEnv();

export function findSupplier(orgId: string, supplierId: string): SupplierRecord {
  const s = getOrg(orgId).suppliers.find((x) => x.id === supplierId);
  if (!s) throw new ServiceError('recipient_not_found', 'That recipient is not on your saved list.', 404);
  return s;
}

/* ── Save ─────────────────────────────────────────────────────────────── */

/**
 * Store a recipient's full number. The same number again changes nothing. A different one is a new
 * record and holds the recipient until a call-back passes (`markBankDetailsVerified`).
 */
export async function saveBankNumber(orgId: string, supplierId: string, input: { bankCode: string; accountNumber: string }, now = new Date()) {
  const supplier = findSupplier(orgId, supplierId);
  const sealed = await sealNumber(kms(), { orgId, beneficiaryId: supplierId, bankCode: input.bankCode, accountNumber: input.accountNumber });
  const secrets = runtime().secrets;
  const current = await secrets.current(orgId, supplierId);
  if (current && current.fingerprint === sealed.fingerprint) return { secretId: current.id, last4: current.last4, changed: false };
  const verifiedLast4 = supplier.accountLast4;
  const { secret, replaced } = await secrets.putCurrent({ orgId, beneficiaryId: supplierId, ...sealed }, now);
  supplier.secretId = secret.id;
  supplier.accountLast4 = secret.last4;
  // Details that change after they were verified are paid only after a new call-back (memo §6): a new
  // number replacing a stored one, or a first full number that isn't the account that was verified.
  const changed = replaced !== null || secret.last4 !== verifiedLast4;
  if (changed) supplier.pendingCallBack = { since: now.toISOString(), previousLast4: replaced?.last4 ?? verifiedLast4 };
  return { secretId: secret.id, last4: secret.last4, changed };
}

/** A call-back (or the supplier's own account page) confirmed the current details: payable again. */
export function markBankDetailsVerified(orgId: string, supplierId: string, by: string, method: 'call-back' | 'supplier-account', now = new Date()) {
  const supplier = findSupplier(orgId, supplierId);
  supplier.verified = { by, method, at: now.toISOString() };
  delete supplier.pendingCallBack;
  return supplier;
}

/* ── Payout ───────────────────────────────────────────────────────────── */

/**
 * The full number for the partner's payout instruction, read just in time and never stored with the
 * payment. Refused while changed details wait for their call-back.
 */
export async function bankNumberForPayout(orgId: string, supplierId: string): Promise<{ accountNumber: string; last4: string }> {
  return openForPayout(orgId, findSupplier(orgId, supplierId));
}

/* ── Reveal ───────────────────────────────────────────────────────────── */

export interface RevealActor {
  orgId: string;
  userId: string;
  isOwner: boolean;
  /** The workspace role on the users row: maker, checker, admin or viewer. */
  role?: string;
  /** This member's device key (base58), as account setup recorded it. */
  deviceKey: string | null;
}

/** Owner or finance admin. No new role (decision 15): `admin` is the existing membership role. */
export const mayRevealBankNumbers = (a: Pick<RevealActor, 'isOwner' | 'role'>) => a.isOwner || a.role === 'admin';

interface PendingReveal {
  orgId: string;
  userId: string;
  supplierId: string;
  publicKey: string;
  nonce: string;
  expiresAt: string;
}

const G = globalThis as typeof globalThis & { __splashRevealChallenges?: Map<string, PendingReveal> };
const pending = () => (G.__splashRevealChallenges ??= new Map());

/** The exact text the device signs. Domain-separated: it can never be a valid transaction. */
export function revealMessage(c: PendingReveal): Uint8Array {
  return new TextEncoder().encode(`${CHALLENGE_PREFIX}reveal\norg:${c.orgId}\nrecipient:${c.supplierId}\nuser:${c.userId}\nkey:${c.publicKey}\nnonce:${c.nonce}\nexpires:${c.expiresAt}`);
}

const REFUSAL_CODE: Record<number, 'not_authorized' | 'step_up_required' | 'recipient_not_found' | 'bank_number_unavailable' | 'bad_request'> = {
  400: 'bad_request',
  401: 'step_up_required',
  403: 'not_authorized',
  404: 'recipient_not_found',
  409: 'bank_number_unavailable',
};

/** Log a refused attempt to see a number, with its reason. Used here and by the route (a malformed request). */
export async function logRefusedReveal(actor: Pick<RevealActor, 'orgId' | 'userId'>, supplierId: string, secretId: string | null, reason: string, now = new Date()) {
  await runtime().secrets.logReveal({ orgId: actor.orgId, beneficiaryId: supplierId.slice(0, 80), secretId, userId: actor.userId, result: 'refused', reason, at: now });
}

async function refuse(actor: RevealActor, supplierId: string, secretId: string | null, reason: string, now: Date, status: number, message: string): Promise<never> {
  await logRefusedReveal(actor, supplierId, secretId, reason, now);
  throw new ServiceError(REFUSAL_CODE[status] ?? 'not_authorized', message, status);
}

/**
 * The recipient (`sup_…`), or an invoice whose printed number was sealed (`inv_…`, prompt 10 §6.2), or a
 * logged refusal: every attempt is in the reveal log, even one naming nobody.
 */
async function recipientOrRefuse(actor: RevealActor, subjectId: string, now: Date) {
  if (subjectId.startsWith('inv_')) {
    const inv = store().invoices.get(subjectId);
    if (!inv || inv.orgId !== actor.orgId || !inv.accountSecretId) await refuse(actor, subjectId, null, 'no such invoice number', now, 404, 'This invoice has no full account number on file.');
    return;
  }
  if (!getOrg(actor.orgId).suppliers.some((x) => x.id === subjectId)) await refuse(actor, subjectId, null, 'no such recipient', now, 404, 'That recipient is not on your saved list.');
}

/** Step 1: a challenge for this member's device, bound to this recipient. */
export async function revealChallenge(actor: RevealActor, supplierId: string, now = new Date()) {
  await recipientOrRefuse(actor, supplierId, now);
  if (!mayRevealBankNumbers(actor)) return refuse(actor, supplierId, null, `role ${actor.role ?? 'unknown'}`, now, 403, 'Only the owner or a finance admin can see a full account number.');
  if (!actor.deviceKey) return refuse(actor, supplierId, null, 'no device key', now, 409, 'Set up this device first: seeing a full number needs a device approval.');
  for (const [k, v] of pending()) if (Date.parse(v.expiresAt) < now.getTime()) pending().delete(k);
  const c: PendingReveal = { orgId: actor.orgId, userId: actor.userId, supplierId, publicKey: actor.deviceKey, nonce: randomBytes(32).toString('hex'), expiresAt: new Date(now.getTime() + STEP_UP_SECONDS * 1000).toISOString() };
  pending().set(c.nonce, c);
  await runtime().secrets.logReveal({ orgId: actor.orgId, beneficiaryId: supplierId, secretId: null, userId: actor.userId, result: 'challenged', reason: 'device approval asked', at: now });
  return { nonce: c.nonce, expiresAt: c.expiresAt, message: new TextDecoder().decode(revealMessage(c)) };
}

/** Step 2: the signed challenge, then the number, shown for 30 seconds. */
export async function revealBankNumber(actor: RevealActor, supplierId: string, proof: { nonce: string; signature: string }, now = new Date()) {
  await recipientOrRefuse(actor, supplierId, now);
  const secret = await runtime().secrets.current(actor.orgId, supplierId);
  const secretId = secret?.id ?? null;
  if (!mayRevealBankNumbers(actor)) return refuse(actor, supplierId, secretId, `role ${actor.role ?? 'unknown'}`, now, 403, 'Only the owner or a finance admin can see a full account number.');
  const c = pending().get(proof.nonce);
  // Single use: a challenge is gone after one try, right or wrong.
  pending().delete(proof.nonce);
  if (!c || c.orgId !== actor.orgId || c.userId !== actor.userId || c.supplierId !== supplierId) return refuse(actor, supplierId, secretId, 'no matching device approval', now, 401, 'Approve on this device first.');
  if (now.getTime() > Date.parse(c.expiresAt)) return refuse(actor, supplierId, secretId, 'device approval expired', now, 401, 'That approval expired. Approve on this device again.');
  if (!actor.deviceKey || actor.deviceKey !== c.publicKey) return refuse(actor, supplierId, secretId, 'device changed', now, 401, 'Approve on this device first.');
  let valid = false;
  try {
    const sig = bs58.decode(proof.signature);
    valid = sig.length === 64 && ed25519.verify(sig, revealMessage(c), bs58.decode(c.publicKey));
  } catch {
    valid = false;
  }
  if (!valid) return refuse(actor, supplierId, secretId, 'bad device signature', now, 401, 'The device approval did not check out. Try again.');
  if (!secret) return refuse(actor, supplierId, null, 'no full number on file', now, 404, supplierId.startsWith('inv_') ? 'This invoice has no full account number on file.' : 'This recipient has no full account number on file.');
  let accountNumber: string;
  try {
    accountNumber = await openNumber(kms(), secret, { orgId: actor.orgId, beneficiaryId: supplierId });
  } catch (e) {
    const reason = e instanceof VaultError ? e.code : 'could not open';
    return refuse(actor, supplierId, secretId, reason, now, 409, 'This number can’t be shown.');
  }
  await runtime().secrets.logReveal({ orgId: actor.orgId, beneficiaryId: supplierId, secretId, userId: actor.userId, result: 'revealed', reason: 'owner or finance admin, device approved', at: now });
  return { accountNumber, last4: secret.last4, expiresAt: new Date(now.getTime() + REVEAL_SECONDS * 1000).toISOString() };
}

/* ── Shred ────────────────────────────────────────────────────────────── */

/**
 * A recipient was removed: its records are destroyed 30 days after its last payment settled, or 30 days
 * from now if it was never paid.
 */
export async function scheduleShredForRemoved(orgId: string, removed: Pick<SupplierRecord, 'id' | 'name' | 'bank'>, now = new Date()): Promise<{ shredAfter: Date; records: number }> {
  const s = store();
  let lastSettled: number | null = null;
  for (const p of await runtime().payments.listByOrg(orgId)) {
    const inv = s.invoices.get(p.invoiceId);
    const c = inv?.confirmed;
    if (!c || c.supplierName !== removed.name || c.supplierBank !== removed.bank || !p.timeline.paidAt) continue;
    const at = Date.parse(p.timeline.paidAt);
    if (lastSettled === null || at > lastSettled) lastSettled = at;
  }
  const shredAfter = new Date((lastSettled ?? now.getTime()) + SHRED_AFTER_DAYS * 86_400_000);
  const records = await runtime().secrets.scheduleShred(orgId, removed.id, shredAfter);
  return { shredAfter, records };
}

/**
 * A bill set aside ("Not this one", prompt 10 §6.2): the number printed on it is destroyed 30 days
 * from now. Nothing was paid from it.
 */
export async function scheduleShredForInvoice(orgId: string, invoiceId: string, now = new Date()): Promise<number> {
  return runtime().secrets.scheduleShred(orgId, invoiceId, new Date(now.getTime() + SHRED_AFTER_DAYS * 86_400_000));
}

/** The daily job: destroy what is due. Safe to run twice. */
export async function shredDue(now = new Date()): Promise<{ shredded: number }> {
  const secrets = runtime().secrets;
  let shredded = 0;
  for (const r of await secrets.dueForShredAcrossCompanies(now)) if (await secrets.shred(r.id, now)) shredded++;
  return { shredded };
}
