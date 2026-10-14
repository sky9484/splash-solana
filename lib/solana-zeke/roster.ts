/**
 * What each part of Zeke does (prompt 10 §7A), read from the code as it stands, not claimed: the job,
 * the line it never crosses, and whether it is built. The Zeke page renders this table; the authority
 * lines come from ZEKE_AUTHORITY (guard.ts), so the page can't say Zeke may do something the code
 * forbids.
 */
import { ZEKE_AUTHORITY } from './guard.ts';

export interface RosterPart {
  part: string;
  does: string;
  never: string;
  status: 'Built' | 'Planned';
  /** Where it lives, for the engineer reading the table. */
  where: string;
}

export const ZEKE_ROSTER: readonly RosterPart[] = [
  { part: 'Reader', does: 'Reads invoices, with no tools.', never: 'Never approve, pay or hold a key', status: 'Built', where: 'lib/solana-zeke/reader.ts' },
  { part: 'Router', does: 'Explains the routes in plain words.', never: 'Never change an amount or a supplier', status: 'Built', where: 'lib/solana-zeke/router.ts' },
  { part: 'Checker', does: 'Runs your limits and screening, as code.', never: 'Never override a rule', status: 'Built', where: 'lib/route-engine/policy.ts' },
  { part: 'Planner', does: 'Shows what’s due and what’s short; drafts sweeps from your owner’s rule.', never: 'Never move money or pick an investment', status: 'Built', where: 'lib/treasury/reserve.ts, lib/treasury/sweep.ts' },
  { part: 'Matcher', does: 'Matches bank payouts and money in to invoices and requests.', never: 'Never close a mismatch', status: 'Built', where: 'lib/solana-app/service.ts, lib/solana-app/requests.ts' },
  { part: 'Auditor', does: 'Builds one proof record per payment.', never: 'Never give anyone access', status: 'Built', where: 'lib/solana-evidence/bundle.ts' },
  { part: 'Data spend', does: 'Not built. If your owner turns it on later, it would buy listed data (such as weather) within US$50 a month.', never: 'Never spend outside the list or the cap, or without your owner turning it on', status: 'Planned', where: 'not built' },
];

/** "How Zeke is kept safe", each line true of the code (ZEKE_AUTHORITY), or left out. */
export function safetyLines(emergencyStop: 'ready' | 'on'): string[] {
  const a = ZEKE_AUTHORITY;
  const lines: string[] = [];
  if (!a.canSign && !a.canSend && !a.canApprove && !a.canChangeAmounts && !a.canChangeRecipients && !a.holdsKeys) {
    lines.push('It can only read and draft. It can’t approve a payment, move money or change a rule.');
  }
  lines.push('Every draft is checked against your rules again before anyone approves it.');
  lines.push(emergencyStop === 'on' ? 'Emergency stop is on: drafting is stopped until someone turns it off.' : 'Emergency stop is ready: one switch stops all drafting.');
  lines.push('It can be wrong. Every field shows where it came from, so you can check.');
  return lines;
}
