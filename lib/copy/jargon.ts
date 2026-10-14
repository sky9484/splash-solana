/**
 * Plain language (prompt 10 §0.6, glossary G5 approved by Sky on 13 Oct): the crypto words the
 * dashboard doesn't show, and what it shows instead. scripts/check-jargon.mjs counts these in every
 * customer-facing string and fails when a phase raises the count; the final count must be at most
 * 15% of the baseline in docs/design/jargon-baseline.json.
 *
 * Crypto words stay only where they can't be avoided, and those places are marked: the "From a
 * crypto wallet" funding sheet, a route's "How it moves", a receipt's "Technical details", Settings ›
 * Account details, the staff console and developer docs (files under components/technical/** or
 * marked `// copy: technical`).
 */

export interface JargonTerm {
  /** What the dashboard doesn't say. */
  term: string;
  /** Whole words. Case-insensitive unless `caseSensitive`. */
  pattern: RegExp;
  /** What it says instead. */
  instead: string;
}

const w = (src: string, flags = 'gi') => new RegExp(`(?<![\\w-])(?:${src})(?![\\w-])`, flags);

export const JARGON: JargonTerm[] = [
  { term: 'USDC / stablecoin', pattern: w('USDC|USDT|PYUSD|stablecoins?'), instead: 'US dollars, US$' },
  { term: 'vault / Squads / multisig', pattern: w('vaults?|Squads|multisigs?|multi-sig'), instead: 'Payments account, Reserve, Investments; "your account"' },
  { term: 'Solana / devnet / mainnet / cluster', pattern: w('Solana|devnet|mainnet(?:-beta)?|cluster'), instead: 'nothing; the badge says "Test mode"' },
  // "Sign in" and "sign out" are about the person's login, and "once signed" about a contract with
  // the payout partner ("name shown once signed"), not a payment.
  { term: 'sign / signature / device key / keypair', pattern: w('(?<!once )sign(?:s|ed|ing)?(?!\\s*(?:in|out|up)\\b)(?!-in|-out|-up)|signatures?|device keys?|keypairs?|signers?'), instead: 'approve; "Approve on this device"' },
  { term: 'CCTP / Polygon / bridge / hop', pattern: w('CCTP(?: V2)?|Polygon|bridges?|bridging|bridged|hops?'), instead: '"the partner\'s lower-cost lane"' },
  { term: 'network fee / gas / SOL / fee payer / Kora', pattern: w('network fees?|gas|fee payers?|Kora|lamports?'), instead: '"Processing: included"' },
  { term: 'SOL', pattern: w('SOL', 'g'), instead: '"Processing: included"' },
  { term: 'on-chain / anchored / attestation / memo / hash / Merkle', pattern: w('on-chain|onchain|on chain|anchor(?:ed|s|ing)?|attestations?|memos?|hash(?:es)?|Merkle'), instead: '"proof recorded", "this receipt verifies"' },
  { term: 'Solscan / explorer / transaction id', pattern: w('Solscan|explorers?|transaction ids?|tx ids?|txids?'), instead: 'inside "Technical details" only' },
  { term: 'token / mint / swap / DEX / price impact', pattern: w('tokens?|mint(?:s|ed|ing)?|swap(?:s|ped|ping)?|DEX|price impact'), instead: 'units, buy, sell, "price moved by"' },
  { term: 'wallet address / deposit address / account address', pattern: w('wallet address(?:es)?|deposit address(?:es)?|account address(?:es)?|public keys?'), instead: 'account ID (Settings only)' },
  { term: 'yield / APR / APY / earn', pattern: w('yields?|APR|APY|earn(?:s|ed|ing)?'), instead: '"3.75% a year · variable · set by Ondo · as of <date>"' },
];

/** Every jargon hit in a piece of customer-facing text. */
export function jargonIn(text: string): Array<{ term: string; match: string }> {
  const out: Array<{ term: string; match: string }> = [];
  for (const j of JARGON) {
    for (const m of text.matchAll(j.pattern)) out.push({ term: j.term, match: m[0] });
  }
  return out;
}
