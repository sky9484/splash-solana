/**
 * Batch payouts on Solana, end to end (prompt 07 §5.5, §6.2).
 *
 *   create     every supplier row gets its own one-payment deposit from the payout partner and its
 *              own quote (Solana direct); the rules run on the total; a chunk plan is previewed
 *   prepare    the chunks are planned again at the vault's next transaction index, by MEASURED size
 *              (lib/solana/batch.ts), and every chunk's proposal and execute go to the device in one
 *              prompt; a retry prepares one chunk only
 *   submit     chunks are sent in order. Each chunk pays all its suppliers or none; the batch as a
 *              whole does not, and the screen says so. A chunk whose proposal fails stops the ones
 *              after it (Squads indices are sequential); a chunk whose execute fails or expires is
 *              retried alone, its execute rebuilt with a fresh blockhash and never resent as old bytes
 *   settle     for every chunk that landed, the payout partner sees each deposit and pays the bank
 *
 * A batch is the company's document (solana_documents, kind "batch"); every chunk transaction's
 * signature is written to it before the bytes are broadcast, the same rule as a single payment.
 * In this build a batch needs a 1-of-N vault: a second approver would need a second prompt per chunk.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { PublicKey, VersionedTransaction, type TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';

import { quoteRoutes, POLICIES } from '../route-engine/index.ts';
import { isQuoteExpired, routeKindOf } from '../route-engine/quote.ts';
import { BatchPlanError, planBatchChunks } from '../solana/batch.ts';
import { computeBudgetInstructions, DEFAULT_UNIT_LIMITS, MAX_UNIT_LIMIT } from '../solana/compute-budget.ts';
import { utcDay } from '../solana/kora.ts';
import { BLOCKHASH_VALIDITY_BLOCKS, isSimulator } from '../solana/simulator.ts';
import { buildSponsoredTransaction, buildVaultExecuteInstruction, buildVaultProposal, groupProposalTransactions, MAX_TRANSACTION_BYTES, transactionSize } from '../solana/squads.ts';
import type { BatchRowInput } from './batch-rows.ts';
import { saveCompany } from './company.ts';
import { awaitCommitment } from './confirm.ts';
import { ServiceError } from './errors.ts';
import { runtime, splashKeys } from './runtime.ts';
import { assertServiceable, budgeted, confirmWaitMs, DEMO_LIMITS, deserializeIx, getOrg, requireVault, serializeIx, takeSponsorSlot, traceLinks } from './service.ts';
import { store, type SerializedInstruction } from './store.ts';

/* ------------------------------------------------------------------ records */

export type BatchRowStatus = 'quoted' | 'sent' | 'paid' | 'returned' | 'not_sent';
export type BatchChunkState = 'planned' | 'proposed' | 'checking' | 'confirmed' | 'failed' | 'not_sent';
export type BatchState = 'quoted' | 'expired' | 'blocked' | 'sending' | 'done' | 'partial' | 'failed';

export interface BatchRowRecord {
  /** `<batchId>.r<n>`: the payout partner's payment id for this row. */
  id: string;
  line: number;
  supplierName: string;
  bank: string;
  accountLast4: string;
  invoiceNumber: string | null;
  amountPhpMinor: bigint;
  depositAddress: string;
  payoutId: string;
  quoteId: string;
  /** What leaves the vault for this row: the transfer to the deposit plus Splash's fee. */
  youPayUsdcMinor: bigint;
  transferMinor: bigint;
  splashFeeMinor: bigint;
  allInBps: number;
  expiresAt: string;
  chunkIndex: number | null;
  status: BatchRowStatus;
  bankReference: string | null;
  paidAt: string | null;
}

export interface BatchCall {
  step: 'proposal' | 'execute';
  part: number;
  signature: string;
  lastValidBlockHeight: number;
  status: 'signed' | 'confirmed' | 'finalized' | 'failed' | 'expired' | 'pending';
  at: string;
}

export interface BatchChunkRecord {
  index: number;
  memo: string;
  transactionIndex: bigint;
  rowIds: string[];
  payoutMinor: bigint;
  feeMinor: bigint;
  sizes: { proposal: number[]; execute: number };
  /** What the vault transaction does, kept so a failed execute can be rebuilt. */
  vault: SerializedInstruction[];
  preExecute: SerializedInstruction[];
  trace: SerializedInstruction[];
  state: BatchChunkState;
  calls: BatchCall[];
  problem: { code: string; message: string } | null;
}

