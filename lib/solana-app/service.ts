/**
 * The Solana pay flow, server side. Orchestrates the built layers; holds no
 * key that can move client money (I-1) and never auto-executes (I-4):
 *
 *   createOrg → issueChallenges / registerKeys (proof of possession)
 *   → createVault (Squads builder, chain().sendSponsored through the Kora check)
 *   → fund (offline: simulator faucet; devnet: address + faucet link)
 *   → readInvoiceDraft (Zeke Reader, draft only) → verifyBank → confirmInvoice
 *   → quote (mock partner quotes → quoteRoutes; Zeke Router explains)
 *   → selectRoute (evaluatePolicy → approval card from deterministic fields, I-6)
 *   → prepareApproval (unsigned Squads proposal + execute transactions)
 *   → submitApproval (the browser's device-key signatures; refused without them)
 *   → observeDeposit → receivePartnerWebhook (HMAC verified, deduped)
 *   → buildEvidence (bundle, batch, memo anchor) → receipt
 *
 * Every chain call goes through `runtime().chain`, which is `chain()`: the
 * offline simulator by default, DevnetChain with SPLASH_SOLANA_MODE=devnet.
 */
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import bs58 from 'bs58';

import { explorerAddressUrl, explorerTxUrl, usdcMint } from '../solana/config.ts';
import { buildDepositForBurnInstruction } from '../solana/cctp-v2-solana.ts';
import { utcDay } from '../solana/kora.ts';
import { buildMemoInstruction, buildPayoutInstructions, buildSplashFeeInstructions, buildSplashMemo, getAssociatedTokenAddress } from '../solana/payout.ts';
import { createPossessionChallenge, verifyPossession } from '../solana/recovery-kit.ts';
import { SolanaSimulator, simulatedSignature } from '../solana/simulator.ts';
import {
  buildCreateVaultInstruction,
  buildSponsoredTransaction,
  buildVaultExecuteInstruction,
  buildVaultProposal,
  deriveProposalAddresses,
  groupProposalTransactions,
  MAX_TRANSACTION_BYTES,
} from '../solana/squads.ts';
import type { ConfirmedInvoice, InvoiceFields, PartnerPayoutEvent, Policy, RouteQuote } from '../solana/types.ts';
import { quoteRoutes, POLICIES } from '../route-engine/index.ts';
import { createKytStub, evaluatePolicy, TIER_LIMITS, type EnginePolicyResult } from '../route-engine/policy.ts';
import { isQuoteExpired, routeKindOf, type RouteKind } from '../route-engine/quote.ts';
import { signWebhook } from '../solana-partner/mock-partner.ts';
import { assertAttesterIsolated, buildMemoAnchor } from '../solana-evidence/anchor.ts';
import { buildCorridorPayoutBundle, buildEvidenceBatch, bundleLeafHex, computeInvoiceCommitment, type ChainSignatureRecord } from '../solana-evidence/bundle.ts';
import { canonicalJson } from '../solana-evidence/canonical.ts';
import { anchoredRootFromMemo, verifyBundle, type VerifyResult } from '../solana-evidence/verify.ts';
import { assertDraftOnly, assertRouterRefersToEngineQuote } from '../solana-zeke/guard.ts';
import { InvoiceFieldsSchema, readInvoice, ReaderError, type InvoiceFieldName } from '../solana-zeke/reader.ts';
import { explainRoutes } from '../solana-zeke/router.ts';
import { SAMPLE_INVOICE_TEXT } from '../solana-zeke/fixtures/sample-invoice.ts';

import { ServiceError } from './errors.ts';
import { runtime, splashKeys } from './runtime.ts';
import {
  store,
  type ApprovalCard,
  type BankVerification,
  type EvidenceRecord,
  type InvoiceRecord,
  type OrgRecord,
  type PaymentRecord,
  type PreparedMessage,
  type Rehearsal,
} from './store.ts';

/* ------------------------------------------------------------------ constants */

/** Demo company limits, shown on the policy page. Tier "advanced" with a lower per-payment cap. */
export const DEMO_TIER = 'advanced' as const;
export const DEMO_LIMITS = { perPaymentUsdcMinor: 20_000_000_000n, dailyUsdcMinor: TIER_LIMITS.advanced.dailyUsdcMinor };
/** Offline faucet amount: 25,000 test USDC. */
export const OFFLINE_FUND_MINOR = 25_000_000_000n;
export const CIRCLE_FAUCET_URL = 'https://faucet.circle.com/';

const POLICY_LABEL: Record<Policy, string> = { cheapest: 'Cheapest', fastest: 'Fastest', safest: 'Safest' };

export const CHECK_LABELS: Record<string, string> = {
  tier: 'Business tier verified',
  per_payment_limit: 'Within the US$20,000 per-payment limit',
  daily_limit: 'Within the US$100,000 daily limit',
  kyt: 'Wallet screening (stub, not a real screening)',
  duplicate_invoice: 'Invoice not paid before',
  quote_expiry: 'Quote still valid',
  bank_details_verified: 'Bank details verified',
  amount_covers_invoice: 'Supplier receives the full invoice amount',
};

/* ------------------------------------------------------------------ helpers */

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  return bytesToHex(b);
}

const nowIso = (now = new Date()) => now.toISOString();

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromB64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'));
}

function bpsOf(minor: bigint, ticket: bigint): number {
  if (ticket <= 0n) return 0;
  return Number((minor * 1_000_000n) / ticket) / 100;
}

export function getOrg(orgId: string): OrgRecord {
  const org = store().orgs.get(orgId);
  if (!org) throw new ServiceError('org_not_found', 'This demo company is not on the server. The demo resets when the server restarts. Start again from onboarding.', 404);
  return org;
}

function getInvoice(orgId: string, invoiceId: string): InvoiceRecord {
  const inv = store().invoices.get(invoiceId);
  if (!inv || inv.orgId !== orgId) throw new ServiceError('invoice_not_found', 'That invoice is not on the server. Start the payment again.', 404);
  return inv;
}

export function getPayment(paymentId: string): PaymentRecord {
  const p = store().payments.get(paymentId);
  if (!p) throw new ServiceError('payment_not_found', 'That payment is not on the server. The demo resets when the server restarts.', 404);
  return p;
}

function requireVault(org: OrgRecord) {
  if (!org.vault) throw new ServiceError('vault_missing', 'Create your vault first.', 409);
  return org.vault;
}

function arrivalOf(q: RouteQuote): { words: string; rail: string } {
  const partner = q.steps.find((s) => s.kind === 'partner');
  const rail = partner?.provider.split('·').pop()?.trim() ?? '';
  if (rail === 'PESONet') return { words: 'Same banking day, PESONet', rail };
  if (rail === 'InstaPay') return { words: 'Within minutes, InstaPay', rail };
  return { words: 'Arrival depends on the bank', rail };
}

function laneOf(kind: RouteKind): { line: string; solNote: string; routeLabel: string } {
  if (kind === 'solana_direct') return { line: 'From Solana balance · direct', solNote: "You don't need SOL", routeLabel: 'Direct on Solana' };
  if (kind === 'cctp_v2_fast') return { line: 'From Solana balance · CCTP V2 Fast to Polygon', solNote: 'Needs 0.01 SOL in the vault (test pending)', routeLabel: 'CCTP V2 Fast Transfer to Polygon' };
  return { line: 'From Solana balance · CCTP V2 to Polygon', solNote: 'Needs 0.01 SOL in the vault (test pending)', routeLabel: 'CCTP V2 to Polygon' };
}

