/**
 * The admin console's view of the Solana build (prompt 07 §7): every company, not just the one a
 * session belongs to. It reads public facts only (addresses, states, amounts, signatures, counts) and
 * changes exactly one thing: whether Splash serves a company (suspend / unsuspend). No private key
 * and no customer secret is read or returned.
 *
 *   orgs       each company's multisig, its two vaults, threshold, members, the config authority as
 *              the CHAIN reports it (must be none), and the refuse-service switch with its audit log
 *   payments   every payment's state, amounts, the create / approve / execute transactions, the
 *              payout partner's last word, and the evidence state
 *   fee payer  Kora's SOL, what it spent today and over 7 days, per company, and the rent it put
 *              into accounts that never comes back
 *   evidence   anchors (root, count, period), stored records and their Walrus epochs, and the
 *              evidence sponsor's gas (it pays for allowlist updates only)
 *   webhooks   the payout partner's last webhooks, the signature check on each, the replay rules
 */
import { PublicKey } from '@solana/web3.js';

import { MOCK_PARTNER_ENTRY } from '../solana-partner/registry.ts';
import { defaultSponsorPolicy, utcDay } from '../solana/kora.ts';
import { usdcMint } from '../solana/config.ts';
import { loadCompany, saveCompany } from './company.ts';
import { PAYMENT_STATES, STATE_LABEL } from './payment-machine.ts';
import { runtime } from './runtime.ts';
import { getOrg, suspendOrg, traceLinks, treasuryVaultPda, unsuspendOrg } from './service.ts';
import { store, type OrgRecord } from './store.ts';

/** Below this the console shows the fee payer in red: about 50 sponsored payments' worth of fees and rent. */
export const FEE_PAYER_ALERT_LAMPORTS = 500_000_000n; // 0.5 SOL
/** Warn this many days before a stored record's epochs run out. */
const EXPIRY_WARNING_DAYS = 7;

const DAY_MS = 86_400_000;