export interface BatchPreparedMessage {
  id: string;
  chunkIndex: number;
  step: 'proposal' | 'execute';
  part: number;
  txBase64: string;
  messageBase64: string;
  lastValidBlockHeight: number;
}

export interface BatchRecord {
  id: string;
  orgId: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  state: BatchState;
  quoteExpiresAt: string;
  rows: BatchRowRecord[];
  chunks: BatchChunkRecord[];
  checks: Array<{ name: string; label: string; passed: boolean; detail: string }>;
  totals: { payees: number; receivePhpMinor: bigint; transferMinor: bigint; feeMinor: bigint; youPayMinor: bigint };
  prepared: { signer: string; createdAt: string; chunkIndexes: number[]; messages: BatchPreparedMessage[] } | null;
  approvals: Array<{ who: string; keyPublic: string; at: string }>;
  /** Offline only: drop one chunk's execute so the retry can be seen. */
  rehearsal: 'none' | 'drop_chunk';
}

/* ------------------------------------------------------------------ helpers */

const hex = (n: number) => {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
};
const nowIso = (d = new Date()) => d.toISOString();
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

export function getBatch(orgId: string, batchId: string): BatchRecord {
  const b = store().batches.get(batchId);
  if (!b || b.orgId !== orgId) throw new ServiceError('payment_not_found', 'That batch is not on the server for this company.', 404);
  return b;
}

function sum(xs: bigint[]): bigint {
  return xs.reduce((a, x) => a + x, 0n);
}

/* ------------------------------------------------------------------ create */

export async function createBatch(orgId: string, input: { rows: BatchRowInput[]; by: string }, now = new Date()): Promise<BatchRecord> {
  const org = getOrg(orgId);
  const vault = requireVault(org);
  assertServiceable(orgId);
  if (vault.threshold !== 1) throw new ServiceError('wrong_state', 'Batch payouts need accounts where one approval is enough in this build. Pay these suppliers one by one.', 409);
  if (input.rows.length === 0) throw new ServiceError('bad_request', 'Add at least one supplier row.');
  const rt = runtime();
  const id = `bat_${hex(8)}`;
  const balance = await rt.chain.getUsdcBalance(vault.vaultPda);
  const rows: BatchRowRecord[] = [];
  for (const [i, r] of input.rows.entries()) {
    const rowId = `${id}.r${i + 1}`;
    const partnerQuote = rt.partner.quote({ amountPhpMinor: r.amountPhpMinor }, { network: 'solana', now });
    const payout = rt.partner.createPayout({ paymentId: rowId, amountPhpMinor: r.amountPhpMinor, expectedUsdcMinor: partnerQuote.grossUsdcMinor, beneficiary: { bank: r.bank, accountLast4: r.accountLast4 }, now });
    const deposit = payout.deposits.find((d) => d.network === 'solana')!.address;
    const engine = quoteRoutes({ paymentId: rowId, amount: { amountPhpMinor: r.amountPhpMinor }, senderBalanceUsdcMinor: balance, partner: rt.partner.entry, partnerQuotes: [partnerQuote], deposits: { solana: deposit }, now, homeChain: 'solana' });
    const q = POLICIES.map((p) => engine.picks[p]).find((x) => x && routeKindOf(x) === 'solana_direct');
    if (!q) {
      const short = engine.excluded.some((e) => e.reason === 'insufficient_balance');
      throw new ServiceError(short ? 'insufficient_balance' : 'no_route', short ? `Your balance is too low for line ${r.line} (${r.supplierName}) alone. Add money to your Payments account first.` : `No route can pay line ${r.line} right now. Try again in a minute.`, 409);
    }
    rows.push({
      id: rowId,
      line: r.line,
      supplierName: r.supplierName,
      bank: r.bank,
      accountLast4: r.accountLast4,
      invoiceNumber: r.invoiceNumber,
      amountPhpMinor: r.amountPhpMinor,
      depositAddress: deposit,
      payoutId: payout.payoutId,
      quoteId: q.id,
      youPayUsdcMinor: q.source.amountMinor,
      transferMinor: q.source.amountMinor - q.costs.splashMinor,
      splashFeeMinor: q.costs.splashMinor,
      allInBps: q.costs.allInBps,
      expiresAt: q.expiresAt,
      chunkIndex: null,
      status: 'quoted',
      bankReference: null,
      paidAt: null,
    });
  }
  const totals = {
    payees: rows.length,
    receivePhpMinor: sum(rows.map((r) => r.amountPhpMinor)),
    transferMinor: sum(rows.map((r) => r.transferMinor)),
    feeMinor: sum(rows.map((r) => r.splashFeeMinor)),
    youPayMinor: sum(rows.map((r) => r.youPayUsdcMinor)),
  };
  const usedToday = org.dailyDebits[utcDay(now)] ?? 0n;
  const biggest = rows.reduce((m, r) => (r.youPayUsdcMinor > m.youPayUsdcMinor ? r : m), rows[0]!);
  const checks = [
    { name: 'balance', label: 'Enough in your Payments account for the whole batch', passed: totals.youPayMinor <= balance, detail: `needs ${totals.youPayMinor} of ${balance} (USDC minor units)` },
    { name: 'per_payment', label: 'Every line within the per-payment limit', passed: biggest.youPayUsdcMinor <= DEMO_LIMITS.perPaymentUsdcMinor, detail: `largest line ${biggest.youPayUsdcMinor}, limit ${DEMO_LIMITS.perPaymentUsdcMinor}` },
    { name: 'daily', label: 'Within today’s limit', passed: usedToday + totals.youPayMinor <= DEMO_LIMITS.dailyUsdcMinor, detail: `${usedToday} used today, ${totals.youPayMinor} more, limit ${DEMO_LIMITS.dailyUsdcMinor}` },
    { name: 'deposits', label: 'Every line pays its own partner deposit, never a Splash account', passed: new Set(rows.map((r) => r.depositAddress)).size === rows.length, detail: 'one fresh deposit address per supplier' },
  ];
  const batch: BatchRecord = {
    id,
    orgId,
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
    createdBy: input.by,
    state: checks.every((c) => c.passed) ? 'quoted' : 'blocked',
    quoteExpiresAt: rows.map((r) => r.expiresAt).sort()[0]!,
    rows,
    chunks: [],
    checks,
    totals,
    prepared: null,
    approvals: [],
    rehearsal: 'none',
  };
  // A preview of the chunks (the real plan is made again when the device is asked to sign).
  batch.chunks = await planChunks(batch, await rt.chain.getNextTransactionIndex(new PublicKey(vault.multisigPda)));
  store().batches.set(id, batch);
  return batch;
}

