/**
 * Transfer, Step 3: "Money comes from" (prompt 10 §5.6). A plan, from funding-planner.ts:
 *
 *   Covered                    the Payments account pays it.
 *   Move from your reserve     the reserve covers what's missing: a move between the company's own
 *                              accounts, in the same approval sequence (treasury-service.ts).
 *   Add money another way      a bank or card top-up, or a crypto wallet (funding-router.ts). The money
 *                              lands in the company's own Payments account first, never with Splash,
 *                              and only counts after a funds check: the source is screened (an unknown
 *                              result holds it: screening fails closed) and a person declares where the
 *                              money comes from. The third party's charge is shown before anything is
 *                              sent; Splash's fee to add money is US$0.
 *
 * Either way the payout itself is unchanged: it leaves the Payments account with one approval on the
 * device. Every outside source is a mock in this build (Phase A's adapter table), labelled test mode,
 * and refused on devnet.
 */
import { PublicKey } from '@solana/web3.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { isSimulator } from '../solana/simulator.ts';
import { createKytStub } from '../route-engine/policy.ts';
import { ServiceError } from './errors.ts';
import { chargeOn, planFunding, priceRoutes, type FundingPlan } from './funding-planner.ts';
import { createTestModeFundingRouter, type FundingRoute, type FundingSourceId } from './funding-router.ts';
import { isCommitted } from './payment-machine.ts';
import { runtime } from './runtime.ts';
import { findQuote, getOrg, getPayment, requireVault, treasuryVaultPda } from './service.ts';
import { SOURCE_OF_FUNDS, type SourceOfFunds } from './source-of-funds.ts';
import type { FundingMethod, OrgRecord, PaymentFunding } from './store.ts';

/** Offline, the funds check holds this long, so the extra step a person chose is visible. */
export const OFFLINE_FUNDS_CHECK_MS = 2_500;

export { SOURCE_OF_FUNDS, type SourceOfFunds };

/** Integer charge in basis points, rounded up (re-exported for the tests and the screens). */
export const chargeFor = chargeOn;

/**
 * How a funding is named, for today's methods and for records saved before prompt 10 (which named the
 * providers). No provider or brand name reaches a screen (§5.6, tests/claims.test.mjs).
 */
export const FUNDING_METHODS: Record<FundingMethod, { label: string; kind: 'stablecoin' | 'usd' }> = {
  bank_card: { label: 'Bank or card top-up · test mode', kind: 'usd' },
  wallet: { label: 'From a crypto wallet', kind: 'stablecoin' },
  wallet_usdc: { label: 'From a crypto wallet', kind: 'stablecoin' },
  wallet_swap: { label: 'From a crypto wallet', kind: 'stablecoin' },
  stripe: { label: 'Bank or card top-up · test mode', kind: 'usd' },
  airwallex: { label: 'Bank or card top-up · test mode', kind: 'usd' },
};

const router = createTestModeFundingRouter();

function newId(): string {
  const b = new Uint8Array(8);
  globalThis.crypto.getRandomValues(b);
  return `fnd_${bytesToHex(b)}`;
}

function fundingsOf(org: OrgRecord): PaymentFunding[] {
  org.paymentFundings ??= [];
  return org.paymentFundings;
}

export function fundingView(f: PaymentFunding) {
  const m = FUNDING_METHODS[f.method];
  const route = f.sourceId ? router.routes({ destination: 'x' }).find((r) => r.id === f.sourceId) : null;
  return {
    id: f.id,
    paymentId: f.paymentId,
    method: f.method,
    sourceId: f.sourceId ?? null,
    methodLabel: route?.label ?? m.label,
    asset: f.asset,
    network: f.network ?? null,
    fromAddress: f.fromAddress,
    amountMinor: f.amountMinor.toString(),
    chargeMinor: f.chargeMinor.toString(),
    chargeBps: f.chargeBps,
    chargeLabel: route?.chargeLabel ?? (f.chargeBps > 0 ? 'Charge (estimate)' : 'No charge'),
    sourceOfFunds: f.sourceOfFunds,
    sourceOfFundsLabel: SOURCE_OF_FUNDS[f.sourceOfFunds],
    declaredBy: f.declaredBy,
    declaredAt: f.declaredAt,
    state: f.state,
    checkUntil: f.checkUntil,
    check: f.check,
    /** The funds check in a person's words (the screening provider's own label stays in `check`). */
    checkWords: !f.check ? 'Screening where it comes from' : f.check.unknown ? 'Screening couldn’t answer: held until it does' : f.check.flagged ? 'Screening flagged where it comes from: held' : f.simulated ? 'Screened: clear (test screening)' : 'Screened: clear',
    signature: f.signature,
    simulated: f.simulated,
    createdAt: f.createdAt,
    settledAt: f.settledAt,
  };
}

