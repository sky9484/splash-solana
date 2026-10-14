/**
 * Step 3 of a transfer, "Quote & Send" (Sky, 13 Oct): where the USDC for this payment comes from.
 *
 *   Pay from your vaults     the payments vault, topped up from the treasury with a move if it is
 *                            short. That money was checked when it arrived, so it is ready now.
 *   Fund it another way      USD (Stripe, Airwallex) or a stablecoin from another wallet. The money
 *                            lands in the company's own payments vault first, never with Splash, and
 *                            only counts after a funds check: the source is screened and a person
 *                            declares where the money comes from. That is the extra step, and the
 *                            provider's or swap venue's charge is shown before anything is sent.
 *
 * Either way the payout itself is unchanged: it leaves the payments vault with one approval on the
 * device. The vault only ever receives USDC: another stablecoin is swapped before it lands (D-7 holds).
 * Stripe, Airwallex and the swap are sandbox stand-ins in this build, labelled so; no agreement with
 * either provider is signed (DECISIONS D-P6-1).
 */
import { PublicKey } from '@solana/web3.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { isSimulator } from '../solana/simulator.ts';
import { createKytStub } from '../route-engine/policy.ts';
import { ServiceError } from './errors.ts';
import { isCommitted } from './payment-machine.ts';
import { runtime } from './runtime.ts';
import { findQuote, getOrg, getPayment, requireVault, treasuryVaultPda } from './service.ts';
import { SOURCE_OF_FUNDS, type SourceOfFunds } from './source-of-funds.ts';
import type { FundingMethod, OrgRecord, PaymentFunding } from './store.ts';

/** Offline, the funds check holds this long, so the extra step a person chose is visible. */
export const OFFLINE_FUNDS_CHECK_MS = 2_500;

export { SOURCE_OF_FUNDS, type SourceOfFunds };

/**
 * The ways to bring USDC in. `chargeBps` is a sandbox estimate of the provider's or swap venue's
 * charge, never Splash's: Splash adds nothing to funding (its fee is the 0.10% on the payout).
 */
export const FUNDING_METHODS: Record<FundingMethod, { label: string; detail: string; kind: 'stablecoin' | 'usd'; assets: Array<PaymentFunding['asset']>; chargeBps: number; chargeLabel: string; provider: string | null; sandboxOnly: boolean }> = {
  wallet_usdc: {
    label: 'USDC from another wallet',
    detail: 'Sent on Solana from a wallet your company controls. No swap, no charge from Splash.',
    kind: 'stablecoin',
    assets: ['USDC'],
    chargeBps: 0,
    chargeLabel: 'No swap',
    provider: null,
    sandboxOnly: false,
  },
  wallet_swap: {
    label: 'USDT or PYUSD from another wallet',
    detail: 'Swapped to USDC before it reaches your vault. The swap venue charges for the swap.',
    kind: 'stablecoin',
    assets: ['USDT', 'PYUSD'],
    chargeBps: 20,
    chargeLabel: 'Swap charge',
    provider: null,
    sandboxOnly: true,
  },
  stripe: {
    label: 'USD by card or bank, through Stripe',
    detail: 'Stripe takes the USD and delivers USDC to your payments vault.',
    kind: 'usd',
    assets: ['USD'],
    chargeBps: 150,
    chargeLabel: 'Stripe’s charge',
    provider: 'Stripe',
    sandboxOnly: true,
  },
  airwallex: {
    label: 'USD from your Airwallex account',
    detail: 'Airwallex converts the USD and delivers USDC to your payments vault.',
    kind: 'usd',
    assets: ['USD'],
    chargeBps: 50,
    chargeLabel: 'Airwallex’s charge',
    provider: 'Airwallex',
    sandboxOnly: true,
  },
};

const METHOD_IDS = Object.keys(FUNDING_METHODS) as FundingMethod[];

