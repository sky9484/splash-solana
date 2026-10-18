/**
 * Treasury's investments (prompt 10 Phase 5, test mode): T-bills (USDY, issued by Ondo) subscribed and
 * redeemed, and US stocks and ETFs bought and sold, in the company's own Investments account (Squads
 * vault #2 of its multisig: the same members and threshold, no third-party permission).
 *
 * In test mode an order is an off-chain order the company approves on its device: the server writes the
 * exact order text, a member's device key signs it, the server checks the signature, and the simulator
 * plays the market or Ondo. Nothing settles without that signature; Splash holds no key that could. A
 * live adapter builds the vault transaction from vault #2 instead (not built: test mode only).
 *
 *   view      the three accounts, the reserve against its floor, what can be invested and why, the
 *             catalogue with every rate and return dated and sourced, holdings with their holds, the
 *             sweep rule and today's draft, the eligibility gate, Zeke's sentence
 *   quote     what an order would do: units, price, path, price moved, where it lands, its limit
 *   prepare   the order text to sign (60 seconds), after the rules and the eligibility gate
 *   approve   the device signature checked, then settled: money out of the Reserve's surplus first,
 *             then the Payments account's; money back into the Payments account; Ondo's redemption by
 *             wire to the company's bank, outside Splash, never into the Payments account
 *   sweep     at most one draft a day from the owner's rule, and once a quarter a draft to bring the
 *             quarter's interest back (prompt 11 §4.4); "Not now" holds sweep-out drafts back for 7
 *             days. The job never approves or settles: a person approves every move on a device
 *
 * Every settled order writes a receipt of kind 6 (`treasury`). Integers only.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

import { CHALLENGE_PREFIX } from '../solana/recovery-kit.ts';
import { isSimulator } from '../solana/simulator.ts';
import { vaultPdaAt } from '../solana/squads.ts';
import { buildTreasuryOrderBundle, type ChainSignatureRecord } from '../solana-evidence/bundle.ts';
import { formatUsd } from '../solana-zeke/router.ts';
import { adapterFor, PRICE_MOVED_LIMIT_BPS, testPrice, valueOf, type OrderKind, type OrderPath, type OrderQuote } from '../treasury/adapters.ts';
import { ageDays, isFresh, STOCKS, stockRef, TBILLS, UNIT, type AssetId } from '../treasury/reference.ts';
import { availableToInvest, drawPlan, isCovered, maxStockBuy, payablesDue, RESERVE_MARGIN_PCT_DEFAULT, reserveFloor, shortfall, STOCK_CAP_PCT_DEFAULT, stockSharePct, SWEEP_CUSHION_DEFAULT, type Position } from '../treasury/reserve.ts';
import { bookedPrice, dailyInterest, interestBetween, previousQuarter, quarterOf, type UnitsEvent } from '../treasury/history.ts';
import { quarterInterestDraft, sweepDraft, SWEEP_RULE_DEFAULT } from '../treasury/sweep.ts';
import { ServiceError } from './errors.ts';
import { accountBalances, payablesOf, positionFrom } from './money-position.ts';
import { runtime } from './runtime.ts';
import { getOrg, sealEvidence, treasuryVaultPda } from './service.ts';
import type { InvestmentLot, InvestmentOrder, OrgRecord, SweepDraftRecord, TreasuryRules } from './store.ts';

/** Vault index 2 of the company's multisig: the Investments account. */
export const INVESTMENTS_VAULT_INDEX = 2;
/** An order's text is signed within this. */
export const ORDER_TTL_MS = 60_000;
const DAY_MS = 86_400_000;
/** "Not now" on a sweep-out draft: Zeke asks again after this many days (prompt 11 §4.3). */
export const SWEEP_SNOOZE_DAYS = 7;
const ASSETS: AssetId[] = ['usdy', 'spy', 'qqq', 'nvda', 'googl', 'tsla'];