export type FundingView = ReturnType<typeof fundingView>;

function planView(plan: FundingPlan) {
  const s = (v: bigint) => v.toString();
  if (plan.kind === 'covered') return { kind: plan.kind, needMinor: s(plan.needMinor), paymentsNowMinor: s(plan.paymentsNowMinor), paymentsAfterMinor: s(plan.paymentsAfterMinor) };
  if (plan.kind === 'reserve') return { kind: plan.kind, needMinor: s(plan.needMinor), moveMinor: s(plan.moveMinor), paymentsNowMinor: s(plan.paymentsNowMinor), reserveNowMinor: s(plan.reserveNowMinor), reserveAfterMinor: s(plan.reserveAfterMinor), paymentsAfterMinor: s(plan.paymentsAfterMinor) };
  return {
    kind: plan.kind,
    needMinor: s(plan.needMinor),
    shortMinor: s(plan.shortMinor),
    paymentsNowMinor: s(plan.paymentsNowMinor),
    reserveNowMinor: s(plan.reserveNowMinor),
    options: plan.options.map((o) => ({ ...routeView(o), amountMinor: s(o.amountMinor), chargeMinor: s(o.chargeMinor), totalMinor: s(o.totalMinor), approvalMinor: o.approvalMinor === null ? null : s(o.approvalMinor) })),
  };
}

function routeView(r: FundingRoute) {
  return { id: r.id, kind: r.kind, label: r.label, asset: r.asset, network: r.network, available: r.available, unavailableReason: r.unavailableReason, testMode: r.testMode, steps: r.steps, chargeBps: r.chargeBps, chargeLabel: r.chargeLabel, splashFeeBps: r.splashFeeBps, exactApproval: r.exactApproval };
}