/** The charge on top, rounded up to the cent's minor unit: integers only, never a float. */
export function chargeFor(amountMinor: bigint, bps: number): bigint {
  if (bps <= 0) return 0n;
  return (amountMinor * BigInt(bps) + 9_999n) / 10_000n;
}

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
  return {
    id: f.id,
    paymentId: f.paymentId,
    method: f.method,
    methodLabel: m.label,
    provider: m.provider,
    asset: f.asset,
    fromAddress: f.fromAddress,
    amountMinor: f.amountMinor.toString(),
    chargeMinor: f.chargeMinor.toString(),
    chargeBps: f.chargeBps,
    chargeLabel: m.chargeLabel,
    sourceOfFunds: f.sourceOfFunds,
    sourceOfFundsLabel: SOURCE_OF_FUNDS[f.sourceOfFunds],
    declaredBy: f.declaredBy,
    declaredAt: f.declaredAt,
    state: f.state,
    checkUntil: f.checkUntil,
    check: f.check,
    signature: f.signature,
    simulated: f.simulated,
    createdAt: f.createdAt,
    settledAt: f.settledAt,
  };
}

export type FundingView = ReturnType<typeof fundingView>;

/** What Step 3 shows: the two vaults, what this route costs, and every way to bring the USDC in. */
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
  return {
    vaults: {
      paymentsMinor: paymentsMinor.toString(),
      treasuryMinor: treasuryMinor.toString(),
      paymentsAddress: vault.vaultPda,
    },
    neededMinor: neededMinor?.toString() ?? null,
    methods: METHOD_IDS.map((id) => {
      const m = FUNDING_METHODS[id];
      const available = offline || !m.sandboxOnly;
      return {
        id,
        label: m.label,
        detail: m.detail,
        kind: m.kind,
        assets: m.assets,
        provider: m.provider,
        chargeBps: m.chargeBps,
        chargeLabel: m.chargeLabel,
        chargeMinor: neededMinor === null ? null : chargeFor(neededMinor, m.chargeBps).toString(),
        sandbox: m.sandboxOnly,
        available,
        unavailableReason: available ? null : 'Sandbox only in this build; not connected on devnet.',
      };
    }),
    sourcesOfFunds: Object.entries(SOURCE_OF_FUNDS).map(([value, label]) => ({ value, label })),
    fundings: fundingsOf(org).filter((f) => f.paymentId === paymentId).map(fundingView),
    simulated: offline,
  };
}