function findQuote(p: PaymentRecord, quoteId: string): RouteQuote | null {
  for (const policy of POLICIES) {
    const hit = p.engine.ranked[policy].find((q) => q.id === quoteId);
    if (hit) return hit;
  }
  return null;
}

/** HMAC(orgSalt, canonical invoice fields): deterministic per invoice (duplicate check), disclosable alone. */
function invoiceSalt(org: OrgRecord, fields: InvoiceFields): Uint8Array {
  return hmac(sha256, hexToBytes(org.saltHex), utf8ToBytes(canonicalJson({ ...fields, einvoiceRef: fields.einvoiceRef })));
}

/* ------------------------------------------------------------------ onboarding */

export function createOrg(input: { companyName: string; personName?: string }): OrgRecord {
  const companyName = input.companyName.trim();
  if (companyName.length < 2 || companyName.length > 120) throw new ServiceError('bad_request', 'Enter your company name (2 to 120 characters).');
  const org: OrgRecord = {
    id: `org_${randomHex(8)}`,
    companyName,
    personName: (input.personName ?? '').trim() || 'Finance manager',
    createdAt: nowIso(),
    saltHex: randomHex(32),
    challenges: {},
    keys: {},
    suppliers: [],
    dailyDebits: {},
    seenCommitments: [],
    fundings: [],
  };
  store().orgs.set(org.id, org);
  return org;
}

export function issueChallenges(orgId: string, keys: Array<{ role: 'device' | 'kit'; publicKey: string }>, now = new Date()) {
  const org = getOrg(orgId);
  if (org.vault) throw new ServiceError('vault_exists', 'This company already has a vault. Its members cannot be changed.', 409);
  return keys.map((k) => {
    let c;
    try {
      c = createPossessionChallenge(org.id, k.publicKey, now);
    } catch (e) {
      throw new ServiceError('bad_request', `That ${k.role === 'kit' ? 'recovery kit' : 'device'} key is not a valid public key.`, 400, { reason: (e as Error).message });
    }
    org.challenges[c.nonce] = { ...c, role: k.role };
    return { role: k.role, ...c };
  });
}

export async function registerKeys(orgId: string, proofs: Array<{ role: 'device' | 'kit'; publicKey: string; nonce: string; signature: string }>, now = new Date()) {
  const org = getOrg(orgId);
  const rt = runtime();
  for (const proof of proofs) {
    const challenge = org.challenges[proof.nonce];
    if (!challenge || challenge.role !== proof.role) throw new ServiceError('possession_failed', 'That key check is unknown or already used. Start the key step again.', 400);
    const result = await verifyPossession(challenge, proof.publicKey, proof.signature, rt.nonces, now);
    if (!result.ok) {
      throw new ServiceError('possession_failed', `The ${proof.role === 'kit' ? 'recovery kit' : 'device key'} check failed (${result.reason}). Nothing was saved. Try the key step again.`, 400);
    }
    delete org.challenges[proof.nonce];
    org.keys[proof.role] = { publicKey: proof.publicKey, provenAt: nowIso(now) };
  }
  if (org.keys.device && org.keys.kit && org.keys.device.publicKey === org.keys.kit.publicKey) {
    throw new ServiceError('bad_request', 'The device key and the recovery kit must be different keys.');
  }
  return { device: org.keys.device ?? null, kit: org.keys.kit ?? null };
}

export async function createVault(orgId: string) {
  const org = getOrg(orgId);
  if (org.vault) throw new ServiceError('vault_exists', 'This company already has a vault.', 409);
  if (!org.keys.device || !org.keys.kit) throw new ServiceError('keys_missing', 'Save your recovery kit and create the device key first.', 409);
  const rt = runtime();
  const feePayer = await rt.chain.getFeePayer();
  const createKey = Keypair.generate(); // signs the create once, then dropped; it gains no authority
  const plan = buildCreateVaultInstruction({
    mode: 'solo',
    members: [
      { role: 'admin_device', publicKey: org.keys.device.publicKey },
      { role: 'recovery_kit_a', publicKey: org.keys.kit.publicKey },
    ],
    createKey: createKey.publicKey,
    feePayer,
    treasury: await rt.chain.getSquadsTreasury(),
    splashKeys: await splashKeys(rt),
  });
  const tx = buildSponsoredTransaction(feePayer, [plan.instruction], await rt.chain.getLatestBlockhash());
  tx.sign([createKey]);
  const receipt = await rt.chain.sendSponsored(tx, { orgId: org.id });
  const onChain = await rt.chain.getMultisig(plan.multisigPda);
  if (onChain && onChain.configAuthority !== null) throw new ServiceError('send_failed', 'The vault was created with a config authority. Stop and contact support.', 500);
  org.vault = { ...plan.vault, createdAt: nowIso(), signature: receipt.signature, simulated: receipt.simulated, cluster: receipt.cluster };
  return org.vault;
}

/* ------------------------------------------------------------------ funding and summary */

export async function fund(orgId: string) {
  const org = getOrg(orgId);
  const vault = requireVault(org);
  const rt = runtime();
  if (!(rt.chain instanceof SolanaSimulator)) {
    throw new ServiceError('devnet_fund_manual', 'On devnet, send test USDC to your vault from the Circle faucet.', 409, {
      vaultAddress: vault.vaultPda,
      faucetUrl: CIRCLE_FAUCET_URL,
    });
  }
  const receipt = await rt.chain.fundUsdc(vault.vaultPda, OFFLINE_FUND_MINOR);
  org.fundings.push({ signature: receipt.signature, amountMinor: OFFLINE_FUND_MINOR, at: nowIso(), simulated: true, note: 'Test USDC (simulated)' });
  return { receipt, balanceMinor: await rt.chain.getUsdcBalance(vault.vaultPda) };
}