/** Plan chunks by measured size from the rows, starting at a vault transaction index. */
async function planChunks(b: BatchRecord, firstTransactionIndex: bigint, only?: string[]): Promise<BatchChunkRecord[]> {
  const rt = runtime();
  const vault = requireVault(getOrg(b.orgId));
  const rows = only ? b.rows.filter((r) => only.includes(r.id)) : b.rows;
  let plan;
  try {
    plan = await planBatchChunks({
      cluster: rt.env.cluster,
      batchId: b.id,
      multisigPda: new PublicKey(vault.multisigPda),
      vaultPda: new PublicKey(vault.vaultPda),
      member: new PublicKey(vault.members.find((m) => m.role === 'admin_device')!.publicKey),
      feePayer: await rt.chain.getFeePayer(),
      feeAccountOwner: rt.feeAccountOwner,
      payees: rows.map((r) => ({ id: r.id, depositAddress: r.depositAddress, amountMinor: r.transferMinor, splashFeeMinor: r.splashFeeMinor })),
      splashKeys: await splashKeys(rt),
      firstTransactionIndex,
      sizingBlockhash: await rt.chain.getLatestBlockhash(),
    });
  } catch (e) {
    if (e instanceof BatchPlanError) throw new ServiceError('bad_request', e.message);
    throw e;
  }
  return plan.map((c) => ({
    index: c.index,
    memo: c.memo,
    transactionIndex: c.transactionIndex,
    rowIds: c.payees.map((p) => p.id),
    payoutMinor: c.payoutMinor,
    feeMinor: c.feeMinor,
    sizes: c.sizes,
    vault: c.vaultInstructions.map(serializeIx),
    preExecute: c.preExecuteInstructions.map(serializeIx),
    trace: c.traceInstructions.map(serializeIx),
    state: 'planned' as const,
    calls: [],
    problem: null,
  }));
}

/* ------------------------------------------------------------------ prepare */

/**
 * The unsigned transactions this device signs: every chunk at once for a fresh batch, or one chunk
 * for a retry (its execute alone when its proposal is already on chain).
 */
