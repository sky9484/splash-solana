/**
 * `not-licensed` exists because a regulatory position is not a model. The
 * Labuan claim carried status 'modeled', which reads as a product surface
 * that has been reasoned about rather than a fact about what a regulator has
 * granted. A reader can falsify this one against the Labuan FSA register,
 * which is what a status is for.
 */
export type ClaimStatus = 'live' | 'testnet-verified' | 'modeled' | 'simulated' | 'not-licensed';

export type Claim = {
  claim: string;
  evidence: string;
  status: ClaimStatus;
};

export const lockedCopy = {
  headline: 'Collect USD. Pay Southeast Asia. Keep cash working.',
  fee: '0.70% to local currency',
  feeFootnote: 'Flat on every corridor, no fixed fee. USDC transfers are free.',
  /** No speed figure (claims rules): the payout partner's rail decides delivery. */
  delivery: 'Varies by bank rail',
  agent: 'Zeke prepares. You approve.',
} as const;

export const claims = {
  heroSub: {
    claim: 'One operating account for cross-border invoices, FX, payouts, treasury and reconciliation - built for Southeast Asian businesses.',
    evidence: 'Product surfaces currently implemented in the app shell and v3 roadmap.',
    status: 'modeled',
  },
  labuanApplication: {
    claim: 'No licence held. A Labuan FSA money-broking application is in preparation with counsel.',
    evidence: 'Not on the Labuan FSA register — verifiable there. Preparation tracked in operating settings; SECURITY.md records the truth pass.',
    status: 'not-licensed',
  },
  sumsub: {
    claim: 'Sumsub KYB workflow is wired for business verification intake.',
    evidence: 'KYB upload and Sumsub route handlers in app/api/kyb.',
    status: 'testnet-verified',
  },
  elliptic: {
    claim: 'KYT and sanctions checks are part of the required production gate.',
    evidence: 'v3 compliance gate; provider wiring remains rollout work.',
    status: 'modeled',
  },
  custody: {
    claim: 'Qualified custody options are planned for international and Malaysia-local custody.',
    evidence: 'Key policy and v3 custody perimeter docs.',
    status: 'modeled',
  },
  fee: {
    claim: lockedCopy.fee,
    evidence: 'Corridor fee table in lib/fx/corridors.ts: 70 bps on every corridor and no fixed fee (pricing decision of 2026-09-26).',
    status: 'modeled',
  },
  receivable: {
    claim: 'Buyer-signed receivables and early-pay settlement are the v3 working-capital path.',
    evidence: 'Master build spec Phase C; UI is a modeled product surface until Move primitive ships.',
    status: 'modeled',
  },
  auditTrail: {
    claim: 'Settlement proofs are encrypted, stored, and anchored on Solana when evidence is available.',
    evidence: 'The proof code in lib/solana-evidence, with encryption and storage in the evidence layer.',
    status: 'testnet-verified',
  },
  footerLegal: {
    claim: 'Licence application in preparation with Labuan FSA. Not yet authorised to hold customer funds. USDC moves on Solana from the business’s own vault, approved by a person on their device. This build runs on Solana devnet; USD in and local-currency payouts are not live yet.',
    evidence: 'Custody gate (lib/custody-phase-rules.ts); vaults have no config authority and a member approves each transaction (lib/solana-app/account-setup.ts); SOLANA_CLUSTER defaults to devnet (lib/solana/config.ts); fiat partners are not connected.',
    status: 'modeled',
  },
} satisfies Record<string, Claim>;
