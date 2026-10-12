/**
 * Zeke Checker (prompt 07 §5.2, item 5): reads the DETERMINISTIC results — KYC tier, limits,
 * screening, duplicate, quote validity, bank details — and says what they mean in plain words.
 *
 * It decides nothing. The decision was already made by lib/route-engine/policy.ts, outside Zeke;
 * the Checker only explains it, so it can never turn a "no" into a "yes". No tools, no model, no
 * network: the same input always gives the same words. Its output is a draft (guard.ts).
 */
import type { PolicyResult } from '../solana/types.ts';

export interface CheckerInput {
  tier: string | null;
  checks: PolicyResult['checks'];
  extraChecks?: ReadonlyArray<{ name: string; passed: boolean; detail: string }>;
  /** The screening result's own label, e.g. "KYT stub · not a real screening". */
  screeningLabel: string;
}

export interface CheckerLine {
  check: string;
  passed: boolean;
  text: string;
}

export interface CheckerOutput {
  draft: true;
  role: 'checker';
  blocked: boolean;
  summary: string;
  lines: CheckerLine[];
}

const WORDS: Record<string, { ok: (i: CheckerInput) => string; no: string }> = {
  tier: { ok: (i) => `Your business is verified (${i.tier ?? 'tier'}).`, no: 'Your business has no verified tier yet.' },
  per_payment_limit: { ok: () => 'Within your per-payment limit.', no: 'Above your per-payment limit. Split the payment.' },
  daily_limit: { ok: () => "Within today's limit.", no: "Above today's limit. Wait until tomorrow or split it." },
  kyt: { ok: (i) => `The payout partner's deposit address screened clear (${i.screeningLabel}).`, no: "Screening flagged the payout partner's deposit address. Contact support." },
  duplicate_invoice: { ok: () => 'This invoice has not been paid before.', no: 'This invoice is already paid or being paid.' },
  quote_expiry: { ok: () => 'The quote is still valid.', no: 'The quote expired. Get a new one.' },
  bank_details_verified: { ok: () => 'The bank details were verified outside this screen.', no: 'The bank details are new and not verified. Call the supplier first.' },
  amount_covers_invoice: { ok: () => 'The supplier receives the full invoice amount.', no: 'The supplier would receive less than the invoice says.' },
};

export function explainChecks(input: CheckerInput): CheckerOutput {
  const all = [...input.checks, ...(input.extraChecks ?? [])];
  const lines: CheckerLine[] = all.map((c) => {
    const w = WORDS[c.name];
    return { check: c.name, passed: c.passed, text: w ? (c.passed ? w.ok(input) : w.no) : `${c.name}: ${c.passed ? 'passed' : 'not passed'}` };
  });
  const failed = lines.filter((l) => !l.passed);
  const summary = failed.length === 0
    ? `All ${lines.length} checks passed. A person still approves on their device.`
    : `Blocked: ${failed[0]!.text} Zeke cannot change this; your rules decide it.`;
  return { draft: true, role: 'checker', blocked: failed.length > 0, summary, lines };
}
