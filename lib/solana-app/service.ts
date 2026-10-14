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
 *   → prepareApproval (policy + payee re-checked; unsigned Squads transactions, compute budget first)
 *   → submitApproval (the browser's device-key signatures; refused without them; each transaction
 *     simulated, then signed by the fee payer, recorded under paymentId:step, then broadcast)
 *   → observeDeposit → receivePartnerWebhook (HMAC verified, deduped)
 *   → evidence once the execute is finalized (bundle, batch, memo anchor) → receipt
 *
 * Payment state is the machine in payment-machine.ts, stored through the repository
 * (payment-repo.ts): every change a compare-and-set; `resumePayment` picks up after a crash.
 *
 * Every chain call goes through `runtime().chain`, which is `chain()`: the
 * offline simulator by default, DevnetChain with SPLASH_SOLANA_MODE=devnet.
 */
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import bs58 from 'bs58';

import { explorerAddressUrl, explorerTxUrl, solscanAccount, solscanTx, usdcMint } from '../solana/config.ts';
import { buildDepositForBurnInstruction } from '../solana/cctp-v2-solana.ts';
import { defaultSponsorPolicy, utcDay, type SponsorPolicy } from '../solana/kora.ts';
import { cappedMicroLamports, computeBudgetInstructions, DEFAULT_UNIT_LIMITS, unitLimitFromSimulation } from '../solana/compute-budget.ts';
import { buildMemoInstruction, buildPaymentMemo, buildPayoutInstructions, buildPeerMemo, buildSplashFeeInstructions, getAssociatedTokenAddress } from '../solana/payout.ts';
import { createPossessionChallenge, verifyPossession } from '../solana/recovery-kit.ts';
import { isSimulator, simulatedSignature } from '../solana/simulator.ts';
import {
  assertAutonomousSummary,
  buildCreateVaultInstruction,
  buildProposalApprove,
  buildSponsoredTransaction,
  buildVaultExecuteInstruction,
  buildVaultProposal,
  deriveProposalAddresses,
  groupProposalTransactions,
  MAX_TRANSACTION_BYTES,
  TREASURY_VAULT_INDEX,
  transactionSize,
  vaultPdaAt,
} from '../solana/squads.ts';
import type { Cluster, ConfirmedInvoice, InvoiceFields, PartnerPayoutEvent, Policy, RouteQuote, VaultInfo } from '../solana/types.ts';
import type { ShareRecord } from './doc-store.ts';
import { compareValue, quoteRoutes, stepCount, POLICIES, type EngineResult } from '../route-engine/index.ts';
import { createKytStub, evaluatePolicy, TIER_LIMITS, type EnginePolicyResult } from '../route-engine/policy.ts';
import { DEFAULT_ASSUMPTIONS, isQuoteExpired, MAX_QUOTE_TTL_SEC, routeKindOf, type RouteKind } from '../route-engine/quote.ts';
import { ALL_IN_TARGET_BPS, SPLASH_FEE_BPS, SPLASH_MIN_FEE_USDC_MINOR } from '../route-engine/fees.ts';
import { signWebhook } from '../solana-partner/mock-partner.ts';
import type { PartnerPayout } from '../solana-partner/registry.ts';
import { assertAttesterIsolated, buildMemoAnchor } from '../solana-evidence/anchor.ts';
import { buildCorridorPayoutBundle, buildEvidenceBatch, buildPeerTransferBundle, bundleLeafHex, computeInvoiceCommitment, type ChainSignatureRecord, type EvidenceBundle } from '../solana-evidence/bundle.ts';
import { canonicalJson } from '../solana-evidence/canonical.ts';
import { stockRef, TBILLS } from '../treasury/reference.ts';
import { anchoredRootFromMemo, verifyBundle, type VerifyResult } from '../solana-evidence/verify.ts';
import { assertDraftOnly, assertRouterRefersToEngineQuote } from '../solana-zeke/guard.ts';
import { InvoiceFieldsSchema, readInvoice, ReaderError, type InvoiceFieldName } from '../solana-zeke/reader.ts';
import { explainChecks } from '../solana-zeke/checker.ts';
import { explainRoutes, formatUsd, type RouterOutput } from '../solana-zeke/router.ts';
import { SAMPLE_INVOICE_TEXT } from '../solana-zeke/fixtures/sample-invoice.ts';

import { awaitCommitment } from './confirm.ts';
import { detailsView, missingDetails, purposeLine, recipientKey } from './transfer-details.ts';
import { ServiceError } from './errors.ts';
import { chainCallKey, DISCARDABLE_STATES, IllegalTransitionError, isCommitted, RESUMABLE_STATES, STATE_LABEL, type PaymentState } from './payment-machine.ts';
import { StateConflictError, type ChainCall } from './payment-repo.ts';
import { accountNumberFrom, bankCodeFor, maskedLines } from './invoice-document.ts';
import { sealInvoiceNumber } from './invoice-number.ts';
import { adoptInvoiceNumber, openForPayout, openInvoiceForPayout } from './payout-number.ts';
import { runtime, splashKeys } from './runtime.ts';
import {
  newSupplierId,
  store,
  type ApprovalCard,
  type BankVerification,
  type EvidenceRecord,
  type InvoiceRecord,
  type MoveRecord,
  type OrgRecord,
  type PeerDestination,
  type WebhookLogEntry,
  type PaymentRecord,
  type PreparedApproval,
  type PreparedMessage,
  type ProposalPurpose,
  type Rehearsal,
  type SerializedInstruction,
  type SupplierRecord,
  isBill,
  paysPeer,
} from './store.ts';

/* ------------------------------------------------------------------ constants */

/** Demo company limits, shown on the policy page. Tier "advanced" with a lower per-payment cap. */
export const DEMO_TIER = 'advanced' as const;
export const DEMO_LIMITS = { perPaymentUsdcMinor: 20_000_000_000n, dailyUsdcMinor: TIER_LIMITS.advanced.dailyUsdcMinor };
/** Offline faucet amount: 25,000 test USDC. */
export const OFFLINE_FUND_MINOR = 25_000_000_000n;
export const CIRCLE_FAUCET_URL = 'https://faucet.circle.com/';

/**
 * What a person reads (prompt 10 §5.6, decision 8). "Fastest" is a route label only: the route the
 * engine estimates finishes first. The estimate itself (seconds, minutes, "arrives by") is never shown.
 * 'safest' still ranks in the engine, but has no card.
 */
const POLICY_LABEL: Record<Policy, string> = { cheapest: 'Cheapest', fastest: 'Fastest', safest: 'Safest' };
/** The two lanes Transfer shows, in order. */
const LANE_POLICIES: readonly Policy[] = ['cheapest', 'fastest'];

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

/** The same rules, for a payment to another business on Splash (prompt 10 §5.4). */
const PEER_CHECK_LABELS: Record<string, string> = {
  kyt: 'Their account screened (stub, not a real screening)',
  duplicate_invoice: 'Not sent before (same business and reference)',
  bank_details_verified: 'A verified business on Splash',
  amount_covers_invoice: 'They get exactly what you typed',
};