/** What Step 3 shows: the two accounts, the plan for this route's cost, and every way to bring money in. */
export async function fundingOptions(orgId: string, paymentId: string, quoteId?: string | null) {
  const p = await getPayment(paymentId);
  if (p.orgId !== orgId) throw new ServiceError('payment_not_found', 'That payment is not on the server for this company.', 404);
  const org = getOrg(orgId);
  const vault = requireVault(org);
  const rt = runtime();
  const offline = isSimulator(rt.chain);
  const q = quoteId ? findQuote(p, quoteId) : null;
  const neededMinor = q?.source.amountMinor ?? null;
  const [paymentsMinor, treasuryMinor] = await Promise.all([rt.chain.getUsdcBalance(vault.vaultPda), rt.chain.getUsdcBalance(treasuryVaultPda(vault.multisigPda))]);
  const routes = router.routes({ destination: vault.vaultPda }).map((r) => (offline || !r.testMode ? r : { ...r, available: false, unavailableReason: 'Test mode only: not connected on devnet.' }));
  const plan = neededMinor === null ? null : planFunding({ needMinor: neededMinor, paymentsMinor, reserveMinor: treasuryMinor, paymentsAccount: vault.vaultPda, routes });
  // "Add money another way" prices every way in for what the Payments account is short of, even when the
  // reserve could cover it: the person may still choose to bring money in.
  const shortMinor = neededMinor !== null && neededMinor > paymentsMinor ? neededMinor - paymentsMinor : 0n;
  return {
    vaults: { paymentsMinor: paymentsMinor.toString(), treasuryMinor: treasuryMinor.toString() },
    neededMinor: neededMinor?.toString() ?? null,
    plan: plan ? planView(plan) : null,
    routes: routes.map(routeView),
    shortMinor: shortMinor.toString(),
    priced: priceRoutes(routes, shortMinor).map((o) => ({ id: o.id, amountMinor: o.amountMinor.toString(), chargeMinor: o.chargeMinor.toString(), totalMinor: o.totalMinor.toString(), approvalMinor: o.approvalMinor === null ? null : o.approvalMinor.toString() })),
    sourcesOfFunds: Object.entries(SOURCE_OF_FUNDS).map(([value, label]) => ({ value, label })),
    fundings: fundingsOf(org).filter((f) => f.paymentId === paymentId).map(fundingView),
    simulated: offline,
  };
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export async function startFunding(
  orgId: string,
  paymentId: string,
  input: {
    source: FundingSourceId;
    quoteId: string;
    fromAddress?: string | null;
    sourceOfFunds: SourceOfFunds;
    declared: boolean;
    by: string;
    /** Offline rehearsals: a flagged source, or screening that couldn't answer (both are held). */
    rehearsal?: 'none' | 'kyt_flag' | 'kyt_unavailable';
  },
  now = new Date(),
): Promise<PaymentFunding> {
  const p = await getPayment(paymentId);
  if (p.orgId !== orgId) throw new ServiceError('payment_not_found', 'That payment is not on the server for this company.', 404);
  if (isCommitted(p.state)) throw new ServiceError('wrong_state', 'This payment has already been sent. Nothing more to fund.', 409);
  if (p.state === 'discarded') throw new ServiceError('wrong_state', 'This payment was discarded. Start a new one to fund it.', 409);
  const org = getOrg(orgId);
  const vault = requireVault(org);
  const q = findQuote(p, input.quoteId);
  if (!q) throw new ServiceError('bad_request', 'That route is not one of this payment’s quotes. Get a new quote.', 400);
  const route = checkedRoute(vault.vaultPda, input);
  const fromAddress = sendingWallet(route, input.fromAddress, vault);

  const rt = runtime();
  if (!isSimulator(rt.chain)) throw new ServiceError('sandbox_only', `${route.label} is test mode only in this build and is not connected on devnet.`, 409);

  // One funding per payment at a time: a second request returns the one under way (or done).
  const live = fundingsOf(org).find((f) => f.paymentId === p.id && f.state !== 'held');
  if (live) return live;

  // Bring in what the Payments account is missing for this route (the whole cost if it is empty).
  const paymentsMinor = await rt.chain.getUsdcBalance(vault.vaultPda);
  const amountMinor = q.source.amountMinor > paymentsMinor ? q.source.amountMinor - paymentsMinor : 0n;
  if (amountMinor === 0n) throw new ServiceError('bad_request', 'Your Payments account already covers this payment. Nothing to add.', 409);
  return openFunding(org, route, { paymentId: p.id, amountMinor, fromAddress, input, now });
}

/** The way in a person chose, if it exists, is available, and comes with the declaration. */
function checkedRoute(destination: string, input: { source: FundingSourceId; declared: boolean; sourceOfFunds: SourceOfFunds }): FundingRoute {
  const route = router.routes({ destination }).find((r) => r.id === input.source);
  if (!route) throw new ServiceError('bad_request', 'Choose how the money comes in.');
  if (!route.available) throw new ServiceError('bad_request', route.unavailableReason ?? 'That way in is not available.', 422);
  if (!input.declared) throw new ServiceError('declaration_required', 'Tick the declaration about where this money comes from first.', 422);
  if (!SOURCE_OF_FUNDS[input.sourceOfFunds]) throw new ServiceError('bad_request', 'Say where this money comes from.');
  return route;
}

/** A wallet route's sending address, in its network's own format, and never one of the company's own accounts. */
function sendingWallet(route: FundingRoute, raw0: string | null | undefined, vault: NonNullable<OrgRecord['vault']>): string | null {
  let fromAddress: string | null = null;
  if (route.kind === 'wallet') {
    const raw = (raw0 ?? '').trim();
    if (route.network === 'solana') {
      try {
        fromAddress = new PublicKey(raw).toBase58();
      } catch {
        fromAddress = null;
      }
      if (!fromAddress || fromAddress !== raw) throw new ServiceError('bad_request', 'Enter the address of the wallet you are sending from.', 422);
      if (fromAddress === vault.vaultPda || fromAddress === treasuryVaultPda(vault.multisigPda)) {
        throw new ServiceError('bad_request', 'That is one of your own accounts. To pay from them, choose your Payments account or your reserve.', 422);
      }
    } else {
      if (!EVM_ADDRESS.test(raw)) throw new ServiceError('bad_request', 'Enter the address of the wallet you are sending from (0x…).', 422);
      fromAddress = raw;
    }
  }
  return fromAddress;
}

/** A funding under its check: screened, declared, priced, and not yet counted. */
function openFunding(
  org: OrgRecord,
  route: FundingRoute,
  opts: { paymentId: string | null; amountMinor: bigint; fromAddress: string | null; input: { sourceOfFunds: SourceOfFunds; by: string; rehearsal?: 'none' | 'kyt_flag' | 'kyt_unavailable' }; now: Date },
): PaymentFunding {
  const { input, now, fromAddress, amountMinor } = opts;
  const orgId = org.id;
  // Screen what the money comes from: the sending wallet, or the top-up for a bank or card payment.
  const screened = fromAddress ?? `top-up:${orgId}`;
  const kyt = createKytStub(input.rehearsal === 'kyt_flag' ? [screened] : []).screen(screened, 'solana');
  const unknown = input.rehearsal === 'kyt_unavailable';
  const at = now.toISOString();
  const f: PaymentFunding = {
    id: newId(),
    orgId,
    paymentId: opts.paymentId,
    method: route.kind === 'bank_card' ? 'bank_card' : 'wallet',
    sourceId: route.id,
    asset: route.asset === 'USD' ? 'USD' : route.asset === 'USDT' ? 'USDT' : 'USDC',
    network: route.network,
    fromAddress,
    amountMinor,
    chargeMinor: chargeOn(amountMinor, route.chargeBps),
    chargeBps: route.chargeBps,
    sourceOfFunds: input.sourceOfFunds,
    declaredBy: input.by.trim() || org.personName,
    declaredAt: at,
    state: 'checking',
    checkUntil: new Date(now.getTime() + OFFLINE_FUNDS_CHECK_MS).toISOString(),
    check: unknown
      ? { resultId: kyt.resultId, label: 'Screening could not answer: held until it does', flagged: false, unknown: true }
      : { resultId: kyt.resultId, label: kyt.label, flagged: kyt.verdict === 'flagged' },
    signature: null,
    simulated: true,
    createdAt: at,
    settledAt: null,
  };
  fundingsOf(org).push(f);
  return f;
}

/** A top-up from Balance: at least US$1, at most US$1,000,000 in one go (test mode). */
export const TOP_UP_MIN_MINOR = 1_000_000n;
export const TOP_UP_MAX_MINOR = 1_000_000_000_000n;

/**
 * Balance › Add money (prompt 10 §5.10): every way in, priced for the amount a person chooses, with no
 * payment attached. The same shape as a payment's options, so the same sheet shows both.
 */
export async function topUpOptions(orgId: string, amountMinor: bigint) {
  const org = getOrg(orgId);
  const vault = requireVault(org);
  const rt = runtime();
  const offline = isSimulator(rt.chain);
  const [paymentsMinor, treasuryMinor] = await Promise.all([rt.chain.getUsdcBalance(vault.vaultPda), rt.chain.getUsdcBalance(treasuryVaultPda(vault.multisigPda))]);
  const routes = router.routes({ destination: vault.vaultPda }).map((r) => (offline || !r.testMode ? r : { ...r, available: false, unavailableReason: 'Test mode only: not connected on devnet.' }));
  const amount = amountMinor > 0n ? amountMinor : 0n;
  return {
    vaults: { paymentsMinor: paymentsMinor.toString(), treasuryMinor: treasuryMinor.toString() },
    neededMinor: null,
    plan: null,
    routes: routes.map(routeView),
    shortMinor: amount.toString(),
    priced: priceRoutes(routes, amount).map((o) => ({ id: o.id, amountMinor: o.amountMinor.toString(), chargeMinor: o.chargeMinor.toString(), totalMinor: o.totalMinor.toString(), approvalMinor: o.approvalMinor === null ? null : o.approvalMinor.toString() })),
    sourcesOfFunds: Object.entries(SOURCE_OF_FUNDS).map(([value, label]) => ({ value, label })),
    fundings: fundingsOf(org).filter((x) => x.paymentId === null).slice(-5).map(fundingView),
    simulated: offline,
  };
}

/** Add money to the Payments account from Balance: the same funds check and declaration as a payment's. */
export async function startTopUp(
  orgId: string,
  input: { source: FundingSourceId; amountMinor: bigint; fromAddress?: string | null; sourceOfFunds: SourceOfFunds; declared: boolean; by: string; rehearsal?: 'none' | 'kyt_flag' | 'kyt_unavailable' },
  now = new Date(),
): Promise<PaymentFunding> {
  const org = getOrg(orgId);
  const vault = requireVault(org);
  if (input.amountMinor < TOP_UP_MIN_MINOR) throw new ServiceError('bad_request', 'Add at least US$1.00.', 422);
  if (input.amountMinor > TOP_UP_MAX_MINOR) throw new ServiceError('bad_request', 'Add at most US$1,000,000.00 at a time.', 422);
  if (input.amountMinor % 10_000n !== 0n) throw new ServiceError('bad_request', 'Give the amount in whole cents.', 422);
  const route = checkedRoute(vault.vaultPda, input);
  const fromAddress = sendingWallet(route, input.fromAddress, vault);
  if (!isSimulator(runtime().chain)) throw new ServiceError('sandbox_only', `${route.label} is test mode only in this build and is not connected on devnet.`, 409);
  // One top-up under its check at a time: a second request returns the one under way.
  const live = fundingsOf(org).find((x) => x.paymentId === null && (x.state === 'checking' || x.state === 'crediting'));
  if (live) return live;
  return openFunding(org, route, { paymentId: null, amountMinor: input.amountMinor, fromAddress, input, now });
}

/**
 * Where a funding stands. Once its check has run: a flagged source, or one screening couldn't answer
 * for, is held (nothing reaches the account: screening fails closed); a clear one lands in the
 * Payments account. The funding is claimed ('crediting') before the credit is awaited, so two reads at
 * once credit once (FUNDING-AUDIT.md §8 step 9).
 */
export async function refreshFunding(orgId: string, fundingId: string, now = new Date()): Promise<PaymentFunding> {
  const org = getOrg(orgId);
  const f = fundingsOf(org).find((x) => x.id === fundingId);
  if (!f) throw new ServiceError('funding_not_found', 'That funding is not on the server for this company.', 404);
  if (f.state !== 'checking' || now.getTime() < Date.parse(f.checkUntil)) return f;
  if (f.check?.flagged || f.check?.unknown) {
    f.state = 'held';
    f.settledAt = now.toISOString();
    return f;
  }
  const vault = requireVault(org);
  const chain = runtime().chain;
  // Only the offline simulator stands in for an outside source (startFunding refuses on devnet).
  if (!isSimulator(chain)) throw new ServiceError('sandbox_only', 'This funding is test mode only and cannot complete on devnet.', 409);
  f.state = 'crediting';
  let receipt: Awaited<ReturnType<typeof chain.fundUsdc>>;
  try {
    receipt = await chain.fundUsdc(vault.vaultPda, f.amountMinor);
  } catch (e) {
    f.state = 'checking';
    throw e;
  }
  f.state = 'in_vault';
  f.signature = receipt.signature;
  f.settledAt = now.toISOString();
  org.fundings.push({ signature: receipt.signature, amountMinor: f.amountMinor, at: f.settledAt, simulated: true, note: f.paymentId ? `${fundingView(f).methodLabel} for ${f.paymentId}` : `${fundingView(f).methodLabel} · top-up` });
  return f;
}