export async function startFunding(
  orgId: string,
  paymentId: string,
  input: {
    method: FundingMethod;
    quoteId: string;
    asset?: PaymentFunding['asset'];
    fromAddress?: string | null;
    sourceOfFunds: SourceOfFunds;
    declared: boolean;
    by: string;
    rehearsal?: 'none' | 'kyt_flag';
  },
  now = new Date(),
): Promise<PaymentFunding> {
  const p = await getPayment(paymentId);
  if (p.orgId !== orgId) throw new ServiceError('payment_not_found', 'That payment is not on the server for this company.', 404);
  if (isCommitted(p.state)) throw new ServiceError('wrong_state', 'This payment has already been sent. Nothing more to fund.', 409);
  const org = getOrg(orgId);
  const vault = requireVault(org);
  const m = FUNDING_METHODS[input.method];
  if (!m) throw new ServiceError('bad_request', 'Choose how the money comes in.');
  if (!input.declared) throw new ServiceError('declaration_required', 'Tick the declaration about where this money comes from first.', 422);
  if (!SOURCE_OF_FUNDS[input.sourceOfFunds]) throw new ServiceError('bad_request', 'Say where this money comes from.');
  const q = findQuote(p, input.quoteId);
  if (!q) throw new ServiceError('bad_request', 'That route is not one of this payment’s quotes. Get a new quote.', 400);

  const asset = input.asset ?? m.assets[0]!;
  if (!m.assets.includes(asset)) throw new ServiceError('bad_request', `${m.label} takes ${m.assets.join(' or ')}.`);
  let fromAddress: string | null = null;
  if (m.kind === 'stablecoin') {
    const raw = (input.fromAddress ?? '').trim();
    try {
      fromAddress = new PublicKey(raw).toBase58();
    } catch {
      throw new ServiceError('bad_request', 'Enter the Solana address of the wallet you are sending from.', 422);
    }
    if (fromAddress !== raw) throw new ServiceError('bad_request', 'Enter the Solana address of the wallet you are sending from.', 422);
    if (fromAddress === vault.vaultPda || fromAddress === treasuryVaultPda(vault.multisigPda)) {
      throw new ServiceError('bad_request', 'That is one of your own vaults. To pay from your vaults, choose “Pay from your vaults”.', 422);
    }
  }

  const rt = runtime();
  if (!isSimulator(rt.chain)) {
    if (m.sandboxOnly) throw new ServiceError('sandbox_only', `${m.label} is a sandbox stand-in in this build and is not connected on devnet.`, 409);
    throw new ServiceError('devnet_fund_manual', 'On devnet, send the USDC from your wallet to your payments vault, then check again.', 409, {
      vaultAddress: vault.vaultPda,
      amountMinor: q.source.amountMinor.toString(),
    });
  }

  // One funding per payment at a time: a second request returns the one under way (or done).
  const live = fundingsOf(org).find((f) => f.paymentId === p.id && f.state !== 'held');
  if (live) return live;

  // Screen what the money comes from: the sending wallet, or the provider's account for USD.
  const screened = fromAddress ?? `${m.provider ?? 'provider'}:${orgId}`;
  const kyt = createKytStub(input.rehearsal === 'kyt_flag' ? [screened] : []).screen(screened, 'solana');
  const at = now.toISOString();
  const f: PaymentFunding = {
    id: newId(),
    orgId,
    paymentId: p.id,
    method: input.method,
    asset,
    fromAddress,
    amountMinor: q.source.amountMinor,
    chargeMinor: chargeFor(q.source.amountMinor, m.chargeBps),
    chargeBps: m.chargeBps,
    sourceOfFunds: input.sourceOfFunds,
    declaredBy: input.by.trim() || org.personName,
    declaredAt: at,
    state: 'checking',
    checkUntil: new Date(now.getTime() + OFFLINE_FUNDS_CHECK_MS).toISOString(),
    check: { resultId: kyt.resultId, label: kyt.label, flagged: kyt.verdict === 'flagged' },
    signature: null,
    simulated: true,
    createdAt: at,
    settledAt: null,
  };
  fundingsOf(org).push(f);
  return f;
}

/**
 * Where a funding stands. Once its check has run: a flagged source is held (nothing reaches the vault),
 * a clear one lands in the payments vault. Reading it twice never credits twice.
 */
export async function refreshFunding(orgId: string, fundingId: string, now = new Date()): Promise<PaymentFunding> {
  const org = getOrg(orgId);
  const f = fundingsOf(org).find((x) => x.id === fundingId);
  if (!f) throw new ServiceError('funding_not_found', 'That funding is not on the server for this company.', 404);
  if (f.state !== 'checking' || now.getTime() < Date.parse(f.checkUntil)) return f;
  if (f.check?.flagged) {
    f.state = 'held';
    f.settledAt = now.toISOString();
    return f;
  }
  const vault = requireVault(org);
  const chain = runtime().chain;
  // Only the offline simulator stands in for Stripe, Airwallex or the other wallet (startFunding refuses on devnet).
  if (!isSimulator(chain)) throw new ServiceError('sandbox_only', 'This funding is a sandbox stand-in and cannot complete on devnet.', 409);
  const receipt = await chain.fundUsdc(vault.vaultPda, f.amountMinor);
  f.state = 'in_vault';
  f.signature = receipt.signature;
  f.settledAt = now.toISOString();
  org.fundings.push({ signature: receipt.signature, amountMinor: f.amountMinor, at: f.settledAt, simulated: true, note: `${FUNDING_METHODS[f.method].label} for ${f.paymentId} (sandbox)` });
  return f;
}