export async function orgSummary(orgId: string) {
  const org = getOrg(orgId);
  const rt = runtime();
  const balanceMinor = org.vault ? await rt.chain.getUsdcBalance(org.vault.vaultPda) : 0n;
  const payments = [...store().payments.values()]
    .filter((p) => p.orgId === org.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((p) => {
      const inv = store().invoices.get(p.invoiceId);
      return {
        id: p.id,
        status: p.status,
        supplierName: inv?.confirmed?.supplierName ?? '',
        amountPhpMinor: p.payout.amountPhpMinor,
        receiptId: p.receiptId,
        createdAt: p.createdAt,
      };
    });
  const inFlight = payments.filter((p) => p.status === 'SENT' || p.status === 'PARTNER_RECEIVED');
  return {
    org: { id: org.id, companyName: org.companyName, personName: org.personName, createdAt: org.createdAt },
    mode: rt.env.mode,
    cluster: rt.env.cluster,
    simulated: rt.env.mode === 'offline',
    keys: { device: org.keys.device?.publicKey ?? null, kit: org.keys.kit?.publicKey ?? null },
    vault: org.vault
      ? {
          ...org.vault,
          usdcTokenAccount: getAssociatedTokenAddress(usdcMint(rt.env.cluster), new PublicKey(org.vault.vaultPda)).toBase58(),
          explorerUrl: rt.env.mode === 'devnet' ? explorerAddressUrl(org.vault.vaultPda, rt.env.cluster) : null,
        }
      : null,
    /** The payable total is exactly the sum of the parts. Only the Solana lane exists in this build. */
    balance: { totalMinor: balanceMinor, parts: [{ lane: 'Solana', amountMinor: balanceMinor }], inFlightCount: inFlight.length },
    fundings: org.fundings,
    suppliers: org.suppliers.map((x) => ({ name: x.name, bank: x.bank, accountLast4: x.accountLast4, verifiedAt: x.verified.at, method: x.verified.method })),
    limits: { perPaymentUsdcMinor: DEMO_LIMITS.perPaymentUsdcMinor, dailyUsdcMinor: DEMO_LIMITS.dailyUsdcMinor, usedTodayUsdcMinor: org.dailyDebits[utcDay(new Date())] ?? 0n },
    payments,
    faucetUrl: rt.env.mode === 'devnet' ? CIRCLE_FAUCET_URL : null,
  };
}

/* ------------------------------------------------------------------ invoice */

function bankStatusFor(org: OrgRecord, fields: InvoiceFields): { status: InvoiceRecord['bankStatus']; known: BankVerification | null } {
  const sameName = org.suppliers.filter((s) => s.name.toLowerCase() === fields.supplierName.toLowerCase());
  const exact = sameName.find((s) => s.bank === fields.supplierBank && s.accountLast4 === fields.supplierAccountLast4);
  if (exact) return { status: 'known', known: exact.verified };
  return { status: sameName.length > 0 ? 'changed' : 'new', known: null };
}

export async function readInvoiceDraft(orgId: string, input: { text?: string; sample?: boolean; source?: 'paste' | 'upload' }) {
  const org = getOrg(orgId);
  const rt = runtime();
  const text = input.sample ? SAMPLE_INVOICE_TEXT : (input.text ?? '');
  // Offline: never call a model (no network). Devnet runs may use ANTHROPIC_API_KEY if set.
  const env = rt.env.mode === 'offline' ? {} : process.env;
  let draft;
  try {
    draft = await readInvoice({ text }, { env });
  } catch (e) {
    if (e instanceof ReaderError) {
      throw new ServiceError('reader_failed', `Zeke couldn't read this invoice: ${e.message}. Check the text, or use the sample invoice.`, 422);
    }
    throw e;
  }
  assertDraftOnly(draft);
  const { status } = bankStatusFor(org, draft.fields);
  const inv: InvoiceRecord = {
    id: `inv_${randomHex(8)}`,
    orgId: org.id,
    createdAt: nowIso(),
    source: input.sample ? 'sample' : (input.source ?? 'paste'),
    draft,
    bankStatus: status,
    bankVerification: null,
    confirmed: null,
    saltHex: null,
  };
  store().invoices.set(inv.id, inv);
  return { invoice: inv, text };
}

export function verifyBank(orgId: string, invoiceId: string, input: { by: string; method: 'call-back' | 'supplier-account'; bank: string; accountLast4: string }) {
  getOrg(orgId);
  const inv = getInvoice(orgId, invoiceId);
  if (inv.confirmed) throw new ServiceError('wrong_state', 'This invoice is already confirmed.', 409);
  if (!/^\d{4}$/.test(input.accountLast4)) throw new ServiceError('bad_request', 'Account ending must be 4 digits.');
  inv.bankVerification = { by: input.by.trim() || 'Finance manager', method: input.method, at: nowIso(), bank: input.bank, accountLast4: input.accountLast4 };
  return inv.bankVerification;
}

export function confirmInvoice(
  orgId: string,
  invoiceId: string,
  input: { fields: Record<string, string>; confirmed: string[]; confirmedBy?: string },
): ConfirmedInvoice {
  const org = getOrg(orgId);
  const inv = getInvoice(orgId, invoiceId);
  if (inv.confirmed) return inv.confirmed;
  const missing = inv.draft.needsConfirmation.filter((f) => !input.confirmed.includes(f));
  if (missing.length) throw new ServiceError('fields_unconfirmed', `Tick every field to confirm it. Still to check: ${missing.join(', ')}.`, 422, { missing });
  let amount: bigint;
  try {
    amount = BigInt(input.fields.amountPhpMinor ?? '');
  } catch {
    throw new ServiceError('bad_request', 'The amount is not a valid number.');
  }
  const candidate = {
    invoiceNumber: (input.fields.invoiceNumber ?? '').trim(),
    supplierName: (input.fields.supplierName ?? '').trim(),
    supplierBank: (input.fields.supplierBank ?? '').trim(),
    supplierAccountLast4: (input.fields.supplierAccountLast4 ?? '').trim(),
    amountPhpMinor: amount,
    dueDate: (input.fields.dueDate ?? '').trim(),
    ...(input.fields.einvoiceRef ? { einvoiceRef: input.fields.einvoiceRef.trim() } : {}),
  };
  const parsed = InvoiceFieldsSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ServiceError('bad_request', `Some fields are not valid: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}.`, 422);
  }
  const fields = parsed.data as InvoiceFields;
  const { status, known } = bankStatusFor(org, fields);
  let bankDetailsVerified: ConfirmedInvoice['bankDetailsVerified'] = null;
  if (status === 'known' && known) bankDetailsVerified = { by: known.by, method: 'existing-record', at: known.at };
  else if (inv.bankVerification && inv.bankVerification.bank === fields.supplierBank && inv.bankVerification.accountLast4 === fields.supplierAccountLast4) {
    bankDetailsVerified = { by: inv.bankVerification.by, method: inv.bankVerification.method, at: inv.bankVerification.at };
  }
  const salt = invoiceSalt(org, fields);
  const confirmed: ConfirmedInvoice = {
    ...fields,
    confirmedBy: input.confirmedBy?.trim() || org.personName,
    confirmedAt: nowIso(),
    commitmentHex: computeInvoiceCommitment(fields, salt),
    bankDetailsVerified,
  };
  inv.confirmed = confirmed;
  inv.saltHex = bytesToHex(salt);
  inv.bankStatus = status;
  return confirmed;
}

/* ------------------------------------------------------------------ quote and route */

export async function quote(orgId: string, invoiceId: string, opts: { now?: Date; paymentId?: string } = {}): Promise<PaymentRecord> {
  const org = getOrg(orgId);
  const vault = requireVault(org);
  const inv = getInvoice(orgId, invoiceId);
  if (!inv.confirmed) throw new ServiceError('fields_unconfirmed', 'Confirm the invoice fields first.', 409);
  const rt = runtime();
  const now = opts.now ?? new Date();
  const paymentId = opts.paymentId ?? `pay_${randomHex(8)}`;
  const amountPhpMinor = inv.confirmed.amountPhpMinor;
  const partnerQuotes = (['solana', 'polygon'] as const).map((network) => rt.partner.quote({ amountPhpMinor }, { network, now }));
  const payout = rt.partner.createPayout({
    paymentId,
    amountPhpMinor,
    expectedUsdcMinor: partnerQuotes[0]!.grossUsdcMinor,
    beneficiary: { bank: inv.confirmed.supplierBank, accountLast4: inv.confirmed.supplierAccountLast4 },
    now,
  });
  const deposits = Object.fromEntries(payout.deposits.map((d) => [d.network, d.address]));
  const balance = await rt.chain.getUsdcBalance(vault.vaultPda);
  const engine = quoteRoutes({
    paymentId,
    amount: { amountPhpMinor },
    senderBalanceUsdcMinor: balance,
    partner: rt.partner.entry,
    partnerQuotes,
    deposits,
    // No Fast Transfer fee is read offline (it comes from Circle's API), so no Fast candidate.
    now,
    homeChain: 'solana',
  });
  if (!POLICIES.some((p) => engine.picks[p])) {
    const short = engine.excluded.some((e) => e.reason === 'insufficient_balance');
    if (short) throw new ServiceError('insufficient_balance', 'Your Solana balance is too low for this invoice. Add USDC to your vault, then get a new quote.', 409);
    throw new ServiceError('no_route', 'No route can pay this invoice right now. Try again in a minute.', 409);
  }
  const allQuotes = POLICIES.flatMap((p) => engine.ranked[p]);
  const router = explainRoutes({ picks: engine.picks, ranked: engine.ranked, homeLane: engine.homeLane, selected: 'cheapest' });
  assertRouterRefersToEngineQuote(router, allQuotes);

  const existing = store().payments.get(paymentId);
  const record: PaymentRecord = existing
    ? { ...existing, engine, router, payout, status: 'QUOTED', selectedQuoteId: null, policy: null, approval: null, prepared: null, problem: null }
    : {
        id: paymentId,
        orgId: org.id,
        invoiceId: inv.id,
        createdAt: nowIso(now),
        status: 'QUOTED',
        payout,
        engine,
        router,
        selectedQuoteId: null,
        policy: null,
        approval: null,
        rehearsal: 'none',
        prepared: null,
        signatures: [],
        approvals: [],
        partnerEvents: [],
        timeline: {},
        executedRoute: null,
        receiptId: null,
        problem: null,
      };
  store().payments.set(paymentId, record);
  return record;
}