export async function prepareBatch(orgId: string, batchId: string, input: { signer: string; chunk?: number; rehearsal?: 'none' | 'drop_chunk' }, now = new Date()) {
  const b = getBatch(orgId, batchId);
  assertServiceable(orgId);
  const rt = runtime();
  const org = getOrg(orgId);
  const vault = requireVault(org);
  const member = new PublicKey(input.signer);
  if (!vault.members.some((m) => m.publicKey === input.signer && (m.role === 'admin_device' || m.role === 'approver_device'))) {
    throw new ServiceError('not_an_approver', 'That device isn’t one of your company’s approvers.', 403);
  }
  const multisigPda = new PublicKey(vault.multisigPda);
  const feePayer = await rt.chain.getFeePayer();
  const { blockhash, lastValidBlockHeight } = await rt.chain.getBlockhashWithExpiry();

  let targets: BatchChunkRecord[];
  if (input.chunk === undefined) {
    if (b.state === 'blocked') throw new ServiceError('rejected_by_policy', 'This batch does not pass your rules. Change it, then try again.', 409);
    if (b.state !== 'quoted') throw new ServiceError('wrong_state', 'This batch has already been sent. Retry a failed chunk instead.', 409);
    if (isQuoteExpired({ expiresAt: b.quoteExpiresAt }, now)) {
      b.state = 'expired';
      throw new ServiceError('quote_expired', 'The quotes for this batch expired. Start the batch again for fresh quotes.', 409);
    }
    b.chunks = await planChunks(b, await rt.chain.getNextTransactionIndex(multisigPda));
    for (const c of b.chunks) for (const id of c.rowIds) b.rows.find((r) => r.id === id)!.chunkIndex = c.index;
    b.rehearsal = rt.env.mode === 'offline' ? (input.rehearsal ?? 'none') : 'none';
    targets = b.chunks;
  } else {
    const c = b.chunks.find((x) => x.index === input.chunk);
    if (!c || (c.state !== 'failed' && c.state !== 'not_sent')) throw new ServiceError('wrong_state', 'Only a chunk that failed or was not sent can be retried.', 409);
    const proposalLanded = c.calls.some((k) => k.step === 'proposal' && (k.status === 'confirmed' || k.status === 'finalized'));
    // A proposal that never landed consumed no index: it goes at the vault's next one.
    if (!proposalLanded) c.transactionIndex = await rt.chain.getNextTransactionIndex(multisigPda);
    b.rehearsal = 'none';
    targets = [c];
  }

  const messages: BatchPreparedMessage[] = [];
  const push = (chunkIndex: number, step: 'proposal' | 'execute', part: number, ixs: TransactionInstruction[]) => {
    const tx = buildSponsoredTransaction(feePayer, ixs, blockhash);
    const size = transactionSize(tx);
    if (size > MAX_TRANSACTION_BYTES) throw new ServiceError('transaction_too_large', `Chunk ${chunkIndex + 1} is ${size} bytes, over the ${MAX_TRANSACTION_BYTES}-byte limit.`, 500);
    messages.push({ id: `c${chunkIndex}${step === 'proposal' ? `p${part}` : 'x'}`, chunkIndex, step, part, txBase64: b64(tx.serialize()), messageBase64: b64(tx.message.serialize()), lastValidBlockHeight });
  };
  for (const c of targets) {
    const vaultIxs = c.vault.map(deserializeIx);
    const proposalLanded = c.calls.some((k) => k.step === 'proposal' && (k.status === 'confirmed' || k.status === 'finalized'));
    if (!proposalLanded) {
      const proposal = buildVaultProposal({ multisigPda, transactionIndex: c.transactionIndex, member, feePayer, innerInstructions: vaultIxs });
      const placeholder = [...computeBudgetInstructions({ unitLimit: DEFAULT_UNIT_LIMITS.proposal, microLamports: 1n }), ...c.trace.map(deserializeIx)];
      const groups = groupProposalTransactions(proposal, feePayer, blockhash, placeholder);
      for (const [part, raw] of groups.entries()) {
        const budget = await budgeted(feePayer, raw.slice(2), blockhash, DEFAULT_UNIT_LIMITS.proposal, false);
        push(c.index, 'proposal', part, budget.ixs);
      }
    }
    const execute = await buildVaultExecuteInstruction({ multisigPda, transactionIndex: c.transactionIndex, member, innerInstructions: vaultIxs });
    const unitLimit = Math.min(MAX_UNIT_LIMIT, DEFAULT_UNIT_LIMITS.execute + 40_000 * c.rowIds.length);
    const budget = await budgeted(feePayer, [...c.preExecute.map(deserializeIx), execute], blockhash, unitLimit, false);
    push(c.index, 'execute', 0, budget.ixs);
  }
  b.prepared = { signer: input.signer, createdAt: nowIso(now), chunkIndexes: targets.map((c) => c.index), messages };
  b.updatedAt = nowIso(now);
  return { batchId: b.id, signer: input.signer, messages: messages.map((m) => ({ id: m.id, chunkIndex: m.chunkIndex, step: m.step, messageBase64: m.messageBase64 })) };
}