/** The same rules, in a transfer's words: there is no invoice, only a reference. */
const TRANSFER_CHECK_LABELS: Record<string, string> = {
  duplicate_invoice: 'Not sent before (same recipient, amount and reference)',
  bank_details_verified: 'Recipient bank details verified',
  amount_covers_invoice: 'Recipient receives the full amount',
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

export function getInvoice(orgId: string, invoiceId: string): InvoiceRecord {
  const inv = store().invoices.get(invoiceId);
  if (!inv || inv.orgId !== orgId) throw new ServiceError('invoice_not_found', 'That invoice is not on the server. Start the payment again.', 404);
  return inv;
}

/**
 * Where a person follows something on Solscan (first) or Solana Explorer. Null offline, and for a
 * simulated signature: it exists on no network, and a link to nothing would look like proof.
 */
export function traceLinks(kind: 'tx' | 'account', id: string, simulated: boolean): { solscanUrl: string | null; explorerUrl: string | null } {
  const rt = runtime();
  if (rt.env.mode !== 'devnet' || simulated) return { solscanUrl: null, explorerUrl: null };
  return kind === 'tx'
    ? { solscanUrl: solscanTx(id, rt.env.cluster), explorerUrl: explorerTxUrl(id, rt.env.cluster) }
    : { solscanUrl: solscanAccount(id, rt.env.cluster), explorerUrl: explorerAddressUrl(id, rt.env.cluster) };
}

/**
 * Everything needed to trace one payment on Solscan without Splash: the memo every one of its
 * transactions carries, and the accounts it touched. The deposit is listed only for the Solana
 * direct route (a CCTP route's deposit is on Polygon, not on Solscan).
 */
function paymentTrace(p: PaymentRecord) {
  const org = store().orgs.get(p.orgId);
  const vault = org?.vault;
  const rt = runtime();
  const accounts: Array<{ label: string; address: string; solscanUrl: string | null; explorerUrl: string | null }> = [];
  if (vault) {
    const ata = getAssociatedTokenAddress(usdcMint(rt.env.cluster), new PublicKey(vault.vaultPda)).toBase58();
    accounts.push({ label: 'Your vault', address: vault.vaultPda, ...traceLinks('account', vault.vaultPda, vault.simulated) });
    accounts.push({ label: 'Your vault’s USDC account', address: ata, ...traceLinks('account', ata, vault.simulated) });
  }
  const q = p.selectedQuoteId ? findQuote(p, p.selectedQuoteId) : null;
  if (q && routeKindOf(q) === 'solana_direct') {
    accounts.push({ label: 'Payout partner deposit', address: q.target.depositAddress, ...traceLinks('account', q.target.depositAddress, vault?.simulated ?? true) });
  }
  return { memo: p.kind === 'peer' ? buildPeerMemo(p.id) : buildPaymentMemo(p.id), accounts };
}

/** A move between the company's own vaults, as the screens show it. */
export function moveSummary(m: MoveRecord) {
  const last = [...m.calls].reverse().find((c) => c.step === 'execute') ?? m.calls[m.calls.length - 1] ?? null;
  const simulated = runtime().env.mode === 'offline';
  return {
    id: m.id,
    from: m.from,
    to: m.to,
    amountMinor: m.amountMinor,
    memo: m.memo,
    state: m.state,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    createdBy: m.createdBy,
    approvedBy: m.approvedBy,
    problem: m.problem,
    signature: last ? { signature: last.signature, step: last.step, simulated, ...traceLinks('tx', last.signature, simulated) } : null,
  };
}

/** The company's treasury: vault #1 of its own multisig (vault #0 pays suppliers). */
export function treasuryVaultPda(multisigPda: string): string {
  return vaultPdaAt(new PublicKey(multisigPda), TREASURY_VAULT_INDEX).toBase58();
}

export function requireVault(org: OrgRecord) {
  if (!org.vault) throw new ServiceError('vault_missing', 'Create your vault first.', 409);
  return org.vault;
}

/**
 * How the partner reaches the recipient's bank: the rail's name, never a time. A promised arrival
 * time is a speed claim, and Splash makes none (prompt 07 §0.6); the bank and the rail set it.
 */
function arrivalOf(q: RouteQuote): { words: string; rail: string } {
  const partner = q.steps.find((s) => s.kind === 'partner');
  const rail = partner?.provider.split('·').pop()?.trim() ?? '';
  if (rail === 'PESONet' || rail === 'InstaPay') return { words: `${rail}, to the recipient’s bank`, rail };
  return { words: 'The partner’s bank transfer', rail };
}

/**
 * How a route reaches the partner, in the Transfer map's words (prompt 10 §5.6): never the network's
 * name. The lower-cost lane is Circle's own transfer to Polygon, said once in "How it moves".
 */
function laneOf(kind: RouteKind): { line: string; solNote: string; routeLabel: string } {
  if (kind === 'solana_direct') return { line: 'Straight to the partner', solNote: 'Splash pays the network fee', routeLabel: 'Straight to the partner' };
  return { line: 'Through the partner’s lower-cost lane', solNote: 'Your account pays a small network fee (test mode)', routeLabel: 'Through the partner’s lower-cost lane' };
}

export function findQuote(p: PaymentRecord, quoteId: string): RouteQuote | null {
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
    suspended: null,
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

/**
 * Create an autonomous Squads vault (solo mode: device + recovery kit,
 * threshold 1, configAuthority null) and confirm on the created account that
 * nobody, Splash included, can change it. Shared by the demo onboarding and
 * the account setup (lib/solana-app/account-setup.ts).
 */
export async function createAutonomousVault(input: { devicePublicKey: string; kitPublicKey: string; sponsorTag: string }) {
  if (input.devicePublicKey === input.kitPublicKey) throw new ServiceError('bad_request', 'The device key and the recovery kit must be different keys.');
  const rt = runtime();
  const feePayer = await rt.chain.getFeePayer();
  const createKey = Keypair.generate(); // signs the create once, then dropped; it gains no authority
  const plan = buildCreateVaultInstruction({
    mode: 'solo',
    members: [
      { role: 'admin_device', publicKey: input.devicePublicKey },
      { role: 'recovery_kit_a', publicKey: input.kitPublicKey },
    ],
    createKey: createKey.publicKey,
    feePayer,
    treasury: await rt.chain.getSquadsTreasury(),
    splashKeys: await splashKeys(rt),
  });
  const tx = buildSponsoredTransaction(feePayer, [plan.instruction], await rt.chain.getLatestBlockhash());
  tx.sign([createKey]);
  const slot = await takeSponsorSlot(input.sponsorTag);
  let receipt;
  try {
    receipt = await rt.chain.sendSponsored(tx, { orgId: input.sponsorTag });
  } catch (e) {
    await slot.release();
    throw e;
  }
  // §5.4: confirm on the created account that nobody, Splash included, can change it.
  const onChain = await rt.chain.getMultisig(plan.multisigPda);
  if (!onChain) throw new ServiceError('send_failed', 'The vault was not found after creation. Nothing else was done; try again.', 502);
  try {
    assertAutonomousSummary(onChain, { splashKeys: await splashKeys(rt), expectedMembers: [input.devicePublicKey, input.kitPublicKey], expectedThreshold: plan.vault.threshold });
  } catch (e) {
    throw new ServiceError('send_failed', `The vault does not match what was asked for (${(e as Error).message}). Stop and contact support.`, 500);
  }
  return { ...plan.vault, configAuthority: null, createdAt: nowIso(), signature: receipt.signature, simulated: receipt.simulated, cluster: receipt.cluster };
}

export async function createVault(orgId: string) {
  const org = getOrg(orgId);
  if (org.vault) throw new ServiceError('vault_exists', 'This company already has a vault.', 409);
  if (!org.keys.device || !org.keys.kit) throw new ServiceError('keys_missing', 'Save your recovery kit and create the device key first.', 409);
  org.vault = await createAutonomousVault({ devicePublicKey: org.keys.device.publicKey, kitPublicKey: org.keys.kit.publicKey, sponsorTag: org.id });
  return org.vault;
}

/* ------------------------------------------------------------------ the signed-in company */

export interface AccountCompany {
  /** The dashboard organization's id: the same company, not a copy of it. */
  orgId: string;
  companyName: string;
  /** The signed-in person, shown on approvals they make. */
  personName: string;
  /** The vault the setup recorded (org_vaults), or null before setup. */
  vault: (VaultInfo & { createdAt: string; signature: string; simulated: boolean; cluster: Cluster }) | null;
  /** This member's own device key (member_devices), or null before setup. */
  deviceKey: string | null;
}

/**
 * The dashboard's organization IS the Solana app's company (prompt 07 §6.2). Who it is, its vault and
 * the member's device come from what account setup wrote (org_vaults, member_devices); this makes the
 * working copy agree with that on every request. The salt, verified suppliers and fundings are the
 * company's own documents (company.ts) and are kept.
 *
 * Offline, a vault the database recorded but this process never saw (the dev server restarted) is put
 * back into the simulator at its last used transaction index, with no simulated money.
 */
export async function syncAccountCompany(input: AccountCompany): Promise<OrgRecord> {
  const s = store();
  let org = s.orgs.get(input.orgId);
  if (!org) {
    org = { id: input.orgId, companyName: input.companyName, personName: input.personName, createdAt: nowIso(), saltHex: randomHex(32), challenges: {}, keys: {}, suppliers: [], dailyDebits: {}, seenCommitments: [], fundings: [], suspended: null };
    s.orgs.set(org.id, org);
  }
  org.companyName = input.companyName;
  org.personName = input.personName;
  if (input.deviceKey && org.keys.device?.publicKey !== input.deviceKey) org.keys.device = { publicKey: input.deviceKey, provenAt: nowIso() };
  if (input.vault) {
    org.vault = input.vault;
    const kit = input.vault.members.find((m) => m.role === 'recovery_kit_a');
    if (kit && org.keys.kit?.publicKey !== kit.publicKey) org.keys.kit = { publicKey: kit.publicKey, provenAt: input.vault.createdAt };
    const rt = runtime();
    if (isSimulator(rt.chain) && input.vault.simulated && !(await rt.chain.getMultisig(new PublicKey(input.vault.multisigPda)))) {
      const used = (await rt.payments.listByOrg(org.id)).reduce((max, p) => (p.transactionIndex !== null && p.transactionIndex > max ? p.transactionIndex : max), 0n);
      rt.chain.restoreVault({ multisigPda: input.vault.multisigPda, threshold: input.vault.threshold, members: input.vault.members.map((m) => m.publicKey), transactionIndex: used });
      // Simulated money does not survive a restart, and the old fundings are no longer in the vault.
      org.fundings = [];
    }
  }
  return org;
}

/* ------------------------------------------------------------------ receipt share links */

/**
 * A link a business hands its auditor: it opens this one receipt (the record, its verify steps, the
 * Solscan trace and the evidence pack) without signing in, and nothing else. One live link per
 * receipt; minting again returns it. The token is 128 random bits.
 */
export function shareReceipt(orgId: string, receiptId: string, by: string, now = new Date()): ShareRecord {
  const e = getEvidence(receiptId);
  if (e.orgId !== orgId) throw new ServiceError('receipt_not_found', 'That receipt is not on the server for this company.', 404);
  const s = store();
  for (const sh of s.shares.values()) if (sh.receiptId === receiptId && sh.revokedAt === null) return sh;
  const share: ShareRecord = { token: `shr_${randomHex(16)}`, receiptId, orgId, createdAt: nowIso(now), createdBy: by, revokedAt: null };
  s.shares.set(share.token, share);
  return share;
}

/** The live share behind a token, or a not-found error that says nothing about why. */
export function openShare(token: string): ShareRecord {
  const share = store().shares.get(token);
  if (!share || share.revokedAt !== null) throw new ServiceError('receipt_not_found', 'This receipt link is not valid. Ask the business that shared it for a new one.', 404);
  return share;
}

/** A receipt only its own company may read. */
export function assertReceiptOf(receiptId: string, orgId: string): void {
  if (getEvidence(receiptId).orgId !== orgId) throw new ServiceError('receipt_not_found', 'That receipt is not on the server for this company.', 404);
}

/* ------------------------------------------------------------------ funding and summary */

export async function fund(orgId: string) {
  const org = getOrg(orgId);
  const vault = requireVault(org);
  const rt = runtime();
  if (!isSimulator(rt.chain)) {
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
  // A discarded payment leaves the company's lists (nothing moved); the staff console still shows it.
  const payments = (await rt.payments.listByOrg(org.id))
    .filter((p) => p.state !== 'discarded')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .map((p) => {
      const inv = store().invoices.get(p.invoiceId);
      const execute = p.signatures.find((s) => s.purpose === 'squads_vault_execute') ?? null;
      return {
        id: p.id,
        /** An invoice Zeke read, or a transfer a person typed in (its "invoice number" is the reference). */
        kind: inv?.source === 'transfer' || inv?.source === 'peer' ? ('transfer' as const) : ('invoice' as const),
        /** A bank payout, or a payment into a Splash business's account (its stations differ). */
        paymentKind: p.kind ?? ('bank' as const),
        state: p.state,
        stateLabel: STATE_LABEL[p.state],
        /** Nothing has been sent yet, so a person may drop it (payments only; a batch is not dropped here). */
        discardable: p.id.startsWith('pay_') && DISCARDABLE_STATES.includes(p.state),
        supplierName: inv?.confirmed?.supplierName ?? '',
        invoiceNumber: inv?.confirmed?.invoiceNumber ?? null,
        dueDate: inv?.confirmed?.dueDate ?? null,
        amountPhpMinor: p.payout.amountPhpMinor,
        youPayUsdcMinor: p.approval?.youPayUsdcMinor ?? null,
        receiptId: p.receiptId,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        /** Waiting for a person to approve on a device (the first approval, or the next one on a 2-of-N vault). */
        awaitingApproval: p.state === 'checked' || p.state === 'proposed',
        approvals: { approved: p.approvedBy.length, threshold: p.threshold },
        execute: execute ? { signature: execute.signature, simulated: execute.simulated, ...traceLinks('tx', execute.signature, execute.simulated) } : null,
        problem: p.problem,
      };
    });
  const inFlight = payments.filter((p) => ['proposed', 'approved', 'executed', 'confirmed'].includes(p.state));
  // Invoices Zeke has read for this company, paid or not: the first stages of the invoice loop.
  const read = [...store().invoices.values()].filter((i) => i.orgId === org.id && isBill(i));
  const treasuryPda = org.vault ? treasuryVaultPda(org.vault.multisigPda) : null;
  const treasuryMinor = treasuryPda ? await rt.chain.getUsdcBalance(treasuryPda) : 0n;
  return {
    org: { id: org.id, companyName: org.companyName, personName: org.personName, createdAt: org.createdAt, suspended: org.suspended },
    mode: rt.env.mode,
    cluster: rt.env.cluster,
    simulated: rt.env.mode === 'offline',
    keys: { device: org.keys.device?.publicKey ?? null, kit: org.keys.kit?.publicKey ?? null },
    vault: org.vault
      ? {
          ...org.vault,
          usdcTokenAccount: getAssociatedTokenAddress(usdcMint(rt.env.cluster), new PublicKey(org.vault.vaultPda)).toBase58(),
          ...traceLinks('account', org.vault.vaultPda, org.vault.simulated),
        }
      : null,
    /** The payable total is exactly the sum of the parts. Only the Solana lane exists in this build. */
    balance: { totalMinor: balanceMinor, parts: [{ lane: 'Solana', amountMinor: balanceMinor }], inFlightCount: inFlight.length },
    fundings: org.fundings,
    /** Vault #1 of the same multisig: the company's operating cash. Moves to and from it are approved on a device. */
    treasury:
      org.vault && treasuryPda
        ? {
            vaultPda: treasuryPda,
            vaultIndex: TREASURY_VAULT_INDEX,
            usdcTokenAccount: getAssociatedTokenAddress(usdcMint(rt.env.cluster), new PublicKey(treasuryPda)).toBase58(),
            balanceMinor: treasuryMinor,
            ...traceLinks('account', treasuryPda, org.vault.simulated),
            fundings: org.treasuryFundings ?? [],
            moves: (org.moves ?? []).slice().reverse().map(moveSummary),
          }
        : null,
    /** Treasury orders (prompt 10 §7.4), settled, newest first: History's gold "Treasury" rows. */
    treasuryOrders: (org.investments?.orders ?? [])
      .filter((o) => o.state === 'settled')
      .slice()
      .reverse()
      .map((o) => ({ id: o.id, kind: o.kind, asset: o.asset, name: o.asset === 'usdy' ? TBILLS.name : (stockRef(o.asset)?.name ?? o.asset), amountMinor: o.amountMinor, at: o.approval?.at ?? o.createdAt, landsIn: o.landsIn, receiptId: o.receiptId, sweep: Boolean(o.sweepDraftId) })),
    invoices: { read: read.length, confirmed: read.filter((i) => i.confirmed).length },
    suppliers: org.suppliers.map((x) => ({ id: x.id, name: x.name, bank: x.bank, accountLast4: x.accountLast4, verifiedAt: x.verified?.at ?? null, method: x.verified?.method ?? null, callBackPending: Boolean(x.pendingCallBack) })),
    limits: { perPaymentUsdcMinor: DEMO_LIMITS.perPaymentUsdcMinor, dailyUsdcMinor: DEMO_LIMITS.dailyUsdcMinor, usedTodayUsdcMinor: org.dailyDebits[utcDay(new Date())] ?? 0n },
    payments,
    faucetUrl: rt.env.mode === 'devnet' ? CIRCLE_FAUCET_URL : null,
  };
}

/* ------------------------------------------------------------------ invoice */

function bankStatusFor(org: OrgRecord, fields: InvoiceFields): { status: InvoiceRecord['bankStatus']; known: BankVerification | null } {
  const sameName = org.suppliers.filter((s) => s.name.toLowerCase() === fields.supplierName.toLowerCase());
  const exact = sameName.find((s) => s.bank === fields.supplierBank && s.accountLast4 === fields.supplierAccountLast4);
  // New details stored for a saved recipient wait for a call-back: until then they are "changed", and
  // the rules refuse the payment (bank_details_verified), the same as a new supplier (prompt 10 §S.1.7).
  if (exact && !exact.pendingCallBack && exact.verified) return { status: 'known', known: exact.verified };
  return { status: sameName.length > 0 ? 'changed' : 'new', known: null };
}

/**
 * Take a recipient off the company's saved, verified list (Transfer, step 1), by its id. Payments
 * already made keep their records untouched. Paying this recipient again needs a new call-back, and the
 * payout partner's questions are asked again, because the saved answers go with it. Its full bank
 * number is destroyed later (the route schedules it: lib/server/bank-details.ts).
 */
export function removeSupplier(orgId: string, supplierId: string): { removed: SupplierRecord; remaining: number } {
  const org = getOrg(orgId);
  const removed = org.suppliers.find((s) => s.id === supplierId);
  if (!removed) throw new ServiceError('recipient_not_found', 'That recipient is not on your saved list.', 404);
  org.suppliers = org.suppliers.filter((s) => s !== removed);
  if (org.recipientDetails) delete org.recipientDetails[recipientKey({ supplierName: removed.name, supplierBank: removed.bank, supplierAccountLast4: removed.accountLast4 })];
  return { removed, remaining: org.suppliers.length };
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
  // The full account number is sealed now and masked in the document (prompt 10 §6.2): the text the
  // page shows, and every copy kept, carry "•••• •••• 4471".
  const accountNumber = accountNumberFrom(text, draft);
  const bankCode = bankCodeFor(draft.fields.supplierBank ?? '');
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
    document: { lines: maskedLines(text, accountNumber) },
    bankCode,
  };
  if (accountNumber) {
    try {
      inv.accountSecretId = (await sealInvoiceNumber(org.id, inv.id, { bankCode, accountNumber })).secretId;
    } catch {
      // No key service to seal with: the number is not kept at all, only its last four (the check screen says so).
    }
  }
  store().invoices.set(inv.id, inv);
  return { invoice: inv, text: inv.document!.lines.join('\n') };
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
  // A saved, unchanged recipient: the check that made it known ("by call-back, 2 Sep"), as it was done.
  if (status === 'known' && known) bankDetailsVerified = { by: known.by, method: known.method, at: known.at };
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

/* ------------------------------------------------------------------ transfer (no invoice) */

const TRANSFER_FIELDS: InvoiceFieldName[] = ['supplierName', 'invoiceNumber', 'amountPhpMinor', 'dueDate', 'supplierBank', 'supplierAccountLast4'];

/**
 * A transfer with no invoice: the person types who and how much, and it runs the same path as an
 * invoice from here (quote, rules, one approval on the device, proof). Nothing is read, so Zeke drafts
 * nothing ("extractor: none"); the person who typed it confirms every field by sending it. A new
 * recipient still needs its bank details verified by call-back, the same rule as a new supplier.
 */
export function startTransfer(
  orgId: string,
  input: {
    /** A saved recipient (prompt 10 §5.3): its details, and its call-back, come from the saved record. */
    recipientId?: string;
    recipient?: { name: string; bank: string; accountLast4: string };
    amountPhpMinor: string;
    reference?: string | null;
    verification?: { by: string; method: 'call-back' | 'supplier-account' } | null;
    by?: string;
  },
  now = new Date(),
): InvoiceRecord {
  const org = getOrg(orgId);
  requireVault(org);
  if (input.recipientId) {
    const saved = org.suppliers.find((s) => s.id === input.recipientId);
    if (!saved) throw new ServiceError('recipient_not_found', 'That recipient is not on your saved list.', 404);
    // Saved details are "known" only when checked and unchanged; otherwise the rules refuse the quote.
    input = { ...input, recipient: { name: saved.name, bank: saved.bank, accountLast4: saved.accountLast4 }, verification: null };
  }
  if (!input.recipient) throw new ServiceError('bad_request', 'Choose who receives it.', 422);
  const day = utcDay(now);
  const reference = (input.reference ?? '').trim() || `TRF-${day.replaceAll('-', '')}-${randomHex(2).toUpperCase()}`;
  let amount: bigint;
  try {
    amount = BigInt(input.amountPhpMinor);
  } catch {
    throw new ServiceError('bad_request', 'The amount is not a valid number of centavos.');
  }
  const candidate = {
    invoiceNumber: reference,
    supplierName: input.recipient.name.trim(),
    supplierBank: input.recipient.bank.trim(),
    supplierAccountLast4: input.recipient.accountLast4.trim(),
    amountPhpMinor: amount,
    dueDate: day,
  };
  const parsed = InvoiceFieldsSchema.safeParse(candidate);
  if (!parsed.success) {
    const bad = parsed.error.issues.map((i) => ({ invoiceNumber: 'reference (letters, digits, - / .)', supplierName: 'recipient name', supplierBank: 'bank', supplierAccountLast4: 'last four account digits', amountPhpMinor: 'amount' })[String(i.path[0])] ?? String(i.path[0]));
    throw new ServiceError('bad_request', `Check the ${[...new Set(bad)].join(', ')}.`, 422);
  }
  const fields = parsed.data as InvoiceFields;
  const { status } = bankStatusFor(org, fields);
  const inv: InvoiceRecord = {
    id: `inv_${randomHex(8)}`,
    orgId: org.id,
    createdAt: nowIso(now),
    source: 'transfer',
    draft: {
      draft: true,
      extractor: 'none',
      fields,
      sources: {},
      suspicious: false,
      suspiciousReasons: [],
      needsConfirmation: TRANSFER_FIELDS,
      notes: [`Typed in by ${input.by?.trim() || org.personName} for a transfer. No invoice document; nothing was read.`],
    },
    bankStatus: status,
    bankVerification: null,
    confirmed: null,
    saltHex: null,
  };
  store().invoices.set(inv.id, inv);
  if (status !== 'known' && input.verification) {
    verifyBank(orgId, inv.id, { by: input.verification.by, method: input.verification.method, bank: fields.supplierBank, accountLast4: fields.supplierAccountLast4 });
  }
  confirmInvoice(orgId, inv.id, {
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)])),
    confirmed: TRANSFER_FIELDS,
    confirmedBy: input.by,
  });
  return inv;
}

/**
 * A payment to another business on Splash (prompt 10 §5.1, "A business on Splash"): straight into its
 * own account, in US dollars, with no conversion and no Splash fee. The payee comes from the server's
 * directory (lib/server/splash-directory.ts, read again here by the route), never from the browser.
 * The same path from here: quote, rules, the approval on a device, proof (kind 4).
 */