export async function requote(paymentId: string, now = new Date()) {
  const p = getPayment(paymentId);
  if (p.status !== 'QUOTED' && p.status !== 'AWAITING_APPROVAL' && p.status !== 'POLICY_DENIED') {
    throw new ServiceError('wrong_state', 'This payment has already been sent. It cannot be re-quoted.', 409);
  }
  return quote(p.orgId, p.invoiceId, { now, paymentId: p.id });
}

function runPolicy(p: PaymentRecord, q: RouteQuote, now: Date): EnginePolicyResult {
  const org = getOrg(p.orgId);
  const inv = getInvoice(p.orgId, p.invoiceId);
  return evaluatePolicy({
    tier: DEMO_TIER,
    limits: DEMO_LIMITS,
    quote: q,
    invoice: inv.confirmed!,
    usedTodayUsdcMinor: org.dailyDebits[utcDay(now)] ?? 0n,
    seenCommitments: new Set(org.seenCommitments),
    kyt: createKytStub(p.rehearsal === 'kyt_flag' ? [q.target.depositAddress] : []),
    now,
  });
}

function buildApprovalCard(p: PaymentRecord, q: RouteQuote, policy: EnginePolicyResult): ApprovalCard {
  const org = getOrg(p.orgId);
  const inv = getInvoice(p.orgId, p.invoiceId);
  const c = inv.confirmed!;
  const ticket = p.engine.fees[q.id]?.ticketUsdcMinor ?? 0n;
  const kind = routeKindOf(q);
  const lane = laneOf(kind);
  const arrival = arrivalOf(q);
  const covers = policy.extraChecks.find((x) => x.name === 'amount_covers_invoice');
  const checks = [...policy.checks, ...policy.extraChecks].map((x) => ({ name: x.name, label: CHECK_LABELS[x.name] ?? x.name, passed: x.passed, detail: x.detail }));
  return {
    paymentId: p.id,
    quoteId: q.id,
    supplierName: c.supplierName,
    bank: c.supplierBank,
    accountLast4: c.supplierAccountLast4,
    verified: c.bankDetailsVerified,
    receivePhpMinor: q.netLocal.amountMinor,
    youPayUsdcMinor: q.source.amountMinor,
    costs: {
      allInBps: q.costs.allInBps,
      routeMinor: q.costs.routeMinor,
      partnerMinor: q.costs.partnerMinor,
      splashMinor: q.costs.splashMinor,
      routeBps: bpsOf(q.costs.routeMinor, ticket),
      partnerBps: bpsOf(q.costs.partnerMinor, ticket),
      splashBps: bpsOf(q.costs.splashMinor, ticket),
    },
    arrives: arrival.words,
    laneNote: lane.solNote,
    routeLabel: lane.routeLabel,
    policyLabel: POLICY_LABEL[q.policy],
    invoiceNumber: c.invoiceNumber,
    einvoiceRef: c.einvoiceRef ?? null,
    invoiceMatched: covers?.passed === true,
    quoteExpiresAt: q.expiresAt,
    aboveTarget: q.flags.includes('above_target'),
    policy: { allowed: policy.allowed, checks, kytLabel: policy.kyt.label },
    signerPublicKey: org.keys.device!.publicKey,
    simulated: runtime().env.mode === 'offline',
  };
}

export function selectRoute(paymentId: string, input: { quoteId: string; rehearsal?: Rehearsal }, now = new Date()): PaymentRecord {
  const p = getPayment(paymentId);
  if (p.status !== 'QUOTED' && p.status !== 'AWAITING_APPROVAL' && p.status !== 'POLICY_DENIED') {
    throw new ServiceError('wrong_state', 'This payment has already been approved.', 409);
  }
  const q = findQuote(p, input.quoteId);
  if (!q) throw new ServiceError('bad_request', 'That route is not one of this payment’s quotes. Get a new quote.', 400);
  const rt = runtime();
  p.rehearsal = rt.env.mode === 'offline' ? (input.rehearsal ?? 'none') : 'none';
  const policy = runPolicy(p, q, now);
  p.selectedQuoteId = q.id;
  p.policy = policy;
  p.approval = buildApprovalCard(p, q, policy);
  p.prepared = null;
  p.status = policy.allowed ? 'AWAITING_APPROVAL' : 'POLICY_DENIED';
  p.problem = policy.allowed ? null : problemFromPolicy(policy);
  return p;
}

function problemFromPolicy(policy: EnginePolicyResult): { code: string; message: string } {
  const failed = new Set([...policy.checks, ...policy.extraChecks].filter((c) => !c.passed).map((c) => c.name));
  if (failed.has('kyt')) return { code: 'kyt_flagged', message: `Screening flagged this supplier's wallet. Payment blocked. Contact support with reference ${policy.kyt.resultId}.` };
  if (failed.has('quote_expiry')) return { code: 'quote_expired', message: 'Quote expired before you approved. Refresh to get a new quote.' };
  if (failed.has('duplicate_invoice')) return { code: 'duplicate_invoice', message: 'This invoice was already paid or is being paid. Nothing was sent.' };
  if (failed.has('bank_details_verified')) return { code: 'bank_unverified', message: 'New bank details. Verify by phone before paying.' };
  if (failed.has('per_payment_limit') || failed.has('daily_limit')) return { code: 'limit', message: 'This payment is above your limits. Split it or wait until tomorrow.' };
  return { code: 'policy_denied', message: `Payment blocked by your rules: ${policy.reasons.join('; ')}.` };
}

/* ------------------------------------------------------------------ approve and execute */

/**
 * Build the unsigned Squads transactions for the selected route. The device key must sign every one
 * of them in the browser; the server cannot.
 */