/* ------------------------------------------------------------------ submit */

type Outcome = { status: 'confirmed' | 'finalized' } | { status: 'failed'; error: string } | { status: 'expired' } | { status: 'pending' };

/** Simulate, have the fee payer sign, write the signature to the batch, THEN broadcast; wait for confirmed. */
async function sendChunkTx(b: BatchRecord, c: BatchChunkRecord, m: BatchPreparedMessage, tx: VersionedTransaction, drop: boolean): Promise<Outcome> {
  const rt = runtime();
  assertServiceable(b.orgId);
  const sim = await rt.chain.simulate(tx);
  if (!sim.ok) return { status: 'failed', error: sim.error ?? 'simulation failed' };
  const slot = await takeSponsorSlot(b.orgId);
  let signature: string | null = null;
  if (drop && isSimulator(rt.chain)) rt.chain.dropNext();
  try {
    const receipt = await rt.chain.sendSponsored(tx, {
      orgId: b.orgId,
      onSigned: async (sig) => {
        c.calls.push({ step: m.step, part: m.part, signature: sig, lastValidBlockHeight: m.lastValidBlockHeight, status: 'signed', at: nowIso() });
        signature = sig;
        await saveCompany(b.orgId); // recorded before broadcast: a restart polls this, never resends
      },
    });
    signature = receipt.signature;
  } catch (e) {
    if (!signature) {
      await slot.release();
      return { status: 'failed', error: (e as Error).message };
    }
  }
  const call = c.calls[c.calls.length - 1]!;
  let out = await awaitCommitment(rt.chain, { signature: signature!, lastValidBlockHeight: m.lastValidBlockHeight, target: 'confirmed', timeoutMs: confirmWaitMs() });
  if (out.status === 'pending' && isSimulator(rt.chain) && drop) {
    // Offline, waiting a minute is moving the simulator's clock past the blockhash's life.
    rt.chain.advanceBlocks(BLOCKHASH_VALIDITY_BLOCKS + 1);
    out = await awaitCommitment(rt.chain, { signature: signature!, lastValidBlockHeight: m.lastValidBlockHeight, target: 'confirmed', timeoutMs: 0 });
  }
  call.status = out.status === 'failed' ? 'failed' : out.status;
  if (out.status === 'failed') return { status: 'failed', error: out.err };
  return out.status === 'confirmed' || out.status === 'finalized' ? { status: out.status } : out.status === 'expired' ? { status: 'expired' } : { status: 'pending' };
}

