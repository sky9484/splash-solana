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
  headline: 'Pay suppliers abroad. Prove every payment.',
  fee: '0.10% Splash fee per payout',
  feeFootnote: "US$2 minimum. The payout partner's fee is shown before you approve.",
  /** No speed figure (claims rules): the payout partner's rail decides delivery. */
  delivery: 'Varies by bank rail',
  agent: 'Zeke prepares. You approve.',
} as const;

/**
 * The corridors the landing's Southeast Asia band lists, with their status in one place (prompt 12 §2.9).
 * Only Malaysia to the Philippines runs, in the sandbox; the rest are roadmap. A corridor goes live only
 * when a payout partner for that country is signed and the controls are ready (content/sea-numbers.ts
 * keeps 'live-corridor' at 1).
 */
export type CorridorStatus = 'sandbox' | 'roadmap';
export const corridors: ReadonlyArray<{ from: 'MY'; to: string; status: CorridorStatus }> = [
  { from: 'MY', to: 'PH', status: 'sandbox' },
  { from: 'MY', to: 'ID', status: 'roadmap' },
  { from: 'MY', to: 'TH', status: 'roadmap' },
  { from: 'MY', to: 'VN', status: 'roadmap' },
  { from: 'MY', to: 'SG', status: 'roadmap' },
];

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
    evidence: 'lib/route-engine/fees.ts: SPLASH_FEE_BPS is 10 on every route, with a US$2 minimum and an all-in target of 0.33% from US$2,000 (docs/solana-build/DECISIONS.md D-P3-2, awaiting confirmation).',
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