export async function prepareApproval(paymentId: string, now = new Date()) {
  const p = getPayment(paymentId);
  if (p.status !== 'AWAITING_APPROVAL' || !p.selectedQuoteId) throw new ServiceError('wrong_state', 'Choose a route that passes your rules first.', 409);
  const q = findQuote(p, p.selectedQuoteId)!;
  const policy = runPolicy(p, q, now);
  if (!policy.allowed) {
    p.policy = policy;
    p.approval = buildApprovalCard(p, q, policy);
    p.status = 'POLICY_DENIED';
    p.problem = problemFromPolicy(policy);
    throw new ServiceError(isQuoteExpired(q, now) ? 'quote_expired' : 'policy_denied', p.problem.message, 409);
  }
  const org = getOrg(p.orgId);
  const vault = requireVault(org);
  const inv = getInvoice(p.orgId, p.invoiceId);
  const rt = runtime();
  const feePayer = await rt.chain.getFeePayer();
  const multisigPda = new PublicKey(vault.multisigPda);
  const vaultPda = new PublicKey(vault.vaultPda);
  const member = new PublicKey(org.keys.device!.publicKey);
  const kind = routeKindOf(q);
  const keys = await splashKeys(rt);
  const transactionIndex = await rt.chain.getNextTransactionIndex(multisigPda);
  const splashFee = q.costs.splashMinor;
  const transferAmount = q.source.amountMinor - splashFee;
  const expectedDeposit = p.payout.deposits.find((d) => d.network === q.target.network)?.address;
  if (!expectedDeposit || expectedDeposit !== q.target.depositAddress) {
    throw new ServiceError('bad_request', 'The quote’s deposit address does not match the partner’s payout. Get a new quote.', 409);
  }
  const fee = splashFee > 0n ? { feeAccountOwner: rt.feeAccountOwner.toBase58(), amountMinor: splashFee } : undefined;

  let inner: TransactionInstruction[];
  let pre: TransactionInstruction[];
  let post: TransactionInstruction[];
  let ephemeralSigners = 0;
  if (kind === 'solana_direct') {
    const plan = buildPayoutInstructions({
      cluster: rt.env.cluster,
      vaultPda,
      feePayer,
      destination: q.target.depositAddress,
      expectedDepositAddress: expectedDeposit,
      amountMinor: transferAmount,
      commitmentHex: inv.confirmed!.commitmentHex,
      reference: Keypair.generate().publicKey,
      splashKeys: keys,
      splashFee: fee,
    });
    inner = plan.vaultInstructions;
    pre = plan.preExecuteInstructions;
    post = plan.postExecuteInstructions;
  } else {
    if (rt.env.mode !== 'offline') {
      throw new ServiceError('devnet_not_supported', 'The CCTP route is not wired for devnet in this build: the partner cannot watch Polygon yet. Choose the Solana direct route.', 409);
    }
    ephemeralSigners = 1;
    const { transactionPda } = deriveProposalAddresses(multisigPda, transactionIndex, 1);
    const burn = buildDepositForBurnInstruction({
      cluster: rt.env.cluster,
      vaultPda,
      transactionPda,
      amountMinor: transferAmount,
      mintRecipientEvm: q.target.depositAddress,
      expectedMintRecipientEvm: expectedDeposit,
      speed: kind === 'cctp_v2_fast' ? 'fast' : 'standard',
      feePayer,
    });
    const feePlan = fee ? buildSplashFeeInstructions({ cluster: rt.env.cluster, vaultPda, feePayer, fee, payoutAmountMinor: transferAmount }) : null;
    const memo = buildMemoInstruction(buildSplashMemo(inv.confirmed!.commitmentHex));
    inner = [burn.instruction, ...(feePlan?.vaultInstructions ?? []), memo];
    pre = feePlan?.preExecuteInstructions ?? [];
    post = [buildMemoInstruction(buildSplashMemo(inv.confirmed!.commitmentHex))];
  }

  const proposal = buildVaultProposal({ multisigPda, transactionIndex, member, feePayer, innerInstructions: inner, ephemeralSigners });
  const blockhash = await rt.chain.getLatestBlockhash();
  let groups;
  try {
    groups = groupProposalTransactions(proposal, feePayer, blockhash);
  } catch (e) {
    throw new ServiceError('transaction_too_large', `This payment does not fit in a Solana transaction: ${(e as Error).message}`, 500);
  }
  const execute = await buildVaultExecuteInstruction({ multisigPda, transactionIndex, member, innerInstructions: inner, ephemeralSigners });
  const txs: Array<{ purpose: 'proposal' | 'execute'; tx: VersionedTransaction }> = [
    ...groups.map((g) => ({ purpose: 'proposal' as const, tx: buildSponsoredTransaction(feePayer, g, blockhash) })),
    { purpose: 'execute' as const, tx: buildSponsoredTransaction(feePayer, [...pre, execute, ...post], blockhash) },
  ];
  const messages: PreparedMessage[] = txs.map(({ purpose, tx }, i) => {
    const size = tx.serialize().length;
    if (size > MAX_TRANSACTION_BYTES) throw new ServiceError('transaction_too_large', `Transaction ${i + 1} is ${size} bytes, over the ${MAX_TRANSACTION_BYTES}-byte limit.`, 500);
    const required = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
    if (!required.some((k) => k.equals(member))) throw new ServiceError('send_failed', 'The device key is not a signer of this transaction.', 500);
    return { id: `m${i}`, purpose, txBase64: b64(tx.serialize()), messageBase64: b64(tx.message.serialize()) };
  });
  const proposalPurposes = groups.map((g) => {
    const purposes: Array<'squads_proposal_create' | 'squads_proposal_approve'> = [];
    if (g.includes(proposal.create)) purposes.push('squads_proposal_create');
    if (g.includes(proposal.approve)) purposes.push('squads_proposal_approve');
    return purposes;
  });
  p.prepared = {
    createdAt: nowIso(now),
    quoteId: q.id,
    kind,
    transactionIndex,
    signer: member.toBase58(),
    messages,
    transferAmountMinor: transferAmount,
    splashFeeMinor: splashFee,
    depositAddress: q.target.depositAddress,
    proposalPurposes,
  };
  return { paymentId: p.id, signer: member.toBase58(), messages: messages.map((m) => ({ id: m.id, purpose: m.purpose, messageBase64: m.messageBase64 })) };
}

/**
 * Execute only with the device key's signature on every prepared transaction (I-4). Signatures are
 * checked before anything is sent; a missing or wrong one sends nothing.
 */