export async function submitBatch(orgId: string, batchId: string, input: { signatures: Array<{ id: string; signature: string }>; who: string }, now = new Date()): Promise<BatchRecord> {
  const b = getBatch(orgId, batchId);
  assertServiceable(orgId);
  const prepared = b.prepared;
  if (!prepared) throw new ServiceError('not_prepared', 'Nothing to sign yet. Press approve again.', 409);
  const signer = new PublicKey(prepared.signer);
  const byId = new Map(input.signatures.map((s) => [s.id, s.signature]));
  const signed = new Map<string, VersionedTransaction>();
  for (const m of prepared.messages) {
    const sigB58 = byId.get(m.id);
    if (!sigB58) throw new ServiceError('signature_required', 'Every chunk needs this device’s signature. Nothing was sent.', 403);
    let sig: Uint8Array;
    try {
      sig = bs58.decode(sigB58);
    } catch {
      throw new ServiceError('signature_invalid', 'That signature is not readable. Nothing was sent.', 400);
    }
    let valid = false;
    try {
      valid = sig.length === 64 && ed25519.verify(sig, fromB64(m.messageBase64), signer.toBytes());
    } catch {
      valid = false;
    }
    if (!valid) throw new ServiceError('signature_invalid', 'That approval isn’t from one of your company’s devices. Nothing was sent.', 403);
    const tx = VersionedTransaction.deserialize(fromB64(m.txBase64));
    tx.addSignature(signer, sig);
    signed.set(m.id, tx);
  }
  // Claim the prepared set before anything is sent: a second submit of the same signatures finds nothing.
  b.prepared = null;
  b.state = 'sending';
  b.approvals.push({ who: input.who, keyPublic: prepared.signer, at: nowIso(now) });
  await saveCompany(orgId);

  let proposalBlocked = false;
  const dropIndex = b.rehearsal === 'drop_chunk' && prepared.chunkIndexes.length > 1 ? prepared.chunkIndexes[1]! : -1;
  for (const index of prepared.chunkIndexes) {
    const c = b.chunks.find((x) => x.index === index)!;
    const msgs = prepared.messages.filter((m) => m.chunkIndex === index);
    const rows = b.rows.filter((r) => c.rowIds.includes(r.id));
    if (proposalBlocked && msgs.some((m) => m.step === 'proposal')) {
      c.state = 'not_sent';
      c.problem = { code: 'not_sent', message: 'An earlier chunk’s proposal did not land, so this chunk was not sent. Nothing moved for it. Retry it.' };
      for (const r of rows) r.status = 'not_sent';
      continue;
    }
    c.problem = null;
    let ok = true;
    for (const m of msgs.filter((x) => x.step === 'proposal')) {
      const out = await sendChunkTx(b, c, m, signed.get(m.id)!, false);
      if (out.status !== 'confirmed' && out.status !== 'finalized') {
        ok = false;
        const reason = out.status === 'failed' ? out.error : 'it expired';
        proposalBlocked = out.status !== 'pending';
        c.state = out.status === 'pending' ? 'checking' : 'failed';
        c.problem = out.status === 'pending' ? { code: 'uncertain', message: 'Checking whether this chunk’s proposal landed. Don’t retry yet.' } : { code: 'proposal_failed', message: `This chunk’s proposal did not land (${reason}). Nothing moved for it. Retry it.` };
        break;
      }
      c.state = 'proposed';
    }
    if (!ok) {
      for (const r of rows) r.status = 'not_sent';
      continue;
    }
    const exec = msgs.find((x) => x.step === 'execute')!;
    const out = await sendChunkTx(b, c, exec, signed.get(exec.id)!, index === dropIndex);
    if (out.status === 'confirmed' || out.status === 'finalized') {
      c.state = 'confirmed';
      for (const r of rows) r.status = 'sent';
      const org = getOrg(orgId);
      const day = utcDay(now);
      org.dailyDebits[day] = (org.dailyDebits[day] ?? 0n) + c.payoutMinor + c.feeMinor;
    } else if (out.status === 'pending') {
      c.state = 'checking';
      c.problem = { code: 'uncertain', message: 'Checking whether this chunk landed. Don’t retry yet; the page updates on its own.' };
    } else {
      c.state = 'failed';
      c.problem =
        out.status === 'failed'
          ? { code: 'execute_failed', message: `This chunk’s transfer failed (${out.error}). Nothing moved for it. Retry it.` }
          : { code: 'expired', message: 'This chunk’s transfer expired before it landed. Nothing moved for it; its suppliers are not paid. Retry it.' };
      for (const r of rows) r.status = 'not_sent';
    }
    await saveCompany(orgId);
  }
  await settleBatch(b, now);
  return b;
}

/** For every chunk that landed, the payout partner sees each deposit and pays the bank. */
async function settleBatch(b: BatchRecord, now = new Date()): Promise<void> {
  const rt = runtime();
  for (const r of b.rows) {
    if (r.status !== 'sent') continue;
    try {
      const arrived = await rt.chain.getUsdcBalance(r.depositAddress);
      const events = rt.partner.simulateDeposit({ payoutId: r.payoutId, network: 'solana', address: r.depositAddress, amountUsdcMinor: arrived, now });
      const paid = events.find((e) => e.status === 'paid');
      if (paid) {
        r.status = 'paid';
        r.bankReference = paid.bankReference ?? null;
        r.paidAt = paid.at;
      } else if (events.some((e) => e.status === 'returned')) r.status = 'returned';
    } catch {
      /* the partner has not seen it yet; the next read tries again */
    }
  }
  const states = b.chunks.map((c) => c.state);
  b.state = states.every((s) => s === 'confirmed') ? 'done' : states.some((s) => s === 'checking') ? 'sending' : states.some((s) => s === 'confirmed') ? 'partial' : 'failed';
  b.updatedAt = nowIso(now);
}