export function startPeerTransfer(
  orgId: string,
  input: { payee: Omit<PeerDestination, 'amountUsdMinor' | 'note'>; amountUsdMinor: string; note?: string | null; reference?: string | null; by?: string },
  now = new Date(),
): InvoiceRecord {
  const org = getOrg(orgId);
  requireVault(org);
  if (input.payee.payeeOrgId === orgId) throw new ServiceError('bad_request', 'That is your own company. To move money between your accounts, use Treasury.', 422);
  let amount: bigint;
  try {
    amount = BigInt(input.amountUsdMinor);
  } catch {
    throw new ServiceError('bad_request', 'The amount is not a valid number.', 422);
  }
  if (amount <= 0n) throw new ServiceError('bad_request', 'Enter an amount above zero.', 422);
  const day = utcDay(now);
  const reference = (input.reference ?? '').trim() || `SPL-${day.replaceAll('-', '')}-${randomHex(2).toUpperCase()}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9/.-]{0,63}$/.test(reference)) throw new ServiceError('bad_request', 'A reference is letters, digits and - / . only.', 422);
  const note = (input.note ?? '').trim().slice(0, 140) || null;
  const by = input.by?.trim() || org.personName;
  const fields: InvoiceFields = { invoiceNumber: reference, supplierName: input.payee.payeeName, supplierBank: 'Splash', supplierAccountLast4: '', amountPhpMinor: 0n, dueDate: day };
  const salt = invoiceSalt(org, { ...fields, einvoiceRef: `peer:${input.payee.payeeOrgId}:${amount}` });
  const at = nowIso(now);
  const inv: InvoiceRecord = {
    id: `inv_${randomHex(8)}`,
    orgId: org.id,
    createdAt: at,
    source: 'peer',
    peer: { ...input.payee, amountUsdMinor: amount, note },
    draft: {
      draft: true,
      extractor: 'none',
      fields,
      sources: {},
      suspicious: false,
      suspiciousReasons: [],
      needsConfirmation: [],
      notes: [`Typed in by ${by} for a payment to ${input.payee.payeeName} on Splash. Nothing was read.`],
    },
    bankStatus: 'known',
    bankVerification: null,
    confirmed: {
      ...fields,
      confirmedBy: by,
      confirmedAt: at,
      commitmentHex: computeInvoiceCommitment(fields, salt),
      // The payee is a verified company the directory found: there are no bank details to call back.
      bankDetailsVerified: { by: 'Splash directory', method: 'existing-record', at },
    },
    saltHex: bytesToHex(salt),
  };
  store().invoices.set(inv.id, inv);
  return inv;
}

/**
 * A request from a business on Splash, paid (prompt 10 §6.3): the person who pressed Pay confirms it.
 * Nothing to read and no bank details to call back: the money goes into the requester's own Payments
 * account, which the caller checked is still the account on record. Confirming twice changes nothing.
 */
export function confirmRequestBill(orgId: string, invoiceId: string, by: string, now = new Date()): InvoiceRecord {
  const org = getOrg(orgId);
  const inv = getInvoice(orgId, invoiceId);
  if (inv.source !== 'request' || !inv.request || !inv.peer) throw new ServiceError('bad_request', 'That is not a request from a business on Splash.', 400);
  if (inv.confirmed) return inv;
  const fields: InvoiceFields = { ...inv.draft.fields, dueDate: inv.request.dueDate };
  const salt = invoiceSalt(org, { ...fields, einvoiceRef: `request:${inv.request.requestId}:${inv.peer.amountUsdMinor}` });
  const at = nowIso(now);
  inv.confirmed = {
    ...fields,
    confirmedBy: by.trim() || org.personName,
    confirmedAt: at,
    commitmentHex: computeInvoiceCommitment(fields, salt),
    bankDetailsVerified: { by: 'Splash directory', method: 'existing-record', at },
  };
  inv.saltHex = bytesToHex(salt);
  return inv;
}

/* ------------------------------------------------------------------ payments: state and helpers */

/**
 * The payment state machine (payment-machine.ts) through the repository (payment-repo.ts): every
 * state change below is a compare-and-set on (state, version), and every chain call is recorded
 * under `paymentId:step` with its signature before it is broadcast. A crashed worker resumes from
 * the stored state (`resumePayment`) without sending anything twice.
 */
const repo = () => runtime().payments;

export async function getPayment(paymentId: string): Promise<PaymentRecord> {
  const p = await repo().get(paymentId);
  if (!p) throw new ServiceError('payment_not_found', 'That payment is not on the server. The demo resets when the server restarts.', 404);
  return p;
}

/** A lost compare-and-set is a payment someone else moved on: say so, change nothing. */
async function cas<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof StateConflictError) {
      const now = e.actual ? STATE_LABEL[e.actual.state].toLowerCase() : 'gone';
      throw new ServiceError('wrong_state', `This payment changed in another window (it is now ${now}). Refresh before going on.`, 409);
    }
    if (e instanceof IllegalTransitionError) throw new ServiceError('wrong_state', 'That step does not apply to this payment any more. Refresh before going on.', 409);
    throw e;
  }
}

export function serializeIx(ix: TransactionInstruction): SerializedInstruction {
  return {
    programId: ix.programId.toBase58(),
    keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
    dataBase64: Buffer.from(ix.data).toString('base64'),
  };
}

export function deserializeIx(s: SerializedInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(s.programId),
    keys: s.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
    data: Buffer.from(s.dataBase64, 'base64'),
  });
}

/** What the approver is agreeing to pay, and to whom. Re-checked before every device prompt (§5.4). */
function payeeHashOf(p: PaymentRecord, q: RouteQuote): string {
  const inv = getInvoice(p.orgId, p.invoiceId);
  const c = inv.confirmed!;
  return bytesToHex(
    sha256(
      utf8ToBytes(
        canonicalJson({
          quoteId: q.id,
          network: q.target.network,
          depositAddress: q.target.depositAddress,
          payoutDeposit: p.payout.deposits.find((d) => d.network === q.target.network)?.address ?? null,
          supplierName: c.supplierName,
          bank: c.supplierBank,
          accountLast4: c.supplierAccountLast4,
          amountPhpMinor: c.amountPhpMinor,
          sourceMinor: q.source.amountMinor,
          splashMinor: q.costs.splashMinor,
        }),
      ),
    ),
  );
}

/** Reserve the invoice and the daily limit before anything is sent, so a parallel approval cannot double pay. */
function reserve(p: PaymentRecord, q: RouteQuote, now: Date) {
  const org = getOrg(p.orgId);
  const inv = getInvoice(p.orgId, p.invoiceId);
  if (!org.seenCommitments.includes(inv.confirmed!.commitmentHex)) org.seenCommitments.push(inv.confirmed!.commitmentHex);
  const day = utcDay(now);
  org.dailyDebits[day] = (org.dailyDebits[day] ?? 0n) + q.source.amountMinor;
  return () => release(p, q, day);
}

function release(p: PaymentRecord, q: RouteQuote, day: string) {
  const org = getOrg(p.orgId);
  const inv = getInvoice(p.orgId, p.invoiceId);
  org.seenCommitments = org.seenCommitments.filter((c) => c !== inv.confirmed!.commitmentHex);
  org.dailyDebits[day] = (org.dailyDebits[day] ?? 0n) - q.source.amountMinor;
}

/* ------------------------------------------------------------------ quote and route */

/**
 * `allowShort` (a transfer's Step 3): when the payments vault cannot cover any route yet, quote every
 * route anyway, so the person sees what it costs and chooses how to fund it. No route can be chosen
 * for approval until the vault holds the money (selectRoute checks the balance again), and the
 * execute is simulated before it is sent, as for every payment.
 */
export async function quote(orgId: string, invoiceId: string, opts: { now?: Date; paymentId?: string; allowShort?: boolean } = {}): Promise<PaymentRecord> {
  const org = getOrg(orgId);
  const vault = requireVault(org);
  const inv = getInvoice(orgId, invoiceId);
  if (!inv.confirmed) throw new ServiceError('fields_unconfirmed', 'Confirm the invoice fields first.', 409);
  const now = opts.now ?? new Date();
  const paymentId = opts.paymentId ?? `pay_${randomHex(8)}`;
  const kind: 'bank' | 'peer' = paysPeer(inv) ? 'peer' : 'bank';
  const priced = kind === 'peer' ? await pricePeer(vault, inv, paymentId, now, opts.allowShort ?? false) : await priceBank(org, vault, inv, paymentId, now, opts.allowShort ?? false);
  const { engine, router, payout } = priced;
  // Prompt 11 §4.3: recorded at quote time; null on a bank payout.
  const feeAvoidedMinor = priced.feeAvoidedMinor;

  const fresh = (d: PaymentRecord) => {
    // A proposal abandoned with approvals on it (its quote ran out): they belong to that quote, not the
    // new one. The new proposal starts at 0 of N, and the card says why (prompt 10 §5.7). Without this,
    // the old approvals counted toward the new proposal's threshold off chain.
    if (d.approvedBy.length > 0 || d.transactionIndex !== null) {
      const previous = d.selectedQuoteId ? findQuote(d, d.selectedQuoteId) : null;
      d.approvalsReset = { at: nowIso(now), previous: d.approvedBy.length, previousYouPayMinor: previous?.source.amountMinor ?? null };
      d.approvedBy = [];
      d.pendingApprover = null;
      d.approvals = [];
      d.transactionIndex = null;
      d.plan = null;
    }
    d.engine = engine;
    d.router = router;
    d.payout = payout;
    d.feeAvoidedMinor = feeAvoidedMinor;
    d.selectedQuoteId = null;
    d.policy = null;
    d.approval = null;
    d.prepared = null;
    d.payeeHash = null;
    d.problem = null;
    d.threshold = vault.threshold;
  };

  const existing = opts.paymentId ? await repo().get(paymentId) : null;
  if (existing) {
    if (existing.orgId !== org.id) throw new ServiceError('payment_not_found', 'That payment is not on the server for this company.', 404);
    return cas(() => repo().transition(paymentId, { from: ['quoted', 'checked', 'rejected_by_policy', 'quote_expired', 'proposal_failed'], version: existing.version }, 'quoted', fresh, 're-quoted', now));
  }
  const record: PaymentRecord = {
    id: paymentId,
    orgId: org.id,
    invoiceId: inv.id,
    kind,
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
    state: 'draft',
    version: 0,
    threshold: vault.threshold,
    approvedBy: [],
    pendingApprover: null,
    payeeHash: null,
    transactionIndex: null,
    plan: null,
    execution: { attempt: 0, signature: null, confirmedAt: null, finalizedAt: null, lastLogs: null },
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
    feeAvoidedMinor,
  };
  const drafted = await repo().create(record, 'invoice confirmed');
  return cas(() => repo().transition(drafted.id, { from: 'draft', version: drafted.version }, 'quoted', undefined, 'quoted', now));
}

/** A bank payout: the partner's quotes on each network, ranked by the engine, explained by Zeke. */
async function priceBank(org: OrgRecord, vault: NonNullable<OrgRecord['vault']>, inv: InvoiceRecord, paymentId: string, now: Date, allowShort: boolean) {
  const rt = runtime();
  const amountPhpMinor = inv.confirmed!.amountPhpMinor;
  // A checked saved recipient with a full number in the vault: the partner's instruction gets it, read
  // just now and kept nowhere (the payout record keeps bank and last4). Unchecked: last4 only, and the
  // rules refuse the payment anyway.
  const c0 = inv.confirmed!;
  const saved = org.suppliers.find((s) => s.name === c0.supplierName && s.bank === c0.supplierBank && s.accountLast4 === c0.supplierAccountLast4);
  // The bank decides the rail where it takes only one (banks.ts); Step 2 named the same rail.
  const bankCode = saved?.bankCode ?? null;
  const partnerQuotes = (['solana', 'polygon'] as const).map((network) => rt.partner.quote({ amountPhpMinor, bankCode }, { network, now }));
  // A checked saved recipient's number first; else the number printed on this invoice, once its details
  // passed a call-back (prompt 10 §6.2).
  const full = saved?.secretId && saved.verified && !saved.pendingCallBack ? await openForPayout(org.id, saved) : inv.accountSecretId && c0.bankDetailsVerified ? await openInvoiceForPayout(org.id, inv) : null;
  const payout = rt.partner.createPayout({
    paymentId,
    amountPhpMinor,
    expectedUsdcMinor: partnerQuotes[0]!.grossUsdcMinor,
    beneficiary: { bank: c0.supplierBank, accountLast4: c0.supplierAccountLast4, ...(full ? { accountNumber: full.accountNumber } : {}) },
    now,
  });
  const deposits = Object.fromEntries(payout.deposits.map((d) => [d.network, d.address]));
  const balance = await rt.chain.getUsdcBalance(vault.vaultPda);
  const engineFor = (senderBalanceUsdcMinor: bigint) =>
    quoteRoutes({
      paymentId,
      amount: { amountPhpMinor },
      senderBalanceUsdcMinor,
      partner: rt.partner.entry,
      partnerQuotes,
      deposits,
      // No Fast Transfer fee is read offline (it comes from Circle's API), so no Fast candidate.
      now,
      homeChain: 'solana',
    });
  let engine = engineFor(balance);
  if (allowShort && !POLICIES.some((p) => engine.picks[p])) {
    const needs = engine.excluded.flatMap((e) => (e.reason === 'insufficient_balance' && e.neededMinor !== undefined ? [e.neededMinor] : []));
    // Priced as if the vault held enough for every route; funding comes before any approval.
    if (needs.length) engine = engineFor(needs.reduce((a, b) => (b > a ? b : a)));
  }
  if (!POLICIES.some((p) => engine.picks[p])) {
    const needs = engine.excluded.flatMap((e) => (e.reason === 'insufficient_balance' && e.neededMinor !== undefined ? [e.neededMinor] : []));
    if (needs.length) {
      // The cheapest route's need, so the shortfall is the least that unblocks this payment.
      const neededMinor = needs.reduce((a, b) => (b < a ? b : a));
      const treasuryMinor = await rt.chain.getUsdcBalance(treasuryVaultPda(vault.multisigPda));
      const what = inv.source === 'transfer' ? 'this transfer' : 'this invoice';
      throw new ServiceError('insufficient_balance', `Your payments vault is short for ${what}. Move USDC in from your treasury or add USDC, then get a new quote.`, 409, {
        invoiceId: inv.id,
        balanceUsdcMinor: balance.toString(),
        neededUsdcMinor: neededMinor.toString(),
        shortUsdcMinor: (neededMinor - balance).toString(),
        treasuryUsdcMinor: treasuryMinor.toString(),
      });
    }
    throw new ServiceError('no_route', 'No route can pay this invoice right now. Try again in a minute.', 409);
  }
  const allQuotes = POLICIES.flatMap((p) => engine.ranked[p]);
  const router = explainRoutes({ picks: engine.picks, ranked: engine.ranked, homeLane: engine.homeLane, selected: 'cheapest' });
  assertRouterRefersToEngineQuote(router, allQuotes);
  // A bank payout pays its fee; only an inside-Splash payment keeps one (prompt 11 §4.3).
  return { engine, router, payout, feeAvoidedMinor: null };
}

/**
 * A payment into another business's own Splash account (prompt 10 §5.1): one route, straight there.
 * No partner, no conversion, no Splash fee (SPLASH_PEER_FEE_BPS = 0, confirmed): you pay what they get.
 */
export const SPLASH_PEER_FEE_BPS = 0;
async function pricePeer(vault: NonNullable<OrgRecord['vault']>, inv: InvoiceRecord, paymentId: string, now: Date, allowShort: boolean) {
  const rt = runtime();
  const peer = inv.peer!;
  const amount = peer.amountUsdMinor;
  const balance = await rt.chain.getUsdcBalance(vault.vaultPda);
  if (balance < amount && !allowShort) {
    const treasuryMinor = await rt.chain.getUsdcBalance(treasuryVaultPda(vault.multisigPda));
    throw new ServiceError('insufficient_balance', 'Your Payments account is short for this payment. Move money in from your reserve or add money, then get a new quote.', 409, {
      invoiceId: inv.id,
      balanceUsdcMinor: balance.toString(),
      neededUsdcMinor: amount.toString(),
      shortUsdcMinor: (amount - balance).toString(),
      treasuryUsdcMinor: treasuryMinor.toString(),
    });
  }
  const q: RouteQuote = {
    id: `rq_peer_${randomHex(8)}`,
    policy: 'cheapest',
    source: { lane: 'solana', token: 'USDC', amountMinor: amount },
    target: { network: 'solana', token: 'USDC', partnerId: 'splash', depositAddress: peer.payeeVaultPda },
    steps: [{ kind: 'transfer', provider: 'splash · into a Splash account', feeMinor: 0n, etaSec: 0 }],
    costs: { routeMinor: 0n, partnerMinor: 0n, splashMinor: 0n, allInBps: SPLASH_PEER_FEE_BPS },
    fx: { pair: 'USD/USD', rate: '1', reference: 'No conversion', capturedAt: nowIso(now) },
    netLocal: { currency: 'USD', amountMinor: amount },
    etaSec: 0,
    expiresAt: new Date(now.getTime() + MAX_QUOTE_TTL_SEC * 1000).toISOString(),
    flags: [],
  };
  const noLane = (policy: Policy) => ({ policy, homeChain: 'solana', applied: false, reason: 'winner_is_home_lane' as const, bestQuoteId: q.id, homeQuoteId: q.id });
  const engine: EngineResult = {
    paymentId,
    mode: 'usdc_send',
    generatedAt: nowIso(now),
    homeChain: 'solana',
    picks: { cheapest: q, fastest: q, safest: q },
    ranked: { cheapest: [q], fastest: [q], safest: [q] },
    homeLane: { cheapest: noLane('cheapest'), fastest: noLane('fastest'), safest: noLane('safest') },
    fees: {},
    excluded: [],
    assumptions: { ...DEFAULT_ASSUMPTIONS },
  };
  const text = `Straight into ${peer.payeeName}'s Splash account: they get ${formatUsd(amount)}, and there is no Splash fee.`;
  const router: RouterOutput = { draft: true, primary: { refersTo: q.id, policy: 'cheapest', text }, alternative: null };
  const payout: PartnerPayout = {
    payoutId: `peer_${paymentId}`,
    paymentId,
    partnerId: 'splash',
    amountPhpMinor: 0n,
    expectedUsdcMinor: amount,
    rail: 'Splash',
    beneficiary: { bank: 'Splash', accountLast4: '' },
    deposits: [{ network: 'solana', token: 'USDC', address: peer.payeeVaultPda }],
    status: 'AWAITING_DEPOSIT',
    createdAt: nowIso(now),
  };
  return { engine, router, payout, feeAvoidedMinor: bankFeeFor(amount, now) };
}