export async function submitApproval(paymentId: string, input: { signatures?: Array<{ id: string; signature: string }> }, now = new Date()) {
  const p = getPayment(paymentId);
  if (p.status !== 'AWAITING_APPROVAL') throw new ServiceError('wrong_state', 'This payment is not waiting for approval.', 409);
  const prepared = p.prepared;
  if (!prepared) throw new ServiceError('not_prepared', 'Nothing to sign yet. Press approve again.', 409);
  const sigs = input.signatures ?? [];
  const byId = new Map(sigs.map((s) => [s.id, s.signature]));
  const signer = new PublicKey(prepared.signer);
  const signed: Array<{ purpose: 'proposal' | 'execute'; tx: VersionedTransaction }> = [];
  for (const m of prepared.messages) {
    const sigB58 = byId.get(m.id);
    if (!sigB58) throw new ServiceError('signature_required', "Execution needs this device's signature on every step. Nothing was sent.", 403);
    let sig: Uint8Array;
    try {
      sig = bs58.decode(sigB58);
    } catch {
      throw new ServiceError('signature_invalid', 'That signature is not readable. Nothing was sent.', 400);
    }
    let valid = false;
    try {
      valid = sig.length === 64 && ed25519.verify(sig, fromB64(m.messageBase64), signer.toBytes());
    } catch {
      valid = false;
    }
    if (!valid) throw new ServiceError('signature_invalid', "That signature is not from this vault's device key. Nothing was sent.", 403);
    const tx = VersionedTransaction.deserialize(fromB64(m.txBase64));
    tx.addSignature(signer, sig);
    signed.push({ purpose: m.purpose, tx });
  }
  const q = findQuote(p, prepared.quoteId)!;
  if (isQuoteExpired(q, now)) {
    p.prepared = null;
    p.problem = { code: 'quote_expired', message: 'Quote expired before you approved. Refresh to get a new quote.' };
    throw new ServiceError('quote_expired', p.problem.message, 409);
  }
  const rt = runtime();
  const org = getOrg(p.orgId);
  const inv = getInvoice(p.orgId, p.invoiceId);

  // Reserve the invoice and the daily limit before sending, so a parallel approval cannot double pay.
  org.seenCommitments.push(inv.confirmed!.commitmentHex);
  const day = utcDay(now);
  org.dailyDebits[day] = (org.dailyDebits[day] ?? 0n) + q.source.amountMinor;
  const release = () => {
    org.seenCommitments = org.seenCommitments.filter((c) => c !== inv.confirmed!.commitmentHex);
    org.dailyDebits[day] = (org.dailyDebits[day] ?? 0n) - q.source.amountMinor;
  };

  const records: ChainSignatureRecord[] = [];
  const proposals = signed.filter((s) => s.purpose === 'proposal');
  try {
    for (const [i, s] of proposals.entries()) {
      const receipt = await rt.chain.sendSponsored(s.tx, { orgId: org.id, now });
      for (const purpose of prepared.proposalPurposes[i] ?? []) records.push({ purpose, network: 'solana', signature: receipt.signature, cluster: receipt.cluster, simulated: receipt.simulated });
    }
  } catch (e) {
    release();
    p.prepared = null;
    p.status = 'FAILED';
    p.problem = { code: 'send_failed', message: `The approval did not reach the network, so nothing moved. ${(e as Error).message}` };
    throw new ServiceError('send_failed', p.problem.message, 502);
  }
  const approvedAt = nowIso();
  p.timeline.approvedAt = approvedAt;
  p.status = 'APPROVED';
  const policyResult = { allowed: p.policy!.allowed, reasons: p.policy!.reasons, checks: p.policy!.checks };
  p.approvals.push(
    { who: org.personName, role: 'admin_device', action: 'propose', at: approvedAt, keyPublic: prepared.signer, policyResult },
    { who: org.personName, role: 'admin_device', action: 'approve', at: approvedAt, keyPublic: prepared.signer, policyResult },
  );

  const exec = signed.find((s) => s.purpose === 'execute')!;
  try {
    const receipt = await rt.chain.sendSponsored(exec.tx, { orgId: org.id, now });
    records.push({ purpose: 'squads_vault_execute', network: 'solana', signature: receipt.signature, cluster: receipt.cluster, simulated: receipt.simulated });
    records.push({ purpose: prepared.kind === 'solana_direct' ? 'spl_transfer' : 'cctp_burn', network: 'solana', signature: receipt.signature, cluster: receipt.cluster, simulated: receipt.simulated });
  } catch (e) {
    p.signatures = records;
    if (rt.env.mode === 'offline') {
      // The simulator applies a transaction all or nothing: a refusal means nothing moved.
      release();
      p.status = 'FAILED';
      p.problem = { code: 'send_failed', message: `The payment was approved but not sent, so nothing moved. ${(e as Error).message}` };
      throw new ServiceError('send_failed', p.problem.message, 502);
    }
    p.problem = { code: 'uncertain', message: "Checking whether this payment went through. Don't retry yet." };
    throw new ServiceError('uncertain', p.problem.message, 504);
  }
  const sentAt = nowIso();
  p.signatures = records;
  p.timeline.sentAt = sentAt;
  p.status = 'SENT';
  p.prepared = null;
  p.approvals.push({ who: org.personName, role: 'admin_device', action: 'execute', at: sentAt, keyPublic: prepared.signer, policyResult });
  p.executedRoute = { quoteId: q.id, network: q.target.network, depositAddress: q.target.depositAddress, amountMinor: prepared.transferAmountMinor, steps: q.steps };
  return p;
}

/* ------------------------------------------------------------------ partner */

/**
 * What the partner sees arrive at its one-payment deposit address. Solana: the deposit owner's USDC
 * balance, read through the chain client. Polygon (offline only): the simulator's recorded burn.
 * Returns the partner's signed webhooks; the caller delivers them to `receivePartnerWebhook`.
 */
export async function observeDeposit(paymentId: string, now = new Date()): Promise<PartnerPayoutEvent[]> {
  const p = getPayment(paymentId);
  if (p.status !== 'SENT' || !p.executedRoute) throw new ServiceError('wrong_state', 'Nothing has been sent for this payment yet.', 409);
  const rt = runtime();
  const route = p.executedRoute;
  if (p.rehearsal === 'partner_return' && rt.chain instanceof SolanaSimulator) {
    // Offline rehearsal: the mock partner returns the payment and sends the USDC back (simulated).
    await rt.chain.fundUsdc(getOrg(p.orgId).vault!.vaultPda, route.amountMinor);
    getOrg(p.orgId).fundings.push({ signature: 'simulated-return', amountMinor: route.amountMinor, at: nowIso(now), simulated: true, note: 'Returned by mock partner (simulated)' });
    return [signWebhook({ partnerId: p.payout.partnerId, paymentId: p.id, status: 'returned', amountPhpMinor: p.payout.amountPhpMinor, at: nowIso(now) }, rt.webhookSecret)];
  }
  let arrived: bigint;
  if (route.network === 'solana') {
    arrived = await rt.chain.getUsdcBalance(route.depositAddress);
  } else {
    if (!(rt.chain instanceof SolanaSimulator)) throw new ServiceError('devnet_not_supported', 'Watching Polygon is not built yet.', 409);
    const execSig = p.signatures.find((s) => s.purpose === 'cctp_burn')?.signature;
    const burn = rt.chain.burns.find((b) => b.signature === execSig);
    if (!burn) throw new ServiceError('wrong_state', 'No burn found for this payment.', 409);
    arrived = burn.amountMinor - burn.maxFeeMinor;
  }
  return rt.partner.simulateDeposit({ payoutId: p.payout.payoutId, network: route.network, address: route.depositAddress, amountUsdcMinor: arrived, now });
}