/** Poll chunks whose outcome was unknown when the request ended; never sends anything. */
export async function resumeBatch(orgId: string, batchId: string): Promise<BatchRecord> {
  const b = getBatch(orgId, batchId);
  const rt = runtime();
  let changed = false;
  for (const c of b.chunks.filter((x) => x.state === 'checking')) {
    const last = c.calls[c.calls.length - 1];
    if (!last) continue;
    const out = await awaitCommitment(rt.chain, { signature: last.signature, lastValidBlockHeight: last.lastValidBlockHeight, target: 'confirmed', timeoutMs: 0 });
    if (out.status === 'pending') continue;
    changed = true;
    last.status = out.status === 'failed' ? 'failed' : out.status;
    const rows = b.rows.filter((r) => c.rowIds.includes(r.id));
    if (out.status === 'confirmed' || out.status === 'finalized') {
      if (last.step === 'execute') {
        c.state = 'confirmed';
        c.problem = null;
        for (const r of rows) r.status = 'sent';
      } else {
        c.state = 'failed';
        c.problem = { code: 'execute_missing', message: 'The proposal landed; the transfer was not sent. Retry this chunk.' };
      }
    } else {
      c.state = 'failed';
      c.problem = { code: out.status, message: 'This chunk did not land. Nothing moved for it. Retry it.' };
      for (const r of rows) r.status = 'not_sent';
    }
  }
  if (changed || b.rows.some((r) => r.status === 'sent')) await settleBatch(b);
  return b;
}

/* ------------------------------------------------------------------ views */

const CHUNK_LABEL: Record<BatchChunkState, string> = {
  planned: 'Planned',
  proposed: 'Proposed',
  checking: 'Checking',
  confirmed: 'Sent · confirmed',
  failed: 'Failed, nothing moved',
  not_sent: 'Not sent',
};
const ROW_LABEL: Record<BatchRowStatus, string> = { quoted: 'Quoted', sent: 'Sent, partner paying', paid: 'Paid to bank', returned: 'Returned by the partner', not_sent: 'Not paid yet' };

export function batchView(b: BatchRecord) {
  const rt = runtime();
  const simulated = rt.env.mode === 'offline';
  return {
    id: b.id,
    state: b.state,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    createdBy: b.createdBy,
    simulated,
    quoteExpiresAt: b.quoteExpiresAt,
    totals: b.totals,
    checks: b.checks,
    allowed: b.checks.every((c) => c.passed),
    partnerLabel: rt.partner.entry.name,
    rows: b.rows.map((r) => ({
      id: r.id,
      line: r.line,
      supplierName: r.supplierName,
      bank: r.bank,
      accountLast4: r.accountLast4,
      invoiceNumber: r.invoiceNumber,
      amountPhpMinor: r.amountPhpMinor,
      youPayUsdcMinor: r.youPayUsdcMinor,
      splashFeeMinor: r.splashFeeMinor,
      chunkIndex: r.chunkIndex,
      status: r.status,
      statusLabel: ROW_LABEL[r.status],
      bankReference: r.bankReference,
      depositAddress: r.depositAddress,
      ...traceLinks('account', r.depositAddress, simulated),
    })),
    chunks: b.chunks.map((c) => ({
      index: c.index,
      memo: c.memo,
      payees: c.rowIds.length,
      payoutMinor: c.payoutMinor,
      feeMinor: c.feeMinor,
      sizes: c.sizes,
      state: c.state,
      stateLabel: CHUNK_LABEL[c.state],
      problem: c.problem,
      retryable: c.state === 'failed' || c.state === 'not_sent',
      calls: c.calls.map((k) => ({ step: k.step, part: k.part, signature: k.signature, status: k.status, simulated, ...traceLinks('tx', k.signature, simulated) })),
    })),
  };
}

export function listBatches(orgId: string) {
  return [...store().batches.values()]
    .filter((b) => b.orgId === orgId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((b) => ({ id: b.id, state: b.state, createdAt: b.createdAt, payees: b.totals.payees, receivePhpMinor: b.totals.receivePhpMinor, youPayMinor: b.totals.youPayMinor, paid: b.rows.filter((r) => r.status === 'paid').length }));
}