/** Any well-formed deposit address: only a bank route's price is read here; nothing is sent to it. */
const PRICING_DEPOSITS = { solana: '11111111111111111111111111111111', polygon: `0x${'0'.repeat(40)}` };

/**
 * Prompt 11 §4.3, "Fees kept inside Splash": what the cheapest bank payout of the same US$ amount would
 * have charged (route, payout partner and Splash fees), priced by the same engine and partner at the
 * moment an inside-Splash payment is quoted. null when no bank route prices it: nothing is recorded
 * rather than a guess, and nothing is estimated later.
 */
export function bankFeeFor(amountUsdcMinor: bigint, now: Date): bigint | null {
  try {
    const rt = runtime();
    const partnerQuotes = (['solana', 'polygon'] as const).map((network) => rt.partner.quote({ amountUsdcMinor }, { network, now }));
    const engine = quoteRoutes({
      paymentId: 'fee-avoided',
      amount: { amountUsdcMinor },
      // Priced as if the account held enough: this is a price, not a payment.
      senderBalanceUsdcMinor: amountUsdcMinor * 2n + 1_000_000_000n,
      partner: rt.partner.entry,
      partnerQuotes,
      deposits: PRICING_DEPOSITS,
      now,
      homeChain: 'solana',
    });
    const q = engine.picks.cheapest;
    return q ? q.costs.routeMinor + q.costs.partnerMinor + q.costs.splashMinor : null;
  } catch {
    return null;
  }
}

/** Why approvals started again, in words: the rate moved (You pay changed), or the quote ran out. */
export function resetNoteFor(reset: PaymentRecord['approvalsReset'], youPayMinor: bigint | null): string | null {
  if (!reset || reset.previous === 0) return null;
  if (reset.previousYouPayMinor !== null && youPayMinor !== null && reset.previousYouPayMinor !== youPayMinor) return 'The rate moved; approvals start again.';
  return 'The quote ran out; approvals start again.';
}

/**
 * Joint control on the approval card (prompt 10 §5.7): "1 of 2 approved", who approved, who is still
 * to approve, and why approvals started again if a re-quote reset them.
 */
export function approvalStatus(p: PaymentRecord, org: OrgRecord) {
  const name = (key: string) => org.memberNames?.[key] ?? (key === org.keys.device?.publicKey ? org.personName : 'The other approver');
  const approvers = approverKeys(org);
  const q = p.selectedQuoteId ? findQuote(p, p.selectedQuoteId) : null;
  return {
    approved: p.approvedBy.length,
    threshold: p.threshold,
    approvedBy: p.approvedBy.map((key) => ({ key, name: name(key) })),
    waitingFor: p.approvedBy.length > 0 && p.approvedBy.length < p.threshold ? approvers.filter((k) => !p.approvedBy.includes(k)).map((key) => ({ key, name: name(key) })) : [],
    resetNote: resetNoteFor(p.approvalsReset ?? null, q?.source.amountMinor ?? null),
  };
}

/** One reminder per payment per this long: pressing Remind twice sends one notice. */
export const REMIND_EVERY_MS = 10 * 60_000;

/**
 * "Remind": an in-app notice to the approvers who haven't approved a payment that is waiting at
 * "1 of 2". It never approves anything and never moves money.
 */
export async function remindApprover(orgId: string, paymentId: string, by: string, now = new Date()) {
  const p = await getPayment(paymentId);
  if (p.orgId !== orgId) throw new ServiceError('payment_not_found', 'That payment is not on the server for this company.', 404);
  const org = getOrg(orgId);
  const status = approvalStatus(p, org);
  if (p.state !== 'proposed' || status.waitingFor.length === 0) throw new ServiceError('wrong_state', 'Nobody is waiting to approve this payment.', 409);
  const notices = (org.notifications ??= []);
  const last = notices.filter((n) => n.kind === 'approval_reminder' && n.paymentId === p.id).at(-1);
  if (last && now.getTime() - Date.parse(last.at) < REMIND_EVERY_MS) {
    return { sent: false, to: status.waitingFor.map((w) => w.name), nextAt: new Date(Date.parse(last.at) + REMIND_EVERY_MS).toISOString() };
  }
  for (const w of status.waitingFor) notices.push({ id: `ntf_${randomHex(8)}`, kind: 'approval_reminder', paymentId: p.id, to: w.key, by, at: nowIso(now), read: false });
  return { sent: true, to: status.waitingFor.map((w) => w.name), nextAt: new Date(now.getTime() + REMIND_EVERY_MS).toISOString() };
}

export async function requote(paymentId: string, now = new Date(), opts: { allowShort?: boolean } = {}) {
  const p = await getPayment(paymentId);
  if (isCommitted(p.state)) throw new ServiceError('wrong_state', 'This payment has already been sent. It cannot be re-quoted.', 409);
  return quote(p.orgId, p.invoiceId, { now, paymentId: p.id, allowShort: opts.allowShort });
}

/**
 * Drop a payment nobody has sent: it was quoted, checked, blocked, expired, or its proposal never
 * reached the vault. It moves to the terminal state "discarded" with who and when on its
 * transition row; nothing on chain is touched, and USDC already brought into the payments vault
 * for it stays there. Once anything was sent, it cannot be discarded.
 */
export async function discardPayment(paymentId: string, by: string, now = new Date()): Promise<PaymentRecord> {
  const p = await getPayment(paymentId);
  if (p.state === 'discarded') return p;
  if (!DISCARDABLE_STATES.includes(p.state)) {
    throw new ServiceError('wrong_state', `This payment is ${STATE_LABEL[p.state].toLowerCase()}. Only a payment nothing was sent for can be discarded.`, 409);
  }
  return cas(() => repo().transition(p.id, { from: p.state, version: p.version }, 'discarded', (d) => {
    d.prepared = null;
    d.problem = null;
  }, `discarded by ${by.trim() || 'a member'}`, now));
}

/** The payments vault must hold the route's full cost before it can be chosen or approved. */
/**
 * Does the Payments account hold this route's cost? With `reserve`, the reserve may cover what it is short
 * of: that shortfall is moved first, in the same approval sequence (prompt 10 §5.6, step 2 of the plan),
 * and the approval card says so. The proposal itself is built only once the Payments account holds it all
 * (prepareApproval checks without `reserve`).
 */
async function assertVaultCovers(p: PaymentRecord, q: RouteQuote, opts: { reserve?: boolean } = {}): Promise<{ reserveMoveMinor: bigint }> {
  const vault = requireVault(getOrg(p.orgId));
  const rt = runtime();
  const balance = await rt.chain.getUsdcBalance(vault.vaultPda);
  if (balance >= q.source.amountMinor) return { reserveMoveMinor: 0n };
  const treasuryMinor = await rt.chain.getUsdcBalance(treasuryVaultPda(vault.multisigPda));
  const shortMinor = q.source.amountMinor - balance;
  if (opts.reserve && treasuryMinor >= shortMinor) return { reserveMoveMinor: shortMinor };
  throw new ServiceError('insufficient_balance', 'Your payments vault does not hold this payment yet. Pay from your vaults or fund it another way first.', 409, {
    invoiceId: p.invoiceId,
    balanceUsdcMinor: balance.toString(),
    neededUsdcMinor: q.source.amountMinor.toString(),
    shortUsdcMinor: (q.source.amountMinor - balance).toString(),
    treasuryUsdcMinor: treasuryMinor.toString(),
  });
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
    ...(inv.peer ? { peerAmountUsdMinor: inv.peer.amountUsdMinor } : {}),
  });
}

/** The rules, in a person's words for this kind of payment (an invoice, a transfer, a payment to a Splash business). */
function checkLines(inv: InvoiceRecord, policy: EnginePolicyResult) {
  const transfer = inv.source === 'transfer';
  const peer = inv.peer ?? null;
  const label = (name: string) => (peer && PEER_CHECK_LABELS[name]) || (transfer && TRANSFER_CHECK_LABELS[name]) || CHECK_LABELS[name] || name;
  return [...policy.checks, ...policy.extraChecks].map((x) => ({ name: x.name, label: label(x.name), passed: x.passed, detail: x.detail }));
}

/**
 * Step 3's "Passed 8 of 8 rules" (prompt 10 §5.6): the rules the approval runs, for the route a person
 * is looking at, read-only. Nothing changes: choosing the route (selectRoute) and approving it
 * (prepareApproval) run them again for real.
 */
export async function previewChecks(paymentId: string, quoteId: string, now = new Date()) {
  const p = await getPayment(paymentId);
  const q = findQuote(p, quoteId);
  if (!q) throw new ServiceError('bad_request', 'That route is not one of this payment’s quotes. Get a new quote.', 400);
  const checks = checkLines(getInvoice(p.orgId, p.invoiceId), runPolicy(p, q, now));
  return { quoteId: q.id, passed: checks.filter((c) => c.passed).length, total: checks.length, checks: checks.map((c) => ({ name: c.name, label: c.label, passed: c.passed })) };
}

function buildApprovalCard(p: PaymentRecord, q: RouteQuote, policy: EnginePolicyResult, reserveMoveMinor: bigint = p.approval?.reserveMoveMinor ?? 0n): ApprovalCard {
  const org = getOrg(p.orgId);
  const inv = getInvoice(p.orgId, p.invoiceId);
  const c = inv.confirmed!;
  const ticket = p.engine.fees[q.id]?.ticketUsdcMinor ?? 0n;
  const kind = routeKindOf(q);
  const lane = laneOf(kind);
  const arrival = arrivalOf(q);
  const covers = policy.extraChecks.find((x) => x.name === 'amount_covers_invoice');
  const transfer = inv.source === 'transfer';
  const peer = inv.peer ?? null;
  const checks = checkLines(inv, policy);
  return {
    paymentId: p.id,
    quoteId: q.id,
    supplierName: c.supplierName,
    bank: c.supplierBank,
    accountLast4: c.supplierAccountLast4,
    verified: c.bankDetailsVerified,
    receivePhpMinor: peer ? 0n : q.netLocal.amountMinor,
    ...(peer ? { receiveUsdMinor: q.netLocal.amountMinor, intoLine: `Into ${peer.payeeName}'s Splash account` } : {}),
    youPayUsdcMinor: q.source.amountMinor,
    reserveMoveMinor,
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
    depositAddress: q.target.depositAddress,
    draftedBy: transfer || peer ? c.confirmedBy : 'Zeke',
    kind: peer ? 'peer' : transfer ? 'transfer' : 'invoice',
    purpose: transfer ? purposeLine(inv.paymentDetails) : peer?.note ?? null,
    simulated: runtime().env.mode === 'offline',
  };
}

export async function selectRoute(paymentId: string, input: { quoteId: string; rehearsal?: Rehearsal }, now = new Date()): Promise<PaymentRecord> {
  const p = await getPayment(paymentId);
  if (!['quoted', 'checked', 'rejected_by_policy'].includes(p.state)) {
    if (p.state === 'quote_expired') throw new ServiceError('quote_expired', 'Quote expired. Refresh to get a new quote.', 409);
    throw new ServiceError('wrong_state', 'This payment has already been approved.', 409);
  }
  const q = findQuote(p, input.quoteId);
  if (!q) throw new ServiceError('bad_request', 'That route is not one of this payment’s quotes. Get a new quote.', 400);
  const inv = getInvoice(p.orgId, p.invoiceId);
  if (inv.source === 'transfer') {
    const missing = missingDetails(inv.paymentDetails);
    if (missing.length) throw new ServiceError('details_required', `The payout partner needs these first: ${missing.join(', ')}.`, 422, { missing });
  }
  const { reserveMoveMinor } = await assertVaultCovers(p, q, { reserve: true });
  const rt = runtime();
  const rehearsal = rt.env.mode === 'offline' ? (input.rehearsal ?? 'none') : 'none';
  const policy = runPolicy({ ...p, rehearsal }, q, now);
  const expired = isQuoteExpired(q, now);
  const to: PaymentState = expired ? 'quote_expired' : policy.allowed ? 'checked' : 'rejected_by_policy';
  return cas(() =>
    repo().transition(p.id, { from: p.state, version: p.version }, to, (d) => {
      d.rehearsal = rehearsal;
      d.selectedQuoteId = q.id;
      d.policy = policy;
      d.approval = buildApprovalCard(d, q, policy, reserveMoveMinor);
      d.prepared = null;
      d.payeeHash = policy.allowed && !expired ? payeeHashOf(d, q) : null;
      d.problem = policy.allowed && !expired ? null : problemFromPolicy(policy);
    }, `route ${q.id}`, now),
  );
}

function problemFromPolicy(policy: EnginePolicyResult): { code: string; message: string } {
  const failed = new Set([...policy.checks, ...policy.extraChecks].filter((c) => !c.passed).map((c) => c.name));
  // The support reference is the screening result's own id, shown without the provider's internal prefix.
  if (failed.has('kyt')) return { code: 'kyt_flagged', message: `The screening rule stopped it: screening flagged where this payment goes, so nothing was sent. Your company's owner can ask support to review it (reference SCR-${policy.kyt.resultId.slice(-8).toUpperCase()}).` };
  if (failed.has('quote_expiry')) return { code: 'quote_expired', message: 'Quote expired before you approved. Refresh to get a new quote.' };
  if (failed.has('duplicate_invoice')) return { code: 'duplicate_invoice', message: 'This invoice was already paid or is being paid. Nothing was sent.' };
  if (failed.has('bank_details_verified')) return { code: 'bank_unverified', message: 'New bank details. Verify by phone before paying.' };
  if (failed.has('per_payment_limit') || failed.has('daily_limit')) return { code: 'limit', message: `Your ${failed.has('per_payment_limit') ? 'per-payment' : 'daily'} limit stopped it. Split it or wait until tomorrow; your company's owner can change limits in Rules.` };
  return { code: 'policy_denied', message: `Payment blocked by your rules: ${policy.reasons.join('; ')}.` };
}