export async function receivePartnerWebhook(raw: Record<string, unknown>, now = new Date()) {
  let event: PartnerPayoutEvent;
  try {
    event = {
      partnerId: String(raw.partnerId),
      paymentId: String(raw.paymentId),
      status: raw.status as PartnerPayoutEvent['status'],
      ...(raw.bankReference !== undefined ? { bankReference: String(raw.bankReference) } : {}),
      amountPhpMinor: BigInt(String(raw.amountPhpMinor)),
      at: String(raw.at),
      signature: String(raw.signature),
    };
  } catch {
    throw new ServiceError('webhook_invalid', 'Webhook body is malformed.', 400);
  }
  if (!['received', 'paid', 'returned'].includes(event.status)) throw new ServiceError('webhook_invalid', 'Unknown webhook status.', 400);
  const rt = runtime();
  const check = rt.partner.verifyWebhook(event, { now, maxAgeSec: 3600 });
  if (!check.ok) throw new ServiceError('webhook_invalid', `Webhook refused: ${check.reason}.`, 401);
  const p = getPayment(event.paymentId);
  if (event.amountPhpMinor !== p.payout.amountPhpMinor) throw new ServiceError('webhook_invalid', 'Webhook amount differs from the payout.', 422);
  if (p.partnerEvents.some((e) => e.paymentId === event.paymentId && e.status === event.status)) {
    return { duplicate: true, status: p.status };
  }
  if (!['SENT', 'PARTNER_RECEIVED'].includes(p.status)) throw new ServiceError('wrong_state', `Payment is ${p.status}; the webhook does not apply.`, 409);
  p.partnerEvents.push(event);
  if (event.status === 'received') {
    p.status = 'PARTNER_RECEIVED';
    p.timeline.receivedAt = event.at;
  } else if (event.status === 'paid') {
    if (!p.partnerEvents.some((e) => e.status === 'received')) p.timeline.receivedAt = event.at;
    p.status = 'PAID';
    p.timeline.paidAt = event.at;
    await buildEvidence(p.id);
    const inv = getInvoice(p.orgId, p.invoiceId);
    const org = getOrg(p.orgId);
    const c = inv.confirmed!;
    if (c.bankDetailsVerified && !org.suppliers.some((s) => s.name === c.supplierName && s.bank === c.supplierBank && s.accountLast4 === c.supplierAccountLast4)) {
      org.suppliers.push({ name: c.supplierName, bank: c.supplierBank, accountLast4: c.supplierAccountLast4, verified: { by: c.bankDetailsVerified.by, method: c.bankDetailsVerified.method, at: c.bankDetailsVerified.at } });
    }
  } else {
    p.status = 'REFUNDED';
    p.timeline.returnedAt = event.at;
    p.problem = { code: 'partner_returned', message: 'The partner returned the payment. Money is back in your Solana balance. Retry or pay another way.' };
    // The invoice is free to pay again.
    const org = getOrg(p.orgId);
    const inv = getInvoice(p.orgId, p.invoiceId);
    org.seenCommitments = org.seenCommitments.filter((c) => c !== inv.confirmed!.commitmentHex);
  }
  return { duplicate: false, status: p.status };
}

/** Run the partner side once: observe the deposit and deliver its webhooks (optionally spaced out). */
export async function deliverPartnerEvents(paymentId: string, opts: { gapMs?: number } = {}) {
  const events = await observeDeposit(paymentId);
  for (const [i, e] of events.entries()) {
    if (i > 0 && opts.gapMs) await new Promise((r) => setTimeout(r, opts.gapMs));
    // Over the same path the HTTP webhook uses: wire form in, HMAC checked.
    await receivePartnerWebhook(JSON.parse(JSON.stringify({ ...e, amountPhpMinor: e.amountPhpMinor.toString() })));
  }
  return events.length;
}

/* ------------------------------------------------------------------ evidence */

async function seal(plaintext: string): Promise<string> {
  const rt = runtime();
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await rt.sealKey, utf8ToBytes(plaintext)));
  return `aesgcm.${b64(iv)}.${b64(ct)}`;
}