const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const cents = (minor: bigint) => (minor / 10_000n) * 10_000n;
function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  return bytesToHex(b);
}
function shortDay(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
function longDay(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
/** "8,896.80": units, in millionths, to two decimals (rounded down). */
export function unitsText(unitsMicro: bigint): string {
  const hundredths = unitsMicro / 10_000n;
  return `${(hundredths / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(hundredths % 100n).toString().padStart(2, '0')}`;
}
/** "US$1.1240", a test price (in millionths) to four decimals, rounded half-up. Cutting it off instead
 *  could leave the price a whole 0.0001 low, more than the units printed beside it allow for. */
export function priceText(priceMinor: bigint): string {
  const tenThousandths = (priceMinor + 50n) / 100n;
  return `US$${(tenThousandths / 10_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(tenThousandths % 10_000n).toString().padStart(4, '0')}`;
}
/** 21 → "0.21%". */
const movedText = (bps: bigint) => `${bps / 100n}.${(bps % 100n).toString().padStart(2, '0')}%`;

/* ── The company's records ────────────────────────────────────────────── */

function book(org: OrgRecord) {
  org.investments ??= { lots: [], orders: [] };
  return org.investments;
}

export function rulesOf(org: OrgRecord): TreasuryRules {
  org.treasuryRules ??= { sweep: { ...SWEEP_RULE_DEFAULT }, eligibility: null, audit: [] };
  return org.treasuryRules;
}

function draftsOf(org: OrgRecord): SweepDraftRecord[] {
  org.sweepDrafts ??= [];
  return org.sweepDrafts;
}

/** The Investments account's address (vault #2). Only in "Technical details". */
export function investmentsAccount(org: OrgRecord): string | null {
  return org.vault ? vaultPdaAt(new PublicKey(org.vault.multisigPda), INVESTMENTS_VAULT_INDEX).toBase58() : null;
}

export interface Holding {
  asset: AssetId;
  unitsMicro: bigint;
  valueMinor: bigint;
  costMinor: bigint;
  /** Units still in a hold, and when the earliest hold ends. */
  heldUnitsMicro: bigint;
  heldUntil: string | null;
  redeemableUnitsMicro: bigint;
  redeemableMinor: bigint;
}

/** What the company holds, valued at the test prices, with what is still in a hold at `now`. */
export function holdingsOf(org: OrgRecord, now: Date) {
  const lots = book(org).lots.filter((l) => l.unitsMicro > 0n);
  const per: Holding[] = [];
  for (const asset of ASSETS) {
    const mine = lots.filter((l) => l.asset === asset);
    if (mine.length === 0) continue;
    const price = testPrice(asset, now);
    const units = mine.reduce((n, l) => n + l.unitsMicro, 0n);
    const held = mine.filter((l) => l.heldUntil && Date.parse(l.heldUntil) > now.getTime());
    const heldUnits = held.reduce((n, l) => n + l.unitsMicro, 0n);
    const earliest = held.map((l) => l.heldUntil!).sort()[0] ?? null;
    const redeemableUnits = units - heldUnits;
    per.push({ asset, unitsMicro: units, valueMinor: valueOf(units, price), costMinor: mine.reduce((n, l) => n + l.costMinor, 0n), heldUnitsMicro: heldUnits, heldUntil: earliest, redeemableUnitsMicro: redeemableUnits, redeemableMinor: valueOf(redeemableUnits, price) });
  }
  const investmentsMinor = per.reduce((n, h) => n + h.valueMinor, 0n);
  const stocksMinor = per.filter((h) => h.asset !== 'usdy').reduce((n, h) => n + h.valueMinor, 0n);
  return { per, investmentsMinor, stocksMinor, setUp: book(org).orders.some((o) => o.state === 'settled') };
}

/** The reserve rules' position for this company, with its investments at value. */
export async function treasuryPosition(org: OrgRecord, now: Date): Promise<{ position: Position; holdings: ReturnType<typeof holdingsOf> }> {
  const holdings = holdingsOf(org, now);
  const balances = await accountBalances(org);
  const payables = await payablesOf(org, now);
  return { position: positionFrom({ ...balances, investmentsMinor: holdings.investmentsMinor, stocksMinor: holdings.stocksMinor }, payables), holdings };
}

/* ── Sweep ────────────────────────────────────────────────────────────── */

const purposeOf = (d: SweepDraftRecord) => d.purpose ?? 'sweep';

/** The T-bill units each settled order added or took, for the booked interest (history.ts). */
export function unitsEventsOf(org: OrgRecord): UnitsEvent[] {
  return book(org)
    .orders.filter((o) => o.asset === 'usdy' && o.state === 'settled' && (o.kind === 'subscribe' || o.kind === 'redeem'))
    .map((o) => ({ at: o.settlement?.at ?? o.approval?.at ?? o.createdAt, kind: o.kind as 'subscribe' | 'redeem', unitsMicro: o.unitsMicro }));
}

/**
 * Today's sweep draft, made once (the daily job, or the first read of the day): at most one a day, an
 * earlier draft nobody approved is replaced, not stacked. Hold makes nothing, and turning sweep off
 * withdraws a waiting draft. "Not now" on a sweep-out draft holds sweep-out back for 7 days. Beside it,
 * once a quarter, the quarter's interest to bring back (draftQuarterInterest). Never approves or
 * settles anything: every draft waits for a person.
 */
export async function draftSweep(orgId: string, now = new Date()): Promise<SweepDraftRecord | null> {
  const org = getOrg(orgId);
  if (!org.vault) return null;
  const rule = rulesOf(org).sweep;
  const drafts = draftsOf(org);
  const day = utcDay(now);
  if (!rule.on) {
    for (const d of drafts) if (d.state === 'drafted') d.state = 'withdrawn';
    return null;
  }
  const { position, holdings } = await treasuryPosition(org, now);
  const usdy = holdings.per.find((h) => h.asset === 'usdy');
  draftQuarterInterest(org, usdy?.redeemableMinor ?? 0n, now);
  const sweeps = drafts.filter((d) => purposeOf(d) === 'sweep');
  const today = sweeps.find((d) => d.day === day && (d.state === 'drafted' || d.state === 'approved' || d.state === 'dismissed'));
  if (today) return today.state === 'drafted' ? today : null;
  for (const d of sweeps) if (d.state === 'drafted') d.state = 'replaced';
  const draft = sweepDraft({ position, rule, redeemableMinor: usdy?.redeemableMinor ?? 0n });
  if (!draft) return null;
  if (draft.kind === 'subscribe' && snoozedUntil(org, now)) return null;
  const rec: SweepDraftRecord = { id: `swp_${randomHex(8)}`, day, kind: draft.kind, amountMinor: draft.amountMinor, reason: draft.reason, createdAt: now.toISOString(), state: 'drafted', orderId: null, cushionMinor: rule.cushionMinor, purpose: 'sweep' };
  drafts.push(rec);
  trim(drafts);
  return rec;
}

function trim(drafts: SweepDraftRecord[]) {
  if (drafts.length > 60) drafts.splice(0, drafts.length - 60);
}

/** Until when "Not now" holds sweep-out drafts back, if it still does at `now` (ISO), else null. */
export function snoozedUntil(org: OrgRecord, now = new Date()): string | null {
  let until: number | null = null;
  for (const d of draftsOf(org)) {
    if (purposeOf(d) !== 'sweep' || d.kind !== 'subscribe' || d.state !== 'dismissed' || !d.dismissed) continue;
    const end = Date.parse(d.dismissed.at) + SWEEP_SNOOZE_DAYS * DAY_MS;
    if (end > now.getTime() && (until === null || end > until)) until = end;
  }
  return until === null ? null : new Date(until).toISOString();
}

/**
 * Prompt 11 §4.4 (decision 10): from the first business day after a calendar quarter ends, with Sweep
 * on, one draft to bring that quarter's booked interest back to the Payments account, at least US$50 and
 * no more than can be redeemed now. At most one a quarter (one withdrawn by turning sweep off may come
 * back); it replaces an older quarter draft nobody approved, and it doesn't count against the daily
 * sweep. Drafted only.
 */
export function draftQuarterInterest(org: OrgRecord, redeemableMinor: bigint, now = new Date()): SweepDraftRecord | null {
  const rule = rulesOf(org).sweep;
  const day = utcDay(now);
  const q = quarterInterestDraft({ today: day, rule, events: unitsEventsOf(org), redeemableMinor });
  if (!q) return null;
  const drafts = draftsOf(org);
  const mine = drafts.filter((d) => purposeOf(d) === 'quarter_interest');
  const already = mine.find((d) => d.quarter === q.quarter.key && d.state !== 'withdrawn' && d.state !== 'replaced');
  if (already) return already.state === 'drafted' ? already : null;
  for (const d of mine) if (d.state === 'drafted') d.state = 'replaced';
  const rec: SweepDraftRecord = { id: `swp_${randomHex(8)}`, day, kind: 'redeem', amountMinor: q.amountMinor, reason: 'quarter_interest', createdAt: now.toISOString(), state: 'drafted', orderId: null, cushionMinor: rule.cushionMinor, purpose: 'quarter_interest', quarter: q.quarter.key, months: q.quarter.months };
  drafts.push(rec);
  trim(drafts);
  return rec;
}

/** The draft waiting for a person today, if any (Overview's "Needs you", Treasury's row). Reads only. */
export function waitingSweepDraft(org: OrgRecord, now = new Date()): SweepDraftRecord | null {
  return draftsOf(org).find((d) => purposeOf(d) === 'sweep' && d.day === utcDay(now) && d.state === 'drafted') ?? null;
}

/** This quarter's drafted move to bring the last quarter's booked interest back, if it waits for a person. Reads only. */
export function waitingQuarterDraft(org: OrgRecord, now = new Date()): SweepDraftRecord | null {
  return waitingDrafts(org, now).find((d) => purposeOf(d) === 'quarter_interest') ?? null;
}

/** Every draft waiting for a person: today's sweep and this quarter's interest. Reads only. */
export function waitingDrafts(org: OrgRecord, now = new Date()): SweepDraftRecord[] {
  const quarter = previousQuarter(utcDay(now)).key;
  return draftsOf(org).filter((d) => d.state === 'drafted' && (purposeOf(d) === 'sweep' ? d.day === utcDay(now) : d.quarter === quarter));
}

/**
 * "Not now" (prompt 11 §4.3): a person sets a waiting draft aside. Nothing moves; a sweep-out draft is
 * not drafted again for 7 days, a quarter's interest not again that quarter. Recorded with who and when.
 */
export function dismissSweepDraft(orgId: string, draftId: string, actor: { name: string }, now = new Date()): SweepDraftRecord {
  const d = draftsOf(getOrg(orgId)).find((x) => x.id === draftId);
  if (!d) throw new ServiceError('bad_request', 'That draft isn’t here.', 404);
  if (d.state !== 'drafted') throw new ServiceError('wrong_state', 'That draft isn’t waiting any more.', 409);
  d.state = 'dismissed';
  d.dismissed = { by: actor.name, at: now.toISOString() };
  return d;
}

/** The owner turns sweep on or off and sets the cushion. Recorded with who and when. */
export function setSweepRule(orgId: string, input: { on: boolean; cushionMinor?: bigint }, actor: { isOwner: boolean; name: string }, now = new Date()) {
  if (!actor.isOwner) throw new ServiceError('not_authorized', 'Only your company’s owner can turn sweep on or off.', 403);
  const org = getOrg(orgId);
  const rules = rulesOf(org);
  const cushion = input.cushionMinor ?? rules.sweep.cushionMinor;
  if (cushion < 0n || cushion > 1_000_000n * UNIT || cushion % 10_000n !== 0n) throw new ServiceError('bad_request', 'The cushion is a whole-cent amount up to US$1,000,000.', 422);
  const before = rules.sweep;
  rules.sweep = { on: input.on, cushionMinor: cushion };
  rules.audit.push({ at: now.toISOString(), by: actor.name, change: `sweep ${before.on ? 'on' : 'off'} → ${input.on ? 'on' : 'off'}; cushion ${formatUsd(before.cushionMinor)} → ${formatUsd(cushion)}` });
  if (!input.on) for (const d of draftsOf(org)) if (d.state === 'drafted') d.state = 'withdrawn';
  return rules.sweep;
}

/** The one-time US-person confirmation, by the owner, before the first subscription or buy. Recorded with who and when. */
export function confirmEligibility(orgId: string, actor: { isOwner: boolean; name: string }, now = new Date()) {
  if (!actor.isOwner) throw new ServiceError('not_authorized', 'Your company’s owner confirms this once.', 403);
  const rules = rulesOf(getOrg(orgId));
  if (!rules.eligibility) {
    rules.eligibility = { by: actor.name, at: now.toISOString() };
    rules.audit.push({ at: now.toISOString(), by: actor.name, change: 'confirmed: no owner (25% or more), director or approver is a US person or in a restricted country' });
  }
  return rules.eligibility;
}

/* ── Orders ───────────────────────────────────────────────────────────── */

export interface OrderRequest {
  asset: AssetId;
  kind: OrderKind;
  amountMinor: bigint;
  /** The person's choice; the planner's pick when absent. */
  path?: OrderPath;
  sweepDraftId?: string | null;
}

const KIND_FOR: Record<OrderKind, 'tbill' | 'stock'> = { subscribe: 'tbill', redeem: 'tbill', buy: 'stock', sell: 'stock' };

function assertKind(asset: AssetId, kind: OrderKind) {
  if ((asset === 'usdy') !== (KIND_FOR[kind] === 'tbill')) {
    throw new ServiceError('bad_request', asset === 'usdy' ? 'T-bills are subscribed and redeemed.' : 'Stocks are bought and sold.', 422);
  }
}

export interface OrderPreview {
  request: { asset: AssetId; kind: OrderKind; path: OrderPath; amountMinor: bigint; sweepDraftId: string | null };
  quote: OrderQuote;
  name: string;
  /** Where the money comes from (subscribe, buy) and how much may be used. */
  from: { reserveMinor: bigint; paymentsMinor: bigint; label: string } | null;
  /** The most this order may be, and why that's the limit. */
  limit: { maxMinor: bigint; why: string };
  /** For redeem and sell: units that can go now (out of their hold). */
  redeemableMinor: bigint | null;
  holdUntil: string | null;
  /** The stock-cap line, for a buy. */
  stockCapLine: string | null;
  /** One sentence the sheet shows under the rows. */
  note: string;
  /** The sheet's rows, in words: "8,896.80 units at US$1.1240 (test price)"; How, or Price moved by. */
  words: { unitsLabel: string; units: string; howLabel: string; how: string; landsLabel: string; lands: string };
  ok: boolean;
  problem: string | null;
  /** The only thing in the way is the owner's one-time eligibility confirmation. */
  gateOnly: boolean;
}

/** What an order would do, and whether it may go. Reads only. */
export async function quoteOrder(orgId: string, req: OrderRequest, now = new Date()): Promise<OrderPreview> {
  const org = getOrg(orgId);
  if (!org.vault) throw new ServiceError('vault_missing', 'Set up your accounts first.', 409);
  assertKind(req.asset, req.kind);
  if (req.amountMinor <= 0n || req.amountMinor % 10_000n !== 0n) throw new ServiceError('bad_request', 'Give an amount in whole cents.', 422);
  const { position, holdings } = await treasuryPosition(org, now);
  const name = req.asset === 'usdy' ? TBILLS.name : stockRef(req.asset)!.name;
  const holding = holdings.per.find((h) => h.asset === req.asset) ?? null;
  const adapter = adapterFor(req.asset);
  const paying = req.kind === 'subscribe' || req.kind === 'buy';
  // The planner: on the market when it stays within the limit, else straight from Ondo (T-bills only).
  const marketQuote = adapter.quote({ asset: req.asset, kind: req.kind, path: 'market', amountMinor: req.amountMinor, now });
  // Never by wire unless the person picks it: a redemption the planner routes lands in the Payments account.
  const path: OrderPath = req.path ?? (marketQuote.withinLimit || req.asset !== 'usdy' || req.kind === 'redeem' ? 'market' : 'ondo');
  const quote = path === 'market' ? marketQuote : adapter.quote({ asset: req.asset, kind: req.kind, path, amountMinor: req.amountMinor, now });
  const holdUntil = quote.holdDays > 0 ? new Date(now.getTime() + quote.holdDays * DAY_MS).toISOString() : null;

  let limitMax: bigint;
  let limitWhy: string;
  let from: OrderPreview['from'] = null;
  let stockCapLine: string | null = null;
  let redeemableMinor: bigint | null = null;
  const marketMax = path === 'market' ? quote.maxMinor : null;
  if (paying) {
    const a = availableToInvest(position);
    const plan = drawPlan(position, req.amountMinor);
    from = { reserveMinor: plan.fromReserveMinor, paymentsMinor: plan.fromPaymentsMinor, label: plan.fromReserveMinor > 0n && plan.fromPaymentsMinor > 0n ? 'Reserve, then Payments account' : plan.fromReserveMinor > 0n ? 'Reserve' : 'Payments account' };
    limitMax = a.totalMinor;
    limitWhy = `Available to invest: ${formatUsd(a.totalMinor)}. ${a.floorMinor > 0n ? `Your reserve stays at its floor, ${formatUsd(a.floorMinor)}, and` : 'Nothing is due in the next 30 days, so your reserve keeps no floor; and'} nothing waiting for approval is touched.`;
    if (req.kind === 'buy') {
      const cap = maxStockBuy(position);
      // Stocks as a share of treasury after this buy, to a tenth of a percent (rounded down).
      const treasuryAfter = position.reserveMinor + position.investmentsMinor + plan.fromPaymentsMinor;
      const tenths = treasuryAfter === 0n ? 0n : ((position.stocksMinor + req.amountMinor) * 1000n) / treasuryAfter;
      stockCapLine = `Your 20% stock limit allows up to ${formatUsd(cap)} today. This buy takes stocks to ${tenths / 10n}.${tenths % 10n}% of treasury.`;
      if (cap < limitMax) {
        limitMax = cap;
        limitWhy = `Your 20% stock limit allows up to ${formatUsd(cap)} today.`;
      }
    }
  } else {
    redeemableMinor = holding?.redeemableMinor ?? 0n;
    limitMax = redeemableMinor;
    limitWhy = holding && holding.heldUnitsMicro > 0n ? `You can ${req.kind} ${formatUsd(redeemableMinor)} now; ${formatUsd(valueOf(holding.heldUnitsMicro, quote.priceMinor))} is in its hold until ${shortDay(holding.heldUntil!)}.` : `You hold ${formatUsd(redeemableMinor)}.`;
  }
  if (marketMax !== null && marketMax < limitMax) {
    limitMax = marketMax;
    limitWhy = `On the market, an order above ${formatUsd(marketMax)} would move the price more than ${movedText(PRICE_MOVED_LIMIT_BPS)}, so it would be stopped.${req.asset === 'usdy' && paying ? ' Straight from Ondo there is no such limit.' : req.asset !== 'usdy' ? ' Stock orders go on the market only.' : ''}`;
  }

  // The order's own limits first; the one-time eligibility gate only once the order itself may go.
  let problem: string | null = null;
  if (path === 'market' && !quote.withinLimit) problem = `This would move the price by ${movedText(quote.priceMovedBps!)}, past the ${movedText(PRICE_MOVED_LIMIT_BPS)} limit. ${limitWhy}`;
  else if (req.amountMinor > limitMax) problem = limitWhy;
  else if (paying && !rulesOf(org).eligibility) problem = ELIGIBILITY_PROBLEM;

  const floor = reserveFloor(payablesDue(position));
  const floorLine = floor > 0n ? ` Your reserve stays at its floor, ${formatUsd(floor)}.` : '';
  const note =
    req.kind === 'subscribe'
      ? path === 'ondo'
        ? `Your dollars go to Ondo, and Ondo issues the units into your own Investments account. They’re held ${quote.holdDays} days, until ${shortDay(holdUntil!)}.${floorLine}`
        : `Bought on the market, so there’s no hold. The units land in your own Investments account.${floorLine}`
      : req.kind === 'redeem'
        ? path === 'ondo'
          ? 'Redeeming with Ondo sends US dollars by bank wire to your company’s bank account, outside Splash. It doesn’t land in your Payments account.'
          : 'Redeeming never pays a supplier directly: the money lands in your Payments account first.'
        : req.kind === 'buy'
          ? `${stockCapLine ?? ''} The market for this one can be thin, so any order that would move the price more than ${movedText(PRICE_MOVED_LIMIT_BPS)} is stopped.`.trim()
          : 'The money lands in your Payments account.';
  return {
    request: { asset: req.asset, kind: req.kind, path, amountMinor: req.amountMinor, sweepDraftId: req.sweepDraftId ?? null },
    quote,
    name,
    from,
    limit: { maxMinor: limitMax, why: limitWhy },
    redeemableMinor,
    holdUntil,
    stockCapLine,
    note,
    words: {
      unitsLabel: paying ? 'You get about' : req.kind === 'redeem' ? 'You redeem about' : 'You sell about',
      units: unitsWords(quote),
      howLabel: req.asset === 'usdy' ? 'How' : 'Price moved by',
      how: howWords({ quote }),
      landsLabel: paying ? (req.asset === 'usdy' ? 'Units land in' : 'Lands in') : 'Money goes to',
      lands: quote.landsIn === 'investments' ? 'Investments account' : quote.landsIn === 'payments' ? 'Payments account' : 'Your company’s bank account, by wire, outside Splash',
    },
    ok: problem === null,
    problem,
    gateOnly: problem === ELIGIBILITY_PROBLEM,
  };
}

/** The exact text a device signs for an order. Domain-separated: it can never be a valid transaction. */
export function orderMessage(o: Pick<InvestmentOrder, 'id' | 'kind' | 'asset' | 'path' | 'amountMinor' | 'unitsMicro' | 'priceMinor' | 'expiresAt' | 'nonce'>, orgId: string): string {
  return `${CHALLENGE_PREFIX}treasury-order\norg:${orgId}\norder:${o.id}\nkind:${o.kind}\nasset:${o.asset}\npath:${o.path}\namount:${o.amountMinor}\nunits:${o.unitsMicro}\nprice:${o.priceMinor}\nexpires:${o.expiresAt}\nnonce:${o.nonce}`;
}

const ELIGIBILITY_PROBLEM = 'Your company’s owner confirms once that no owner (25% or more), director or approver is a US person or in a restricted country.';

/** A request body (schemas.treasuryOrder) as an order request. */
export function orderRequestFrom(body: { asset: AssetId; kind: OrderKind; amountMinor: string; path?: OrderPath } | { sweepDraftId: string; path?: OrderPath }): OrderRequest {
  if ('sweepDraftId' in body) return { asset: 'usdy', kind: 'subscribe', amountMinor: 0n, sweepDraftId: body.sweepDraftId, path: body.path };
  return { asset: body.asset, kind: body.kind, amountMinor: BigInt(body.amountMinor), path: body.path };
}

/** What the browser learns about a settled order. */
export function orderSummary(o: InvestmentOrder) {
  return { id: o.id, kind: o.kind, asset: o.asset, path: o.path, amountMinor: o.amountMinor, unitsText: unitsText(o.unitsMicro), landsIn: o.landsIn, holdUntil: o.holdUntil, state: o.state, receiptId: o.receiptId };
}

/** A sweep draft's order, as drafted. Money back from a sweep always lands in the Payments account. */
export function resolveOrderRequest(orgId: string, req: OrderRequest): OrderRequest {
  if (!req.sweepDraftId) return req;
  const d = draftsOf(getOrg(orgId)).find((x) => x.id === req.sweepDraftId);
  if (!d || d.state !== 'drafted') throw new ServiceError('wrong_state', 'That sweep draft isn’t waiting any more.', 409);
  return { asset: 'usdy', kind: d.kind, amountMinor: d.amountMinor, sweepDraftId: d.id, path: d.kind === 'redeem' ? 'market' : req.path };
}

/** The order, ready for a device to approve: the text to sign. The rules and the gate first. */
export async function prepareOrder(orgId: string, req: OrderRequest, by: string, now = new Date()): Promise<{ order: InvestmentOrder; message: string; preview: OrderPreview }> {
  const org = getOrg(orgId);
  if (!isSimulator(runtime().chain)) throw new ServiceError('sandbox_only', 'Investments are test mode only until legal sign-off in Malaysia.', 409);
  req = resolveOrderRequest(orgId, req);
  // The gate before anything else: no subscription or buy until the owner has confirmed once.
  if ((req.kind === 'subscribe' || req.kind === 'buy') && !rulesOf(org).eligibility) throw new ServiceError('not_authorized', ELIGIBILITY_PROBLEM, 403);
  const preview = await quoteOrder(orgId, req, now);
  if (!preview.ok) throw new ServiceError('bad_request', preview.problem!, 422);
  for (const o of book(org).orders) if (o.state === 'prepared' && Date.parse(o.expiresAt) < now.getTime()) o.state = 'expired';
  const q = preview.quote;
  const order: InvestmentOrder = {
    id: `ord_${randomHex(8)}`,
    asset: q.asset,
    kind: q.kind,
    path: q.path,
    amountMinor: q.amountMinor,
    unitsMicro: q.unitsMicro,
    priceMinor: q.priceMinor,
    priceMovedBps: q.priceMovedBps,
    holdUntil: preview.holdUntil,
    from: preview.from ? { reserveMinor: preview.from.reserveMinor, paymentsMinor: preview.from.paymentsMinor } : null,
    landsIn: q.landsIn,
    state: 'prepared',
    createdAt: now.toISOString(),
    createdBy: by,
    expiresAt: new Date(now.getTime() + ORDER_TTL_MS).toISOString(),
    nonce: randomHex(16),
    sweepDraftId: preview.request.sweepDraftId,
    approval: null,
    settlement: null,
    receiptId: null,
  };
  book(org).orders.push(order);
  return { order, message: orderMessage(order, org.id), preview };
}

/**
 * A device approved the order: its signature checked against the member's device key, the rules
 * checked again, then settled (test mode: the simulator plays the other side). Returns the order.
 */
/**
 * One approval at a time per company. Without it two requests for the same order (a double click, two
 * tabs) both passed the state check before either settled, and both took the money; two different
 * orders could each pass the reserve floor or the stock cap and breach it together. Each approval
 * waits for the one before it, then reads the order's state afresh.
 */
const approvalQueue = new Map<string, Promise<unknown>>();
async function oneAtATime<T>(orgId: string, run: () => Promise<T>): Promise<T> {
  const before = approvalQueue.get(orgId) ?? Promise.resolve();
  let done!: () => void;
  const mine = before.then(() => new Promise<void>((resolve) => (done = resolve)));
  approvalQueue.set(orgId, mine);
  await before;
  try {
    return await run();
  } finally {
    done();
    if (approvalQueue.get(orgId) === mine) approvalQueue.delete(orgId);
  }
}

export async function approveOrder(orgId: string, orderId: string, input: { signature: string; who: string; deviceKey: string }, now = new Date()): Promise<InvestmentOrder> {
  return oneAtATime(orgId, () => approveOrderNow(orgId, orderId, input, now));
}

async function approveOrderNow(orgId: string, orderId: string, input: { signature: string; who: string; deviceKey: string }, now: Date): Promise<InvestmentOrder> {
  const org = getOrg(orgId);
  const vault = org.vault;
  if (!vault) throw new ServiceError('vault_missing', 'Set up your accounts first.', 409);
  const order = book(org).orders.find((o) => o.id === orderId);
  if (!order) throw new ServiceError('payment_not_found', 'That order isn’t on the server for this company.', 404);
  if (order.state === 'settled') return order;
  if (order.state !== 'prepared') throw new ServiceError('wrong_state', 'That order isn’t waiting for an approval.', 409);
  if (now.getTime() > Date.parse(order.expiresAt)) {
    order.state = 'expired';
    throw new ServiceError('quote_expired', 'That order’s price ran out. Review it again for a fresh one.', 409);
  }
  if (vault.threshold > 1) throw new ServiceError('not_authorized', 'Your accounts need more than one approver; investments in test mode take one.', 409);
  if (!vault.members.some((m) => m.publicKey === input.deviceKey)) throw new ServiceError('not_an_approver', 'This device isn’t one of your accounts’ approvers.', 403);
  const message = orderMessage(order, org.id);
  let valid = false;
  try {
    const sig = bs58.decode(input.signature);
    valid = sig.length === 64 && ed25519.verify(sig, utf8ToBytes(message), bs58.decode(input.deviceKey));
  } catch {
    valid = false;
  }
  if (!valid) throw new ServiceError('signature_invalid', 'The device approval did not check out. Try again.', 401);
  // A sweep order settles only while its draft is still waiting: not twice from one draft, and not
  // after the owner turned sweep off and the draft was withdrawn.
  if (order.sweepDraftId) {
    const d = draftsOf(org).find((x) => x.id === order.sweepDraftId);
    if (!d || d.state !== 'drafted') throw new ServiceError('wrong_state', 'That sweep draft isn’t waiting any more. Review Treasury for today’s.', 409);
  }

  // The rules again, at this moment: balances and holds may have changed since the quote.
  const again = await quoteOrder(orgId, { asset: order.asset as AssetId, kind: order.kind, amountMinor: order.amountMinor, path: order.path, sweepDraftId: order.sweepDraftId }, now);
  if (!again.ok) throw new ServiceError('rejected_by_policy', again.problem!, 409);

  const chain = runtime().chain;
  if (!isSimulator(chain)) throw new ServiceError('sandbox_only', 'Investments are test mode only until legal sign-off in Malaysia.', 409);
  const reserveVault = treasuryVaultPda(vault.multisigPda);
  const signatures: string[] = [];
  const label = `${order.kind}:${order.asset}:${order.id}`;
  const lots = book(org).lots;
  if (order.kind === 'subscribe' || order.kind === 'buy') {
    const plan = again.from!;
    if (plan.reserveMinor > 0n) signatures.push((await chain.settleTestOrder(reserveVault, -plan.reserveMinor, label)).signature);
    if (plan.paymentsMinor > 0n) signatures.push((await chain.settleTestOrder(vault.vaultPda, -plan.paymentsMinor, label)).signature);
    order.from = { reserveMinor: plan.reserveMinor, paymentsMinor: plan.paymentsMinor };
    const lot: InvestmentLot = { id: `lot_${randomHex(6)}`, asset: order.asset, unitsMicro: order.unitsMicro, costMinor: order.amountMinor, at: now.toISOString(), heldUntil: order.holdUntil, orderId: order.id };
    lots.push(lot);
  } else {
    // Out of units not in a hold, oldest first.
    let left = order.unitsMicro;
    for (const l of lots.filter((x) => x.asset === order.asset && x.unitsMicro > 0n && !(x.heldUntil && Date.parse(x.heldUntil) > now.getTime())).sort((a, b) => (a.at < b.at ? -1 : 1))) {
      if (left === 0n) break;
      const take = l.unitsMicro < left ? l.unitsMicro : left;
      l.costMinor -= (l.costMinor * take) / l.unitsMicro;
      l.unitsMicro -= take;
      left -= take;
    }
    if (left > 0n) throw new ServiceError('rejected_by_policy', 'There aren’t enough units out of their hold for this.', 409);
    if (order.landsIn === 'payments') signatures.push((await chain.settleTestOrder(vault.vaultPda, order.amountMinor, label)).signature);
    else signatures.push(`wire:${order.id}`);
  }
  order.state = 'settled';
  order.approval = { who: input.who, keyPublic: input.deviceKey, at: now.toISOString(), signature: input.signature };
  order.settlement = { signatures, simulated: true, at: now.toISOString() };
  if (order.sweepDraftId) {
    const d = draftsOf(org).find((x) => x.id === order.sweepDraftId);
    if (d) {
      d.state = 'approved';
      d.orderId = order.id;
    }
  }

  const receiptId = `rcpt_${randomHex(8)}`;
  const chainSigs: ChainSignatureRecord[] = signatures.filter((s) => !s.startsWith('wire:')).map((s) => ({ purpose: 'spl_transfer', network: 'solana', signature: s, cluster: vault.cluster, simulated: true }));
  const draft = order.sweepDraftId ? draftsOf(org).find((x) => x.id === order.sweepDraftId) ?? null : null;
  const bundle = buildTreasuryOrderBundle({
    orderId: order.id,
    createdAt: now.toISOString(),
    org: { orgId: org.id, investmentsAccount: investmentsAccount(org)! },
    asset: { id: order.asset, issuer: 'Ondo', token: order.asset === 'usdy' ? TBILLS.token : stockRef(order.asset)!.token },
    order: { kind: order.kind, path: order.path, amountMinor: order.amountMinor, unitsMicro: order.unitsMicro, priceMinor: order.priceMinor, priceMovedBps: order.priceMovedBps, holdUntil: order.holdUntil, landsIn: order.landsIn },
    approval: { who: input.who, keyPublic: input.deviceKey, at: now.toISOString(), signature: input.signature, messageSha256: bytesToHex(sha256(utf8ToBytes(message))) },
    chain: { signatures: chainSigs },
    wire: order.landsIn === 'bank_wire' ? { to: 'the company’s own bank account, outside Splash', reference: order.id } : null,
    sweep: draft ? { draftId: draft.id, reason: draft.reason, cushionMinor: draft.cushionMinor } : null,
    receipt: { receiptId, issuedAt: now.toISOString(), simulated: true },
  });
  const record = await sealEvidence({ id: order.id }, org, bundle, receiptId);
  order.receiptId = record.receiptId;
  return order;
}

/* ── The page ─────────────────────────────────────────────────────────── */

function sourced<T>(s: { value: T; asOf: string; sourceUrl: string; note?: string }, now: Date) {
  return { ...s, fresh: isFresh(s, now), ageDays: ageDays(s, now), asOfLabel: shortDay(s.asOf), asOfLong: longDay(s.asOf) };
}

/** Everything Treasury shows, in one read. Makes today's sweep draft if the rule is on and none exists. */
export async function treasuryView(orgId: string, viewer: { isOwner: boolean }, now = new Date()) {
  const org = getOrg(orgId);
  if (org.vault) await draftSweep(orgId, now);
  const { position, holdings } = await treasuryPosition(org, now);
  const rules = rulesOf(org);
  const payables = payablesDue(position);
  const floor = reserveFloor(payables);
  const available = availableToInvest(position);
  const usdy = holdings.per.find((h) => h.asset === 'usdy') ?? null;
  const draft = waitingSweepDraft(org, now);
  const today = utcDay(now);
  const sharePct = stockSharePct(position);
  const events = unitsEventsOf(org);
  const interest30 = dailyInterest(today, 30, events);
  const quarterNow = quarterOf(today);
  const feesKept = await feesKeptThisMonth(org.id, now);
  // With nothing waiting, say why: today's sweep may already be decided, or "Not now" holds sweep-out back.
  const decidedToday = draft ? null : (draftsOf(org).findLast((d) => purposeOf(d) === 'sweep' && d.day === today && (d.state === 'approved' || d.state === 'dismissed')) ?? null);
  const snoozed = snoozedUntil(org, now);
  const zeke = draft
    ? draft.kind === 'subscribe'
      ? `I drafted a sweep of ${formatUsd(draft.amountMinor)} into T-bills under your sweep rule. Nothing moves until a person approves it.`
      : `I drafted a redemption of ${formatUsd(draft.amountMinor)} from T-bills, because bills due need the money back. Nothing moves until a person approves it.`
    : rules.sweep.on && decidedToday
      ? decidedToday.state === 'approved'
        ? `Today’s ${decidedToday.kind === 'subscribe' ? 'sweep into' : 'redemption from'} T-bills, ${formatUsd(decidedToday.amountMinor)}, is approved. I’ll look again tomorrow, and I never pick an investment for you.`
        : decidedToday.kind === 'subscribe' && snoozed
          ? `You said not now to today’s sweep, so I won’t draft one into T-bills again before ${shortDay(snoozed)}. I never pick an investment for you.`
          : `You said not now to today’s ${decidedToday.kind === 'subscribe' ? 'sweep' : 'redemption'}. I’ll look again tomorrow, and I never pick an investment for you.`
    : rules.sweep.on && snoozed
      ? `You said not now to a sweep, so I won’t draft one into T-bills again before ${shortDay(snoozed)}. I never pick an investment for you.`
    : rules.sweep.on
      ? 'Sweep is on. Nothing needs drafting today: your reserve is at its floor and your Payments account holds no more than its cushion. I never pick an investment for you.'
      : available.totalMinor > 0n
        ? `${formatUsd(available.totalMinor)} is available to invest: what’s left after what’s waiting and your reserve’s floor. Sweep is off, so I won’t draft a move, and I never pick an investment for you.`
        : 'Nothing is available to invest: what’s waiting and your reserve’s floor need it all. Sweep is off, so I won’t draft a move, and I never pick an investment for you.';
  const positions = holdings.per.map((h) => {
    const ref = h.asset === 'usdy' ? null : stockRef(h.asset);
    return {
      asset: h.asset,
      name: h.asset === 'usdy' ? 'US Treasury bills' : ref!.name,
      unitsMicro: h.unitsMicro,
      unitsText: unitsText(h.unitsMicro),
      valueMinor: h.valueMinor,
      // To the cent (half away from zero): a remainder under half a cent is no change at all.
      changeMinor: (() => {
        const d = h.valueMinor - h.costMinor;
        const c = ((d < 0n ? -d : d) + 5_000n) / 10_000n;
        return (d < 0n ? -c : c) * 10_000n;
      })(),
      heldUnitsMicro: h.heldUnitsMicro,
      heldUntil: h.heldUntil,
      heldUntilLabel: h.heldUntil ? shortDay(h.heldUntil) : null,
      heldMinor: h.valueMinor - h.redeemableMinor,
      redeemableMinor: h.redeemableMinor,
      action: h.asset === 'usdy' ? ('redeem' as const) : ('sell' as const),
    };
  });
  const orders = book(org)
    .orders.filter((o) => o.state === 'settled')
    .slice(-8)
    .reverse()
    .map((o) => ({ id: o.id, kind: o.kind, asset: o.asset, name: o.asset === 'usdy' ? 'US Treasury bills' : stockRef(o.asset)!.name, amountMinor: o.amountMinor, unitsText: unitsText(o.unitsMicro), path: o.path, landsIn: o.landsIn, at: o.approval?.at ?? o.createdAt, receiptId: o.receiptId, sweep: Boolean(o.sweepDraftId) }));

  return {
    accounts: {
      paymentsMinor: position.paymentsMinor,
      reserveMinor: position.reserveMinor,
      investmentsMinor: holdings.investmentsMinor,
      totalMinor: position.paymentsMinor + position.reserveMinor + holdings.investmentsMinor,
      waitingMinor: position.waitingMinor,
    },
    reserve: {
      payablesMinor: payables,
      floorMinor: floor,
      marginPct: RESERVE_MARGIN_PCT_DEFAULT,
      covered: isCovered(position),
      shortMinor: shortfall(position),
      /** How full the Reserve is against its floor, in whole percent (capped at 100). */
      fillPct: floor === 0n ? 100n : position.reserveMinor >= floor ? 100n : (position.reserveMinor * 100n) / floor,
      atFloor: position.reserveMinor === floor,
      /** The bar: the Reserve against its floor, on a scale of whichever is larger. */
      bar: (() => {
        const scale = position.reserveMinor > floor ? position.reserveMinor : floor;
        return scale === 0n ? { fillPct: 0n, floorPct: null } : { fillPct: (position.reserveMinor * 100n) / scale, floorPct: floor === 0n ? null : (floor * 100n) / scale };
      })(),
    },
    available: {
      totalMinor: available.totalMinor,
      fromReserveMinor: available.fromReserveMinor,
      fromPaymentsMinor: available.fromPaymentsMinor,
      fromLabel: available.fromReserveMinor > 0n && available.fromPaymentsMinor > 0n ? 'from your Reserve, then your Payments account' : available.fromReserveMinor > 0n ? 'from your Reserve' : 'from your Payments account',
    },
    tbills: {
      name: TBILLS.name,
      issuer: TBILLS.issuer,
      rate: sourced(TBILLS.rate, now),
      holdDays: TBILLS.holdDays.value,
      holdConfirmed: false,
      priceMinor: TBILLS.testPriceMinor,
      holding: usdy ? { unitsText: unitsText(usdy.unitsMicro), valueMinor: usdy.valueMinor, heldMinor: usdy.valueMinor - usdy.redeemableMinor, heldUntil: usdy.heldUntil, heldUntilLabel: usdy.heldUntil ? shortDay(usdy.heldUntil) : null, redeemableMinor: usdy.redeemableMinor } : null,
      /**
       * For the live "Interest today" estimate (prompt 11 §4.2): today's booked price and the units held.
       * The browser turns these into a floating-point figure for the eye; nothing comes back.
       */
      live: usdy ? { unitsMicro: usdy.unitsMicro, priceTodayMinor: bookedPrice(today), bps: TBILLS.rate.value.bps, day: today } : null,
      /** Interest booked each of the last 30 days, oldest first (integers, history.ts). */
      interest: interest30.map((d) => ({ day: d.day, label: shortDay(d.day), interestMinor: d.interestMinor })),
      quarterSoFarMinor: interestBetween(quarterNow.first, today, events),
    },
    stocks: {
      sharePct,
      capPct: STOCK_CAP_PCT_DEFAULT,
      maxBuyMinor: maxStockBuy(position),
      rows: STOCKS.map((s) => {
        const h = holdings.per.find((x) => x.asset === s.id) ?? null;
        return { id: s.id, name: s.name, tracks: s.tracks, return12m: sourced(s.return12m, now), dividends12m: sourced(s.dividends12m, now), holdingMinor: h?.valueMinor ?? null, unitsText: h ? unitsText(h.unitsMicro) : null, priceMinor: s.testPriceMinor };
      }),
    },
    sweep: {
      on: rules.sweep.on,
      cushionMinor: rules.sweep.cushionMinor,
      cushionDefaultMinor: SWEEP_CUSHION_DEFAULT,
      mayChange: viewer.isOwner,
      draft: draft ? { id: draft.id, kind: draft.kind, amountMinor: draft.amountMinor, reason: draft.reason } : null,
      /** Hold or sweep's rows (prompt 11 §4.3): today's sweep and this quarter's interest, waiting or decided. */
      rows: sweepRows(org, now),
      snoozedUntil: snoozedUntil(org, now),
    },
    eligibility: { confirmed: Boolean(rules.eligibility), by: rules.eligibility?.by ?? null, at: rules.eligibility?.at ?? null, mayConfirm: viewer.isOwner },
    positions,
    orders,
    /** Treasury activity (prompt 11 §4.6): interest booked and moves in and out, newest first. */
    activity: activityOf(org, interest30, now),
    /** "Fees kept inside Splash, this month" (prompt 11 §4.3): recorded fees only, never an estimate. */
    feesKept,
    zeke,
    technical: { investmentsAccount: investmentsAccount(org), usdyMint: TBILLS.mintSolana.value, usdyMintSource: TBILLS.mintSolana.sourceUrl, holdSource: TBILLS.holdDays.sourceUrl },
    testMode: true,
    simulator: isSimulator(runtime().chain),
    hasAccounts: Boolean(org.vault),
    companyName: org.companyName,
  };
}

export type TreasuryView = Awaited<ReturnType<typeof treasuryView>>;

/** Hold or sweep's rows: today's sweep draft and this quarter's interest draft, waiting, approved or set aside. */
function sweepRows(org: OrgRecord, now: Date) {
  const day = utcDay(now);
  const quarter = previousQuarter(day).key;
  const orders = book(org).orders;
  return draftsOf(org)
    .filter((d) => (d.state === 'drafted' || d.state === 'approved' || d.state === 'dismissed') && (purposeOf(d) === 'sweep' ? d.day === day : d.quarter === quarter))
    .sort((a, b) => (purposeOf(a) === purposeOf(b) ? 0 : purposeOf(a) === 'sweep' ? -1 : 1))
    .map((d) => {
      const order = d.orderId ? (orders.find((o) => o.id === d.orderId) ?? null) : null;
      return {
        id: d.id,
        purpose: purposeOf(d),
        kind: d.kind,
        amountMinor: d.amountMinor,
        reason: d.reason,
        months: d.months ?? null,
        state: d.state as 'drafted' | 'approved' | 'dismissed',
        /** The device key that approved it: the browser says "Approved on this device" when it is its own. */
        approvedKey: order?.approval?.keyPublic ?? null,
        approvedBy: order?.approval?.who ?? null,
        dismissedAt: d.dismissed?.at ?? null,
      };
    });
}

/** A moment's calendar day and clock in Malaysia time (UTC+8), the app's clock (prompt 12 B4). Arithmetic, not formatting. */
const MYT_MS = 8 * 3_600_000;
const mytDayOf = (iso: string) => new Date(Date.parse(iso) + MYT_MS).toISOString().slice(0, 10);
const mytClock = (iso: string) => new Date(Date.parse(iso) + MYT_MS).toISOString().slice(11, 16);

/** Where a settled T-bill move went, in plain words. */
function destinationOf(o: { kind: string; landsIn?: string | null }): string {
  if (o.kind === 'subscribe') return 'into your Investments account';
  if (o.landsIn === 'payments') return 'into your Payments account';
  if (o.landsIn === 'bank_wire') return 'to your company’s bank account, by wire';
  return 'into your Investments account';
}

/**
 * Interest booked (last 7 days with any) and settled T-bill moves, newest first, at most 8. Each row
 * carries its day and time in MYT and where the money went (prompt 12 B4: two "Moved out" rows on the
 * same day were indistinguishable). Interest is booked at the close of its day.
 */
function activityOf(org: OrgRecord, interest: Array<{ day: string; interestMinor: bigint }>, now: Date) {
  const today = mytDayOf(now.toISOString());
  const label = (at: string) => (mytDayOf(at) === today ? 'Today' : shortDay(mytDayOf(at)));
  const rows: Array<{ id: string; at: string; label: string; time: string; to: string; what: 'interest' | 'in' | 'out'; amountMinor: bigint; approvedKey: string | null; approvedBy: string | null }> = [];
  for (const d of interest.slice(-7)) {
    const at = `${d.day}T23:59:59.000Z`;
    if (d.interestMinor > 0n) rows.push({ id: `int_${d.day}`, at, label: label(at), time: mytClock(at), to: 'on your T-bills, in your Investments account', what: 'interest', amountMinor: d.interestMinor, approvedKey: null, approvedBy: null });
  }
  for (const o of book(org).orders) {
    if (o.asset !== 'usdy' || o.state !== 'settled') continue;
    const at = o.settlement?.at ?? o.approval?.at ?? o.createdAt;
    rows.push({ id: o.id, at, label: label(at), time: mytClock(at), to: destinationOf(o), what: o.kind === 'subscribe' ? 'in' : 'out', amountMinor: o.amountMinor, approvedKey: o.approval?.keyPublic ?? null, approvedBy: o.approval?.who ?? null });
  }
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 8);
}

/** Paid into another business's own Splash account (no partner): these states have left the account. */
const PEER_PAID = ['executed', 'confirmed', 'partner_paid', 'evidenced', 'anchored', 'evidence_failed'];

/**
 * "Fees kept inside Splash, this month" (prompt 11 §4.3): the sum of fee_avoided_minor over this
 * calendar month's (UTC) inside-Splash payments that were paid. Payments without it are left out, not
 * estimated; `since` is the first day one was recorded, when that is inside this month.
 */
export async function feesKeptThisMonth(orgId: string, now = new Date()) {
  const month = utcDay(now).slice(0, 7);
  const all = await runtime().payments.listByOrg(orgId);
  let sumMinor = 0n;
  let count = 0;
  let first: string | null = null;
  for (const p of all) {
    if (p.kind !== 'peer' || p.feeAvoidedMinor === undefined || p.feeAvoidedMinor === null) continue;
    if (first === null || p.createdAt < first) first = p.createdAt;
    if (!PEER_PAID.includes(p.state)) continue;
    const paidAt = p.timeline.paidAt ?? p.execution.confirmedAt ?? p.updatedAt;
    if (paidAt.slice(0, 7) !== month) continue;
    sumMinor += p.feeAvoidedMinor;
    count += 1;
  }
  const since = first !== null && first.slice(0, 7) === month && first.slice(0, 10) !== `${month}-01` ? shortDay(first) : null;
  return { sumMinor, count, since };
}

/** For Overview and Balance: the Investments account at value, and whether it holds anything yet. */
export function investmentsSummary(org: OrgRecord, now = new Date()) {
  const h = holdingsOf(org, now);
  return { investmentsMinor: h.investmentsMinor, stocksMinor: h.stocksMinor, setUp: h.setUp || h.per.length > 0 };
}

/** History's gold "Treasury" rows. */
export function treasuryHistory(org: OrgRecord) {
  return book(org)
    .orders.filter((o) => o.state === 'settled')
    .map((o) => ({ id: o.id, at: o.approval?.at ?? o.createdAt, kind: o.kind, asset: o.asset, name: o.asset === 'usdy' ? 'US Treasury bills' : stockRef(o.asset)!.name, amountMinor: o.amountMinor, fromPaymentsMinor: o.from?.paymentsMinor ?? 0n, fromReserveMinor: o.from?.reserveMinor ?? 0n, path: o.path, landsIn: o.landsIn, receiptId: o.receiptId, sweep: Boolean(o.sweepDraftId) }));
}

/** The words a quote's "How" row uses. */
export function howWords(p: Pick<OrderPreview, 'quote'>, holdDays = TBILLS.holdDays.value): string {
  const q = p.quote;
  if (q.path === 'ondo') return q.kind === 'subscribe' ? `Straight from Ondo · units held ${holdDays} days` : 'With Ondo · US dollars by bank wire to your company’s bank account';
  if (q.asset !== 'usdy') return `${movedText(q.priceMovedBps ?? 0n)} · limit ${movedText(PRICE_MOVED_LIMIT_BPS)}`;
  return `On the market · ${q.kind === 'subscribe' ? 'no hold · ' : ''}price moved by ${movedText(q.priceMovedBps ?? 0n)} (limit ${movedText(PRICE_MOVED_LIMIT_BPS)})`;
}

/** Test helper and sheet line: units at a price, in words. */
export function unitsWords(q: Pick<OrderQuote, 'unitsMicro' | 'priceMinor'>): string {
  return `${unitsText(q.unitsMicro)} units at ${priceText(q.priceMinor)} (test price)`;
}

export { cents as wholeCents };