/* ------------------------------------------------------------------ approve and execute */

/** The refuse-service switch (§5.6): a suspended company gets no Kora signature and no new proposal. */
export function assertServiceable(orgId: string) {
  const org = getOrg(orgId);
  if (org.suspended) {
    throw new ServiceError('org_suspended', 'Splash has paused service for this company, so nothing new can be sent. Your money stays in your vault, which only your approvers control. Contact support.', 403);
  }
}

/** Device keys that may approve routine payments. The recovery kit is for recovery, not payments. */
function approverKeys(org: OrgRecord): string[] {
  return (org.vault?.members ?? []).filter((m) => m.role === 'admin_device' || m.role === 'approver_device').map((m) => m.publicKey);
}

export async function budgeted(feePayer: PublicKey, ixs: TransactionInstruction[], blockhash: string, fallbackLimit: number, simulateFirst: boolean): Promise<{ ixs: TransactionInstruction[]; unitLimit: number; microLamports: bigint }> {
  const rt = runtime();
  const writable = [...new Map(ixs.flatMap((ix) => ix.keys.filter((k) => k.isWritable).map((k) => [k.pubkey.toBase58(), k.pubkey] as const))).values()];
  const estimate = await rt.chain.getPriorityFeeEstimate(writable);
  let unitLimit = fallbackLimit;
  if (simulateFirst) {
    const draft = buildSponsoredTransaction(feePayer, [...computeBudgetInstructions({ unitLimit: fallbackLimit, microLamports: 0n }), ...ixs], blockhash);
    const sim = await rt.chain.simulate(draft);
    if (sim.ok && sim.unitsConsumed) unitLimit = unitLimitFromSimulation(sim.unitsConsumed, fallbackLimit);
  }
  const microLamports = cappedMicroLamports(unitLimit, estimate);
  return { ixs: [...computeBudgetInstructions({ unitLimit, microLamports }), ...ixs], unitLimit, microLamports };
}

/** The vault transaction's instructions for the selected route. */
function buildRoutePlan(p: PaymentRecord, q: RouteQuote, vault: NonNullable<OrgRecord['vault']>, feePayer: PublicKey, keys: string[], transactionIndex: bigint) {
  const rt = runtime();
  const kind = routeKindOf(q);
  const vaultPda = new PublicKey(vault.vaultPda);
  const splashFee = q.costs.splashMinor;
  const transferAmount = q.source.amountMinor - splashFee;
  const expectedDeposit = p.payout.deposits.find((d) => d.network === q.target.network)?.address;
  if (!expectedDeposit || expectedDeposit !== q.target.depositAddress) {
    throw new ServiceError('bad_request', 'The quote’s deposit address does not match the partner’s payout. Get a new quote.', 409);
  }
  const fee = splashFee > 0n ? { feeAccountOwner: rt.feeAccountOwner.toBase58(), amountMinor: splashFee } : undefined;
  if (kind === 'solana_direct') {
    const plan = buildPayoutInstructions({
      cluster: rt.env.cluster,
      vaultPda,
      feePayer,
      destination: q.target.depositAddress,
      expectedDepositAddress: expectedDeposit,
      amountMinor: transferAmount,
      paymentId: p.id,
      reference: Keypair.generate().publicKey,
      splashKeys: keys,
      splashFee: fee,
      ...(p.kind === 'peer' ? { memoKind: 'peer' as const } : {}),
    });
    return { kind, transferAmount, splashFee, vault: plan.vaultInstructions, pre: plan.preExecuteInstructions, post: plan.postExecuteInstructions, ephemeralSigners: 0 };
  }
  if (rt.env.mode !== 'offline') {
    throw new ServiceError('devnet_not_supported', 'The CCTP route is not wired for devnet in this build: the partner cannot watch Polygon yet. Choose the Solana direct route.', 409);
  }
  const { transactionPda } = deriveProposalAddresses(new PublicKey(vault.multisigPda), transactionIndex, 1);
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
  const memo = () => buildMemoInstruction(buildPaymentMemo(p.id));
  return {
    kind,
    transferAmount,
    splashFee,
    vault: [burn.instruction, ...(feePlan?.vaultInstructions ?? []), memo()],
    pre: feePlan?.preExecuteInstructions ?? [],
    post: [memo()],
    ephemeralSigners: 1,
  };
}

function preparedMessage(id: string, purpose: PreparedMessage['purpose'], step: string, tx: VersionedTransaction, lastValidBlockHeight: number, purposes: ProposalPurpose[], budget: { unitLimit: number; microLamports: bigint }, signer: PublicKey): PreparedMessage {
  const size = tx.serialize().length;
  if (size > MAX_TRANSACTION_BYTES) throw new ServiceError('transaction_too_large', `Transaction ${id} is ${size} bytes, over the ${MAX_TRANSACTION_BYTES}-byte limit.`, 500);
  const required = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
  if (!required.some((k) => k.equals(signer))) throw new ServiceError('send_failed', 'The device key is not a signer of this transaction.', 500);
  return { id, purpose, step, txBase64: b64(tx.serialize()), messageBase64: b64(tx.message.serialize()), lastValidBlockHeight, purposes, unitLimit: budget.unitLimit, microLamports: budget.microLamports };
}

/**
 * Build the unsigned transactions this approver signs, after re-checking policy and that the payee is
 * unchanged since the route was chosen (§5.4: before the device prompt). The device key must sign every
 * one of them in the browser; the server cannot.
 *   checked        vault transaction + proposal + this approval (+ execute when that meets the threshold)
 *   proposed       one more approval (threshold > 1) (+ execute when it meets the threshold)
 *   approved,      the execute alone: after a crash between approval and execute, or rebuilt with a
 *   execute_failed fresh blockhash after the last one expired (never the old bytes again)
 */
export async function prepareApproval(paymentId: string, input: { signer?: string } = {}, now = new Date()) {
  let p = await getPayment(paymentId);
  assertServiceable(p.orgId);
  const org = getOrg(p.orgId);
  const vault = requireVault(org);
  if (!p.selectedQuoteId) throw new ServiceError('wrong_state', 'Choose a route that passes your rules first.', 409);
  if (!['checked', 'proposed', 'approved', 'execute_failed'].includes(p.state)) {
    throw new ServiceError('wrong_state', p.state === 'rejected_by_policy' || p.state === 'quote_expired' ? 'Choose a route that passes your rules first.' : `This payment is ${STATE_LABEL[p.state].toLowerCase()}; there is nothing to approve.`, 409);
  }
  const signerKey = input.signer ?? org.keys.device!.publicKey;
  if (!approverKeys(org).includes(signerKey)) throw new ServiceError('not_an_approver', 'That device is not an approver of this vault.', 403);
  const q = findQuote(p, p.selectedQuoteId)!;

  if (p.state === 'checked' || p.state === 'proposed') {
    if (p.approvedBy.includes(signerKey) || p.pendingApprover === signerKey) throw new ServiceError('already_approved', 'This device has already approved this payment.', 409);
    // Re-check before the prompt: the quote is still valid, limits pass, the payee is unchanged.
    const policy = p.state === 'checked' ? runPolicy(p, q, now) : null;
    const expired = isQuoteExpired(q, now);
    const payeeChanged = p.payeeHash !== payeeHashOf(p, q);
    if (expired || payeeChanged || (policy && !policy.allowed)) {
      const problem = payeeChanged
        ? { code: 'payee_changed', message: 'The payee or amount changed since this route was chosen. Get a new quote before approving.' }
        : expired
          ? { code: 'quote_expired', message: 'Quote expired before you approved. Refresh to get a new quote.' }
          : problemFromPolicy(policy!);
      const to: PaymentState = p.state === 'proposed' ? 'proposal_failed' : expired ? 'quote_expired' : 'rejected_by_policy';
      if (p.state === 'proposed') {
        // An approved-in-part proposal whose quote went stale is abandoned; nothing moved.
        release(p, q, utcDay(new Date(p.timeline.approvedAt ?? p.updatedAt)));
      }
      await cas(() => repo().transition(p.id, { from: p.state, version: p.version }, to, (d) => {
        if (policy) {
          d.policy = policy;
          d.approval = buildApprovalCard(d, q, policy);
        }
        d.prepared = null;
        d.problem = problem;
      }, problem.code, now));
      throw new ServiceError(problem.code === 'payee_changed' ? 'payee_changed' : expired ? 'quote_expired' : 'policy_denied', problem.message, 409);
    }
  }
  // The money is in the Payments account before the first approval (a planned reserve move lands first).
  if (p.state === 'checked') await assertVaultCovers(p, q);

  const rt = runtime();
  const feePayer = await rt.chain.getFeePayer();
  const multisigPda = new PublicKey(vault.multisigPda);
  const member = new PublicKey(signerKey);
  const keys = await splashKeys(rt);
  const { blockhash, lastValidBlockHeight } = await rt.chain.getBlockhashWithExpiry();
  const approvalsAfter = p.approvedBy.length + (p.state === 'checked' || p.state === 'proposed' ? 1 : 0);
  const includesExecute = approvalsAfter >= p.threshold;
  const messages: PreparedMessage[] = [];
  // Every transaction of this payment carries its memo at the top level, so each one reads
  // "splash:pay:v1:<paymentId>" in its Solscan program logs, not only the execute.
  const traceMemo = () => buildMemoInstruction(p.kind === 'peer' ? buildPeerMemo(p.id) : buildPaymentMemo(p.id));

  let transactionIndex = p.transactionIndex;
  let routePlan: { kind: RouteKind; transferAmount: bigint; splashFee: bigint; vault: TransactionInstruction[]; pre: TransactionInstruction[]; post: TransactionInstruction[]; ephemeralSigners: number };
  if (p.state === 'checked') {
    transactionIndex = await rt.chain.getNextTransactionIndex(multisigPda);
    routePlan = buildRoutePlan(p, q, vault, feePayer, keys, transactionIndex);
    const proposal = buildVaultProposal({ multisigPda, transactionIndex, member, feePayer, innerInstructions: routePlan.vault, ephemeralSigners: routePlan.ephemeralSigners });
    const placeholder = computeBudgetInstructions({ unitLimit: DEFAULT_UNIT_LIMITS.proposal, microLamports: 1n });
    const fits = (ixs: TransactionInstruction[]) => transactionSize(buildSponsoredTransaction(feePayer, ixs, blockhash)) <= MAX_TRANSACTION_BYTES;
    let groups: TransactionInstruction[][];
    try {
      groups = groupProposalTransactions(proposal, feePayer, blockhash, [...placeholder, traceMemo()]);
    } catch {
      // A CCTP vault transaction leaves no room for a memo beside vaultTransactionCreate. Group
      // without it, then give the memo to every transaction that still has room.
      try {
        groups = groupProposalTransactions(proposal, feePayer, blockhash, placeholder).map((g) => (fits([...g, traceMemo()]) ? [...g, traceMemo()] : g));
      } catch (e) {
        throw new ServiceError('transaction_too_large', `This payment does not fit in a Solana transaction: ${(e as Error).message}`, 500);
      }
    }
    for (const [i, raw] of groups.entries()) {
      const body = raw.slice(2); // the grouping included a compute budget placeholder for sizing; the memo stays
      const budget = await budgeted(feePayer, body, blockhash, DEFAULT_UNIT_LIMITS.proposal, i === 0);
      const purposes: ProposalPurpose[] = [];
      if (body.includes(proposal.create)) purposes.push('squads_proposal_create');
      if (body.includes(proposal.approve)) purposes.push('squads_proposal_approve');
      // Keyed by the proposal's on-chain index: a payment re-proposed after a re-quote (its first proposal
      // abandoned) sends new transactions, while a resend of the same one is still refused.
      messages.push(preparedMessage(`m${messages.length}`, 'proposal', `proposal:tx${transactionIndex}.${i}`, buildSponsoredTransaction(feePayer, budget.ixs, blockhash), lastValidBlockHeight, purposes, budget, member));
    }
  } else {
    if (transactionIndex === null || !p.plan) throw new ServiceError('wrong_state', 'This payment has no proposal yet.', 409);
    routePlan = {
      kind: routeKindOf(q),
      transferAmount: q.source.amountMinor - q.costs.splashMinor,
      splashFee: q.costs.splashMinor,
      vault: p.plan.vault.map(deserializeIx),
      pre: p.plan.preExecute.map(deserializeIx),
      post: p.plan.postExecute.map(deserializeIx),
      ephemeralSigners: p.plan.ephemeralSigners,
    };
    if (p.state === 'proposed') {
      const budget = await budgeted(feePayer, [buildProposalApprove(multisigPda, transactionIndex, member), traceMemo()], blockhash, DEFAULT_UNIT_LIMITS.proposal, true);
      messages.push(preparedMessage(`m${messages.length}`, 'approve', `approve:tx${transactionIndex}.${signerKey.slice(0, 16)}`, buildSponsoredTransaction(feePayer, budget.ixs, blockhash), lastValidBlockHeight, ['squads_proposal_approve'], budget, member));
    }
  }

  if (includesExecute || p.state === 'approved' || p.state === 'execute_failed') {
    const execute = await buildVaultExecuteInstruction({ multisigPda, transactionIndex: transactionIndex!, member, innerInstructions: routePlan.vault, ephemeralSigners: routePlan.ephemeralSigners });
    const budget = await budgeted(feePayer, [...routePlan.pre, execute, ...routePlan.post], blockhash, routePlan.kind === 'solana_direct' ? DEFAULT_UNIT_LIMITS.execute : DEFAULT_UNIT_LIMITS.executeCctp, false);
    messages.push(preparedMessage(`m${messages.length}`, 'execute', `execute:${p.execution.attempt}`, buildSponsoredTransaction(feePayer, budget.ixs, blockhash), lastValidBlockHeight, [], budget, member));
  }

  const prepared: PreparedApproval = {
    createdAt: nowIso(now),
    quoteId: q.id,
    kind: routePlan.kind,
    transactionIndex: transactionIndex!,
    signer: member.toBase58(),
    messages,
    transferAmountMinor: routePlan.transferAmount,
    splashFeeMinor: routePlan.splashFee,
    depositAddress: q.target.depositAddress,
    includesExecute: messages.some((m) => m.purpose === 'execute'),
  };
  const plan = { vault: routePlan.vault.map(serializeIx), preExecute: routePlan.pre.map(serializeIx), postExecute: routePlan.post.map(serializeIx), ephemeralSigners: routePlan.ephemeralSigners };
  p = await cas(() => repo().update(p.id, { version: p.version, states: [p.state] }, (d) => {
    d.prepared = prepared;
    if (d.state === 'checked') d.plan = plan;
  }, now));
  return { paymentId: p.id, signer: member.toBase58(), messages: messages.map((m) => ({ id: m.id, purpose: m.purpose, messageBase64: m.messageBase64 })) };
}

type SendOutcome = { status: 'confirmed' | 'finalized'; signature: string } | { status: 'failed'; signature: string | null; error: string; logs: string[] } | { status: 'expired'; signature: string } | { status: 'pending'; signature: string };

/** How long a request waits for `confirmed` before answering "still checking". Offline: no wait. */
export function confirmWaitMs(): number {
  return runtime().env.mode === 'offline' ? 0 : 45_000;
}

/**
 * Simulate, then send: the fee payer signs, the signature is recorded under `paymentId:step`, and
 * only then are the bytes broadcast (§5.1). `beforeBroadcast` runs inside that window so a state
 * claim that loses its race stops the send. Then wait for `confirmed`.
 */
