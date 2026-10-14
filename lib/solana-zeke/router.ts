/**
 * Zeke Router: explains the engine's ranked quotes in plain words.
 *
 * It returns TEXT plus the id of the quote the text refers to. It cannot
 * change an amount, a recipient or a route: it takes quotes as read-only
 * input, copies nothing back, and its output has no amount, address or step
 * fields (guard.ts asserts the shape). Deterministic templates; no model call.
 */
import { formatMinor } from '../money.ts';
import type { Policy, RouteQuote } from '../solana/types.ts';

export interface HomeLaneNote {
  applied: boolean;
  homeQuoteId?: string;
  deltaUsdcMinor?: bigint;
}

export interface RouterInput {
  picks: Partial<Record<Policy, RouteQuote | null>>;
  /** Optional: full ranked lists, used to find an alternative when all picks coincide. */
  ranked?: Partial<Record<Policy, RouteQuote[]>>;
  homeLane?: Partial<Record<Policy, HomeLaneNote>>;
  /** The policy the business selected. Default 'cheapest'. */
  selected?: Policy;
}

export interface RouterExplanation {
  refersTo: string;
  policy: Policy;
  text: string;
}

export interface RouterOutput {
  draft: true;
  primary: RouterExplanation;
  alternative: RouterExplanation | null;
}

const LABEL: Record<Policy, string> = { cheapest: 'Cheapest', fastest: 'Shortest route', safest: 'Safest' };
const ORDER: Policy[] = ['cheapest', 'fastest', 'safest'];

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatPhp(minor: bigint): string {
  const [i, f] = formatMinor(minor, 2).split('.');
  return `₱${groupThousands(i.replace('-', ''))}.${f}`;
}

export function formatUsd(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const cents = (abs + 5_000n) / 10_000n; // half-up to cents, display only
  const [i, f] = formatMinor(cents, 2).split('.');
  return `${negative ? '−' : ''}US$${groupThousands(i)}.${f}`;
}

/** bps (two decimals) → "0.29%". Display only. */
export function formatPct(bps: number): string {
  return `${(Math.round(bps) / 100).toFixed(2)}%`;
}

/** The rail that reaches the bank, never an arrival time: Zeke states no speed (prompt 07 §0.6). */
function arrivalPhrase(q: RouteQuote): string {
  const partner = q.steps.find((s) => s.kind === 'partner');
  if (partner?.provider.includes('PESONet')) return 'paid out by PESONet';
  if (partner?.provider.includes('InstaPay')) return 'paid out by InstaPay';
  return "paid out by the partner's bank transfer";
}

function routePhrase(q: RouteQuote): string {
  if (q.target.network === 'solana') return 'direct on Solana';
  return q.flags.includes('fast_transfer') ? 'via CCTP V2 Fast Transfer to Polygon' : 'via CCTP V2 to Polygon';
}

function sentence(policy: Policy, q: RouteQuote, home?: HomeLaneNote): string {
  let s = `${LABEL[policy]}: supplier receives ${formatPhp(q.netLocal.amountMinor)}, all-in ${formatPct(q.costs.allInBps)}, ${arrivalPhrase(q)}.`;
  s += ` Route: ${routePhrase(q)}.`;
  if (home?.applied && home.homeQuoteId === q.id && home.deltaUsdcMinor !== undefined) {
    s += home.deltaUsdcMinor > 0n
      ? ` Solana route chosen: +${formatUsd(home.deltaUsdcMinor)} vs the best quote.`
      : ' Solana route chosen: no extra cost.';
  }
  if (q.flags.includes('above_target')) s += ' All-in is above the 0.33% target, so it needs your explicit OK.';
  if (q.flags.includes('mock_partner')) s += ' Mock partner · devnet: the rate is not a live rate.';
  return s;
}

export function explainRoutes(input: RouterInput): RouterOutput {
  const selected = input.selected ?? 'cheapest';
  const primaryQuote = input.picks[selected];
  if (!primaryQuote) throw new Error(`no ${selected} quote to explain`);
  const primary: RouterExplanation = { refersTo: primaryQuote.id, policy: selected, text: sentence(selected, primaryQuote, input.homeLane?.[selected]) };

  // One alternative: the first other policy whose pick is a different route; else the runner-up.
  let alternative: RouterExplanation | null = null;
  for (const p of ORDER) {
    if (p === selected) continue;
    const q = input.picks[p];
    if (q && q.id !== primaryQuote.id && (q.target.network !== primaryQuote.target.network || q.flags.join() !== primaryQuote.flags.join() || q.netLocal.amountMinor !== primaryQuote.netLocal.amountMinor)) {
      alternative = { refersTo: q.id, policy: p, text: `Alternative, ${sentence(p, q, input.homeLane?.[p])}` };
      break;
    }
  }
  if (!alternative) {
    const runnerUp = input.ranked?.[selected]?.[1];
    if (runnerUp) alternative = { refersTo: runnerUp.id, policy: selected, text: `Alternative, ${sentence(selected, runnerUp)}` };
  }
  return { draft: true, primary, alternative };
}