/** Every company this deployment knows: the ones in this process, and every one saved in the database. */
export async function allCompanies(): Promise<OrgRecord[]> {
  const ids = new Set<string>([...store().orgs.keys(), ...(await runtime().docs.listOrgIds())]);
  for (const id of ids) await loadCompany(id);
  return [...ids]
    .map((id) => store().orgs.get(id))
    .filter((o): o is OrgRecord => !!o)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

const nameOf = (orgs: OrgRecord[]) => {
  const m = new Map(orgs.map((o) => [o.id, o.companyName]));
  return (id: string) => m.get(id) ?? id;
};

/* ------------------------------------------------------------------ 1. orgs and vaults */

export async function adminOrgs() {
  const rt = runtime();
  const orgs = await allCompanies();
  return Promise.all(
    orgs.map(async (o) => {
      const v = o.vault;
      let chain: { found: boolean; configAuthority: string | null; threshold: number | null; members: number | null } = { found: false, configAuthority: null, threshold: null, members: null };
      if (v) {
        try {
          const ms = await rt.chain.getMultisig(new PublicKey(v.multisigPda));
          if (ms) chain = { found: true, configAuthority: ms.configAuthority, threshold: ms.threshold, members: ms.members.length };
        } catch {
          /* the RPC did not answer: shown as not read, never as "none" */
        }
      }
      return {
        orgId: o.id,
        companyName: o.companyName,
        createdAt: o.createdAt,
        vault: v
          ? {
              multisigPda: v.multisigPda,
              paymentsVault: { address: v.vaultPda, ...traceLinks('account', v.vaultPda, v.simulated) },
              treasuryVault: { address: treasuryVaultPda(v.multisigPda), ...traceLinks('account', treasuryVaultPda(v.multisigPda), v.simulated) },
              threshold: v.threshold,
              memberCount: v.members.length,
              simulated: v.simulated,
              multisig: traceLinks('account', v.multisigPda, v.simulated),
            }
          : null,
        /** What the chain says, not what Splash recorded: the config authority must read "none". */
        chain,
        configAuthorityNone: chain.found && chain.configAuthority === null,
        suspended: o.suspended,
        serviceLog: o.serviceLog ?? [],
        counts: {
          moves: (o.moves ?? []).length,
          batches: [...store().batches.values()].filter((b) => b.orgId === o.id).length,
        },
      };
    }),
  );
}

/* ------------------------------------------------------------------ 2. payments */

const STEP: Record<string, 'create' | 'approve' | 'execute' | 'anchor' | 'other'> = {
  squads_proposal_create: 'create',
  squads_proposal_approve: 'approve',
  squads_vault_execute: 'execute',
};

export async function adminPayments() {
  const rt = runtime();
  const orgs = await allCompanies();
  const name = nameOf(orgs);
  const all = (await rt.payments.listInStates(PAYMENT_STATES)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return all.map((p) => {
    const inv = store().invoices.get(p.invoiceId);
    const last = p.partnerEvents[p.partnerEvents.length - 1] ?? null;
    const evidence = p.receiptId ? store().evidence.get(p.receiptId) ?? null : null;
    return {
      id: p.id,
      orgId: p.orgId,
      companyName: name(p.orgId),
      kind: inv?.source === 'transfer' ? ('transfer' as const) : ('invoice' as const),
      createdAt: p.createdAt,
      state: p.state,
      stateLabel: STATE_LABEL[p.state],
      supplierName: inv?.confirmed?.supplierName ?? '',
      amountPhpMinor: p.payout.amountPhpMinor,
      youPayUsdcMinor: p.approval?.youPayUsdcMinor ?? null,
      transactions: p.signatures.map((s) => ({ step: STEP[s.purpose] ?? 'other', purpose: s.purpose, signature: s.signature, simulated: s.simulated, ...traceLinks('tx', s.signature, s.simulated) })),
      partner: last ? { status: last.status, bankReference: last.bankReference ?? null, at: last.at } : null,
      evidence: p.receiptId ? { receiptId: p.receiptId, anchor: evidence?.anchor.status ?? 'not loaded' } : null,
      problem: p.problem,
    };
  });
}

/* ------------------------------------------------------------------ 3. fee payer (Kora) */

export async function adminFeePayer(now = new Date()) {
  const rt = runtime();
  const orgs = await allCompanies();
  const name = nameOf(orgs);
  const feePayer = (await rt.chain.getFeePayer()).toBase58();
  let solLamports: bigint | null = null;
  try {
    solLamports = await rt.chain.getSolBalance(feePayer);
  } catch {
    solLamports = null;
  }
  const today = utcDay(now);
  const weekFrom = utcDay(new Date(now.getTime() - 6 * DAY_MS));
  type Spend = { count: number; feeLamports: bigint; rentLamports: bigint };
  const zero = (): Spend => ({ count: 0, feeLamports: 0n, rentLamports: 0n });
  const add = (a: Spend, r: Spend): Spend => ({ count: a.count + r.count, feeLamports: a.feeLamports + r.feeLamports, rentLamports: a.rentLamports + r.rentLamports });
  const sum = (rows: Spend[]) => rows.reduce(add, zero());
  const all = await rt.sponsors.list('0000-00-00');
  const week = all.filter((r) => r.day >= weekFrom);
  const byOrg = new Map<string, { orgId: string; today: Spend; week: Spend }>();
  for (const r of week) {
    const e = byOrg.get(r.orgId) ?? { orgId: r.orgId, today: zero(), week: zero() };
    e.week = add(e.week, r);
    if (r.day === today) e.today = add(e.today, r);
    byOrg.set(r.orgId, e);
  }
  const cap = defaultSponsorPolicy(usdcMint(rt.env.cluster).toBase58()).perOrgDailyTxCap;
  return {
    feePayer: { address: feePayer, ...traceLinks('account', feePayer, rt.env.mode === 'offline') },
    simulated: rt.env.mode === 'offline',
    solLamports,
    alertBelowLamports: FEE_PAYER_ALERT_LAMPORTS,
    low: solLamports !== null && solLamports < FEE_PAYER_ALERT_LAMPORTS,
    today: sum(all.filter((r) => r.day === today)),
    week: sum(week),
    /** Rent the fee payer has put into accounts since the ledger began. Splash's vaults set no rent collector, so it stays there. */
    rentLocked: sum(all).rentLamports,
    perOrgCap: cap,
    perOrg: [...byOrg.values()]
      .map((e) => ({ ...e, companyName: name(e.orgId), capUsedToday: e.today.count }))
      .sort((a, b) => (a.week.feeLamports + a.week.rentLamports < b.week.feeLamports + b.week.rentLamports ? 1 : -1)),
  };
}

/* ------------------------------------------------------------------ 4. evidence */

export async function adminEvidence(now = new Date()) {
  const rt = runtime();
  const orgs = await allCompanies();
  const name = nameOf(orgs);
  const records = [...store().evidence.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  // One anchor per batch root: the memo (or attestation) that carries it.
  const anchors = new Map<string, { rootHex: string; count: number; periodStart: bigint; periodEnd: bigint; method: string; status: string; signature: string | null; attester: string; simulated: boolean; solscanUrl: string | null; explorerUrl: string | null; receipts: number }>();
  for (const e of records) {
    const prev = anchors.get(e.batch.rootHex);
    if (prev) {
      prev.receipts += 1;
      continue;
    }
    const links = e.anchor.signature ? traceLinks('tx', e.anchor.signature, e.anchor.simulated) : { solscanUrl: null, explorerUrl: null };
    anchors.set(e.batch.rootHex, {
      rootHex: e.batch.rootHex,
      count: e.batch.count,
      periodStart: e.batch.periodStart,
      periodEnd: e.batch.periodEnd,
      method: e.anchor.method,
      status: e.anchor.status,
      signature: e.anchor.signature,
      attester: e.anchor.attester,
      simulated: e.anchor.simulated,
      ...links,
      receipts: 1,
    });
  }
  const { walrusEpochs } = await import('../evidence-sui/walrus.ts');
  const { evidenceSuiNetwork } = await import('../evidence-sui/client.ts');
  const epochs = walrusEpochs();
  /** Walrus epoch length: testnet 1 day, mainnet 14 days. */
  const WALRUS_EPOCH_DAYS = evidenceSuiNetwork() === 'mainnet' ? 14 : 1;
  const stored = records.map((e) => {
    const onWalrus = e.stored.mode !== 'memory';
    const expiresAt = onWalrus ? new Date(new Date(e.createdAt).getTime() + epochs * WALRUS_EPOCH_DAYS * DAY_MS) : null;
    return {
      receiptId: e.receiptId,
      companyName: name(e.orgId),
      blobId: e.stored.blobId,
      mode: e.stored.mode,
      sizeBytes: e.stored.sizeBytes,
      createdAt: e.createdAt,
      expiresAt: expiresAt?.toISOString() ?? null,
      expiringSoon: expiresAt ? expiresAt.getTime() - now.getTime() < EXPIRY_WARNING_DAYS * DAY_MS : false,
    };
  });
  let sponsor: { address: string; balanceMist: bigint | null } | null = null;
  let sponsorProblem: string | null = null;
  try {
    const { evidenceSponsorFromEnv, sponsorBalanceMist } = await import('../evidence-sui/sponsor.ts');
    const s = evidenceSponsorFromEnv();
    if (s) {
      const address = await s.address();
      sponsor = { address, balanceMist: await sponsorBalanceMist(address) };
    }
  } catch (e) {
    sponsorProblem = e instanceof Error ? e.message : String(e);
  }
  return {
    attester: rt.attester.publicKey.toBase58(),
    anchors: [...anchors.values()],
    stored,
    walrus: {
      epochs,
      epochDays: WALRUS_EPOCH_DAYS,
      onWalrus: stored.filter((s) => s.mode !== 'memory').length,
      offline: stored.filter((s) => s.mode === 'memory').length,
      expiringSoon: stored.filter((s) => s.expiringSoon).length,
    },
    /** Pays Sui gas for allowlist updates only; holds no customer money. */
    sponsor,
    sponsorProblem,
  };
}

/* ------------------------------------------------------------------ 5. compliance (subtractive) */

/** Suspend: no fee-payer signature, no new proposal. The vault stays the company's; Splash cannot move it. */
export async function adminSuspend(orgId: string, by: string, reason: string) {
  await loadCompany(orgId);
  getOrg(orgId);
  const out = suspendOrg(orgId, { by, reason });
  await saveCompany(orgId);
  return out;
}

export async function adminUnsuspend(orgId: string, by: string, reason: string) {
  await loadCompany(orgId);
  getOrg(orgId);
  unsuspendOrg(orgId, { by, reason });
  await saveCompany(orgId);
  return null;
}

/* ------------------------------------------------------------------ 6. partner webhooks */

export function adminWebhooks() {
  const log = [...store().webhookLog].reverse();
  return {
    partner: { id: MOCK_PARTNER_ENTRY.id, name: MOCK_PARTNER_ENTRY.name, sandbox: MOCK_PARTNER_ENTRY.sandbox },
    /** How a webhook is checked before it changes anything (service.ts receivePartnerWebhook). */
    protection: {
      signature: 'HMAC-SHA256 over the event with the partner secret, compared in constant time',
      maxAgeSec: 3600,
      futureSkewSec: 300,
      duplicateRule: 'The same payment and status again is a no-op',
      amountRule: 'The amount must equal the payout, or the webhook is refused',
    },
    counts: {
      accepted: log.filter((l) => l.result === 'accepted').length,
      duplicate: log.filter((l) => l.result === 'duplicate').length,
      refused: log.filter((l) => l.result === 'refused').length,
      badSignature: log.filter((l) => l.signatureOk === false).length,
    },
    log: log.slice(0, 50),
  };
}