async function sendStep(p: PaymentRecord, step: string, tx: VersionedTransaction, lastValidBlockHeight: number, beforeBroadcast?: (signature: string) => Promise<void>): Promise<SendOutcome> {
  const rt = runtime();
  assertServiceable(p.orgId);
  const sim = await rt.chain.simulate(tx);
  if (!sim.ok) return { status: 'failed', signature: null, error: sim.error ?? 'simulation failed', logs: sim.logs.slice(-40) };
  const key = chainCallKey(p.id, step);
  const slot = await takeSponsorSlot(p.orgId);
  let signature: string | null = null;
  try {
    const receipt = await rt.chain.sendSponsored(tx, {
      orgId: p.orgId,
      onSigned: async (sig) => {
        await repo().recordSigned({ key, paymentId: p.id, step, signature: sig, lastValidBlockHeight });
        signature = sig;
        await beforeBroadcast?.(sig);
      },
    });
    signature = receipt.signature;
  } catch (e) {
    if (!signature) {
      await slot.release(); // refused before the fee payer signed: the slot goes back
      return { status: 'failed', signature: null, error: (e as Error).message, logs: [] };
    }
    // Signed and recorded, broadcast uncertain: never resend; the poll below (or resume) decides.
  }
  const outcome = await awaitCommitment(rt.chain, { signature: signature!, lastValidBlockHeight, target: 'confirmed', timeoutMs: confirmWaitMs() });
  if (outcome.status === 'confirmed' || outcome.status === 'finalized') {
    await repo().updateCall(key, { status: outcome.status });
    return { status: outcome.status, signature: signature! };
  }
  if (outcome.status === 'failed') {
    await repo().updateCall(key, { status: 'failed', error: outcome.err });
    return { status: 'failed', signature: signature!, error: outcome.err, logs: [] };
  }
  if (outcome.status === 'expired') {
    await repo().updateCall(key, { status: 'expired' });
    return { status: 'expired', signature: signature! };
  }
  return { status: 'pending', signature: signature! };
}

function signatureRecord(purpose: ChainSignatureRecord['purpose'], signature: string): ChainSignatureRecord {
  const rt = runtime();
  return { purpose, network: 'solana', signature, cluster: rt.env.cluster, simulated: rt.env.mode === 'offline' };
}

const UNCERTAIN = { code: 'uncertain', message: "Checking whether this payment went through. Don't retry yet." };

/**
 * Execute only with the device key's signature on every prepared transaction (I-4). Signatures are
 * checked before anything is sent; a missing or wrong one sends nothing.
 */
export async function submitApproval(paymentId: string, input: { signatures?: Array<{ id: string; signature: string }>; who?: string }, now = new Date()): Promise<PaymentRecord> {
  let p = await getPayment(paymentId);
  assertServiceable(p.orgId);
  // The approver's name on the record: the signed-in person, else the company's contact (the demo).
  const who = input.who?.trim() || getOrg(p.orgId).personName;
  if (!['checked', 'proposed', 'approved', 'execute_failed'].includes(p.state)) throw new ServiceError('wrong_state', 'This payment is not waiting for approval.', 409);
  const prepared = p.prepared;
  if (!prepared) throw new ServiceError('not_prepared', 'Nothing to sign yet. Press approve again.', 409);
  const byId = new Map((input.signatures ?? []).map((s) => [s.id, s.signature]));
  const signer = new PublicKey(prepared.signer);
  const signed: Array<{ m: PreparedMessage; tx: VersionedTransaction }> = [];
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
    signed.push({ m, tx });
  }
  const q = findQuote(p, prepared.quoteId)!;
  const org = getOrg(p.orgId);
  const policyResult = { allowed: p.policy!.allowed, reasons: p.policy!.reasons, checks: p.policy!.checks };

  // 1. Proposal (first approver) or one more approval (threshold > 1).
  const approvalTxs = signed.filter((s) => s.m.purpose === 'proposal' || s.m.purpose === 'approve');
  if (approvalTxs.length > 0) {
    if (isQuoteExpired(q, now) && p.state === 'checked') {
      await cas(() => repo().transition(p.id, { from: 'checked', version: p.version }, 'quote_expired', (d) => {
        d.prepared = null;
        d.problem = { code: 'quote_expired', message: 'Quote expired before you approved. Refresh to get a new quote.' };
      }, 'quote_expired', now));
      throw new ServiceError('quote_expired', 'Quote expired before you approved. Refresh to get a new quote.', 409);
    }
    const first = p.state === 'checked';
    if (first) {
      // Checked and reserved with no await in between, so two approvals of the same invoice (two
      // windows, or two payments for one invoice) cannot both pass: the second finds it reserved.
      const commitment = getInvoice(p.orgId, p.invoiceId).confirmed!.commitmentHex;
      if (getOrg(p.orgId).seenCommitments.includes(commitment)) {
        throw new ServiceError('wrong_state', 'This invoice is already being paid. Nothing was sent; refresh to see where it is.', 409);
      }
    }
    const releaseReservation = first ? reserve(p, q, now) : () => undefined;
    // Claim before sending: a second request for the same approval loses this compare-and-set.
    try {
      p = await cas(() => repo().transition(p.id, { from: first ? 'checked' : 'proposed', version: p.version }, 'proposed', (d) => {
        d.transactionIndex = prepared.transactionIndex;
        d.pendingApprover = prepared.signer;
        d.problem = null;
        if (first) d.timeline.approvedAt = nowIso(now);
      }, first ? 'proposal submitted' : 'approval submitted', now));
    } catch (e) {
      releaseReservation();
      throw e;
    }
    const records: ChainSignatureRecord[] = [];
    for (const { m, tx } of approvalTxs) {
      const out = await sendStep(p, m.step, tx, m.lastValidBlockHeight);
      if (out.status === 'pending') {
        p = await repo().update(p.id, { version: p.version }, (d) => { d.problem = UNCERTAIN; });
        throw new ServiceError('uncertain', UNCERTAIN.message, 504);
      }
      if (out.status === 'failed' || out.status === 'expired') {
        if (first) releaseReservation();
        const message = out.status === 'expired'
          ? 'The approval did not reach the network in time, so nothing moved. Get a new quote and approve again.'
          : `The approval did not go through, so nothing moved. ${out.error}`;
        p = await cas(() => repo().transition(p.id, { from: 'proposed', version: p.version }, first ? 'proposal_failed' : 'proposed', (d) => {
          d.pendingApprover = null;
          d.prepared = null;
          d.problem = { code: 'send_failed', message };
          if (out.status === 'failed') d.execution.lastLogs = out.logs.length ? out.logs : null;
        }, 'approval not sent', now));
        throw new ServiceError('send_failed', message, 502);
      }
      for (const purpose of m.purposes) records.push(signatureRecord(purpose, out.signature));
    }
    const at = nowIso();
    const approvedBy = [...p.approvedBy, prepared.signer];
    const met = approvedBy.length >= p.threshold;
    p = await cas(() => repo().transition(p.id, { from: 'proposed', version: p.version }, met ? 'approved' : 'proposed', (d) => {
      d.approvedBy = approvedBy;
      d.pendingApprover = null;
      d.signatures.push(...records);
      if (first) d.approvals.push({ who, role: 'admin_device', action: 'propose', at, keyPublic: prepared.signer, policyResult });
      d.approvals.push({ who, role: roleOf(org, prepared.signer), action: 'approve', at, keyPublic: prepared.signer, policyResult });
      if (!met) d.prepared = null;
    }, met ? 'threshold met' : `approval ${approvedBy.length} of ${p.threshold}`, now));
  }

  // 2. The execute, when this signing included it.
  const exec = signed.find((s) => s.m.purpose === 'execute');
  if (exec && (p.state === 'approved' || p.state === 'execute_failed')) {
    if (p.state === 'execute_failed') {
      p = await cas(() => repo().transition(p.id, { from: 'execute_failed', version: p.version }, 'approved', (d) => { d.problem = null; }, 'execute rebuilt', now));
    }
    p = await executeStep(p, exec.m, exec.tx, prepared, q, who, now);
  }
  return p;
}

function roleOf(org: OrgRecord, key: string): 'admin_device' | 'approver_device' {
  return org.vault?.members.find((m) => m.publicKey === key)?.role === 'approver_device' ? 'approver_device' : 'admin_device';
}

async function executeStep(p: PaymentRecord, m: PreparedMessage, tx: VersionedTransaction, prepared: PreparedApproval, q: RouteQuote, who: string, now: Date): Promise<PaymentRecord> {
  const org = getOrg(p.orgId);
  const policyResult = { allowed: p.policy!.allowed, reasons: p.policy!.reasons, checks: p.policy!.checks };
  const out = await sendStep(p, m.step, tx, m.lastValidBlockHeight, async (signature) => {
    // Claim approved → executed with the signature BEFORE broadcast: a racer loses here and sends nothing.
    p = await cas(() => repo().transition(p.id, { from: 'approved', version: p.version }, 'executed', (d) => {
      d.execution.signature = signature;
      d.timeline.sentAt = nowIso();
      d.prepared = null;
      d.approvals.push({ who, role: roleOf(org, prepared.signer), action: 'execute', at: nowIso(), keyPublic: prepared.signer, policyResult });
      d.signatures.push(signatureRecord('squads_vault_execute', signature), signatureRecord(prepared.kind === 'solana_direct' ? 'spl_transfer' : 'cctp_burn', signature));
      d.executedRoute = { quoteId: q.id, network: q.target.network, depositAddress: q.target.depositAddress, amountMinor: prepared.transferAmountMinor, steps: q.steps };
    }, 'execute broadcast', now));
  });
  if (out.status === 'failed' && out.signature === null) {
    // Refused before anything was signed (simulation or sponsorship): nothing was sent.
    return cas(() => repo().transition(p.id, { from: 'approved', version: p.version }, 'execute_failed', (d) => {
      d.prepared = null;
      d.execution.lastLogs = out.logs.length ? out.logs : null;
      d.problem = { code: 'send_failed', message: `The payment was approved but not sent, so nothing moved. ${out.error}` };
    }, 'execute refused', now));
  }
  const settled = await settleExecute(p.id, out);
  if (out.status === 'pending') throw new ServiceError('uncertain', UNCERTAIN.message, 504);
  return settled;
}

/** Record what the network said about the execute. */
async function settleExecute(paymentId: string, out: SendOutcome): Promise<PaymentRecord> {
  const p = await getPayment(paymentId);
  if (p.state !== 'executed') return p;
  const at = nowIso();
  if (out.status === 'confirmed' || out.status === 'finalized') {
    return cas(() => repo().transition(p.id, { from: 'executed', version: p.version }, 'confirmed', (d) => {
      d.execution.confirmedAt = at;
      if (out.status === 'finalized') d.execution.finalizedAt = at;
      d.problem = null;
    }, `execute ${out.status}`));
  }
  if (out.status === 'pending') return repo().update(p.id, { version: p.version }, (d) => { d.problem = UNCERTAIN; });
  const message = out.status === 'failed'
    ? `The payment failed on the network, so nothing moved. ${out.error}`
    : 'The payment did not land before its transaction expired, so nothing moved. Approve again: a fresh transaction is built and nothing is sent twice.';
  return cas(() => repo().transition(p.id, { from: 'executed', version: p.version }, 'execute_failed', (d) => {
    d.execution.attempt += 1;
    d.execution.signature = null;
    if (out.status === 'failed') d.execution.lastLogs = out.logs.length ? out.logs : null;
    d.problem = { code: out.status === 'expired' ? 'blockhash_expired' : 'execute_failed', message };
  }, out.status === 'expired' ? 'blockhash expired' : 'execute failed'));
}

/**
 * Resume a payment from its stored state: poll the signatures already recorded, move the state on,
 * and never send anything (§5.1). Safe to call at any time and from any number of workers: each move
 * is a compare-and-set. `timeoutMs` 0 checks once.
 */
export async function resumePayment(paymentId: string, opts: { timeoutMs?: number } = {}): Promise<PaymentRecord> {
  let p = await getPayment(paymentId);
  const rt = runtime();
  const timeoutMs = opts.timeoutMs ?? 0;
  const calls = await repo().listCalls(p.id);
  const poll = async (call: ChainCall, target: 'confirmed' | 'finalized') => awaitCommitment(rt.chain, { signature: call.signature, lastValidBlockHeight: call.lastValidBlockHeight, target, timeoutMs });

  if (p.state === 'proposed' && p.pendingApprover) {
    const open = calls.filter((c) => (c.step.startsWith('proposal:') || c.step.startsWith('approve:')) && c.status === 'signed');
    for (const call of open) {
      const out = await poll(call, 'confirmed');
      if (out.status === 'pending') return p;
      await repo().updateCall(call.key, out.status === 'failed' ? { status: 'failed', error: out.err } : { status: out.status });
      if (out.status === 'failed' || out.status === 'expired') {
        const q = findQuote(p, p.selectedQuoteId!)!;
        const first = p.approvedBy.length === 0;
        if (first) release(p, q, utcDay(new Date(p.timeline.approvedAt ?? p.updatedAt)));
        return cas(() => repo().transition(p.id, { from: 'proposed', version: p.version }, first ? 'proposal_failed' : 'proposed', (d) => {
          d.pendingApprover = null;
          d.prepared = null;
          d.problem = { code: 'send_failed', message: 'The approval did not reach the network, so nothing moved. Approve again.' };
        }, 'resume: approval not landed'));
      }
    }
    const stillOpen = (await repo().listCalls(p.id)).some((c) => (c.step.startsWith('proposal:') || c.step.startsWith('approve:')) && c.status === 'signed');
    if (!stillOpen) {
      const approvedBy = [...p.approvedBy, p.pendingApprover];
      const met = approvedBy.length >= p.threshold;
      p = await cas(() => repo().transition(p.id, { from: 'proposed', version: p.version }, met ? 'approved' : 'proposed', (d) => {
        d.approvedBy = approvedBy;
        d.pendingApprover = null;
        d.problem = null;
      }, 'resume: approval confirmed'));
    }
    return p;
  }

  if (p.state === 'executed') {
    const call = calls.find((c) => c.step === `execute:${p.execution.attempt}` && c.signature === p.execution.signature);
    if (!call) return p;
    const out = await poll(call, 'confirmed');
    if (out.status === 'pending') return p;
    await repo().updateCall(call.key, out.status === 'failed' ? { status: 'failed', error: out.err } : { status: out.status });
    const mapped: SendOutcome = out.status === 'failed' ? { status: 'failed', signature: call.signature, error: out.err, logs: [] } : { status: out.status, signature: call.signature };
    return settleExecute(p.id, mapped);
  }

  if (['confirmed', 'partner_paid', 'evidence_failed'].includes(p.state) && !p.execution.finalizedAt && p.execution.signature) {
    const call = calls.find((c) => c.signature === p.execution.signature);
    if (call) {
      const out = await poll(call, 'finalized');
      if (out.status === 'finalized') {
        await repo().updateCall(call.key, { status: 'finalized' });
        p = await repo().update(p.id, { version: p.version }, (d) => { d.execution.finalizedAt = nowIso(); });
      }
    }
  }
  if ((p.state === 'partner_paid' || p.state === 'evidence_failed') && p.execution.finalizedAt) {
    p = await settleEvidence(p.id);
  }
  // A payment to a Splash business is in their account once confirmed: its proof is next (no partner).
  if (p.kind === 'peer' && p.state === 'confirmed' && p.execution.finalizedAt) {
    p = await settleEvidence(p.id);
  }
  return p;
}

/** Every payment that may have something in flight. For a worker to run after a restart. */
export async function resumeAll(opts: { timeoutMs?: number } = {}): Promise<Array<{ id: string; state: PaymentState }>> {
  const open = await repo().listInStates(RESUMABLE_STATES);
  const out: Array<{ id: string; state: PaymentState }> = [];
  for (const p of open) {
    try {
      const r = await resumePayment(p.id, opts);
      out.push({ id: r.id, state: r.state });
    } catch {
      out.push({ id: p.id, state: p.state });
    }
  }
  return out;
}