export async function buildEvidence(paymentId: string): Promise<EvidenceRecord> {
  const p = getPayment(paymentId);
  if (p.receiptId) return store().evidence.get(p.receiptId)!;
  const org = getOrg(p.orgId);
  const inv = getInvoice(p.orgId, p.invoiceId);
  const rt = runtime();
  const q = findQuote(p, p.executedRoute!.quoteId)!;
  const paid = p.partnerEvents.find((e) => e.status === 'paid')!;
  const receiptId = `rcpt_${randomHex(8)}`;
  const simulated = p.signatures.some((s) => s.simulated) || rt.env.mode === 'offline';
  const createdAt = paid.at;
  const bundle = buildCorridorPayoutBundle({
    paymentId: p.id,
    createdAt,
    invoice: { commitmentHex: inv.confirmed!.commitmentHex, einvoiceRef: inv.confirmed!.einvoiceRef ?? null },
    approvals: p.approvals,
    kyt: { provider: p.policy!.kyt.provider, resultId: p.policy!.kyt.resultId, verdict: p.policy!.kyt.verdict },
    quotedRoute: q,
    executedRoute: p.executedRoute!,
    chain: { signatures: p.signatures },
    partner: { partnerId: p.payout.partnerId, payoutId: p.payout.payoutId, events: p.partnerEvents },
    bank: { reference: paid.bankReference!, rail: p.payout.rail },
    receipt: { receiptId, issuedAt: nowIso(), simulated },
  });
  const t = Date.parse(createdAt);
  const dayStart = new Date(Math.floor(t / 86_400_000) * 86_400_000);
  const batch = buildEvidenceBatch([bundle], { start: dayStart, end: new Date(dayStart.getTime() + 86_400_000) });
  const leaf = batch.leaves[0]!;

  assertAttesterIsolated(rt.attester.publicKey.toBase58(), [org.vault!]);
  const anchorPlan = buildMemoAnchor({ attester: rt.attester.publicKey.toBase58(), rootHex: batch.rootHex, count: batch.count });
  let anchor: EvidenceRecord['anchor'];
  if (rt.chain instanceof SolanaSimulator) {
    // Offline: the attester signs the memo transaction; the signature is the simulator's deterministic one (I-7).
    const msg = new TransactionMessage({ payerKey: rt.attester.publicKey, recentBlockhash: await rt.chain.getLatestBlockhash(), instructions: [anchorPlan.instruction] }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([rt.attester]);
    anchor = { method: 'memo', memo: anchorPlan.memo, status: 'anchored', signature: simulatedSignature(tx.serialize()), simulated: true, attester: rt.attester.publicKey.toBase58() };
  } else {
    // Devnet: the attester key is not funded in this build, so the root is recorded and the anchor waits.
    anchor = { method: 'memo', memo: anchorPlan.memo, status: 'pending', signature: null, simulated: false, attester: rt.attester.publicKey.toBase58() };
  }
  const stored = await rt.evidence.put(bundle.bundleId, await seal(canonicalJson(bundle)));
  const record: EvidenceRecord = {
    receiptId,
    paymentId: p.id,
    orgId: org.id,
    createdAt: nowIso(),
    bundle,
    leafHex: bundleLeafHex(bundle),
    batch: { rootHex: batch.rootHex, count: batch.count, periodStart: batch.periodStart, periodEnd: batch.periodEnd },
    proof: leaf.proof,
    anchor,
    stored,
  };
  store().evidence.set(receiptId, record);
  p.receiptId = receiptId;
  return record;
}

export function getEvidence(receiptId: string): EvidenceRecord {
  const e = store().evidence.get(receiptId);
  if (!e) throw new ServiceError('receipt_not_found', 'That receipt is not on the server. The demo resets when the server restarts.', 404);
  return e;
}

/** Server-side verification (the receipt page runs the same check in the browser). */
export function verifyReceipt(receiptId: string): VerifyResult {
  const e = getEvidence(receiptId);
  if (e.anchor.status !== 'anchored') {
    return { ok: false, leafHex: e.leafHex, computedRootHex: null, anchoredRootHex: e.batch.rootHex, simulated: e.anchor.simulated, checks: [{ name: 'root_matches_anchor', passed: false, detail: 'anchor pending' }] };
  }
  return verifyBundle({ bundle: e.bundle, proof: e.proof, anchor: anchoredRootFromMemo(e.anchor.memo, { signature: e.anchor.signature ?? undefined, simulated: e.anchor.simulated }) });
}

/* ------------------------------------------------------------------ views for the UI */

export function paymentView(paymentId: string) {
  const p = getPayment(paymentId);
  const inv = getInvoice(p.orgId, p.invoiceId);
  const rt = runtime();
  const devnet = rt.env.mode === 'devnet';
  // At most three cards. Picks that are the same route at the same price share one card; if no pick
  // uses the CCTP lane, its best quote gets the last card so both lanes are visible.
  type Card = ReturnType<typeof cardFor>;
  const cardFor = (q: RouteQuote, policies: Policy[]) => {
    const kind = routeKindOf(q);
    const lane = laneOf(kind);
    const names = policies.map((x) => POLICY_LABEL[x]);
    return {
      policy: q.policy,
      policies,
      label: names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!.toLowerCase()}`,
      quoteId: q.id,
      kind,
      receivePhpMinor: q.netLocal.amountMinor,
      youPayUsdcMinor: q.source.amountMinor,
      allInBps: q.costs.allInBps,
      arrives: arrivalOf(q).words.split(',')[0]!,
      laneLine: lane.line,
      solNote: lane.solNote,
      aboveTarget: q.flags.includes('above_target'),
      mockPartner: q.flags.includes('mock_partner'),
      expiresAt: q.expiresAt,
      homeLane: p.engine.homeLane[q.policy],
    };
  };
  const cards: Card[] = [];
  const byKey = new Map<string, { q: RouteQuote; policies: Policy[] }>();
  for (const policy of POLICIES) {
    const q = p.engine.picks[policy];
    if (!q) continue;
    const key = `${routeKindOf(q)}|${q.source.amountMinor}|${q.netLocal.amountMinor}`;
    const hit = byKey.get(key);
    if (hit) hit.policies.push(policy);
    else byKey.set(key, { q, policies: [policy] });
  }
  for (const { q, policies } of byKey.values()) cards.push(cardFor(q, policies));
  if (cards.length < 3 && !cards.some((c) => c.kind !== 'solana_direct')) {
    const cctp = POLICIES.flatMap((x) => p.engine.ranked[x]).filter((q) => q.target.network === 'polygon').sort((a, b) => (a.source.amountMinor < b.source.amountMinor ? -1 : a.source.amountMinor > b.source.amountMinor ? 1 : 0))[0];
    if (cctp) cards.push({ ...cardFor(cctp, [cctp.policy]), label: 'Via Polygon' });
  }
  const explorer = (sig: string, simulated: boolean) => (devnet && !simulated ? explorerTxUrl(sig, rt.env.cluster) : null);
  return {
    id: p.id,
    status: p.status,
    createdAt: p.createdAt,
    simulated: rt.env.mode === 'offline',
    invoice: { id: inv.id, confirmed: inv.confirmed },
    cards,
    zeke: { suggests: POLICY_LABEL[p.router.primary.policy], primary: p.router.primary.text, alternative: p.router.alternative?.text ?? null },
    selectedQuoteId: p.selectedQuoteId,
    approval: p.approval,
    rehearsal: p.rehearsal,
    timeline: p.timeline,
    signatures: p.signatures.map((s) => ({ ...s, explorerUrl: explorer(s.signature, s.simulated) })),
    partnerEvents: p.partnerEvents.map((e) => ({ status: e.status, at: e.at, bankReference: e.bankReference ?? null })),
    partnerLabel: rt.partner.entry.name,
    receiptId: p.receiptId,
    problem: p.problem,
  };
}

export function invoiceView(inv: InvoiceRecord) {
  const fields = inv.draft.fields;
  return {
    id: inv.id,
    source: inv.source,
    extractor: inv.draft.extractor,
    fields: {
      invoiceNumber: fields.invoiceNumber,
      supplierName: fields.supplierName,
      supplierBank: fields.supplierBank,
      supplierAccountLast4: fields.supplierAccountLast4,
      amountPhpMinor: fields.amountPhpMinor,
      dueDate: fields.dueDate,
      einvoiceRef: fields.einvoiceRef ?? null,
    },
    needsConfirmation: inv.draft.needsConfirmation as InvoiceFieldName[],
    sources: Object.fromEntries(Object.entries(inv.draft.sources).map(([k, v]) => [k, v ? { line: v.line, excerpt: v.excerpt, grounded: v.grounded } : null])),
    suspicious: inv.draft.suspicious,
    suspiciousReasons: inv.draft.suspiciousReasons,
    bankStatus: inv.bankStatus,
    bankVerification: inv.bankVerification,
    confirmed: inv.confirmed,
  };
}

export function receiptView(receiptId: string) {
  const e = getEvidence(receiptId);
  const p = getPayment(e.paymentId);
  const inv = getInvoice(p.orgId, p.invoiceId);
  const org = getOrg(p.orgId);
  const rt = runtime();
  const devnet = rt.env.mode === 'devnet';
  return {
    receiptId: e.receiptId,
    paymentId: e.paymentId,
    simulated: e.anchor.simulated || e.bundle.receipt.simulated,
    companyName: org.companyName,
    summary: {
      supplierName: inv.confirmed!.supplierName,
      bank: inv.confirmed!.supplierBank,
      accountLast4: inv.confirmed!.supplierAccountLast4,
      invoiceNumber: inv.confirmed!.invoiceNumber,
      receivePhpMinor: e.bundle.quotedRoute.netLocal.amountMinor,
      youPayUsdcMinor: e.bundle.quotedRoute.source.amountMinor,
      paidAt: p.timeline.paidAt ?? null,
      bankReference: e.bundle.bank.reference,
      partnerLabel: rt.partner.entry.name,
    },
    bundle: e.bundle,
    leafHex: e.leafHex,
    proof: e.proof,
    batch: e.batch,
    anchor: { ...e.anchor, explorerUrl: devnet && e.anchor.signature ? explorerTxUrl(e.anchor.signature, rt.env.cluster) : null },
    stored: { blobId: e.stored.blobId, mode: e.stored.mode, sizeBytes: e.stored.sizeBytes },
  };
}

/** The evidence pack a business hands its auditor. Includes the invoice fields and this invoice's salt so the commitment can be recomputed. */
export function evidencePack(receiptId: string) {
  const e = getEvidence(receiptId);
  const p = getPayment(e.paymentId);
  const inv = getInvoice(p.orgId, p.invoiceId);
  const c = inv.confirmed!;
  return {
    format: 'splash.evidence.pack.v1',
    simulated: e.anchor.simulated || e.bundle.receipt.simulated,
    note: e.anchor.simulated ? 'Simulated · devnet-ready. Produced by the offline simulator; no network was used.' : 'Devnet run.',
    receiptId: e.receiptId,
    bundle: e.bundle,
    leafHex: e.leafHex,
    proof: e.proof,
    batch: e.batch,
    anchor: e.anchor,
    invoiceDisclosure: {
      fields: { invoiceNumber: c.invoiceNumber, supplierName: c.supplierName, supplierBank: c.supplierBank, supplierAccountLast4: c.supplierAccountLast4, amountPhpMinor: c.amountPhpMinor, dueDate: c.dueDate, einvoiceRef: c.einvoiceRef },
      saltHex: inv.saltHex,
      commitment: 'sha256(salt || canonicalJson(fields)) must equal bundle.invoice.commitmentHex',
    },
    howToVerify: [
      'leaf = sha256(utf8("splash.evidence.leaf.v1") || 0x00 || utf8(canonicalJson(bundle))); bigint values are decimal strings',
      'walk proof.siblings bottom-up: node = sha256(utf8("splash.evidence.node.v1") || 0x01 || left || right)',
      'the root must equal the root in the anchor memo "splash:root:v1:<root>:<count>"',
    ],
  };
}