/** Note a problem without changing state (used when background work cannot finish). */
export async function noteProblem(paymentId: string, problem: { code: string; message: string }) {
  const p = await getPayment(paymentId);
  return repo().update(p.id, { version: p.version }, (d) => { d.problem = problem; });
}

/* ------------------------------------------------------------------ refuse service (§5.6) */

/**
 * Take one of the org's sponsored transactions for today before Kora is asked (§5.6). Refused when
 * the day's cap is reached: nothing is signed. The cap is the sponsor policy's (kora.toml).
 */
export async function takeSponsorSlot(orgId: string, now = new Date()): Promise<{ release: () => Promise<void> }> {
  const rt = runtime();
  const cap = ((rt.chain as { policy?: SponsorPolicy }).policy ?? defaultSponsorPolicy(usdcMint(rt.env.cluster).toBase58())).perOrgDailyTxCap;
  const day = utcDay(now);
  const slot = await rt.sponsors.reserve(orgId, day, cap);
  if (!slot.ok) {
    throw new ServiceError('sponsor_cap', `This company has used today's ${cap} sponsored transactions. Nothing was sent; try again tomorrow or contact support.`, 429);
  }
  return { release: () => rt.sponsors.release(orgId, day) };
}

/** Staff pause service for a company: no Kora signature, no new proposal. The vault stays the company's. */
/**
 * Refuse service (prompt 07 §7.5): no fee-payer signature and no new proposal for this company, from
 * any code path (assertServiceable here, and the runtime's chain wrapper in front of Kora). Splash
 * cannot freeze or move the money: the vault is the company's, and its approvers still control it.
 * Every suspend and unsuspend is appended to the company's audit log, never edited.
 */
export function suspendOrg(orgId: string, input: { by: string; reason: string }, now = new Date()) {
  const org = getOrg(orgId);
  const reason = input.reason.trim();
  if (reason.length < 3) throw new ServiceError('bad_request', 'Give a reason for the audit log.');
  const by = input.by.trim() || 'staff';
  org.suspended = { at: nowIso(now), by, reason };
  (org.serviceLog ??= []).push({ at: nowIso(now), by, action: 'suspend', reason });
  return org.suspended;
}

export function unsuspendOrg(orgId: string, input: { by: string; reason: string } = { by: 'staff', reason: 'Service restored' }, now = new Date()) {
  const org = getOrg(orgId);
  const reason = input.reason.trim();
  if (reason.length < 3) throw new ServiceError('bad_request', 'Give a reason for the audit log.');
  if (org.suspended) (org.serviceLog ??= []).push({ at: nowIso(now), by: input.by.trim() || 'staff', action: 'unsuspend', reason });
  org.suspended = null;
  return null;
}

/* ------------------------------------------------------------------ partner */

/**
 * What the partner sees arrive at its one-payment deposit address. Solana: the deposit owner's USDC
 * balance, read through the chain client. Polygon (offline only): the simulator's recorded burn.
 * Returns the partner's signed webhooks; the caller delivers them to `receivePartnerWebhook`.
 */
export async function observeDeposit(paymentId: string, now = new Date()): Promise<PartnerPayoutEvent[]> {
  const p = await getPayment(paymentId);
  if (p.state !== 'confirmed' || !p.executedRoute) throw new ServiceError('wrong_state', 'Nothing has landed for this payment yet.', 409);
  const rt = runtime();
  const route = p.executedRoute;
  if (p.rehearsal === 'partner_return' && isSimulator(rt.chain)) {
    // Offline rehearsal: the mock partner returns the payment and sends the USDC back (simulated).
    await rt.chain.fundUsdc(getOrg(p.orgId).vault!.vaultPda, route.amountMinor);
    getOrg(p.orgId).fundings.push({ signature: 'simulated-return', amountMinor: route.amountMinor, at: nowIso(now), simulated: true, note: 'Returned by mock partner (simulated)' });
    return [signWebhook({ partnerId: p.payout.partnerId, paymentId: p.id, status: 'returned', amountPhpMinor: p.payout.amountPhpMinor, at: nowIso(now) }, rt.webhookSecret)];
  }
  let arrived: bigint;
  if (route.network === 'solana') {
    arrived = await rt.chain.getUsdcBalance(route.depositAddress);
  } else {
    if (!isSimulator(rt.chain)) throw new ServiceError('devnet_not_supported', 'Watching Polygon is not built yet.', 409);
    const execSig = p.signatures.find((s) => s.purpose === 'cctp_burn')?.signature;
    const burn = rt.chain.burns.find((b) => b.signature === execSig);
    if (!burn) throw new ServiceError('wrong_state', 'No burn found for this payment.', 409);
    arrived = burn.amountMinor - burn.maxFeeMinor;
  }
  return rt.partner.simulateDeposit({ payoutId: p.payout.payoutId, network: route.network, address: route.depositAddress, amountUsdcMinor: arrived, now });
}

/** Every partner webhook goes in the log (the admin console's webhooks section), with what was done with it. */
export async function receivePartnerWebhook(raw: Record<string, unknown>, now = new Date()) {
  const log = (result: WebhookLogEntry['result'], signatureOk: boolean | null, reason: string | null) => {
    const l = store().webhookLog;
    l.push({ at: nowIso(now), paymentId: String(raw.paymentId ?? '').slice(0, 40), status: String(raw.status ?? '').slice(0, 20), result, signatureOk, reason });
    if (l.length > 200) l.splice(0, l.length - 200);
  };
  try {
    const out = await applyPartnerWebhook(raw, now);
    log(out.duplicate ? 'duplicate' : 'accepted', true, out.duplicate ? 'The same payment and status again: no change.' : null);
    return out;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const signatureOk = /missing signature|bad signature/.test(message) ? false : /malformed|Unknown webhook status/.test(message) ? null : true;
    log('refused', signatureOk, message);
    throw e;
  }
}

async function applyPartnerWebhook(raw: Record<string, unknown>, now: Date) {
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
  const p = await getPayment(event.paymentId);
  if (event.amountPhpMinor !== p.payout.amountPhpMinor) throw new ServiceError('webhook_invalid', 'Webhook amount differs from the payout.', 422);
  if (p.partnerEvents.some((e) => e.paymentId === event.paymentId && e.status === event.status)) {
    return { duplicate: true, state: p.state };
  }
  if (p.state !== 'confirmed') throw new ServiceError('wrong_state', `Payment is ${STATE_LABEL[p.state].toLowerCase()}; the webhook does not apply.`, 409);
  if (event.status === 'received') {
    const next = await cas(() => repo().update(p.id, { version: p.version, states: ['confirmed'] }, (d) => {
      d.partnerEvents.push(event);
      d.timeline.receivedAt = event.at;
    }, now));
    return { duplicate: false, state: next.state };
  }
  if (event.status === 'paid') {
    let next = await cas(() => repo().transition(p.id, { from: 'confirmed', version: p.version }, 'partner_paid', (d) => {
      d.partnerEvents.push(event);
      if (!d.partnerEvents.some((e) => e.status === 'received')) d.timeline.receivedAt = event.at;
      d.timeline.paidAt = event.at;
    }, 'partner paid', now));
    const inv = getInvoice(p.orgId, p.invoiceId);
    const org = getOrg(p.orgId);
    const c = inv.confirmed!;
    const saved = org.suppliers.find((s) => s.name === c.supplierName && s.bank === c.supplierBank && s.accountLast4 === c.supplierAccountLast4);
    let keep: SupplierRecord | null = null;
    if (c.bankDetailsVerified && !saved) {
      keep = { id: newSupplierId(), name: c.supplierName, bank: c.supplierBank, accountLast4: c.supplierAccountLast4, verified: { by: c.bankDetailsVerified.by, method: c.bankDetailsVerified.method, at: c.bankDetailsVerified.at }, ...(inv.bankCode ? { bankCode: inv.bankCode } : {}) };
      org.suppliers.push(keep);
    } else if (saved?.pendingCallBack && c.bankDetailsVerified && c.bankDetailsVerified.method !== 'existing-record') {
      // Paid after a call-back on the new details: they are the verified details now.
      saved.verified = { by: c.bankDetailsVerified.by, method: c.bankDetailsVerified.method, at: c.bankDetailsVerified.at };
      delete saved.pendingCallBack;
      keep = saved;
    } else if (saved && !saved.secretId) {
      keep = saved;
    }
    // The supplier this payment saved (or checked) keeps the invoice's full number for next time.
    if (keep && inv.accountSecretId) await adoptInvoiceNumber(org.id, inv, keep, now).catch(() => false);
    // Evidence only after the execute is final (§5.1); resume picks it up if it is not yet.
    next = await resumePayment(p.id);
    return { duplicate: false, state: next.state };
  }
  const next = await cas(() => repo().transition(p.id, { from: 'confirmed', version: p.version }, 'partner_failed', (d) => {
    d.partnerEvents.push(event);
    d.timeline.returnedAt = event.at;
    d.problem = { code: 'partner_returned', message: 'The payout partner returned the payment. What it received is back in your Payments account; Splash’s fee isn’t part of it. Retry or pay another way.' };
  }, 'partner returned', now));
  // The invoice is free to pay again.
  const org = getOrg(p.orgId);
  const inv = getInvoice(p.orgId, p.invoiceId);
  org.seenCommitments = org.seenCommitments.filter((c) => c !== inv.confirmed!.commitmentHex);
  return { duplicate: false, state: next.state };
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

/** partner_paid (and finalized) → evidenced → anchored; a failure lands in evidence_failed and is retried. */
async function settleEvidence(paymentId: string): Promise<PaymentRecord> {
  let p = await getPayment(paymentId);
  const ready = p.state === 'partner_paid' || p.state === 'evidence_failed' || (p.kind === 'peer' && p.state === 'confirmed');
  if (!ready) return p;
  if (!p.execution.finalizedAt) return p;
  let record: EvidenceRecord;
  try {
    record = await buildEvidence(p);
  } catch (e) {
    return cas(() => repo().transition(p.id, { from: p.state, version: p.version }, 'evidence_failed', (d) => {
      d.problem = { code: 'evidence_failed', message: `The payment is paid; its proof is not saved yet and will be retried. (${(e as Error).message})` };
    }, 'evidence failed'));
  }
  p = await cas(() => repo().transition(p.id, { from: p.state, version: p.version }, 'evidenced', (d) => {
    d.receiptId = record.receiptId;
    d.problem = null;
  }, 'evidence saved'));
  if (record.anchor.status === 'anchored') {
    p = await cas(() => repo().transition(p.id, { from: 'evidenced', version: p.version }, 'anchored', undefined, `anchored ${record.anchor.method}`));
  }
  // A payment into another business's account: the payee records the money in, and a request it paid
  // is marked paid with its own receipt (prompt 10 §6.3). Loaded late: requests.ts reads this module.
  if (p.kind === 'peer') {
    const { recordSplashPaymentReceived } = await import('./requests.ts');
    await recordSplashPaymentReceived(p);
  }
  return p;
}

async function buildEvidence(p: PaymentRecord): Promise<EvidenceRecord> {
  if (p.receiptId) {
    const existing = store().evidence.get(p.receiptId);
    if (existing) return existing;
  }
  const org = getOrg(p.orgId);
  const inv = getInvoice(p.orgId, p.invoiceId);
  const rt = runtime();
  const q = findQuote(p, p.executedRoute!.quoteId)!;
  const receiptId = `rcpt_${randomHex(8)}`;
  const simulated = p.signatures.some((s) => s.simulated) || rt.env.mode === 'offline';
  if (p.kind === 'peer') return sealEvidence(p, org, buildPeerTransferBundle({
    paymentId: p.id,
    createdAt: p.execution.confirmedAt ?? p.updatedAt,
    payer: { orgId: org.id },
    payee: { orgId: inv.peer!.payeeOrgId, name: inv.peer!.payeeName, account: inv.peer!.payeeVaultPda },
    amount: { currency: 'USD', amountMinor: inv.peer!.amountUsdMinor },
    reference: { commitmentHex: inv.confirmed!.commitmentHex },
    approvals: p.approvals,
    kyt: { provider: p.policy!.kyt.provider, resultId: p.policy!.kyt.resultId, verdict: p.policy!.kyt.verdict },
    executedRoute: p.executedRoute!,
    chain: { signatures: p.signatures },
    receipt: { receiptId, issuedAt: nowIso(), simulated },
  }), receiptId);
  const paid = p.partnerEvents.find((e) => e.status === 'paid')!;
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
  return sealEvidence(p, org, bundle, receiptId);
}

/** Batch, anchor, seal and store one bundle (any kind). `p` names what the receipt is for: a payment, or a request it paid. */
export async function sealEvidence(p: { id: string }, org: OrgRecord, bundle: EvidenceBundle, receiptId: string): Promise<EvidenceRecord> {
  const rt = runtime();
  const createdAt = bundle.createdAt;
  const t = Date.parse(createdAt);
  const dayStart = new Date(Math.floor(t / 86_400_000) * 86_400_000);
  const batch = buildEvidenceBatch([bundle], { start: dayStart, end: new Date(dayStart.getTime() + 86_400_000) });
  const leaf = batch.leaves[0]!;

  assertAttesterIsolated(rt.attester.publicKey.toBase58(), [org.vault!]);
  const anchorPlan = buildMemoAnchor({ attester: rt.attester.publicKey.toBase58(), rootHex: batch.rootHex, count: batch.count });
  let anchor: EvidenceRecord['anchor'];
  if (isSimulator(rt.chain)) {
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

/** part ÷ whole as a percent with two decimals, "0.20%", rounded half up, in integers only. */
export function shareText(part: bigint, whole: bigint): string {
  if (whole <= 0n || part <= 0n) return '0.00%';
  const hundredths = (part * 10_000n + whole / 2n) / whole;
  return `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, '0')}%`;
}

export async function paymentView(paymentId: string) {
  const p = await getPayment(paymentId);
  const inv = getInvoice(p.orgId, p.invoiceId);
  const rt = runtime();
  // Two lanes, Cheapest and Fastest, labelled by the engine's ranking, never by network (prompt 10
  // §5.6). A route that wins both is one card with both labels; the best other route then rides along
  // as `compare`, shown quietly behind "Compare the other route".
  type Card = ReturnType<typeof cardFor>;
  const cardFor = (q: RouteQuote, policies: Policy[]) => {
    const kind = routeKindOf(q);
    const lane = laneOf(kind);
    const names = policies.map((x) => POLICY_LABEL[x]);
    return {
      policy: q.policy,
      policies,
      label: names.length === 0 ? 'Other route' : names.length === 1 ? names[0]! : `${[names[0]!, ...names.slice(1, -1).map((n) => n.toLowerCase())].join(', ')} and ${names[names.length - 1]!.toLowerCase()}`,
      /** Links on the map: 2 straight to the partner, 3 through its lower-cost lane (display only). */
      /** The lane's labels, each a whole word from POLICY_LABEL. */
      labels: names,
      steps: stepCount(q),
      /** The partner's fee as a share of what you pay, "0.20%" (display only, integer math). */
      partnerFee: shareText(q.costs.partnerMinor, q.source.amountMinor),
      lowerCostLane: kind !== 'solana_direct',
      quoteId: q.id,
      kind,
      receivePhpMinor: q.netLocal.amountMinor,
      youPayUsdcMinor: q.source.amountMinor,
      allInBps: q.costs.allInBps,
      /** The cost card's lines (§5.6): the amount itself, then each fee. They add up to youPayUsdcMinor. */
      costs: {
        amountMinor: q.source.amountMinor - q.costs.routeMinor - q.costs.partnerMinor - q.costs.splashMinor,
        routeMinor: q.costs.routeMinor,
        partnerMinor: q.costs.partnerMinor,
        splashMinor: q.costs.splashMinor,
        /**
         * Splash's fee as its rule (§5.6): "0.10%", and "0.10%, at least US$2.00" when the minimum is what
         * applied, so the label never reads as a higher rate than the one charged.
         */
        splashShare: `${shareText(BigInt(SPLASH_FEE_BPS[q.policy]), 10_000n)}${q.costs.splashMinor === SPLASH_MIN_FEE_USDC_MINOR ? `, at least ${formatUsd(SPLASH_MIN_FEE_USDC_MINOR)}` : ''}`,
      },
      rate: q.fx.rate,
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
  for (const policy of LANE_POLICIES) {
    const q = p.engine.picks[policy];
    if (!q) continue;
    const key = `${routeKindOf(q)}|${q.source.amountMinor}|${q.netLocal.amountMinor}`;
    const hit = byKey.get(key);
    if (hit) hit.policies.push(policy);
    else byKey.set(key, { q, policies: [policy] });
  }
  for (const { q, policies } of byKey.values()) cards.push(cardFor(q, policies));
  let compare: Card | null = null;
  if (cards.length === 1) {
    const kind = cards[0]!.kind;
    const other = LANE_POLICIES.flatMap((x) => p.engine.ranked[x]).filter((q) => routeKindOf(q) !== kind).sort((a, b) => -compareValue(a, b))[0];
    if (other) compare = cardFor(other, []);
  }
  // Zeke Checker: the deterministic results in plain words. It explains; it never decides.
  const checker = p.policy ? explainChecks({ tier: DEMO_TIER, checks: p.policy.checks, extraChecks: p.policy.extraChecks, screeningLabel: p.policy.kyt.label }) : null;
  if (checker) assertDraftOnly(checker);
  return {
    id: p.id,
    state: p.state,
    stateLabel: STATE_LABEL[p.state],
    createdAt: p.createdAt,
    simulated: rt.env.mode === 'offline',
    kind: p.kind ?? ('bank' as const),
    invoice: {
      id: inv.id,
      source: inv.source,
      confirmed: inv.confirmed,
      details: detailsView(inv.paymentDetails),
      peer: inv.peer ? { payeeName: inv.peer.payeeName, payeeHandle: inv.peer.payeeHandle, payeeCountry: inv.peer.payeeCountry, amountUsdMinor: inv.peer.amountUsdMinor, note: inv.peer.note } : null,
    },
    cards,
    compare,
    /** The lane names, for the copy that explains them ("How it moves"): the words come from POLICY_LABEL only. */
    laneNames: { cheapest: POLICY_LABEL.cheapest, fastest: POLICY_LABEL.fastest },
    allInTarget: shareText(ALL_IN_TARGET_BPS, 10_000n),
    zeke: { suggests: POLICY_LABEL[p.router.primary.policy], primary: p.router.primary.text, alternative: p.router.alternative?.text ?? null, checks: checker ? { summary: checker.summary, blocked: checker.blocked, lines: checker.lines } : null },
    selectedQuoteId: p.selectedQuoteId,
    approval: p.approval,
    approvals: approvalStatus(p, getOrg(p.orgId)),
    rehearsal: p.rehearsal,
    timeline: p.timeline,
    finalized: p.execution.finalizedAt !== null,
    signatures: p.signatures.map((s) => ({ ...s, ...(s.network === 'solana' ? traceLinks('tx', s.signature, s.simulated) : { solscanUrl: null, explorerUrl: null }) })),
    trace: paymentTrace(p),
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

/** Money received against a request (kind 5): no payment of this company's behind it, only the transfer in. */
function receivableTrace(e: EvidenceRecord) {
  const b = e.bundle;
  if (b.kindName !== 'receivable') throw new Error('not a receivable');
  const org = store().orgs.get(e.orgId);
  const vault = org?.vault;
  const rt = runtime();
  const accounts: Array<{ label: string; address: string; solscanUrl: string | null; explorerUrl: string | null }> = [];
  if (vault) {
    const ata = getAssociatedTokenAddress(usdcMint(rt.env.cluster), new PublicKey(vault.vaultPda)).toBase58();
    accounts.push({ label: 'Your vault', address: vault.vaultPda, ...traceLinks('account', vault.vaultPda, vault.simulated) });
    accounts.push({ label: 'Your vault’s USDC account', address: ata, ...traceLinks('account', ata, vault.simulated) });
  }
  return { memo: b.incoming.memo ?? '', accounts };
}

function receivableReceipt(e: EvidenceRecord) {
  const b = e.bundle;
  if (b.kindName !== 'receivable') throw new Error('not a receivable');
  const org = getOrg(e.orgId);
  const req = store().requests.get(b.requestId);
  return {
    receiptId: e.receiptId,
    paymentId: e.paymentId,
    simulated: e.anchor.simulated || b.receipt.simulated,
    companyName: org.companyName,
    summary: {
      kind: 'receivable' as const,
      supplierName: req?.payer.name ?? (b.payer.kind === 'splash' ? 'A business on Splash' : 'Payer'),
      bank: 'Splash',
      accountLast4: '',
      invoiceNumber: req?.number ?? '',
      receivePhpMinor: 0n,
      receiveUsdMinor: b.amount.amountMinor,
      youPayUsdcMinor: b.amount.amountMinor,
      paidAt: b.createdAt,
      bankReference: null,
      partnerLabel: null,
      note: req?.note ?? null,
      matchedBy: b.match.method,
    },
    bundle: e.bundle,
    leafHex: e.leafHex,
    proof: e.proof,
    batch: e.batch,
    anchor: { ...e.anchor, ...(e.anchor.signature ? traceLinks('tx', e.anchor.signature, e.anchor.simulated) : { solscanUrl: null, explorerUrl: null }) },
    signatures: b.chain.signatures.map((s) => ({ purpose: s.purpose, network: s.network, signature: s.signature, simulated: s.simulated, ...(s.network === 'solana' ? traceLinks('tx', s.signature, s.simulated) : { solscanUrl: null, explorerUrl: null }) })),
    trace: receivableTrace(e),
    stored: { blobId: e.stored.blobId, mode: e.stored.mode, sizeBytes: e.stored.sizeBytes, ciphertextSha256Hex: e.stored.ciphertextSha256Hex },
  };
}

/** A treasury order (kind 6): the company's own accounts, the device approval, no payment behind it. */
function treasuryTrace(e: EvidenceRecord) {
  const b = e.bundle;
  if (b.kindName !== 'treasury') throw new Error('not a treasury order');
  const vault = store().orgs.get(e.orgId)?.vault;
  const simulated = b.receipt.simulated;
  const accounts: Array<{ label: string; address: string; solscanUrl: string | null; explorerUrl: string | null }> = [];
  accounts.push({ label: 'Your Investments account', address: b.org.investmentsAccount, ...traceLinks('account', b.org.investmentsAccount, simulated) });
  if (vault) {
    accounts.push({ label: 'Your Payments account', address: vault.vaultPda, ...traceLinks('account', vault.vaultPda, simulated) });
    const reserve = treasuryVaultPda(vault.multisigPda);
    accounts.push({ label: 'Your Reserve', address: reserve, ...traceLinks('account', reserve, simulated) });
  }
  return { memo: '', accounts, approvedTextSha256: b.approval.messageSha256 };
}

function treasuryReceipt(e: EvidenceRecord) {
  const b = e.bundle;
  if (b.kindName !== 'treasury') throw new Error('not a treasury order');
  const org = getOrg(e.orgId);
  const name = b.asset.id === 'usdy' ? TBILLS.name : (stockRef(b.asset.id)?.name ?? b.asset.id);
  return {
    receiptId: e.receiptId,
    paymentId: e.paymentId,
    simulated: e.anchor.simulated || b.receipt.simulated,
    companyName: org.companyName,
    summary: {
      kind: 'treasury' as const,
      supplierName: name,
      bank: 'Splash',
      accountLast4: '',
      invoiceNumber: '',
      receivePhpMinor: 0n,
      receiveUsdMinor: b.order.amountMinor,
      youPayUsdcMinor: b.order.amountMinor,
      paidAt: b.createdAt,
      bankReference: null,
      partnerLabel: null,
      note: null,
      treasury: {
        orderKind: b.order.kind,
        path: b.order.path,
        unitsMicro: b.order.unitsMicro,
        priceMinor: b.order.priceMinor,
        landsIn: b.order.landsIn,
        holdUntil: b.order.holdUntil,
        sweep: Boolean(b.sweep),
        approvedBy: b.approval.who,
      },
    },
    bundle: e.bundle,
    leafHex: e.leafHex,
    proof: e.proof,
    batch: e.batch,
    anchor: { ...e.anchor, ...(e.anchor.signature ? traceLinks('tx', e.anchor.signature, e.anchor.simulated) : { solscanUrl: null, explorerUrl: null }) },
    signatures: b.chain.signatures.map((s) => ({ purpose: s.purpose, network: s.network, signature: s.signature, simulated: s.simulated, ...(s.network === 'solana' ? traceLinks('tx', s.signature, s.simulated) : { solscanUrl: null, explorerUrl: null }) })),
    trace: treasuryTrace(e),
    stored: { blobId: e.stored.blobId, mode: e.stored.mode, sizeBytes: e.stored.sizeBytes, ciphertextSha256Hex: e.stored.ciphertextSha256Hex },
  };
}

export async function receiptView(receiptId: string) {
  const e = getEvidence(receiptId);
  if (e.bundle.kindName === 'receivable') return receivableReceipt(e);
  if (e.bundle.kindName === 'treasury') return treasuryReceipt(e);
  const p = await getPayment(e.paymentId);
  const inv = getInvoice(p.orgId, p.invoiceId);
  const org = getOrg(p.orgId);
  const rt = runtime();
  return {
    receiptId: e.receiptId,
    paymentId: e.paymentId,
    simulated: e.anchor.simulated || e.bundle.receipt.simulated,
    companyName: org.companyName,
    summary:
      e.bundle.kindName === 'peer_transfer'
        ? {
            kind: 'peer' as const,
            supplierName: e.bundle.payee.name,
            bank: 'Splash',
            accountLast4: '',
            invoiceNumber: inv.confirmed!.invoiceNumber,
            receivePhpMinor: 0n,
            receiveUsdMinor: e.bundle.amount.amountMinor,
            youPayUsdcMinor: e.bundle.amount.amountMinor,
            paidAt: p.execution.confirmedAt ?? null,
            bankReference: null,
            partnerLabel: null,
            note: inv.peer?.note ?? null,
          }
        : {
            kind: 'bank' as const,
            supplierName: inv.confirmed!.supplierName,
            bank: inv.confirmed!.supplierBank,
            accountLast4: inv.confirmed!.supplierAccountLast4,
            invoiceNumber: inv.confirmed!.invoiceNumber,
            receivePhpMinor: e.bundle.quotedRoute.netLocal.amountMinor,
            receiveUsdMinor: null,
            youPayUsdcMinor: e.bundle.quotedRoute.source.amountMinor,
            paidAt: p.timeline.paidAt ?? null,
            bankReference: e.bundle.bank.reference,
            partnerLabel: rt.partner.entry.name,
            note: null,
          },
    bundle: e.bundle,
    leafHex: e.leafHex,
    proof: e.proof,
    batch: e.batch,
    anchor: { ...e.anchor, ...(e.anchor.signature ? traceLinks('tx', e.anchor.signature, e.anchor.simulated) : { solscanUrl: null, explorerUrl: null }) },
    signatures: p.signatures.map((s) => ({ purpose: s.purpose, network: s.network, signature: s.signature, simulated: s.simulated, ...(s.network === 'solana' ? traceLinks('tx', s.signature, s.simulated) : { solscanUrl: null, explorerUrl: null }) })),
    trace: paymentTrace(p),
    stored: { blobId: e.stored.blobId, mode: e.stored.mode, sizeBytes: e.stored.sizeBytes, ciphertextSha256Hex: e.stored.ciphertextSha256Hex },
  };
}

/**
 * The sealed record as stored (Walrus, or the in-memory store offline), for the receipt's "check the
 * stored copy" step: the browser hashes it and compares with the sha256 recorded at storage. Ciphertext
 * only. Null when the store no longer has it (the offline store empties on restart).
 */
export async function evidenceBlob(receiptId: string) {
  const e = getEvidence(receiptId);
  const ciphertext = await runtime().evidence.get(e.stored.blobId).catch(() => null);
  return { blobId: e.stored.blobId, mode: e.stored.mode, ciphertextSha256Hex: e.stored.ciphertextSha256Hex, ciphertext };
}

/** The evidence pack a business hands its auditor. Includes the invoice fields and this invoice's salt so the commitment can be recomputed. */
export async function evidencePack(receiptId: string) {
  const e = getEvidence(receiptId);
  if (e.bundle.kindName === 'treasury') {
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
      trace: treasuryTrace(e),
      howToVerify: [
        'leaf = sha256(utf8("splash.evidence.leaf.v1") || 0x00 || utf8(canonicalJson(bundle))); bigint values are decimal strings',
        'walk proof.siblings bottom-up: node = sha256(utf8("splash.evidence.node.v1") || 0x01 || left || right)',
        'the root must equal the root in the anchor memo "splash:root:v1:<root>:<count>"',
        'bundle.approval.signature is an ed25519 signature by bundle.approval.keyPublic over the order text whose sha256 is bundle.approval.messageSha256',
      ],
    };
  }
  if (e.bundle.kindName === 'receivable') {
    const req = store().requests.get(e.bundle.requestId);
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
      trace: receivableTrace(e),
      // The request as sent, and its salt, so the commitment can be recomputed. The payer's name and
      // email are committed separately and stay with the company.
      requestDisclosure: req
        ? { fields: { number: req.number, dueDate: req.dueDate, lines: req.lines, amountMinor: req.amountMinor }, saltHex: req.saltHex, commitment: 'sha256(salt || canonicalJson(fields)) must equal bundle.request.commitmentHex' }
        : null,
      howToVerify: [
        'leaf = sha256(utf8("splash.evidence.leaf.v1") || 0x00 || utf8(canonicalJson(bundle))); bigint values are decimal strings',
        'walk proof.siblings bottom-up: node = sha256(utf8("splash.evidence.node.v1") || 0x01 || left || right)',
        'the root must equal the root in the anchor memo "splash:root:v1:<root>:<count>"',
        'bundle.incoming.to is the company’s own account, and the transfer in chain.signatures moved bundle.amount into it',
      ],
    };
  }
  const p = await getPayment(e.paymentId);
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
    trace: {
      ...paymentTrace(p),
      transactions: p.signatures.map((s) => ({ purpose: s.purpose, network: s.network, signature: s.signature, simulated: s.simulated, ...(s.network === 'solana' ? traceLinks('tx', s.signature, s.simulated) : { solscanUrl: null, explorerUrl: null }) })),
      anchor: e.anchor.signature ? { signature: e.anchor.signature, ...traceLinks('tx', e.anchor.signature, e.anchor.simulated) } : null,
    },
    invoiceDisclosure: {
      fields: { invoiceNumber: c.invoiceNumber, supplierName: c.supplierName, supplierBank: c.supplierBank, supplierAccountLast4: c.supplierAccountLast4, amountPhpMinor: c.amountPhpMinor, dueDate: c.dueDate, einvoiceRef: c.einvoiceRef },
      saltHex: inv.saltHex,
      commitment: 'sha256(salt || canonicalJson(fields)) must equal bundle.invoice.commitmentHex',
    },
    howToVerify: [
      'leaf = sha256(utf8("splash.evidence.leaf.v1") || 0x00 || utf8(canonicalJson(bundle))); bigint values are decimal strings',
      'walk proof.siblings bottom-up: node = sha256(utf8("splash.evidence.node.v1") || 0x01 || left || right)',
      'the root must equal the root in the anchor memo "splash:root:v1:<root>:<count>"',
      'on Solscan (devnet: ?cluster=devnet), every transaction in trace.transactions shows the program log Memo "splash:pay:v1:<paymentId>"; the execute moves USDC from the vault to the payout partner deposit and the Splash fee account, and nowhere else',
    ],
  };
}
