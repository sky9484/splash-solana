/**
 * Batch payouts on Solana (prompt 07 §5.5): be honest about the limits.
 *
 * A Solana transaction is capped at 1,232 bytes, so a USDC batch does not fit in one vault
 * transaction. The batch is split into CHUNKS, each its own Squads vault transaction and proposal:
 *
 *   inside the vault transaction   one transferChecked per payee (vault ATA → payee ATA),
 *                                  one transferChecked of the chunk's Splash fee to the fee ATA,
 *                                  SPL Memo "splash:pay:v1:<batchId>.c<n>"
 *   before the execute (top level) compute budget, ATA CreateIdempotent per payee + fee account
 *                                  (Kora pays the rent)
 *   proposal transactions (top)    the same memo again: a proposal stores the vault transaction
 *                                  without running it, so this copy is what puts
 *                                  "splash:pay:v1:<batchId>.c<n>" in the proposal's Solscan logs
 *
 * The execute needs no top-level copy: running the vault transaction runs its memo, and Solscan
 * shows that log under the Squads execute. A copy would cost a payee per chunk.
 *
 * How many payees fit is MEASURED, never hard-coded: payees are added one at a time and every
 * transaction the chunk needs (the proposal group(s) and the execute, compute budget included) is
 * built and serialized; the chunk closes when the next payee would push any of them past the limit.
 *
 * What this means for the person: EACH CHUNK is all-or-none. The batch as a whole is not — one
 * chunk can land while another fails, and only the failed chunk is retried. The batch screen must
 * say so; "all or nothing" for a whole batch is not true on Solana.
 *
 * Address lookup tables would shrink each payee to ~1 byte and fit more per chunk, but the
 * sponsored-transaction policy (kora.toml, §5.6) allowlists no lookup-table program and the sponsor
 * check refuses lookups, so this build does not use one (docs/solana-build/DECISIONS.md D-P3-3).
 */
import { PublicKey, type TransactionInstruction } from '@solana/web3.js';

import { computeBudgetInstructions, DEFAULT_UNIT_LIMITS, MAX_UNIT_LIMIT } from './compute-budget.ts';
import { USDC_DECIMALS, usdcMint } from './config.ts';
import { assertPayoutDestination, buildCreateAtaIdempotentInstruction, buildMemoInstruction, buildPaymentMemo, buildTransferCheckedInstruction, getAssociatedTokenAddress } from './payout.ts';
import { buildSponsoredTransaction, buildVaultExecuteInstruction, buildVaultProposal, groupProposalTransactions, MAX_TRANSACTION_BYTES, transactionSize } from './squads.ts';
import type { Cluster } from './types.ts';

export interface BatchPayee {
  /** The caller's id for this line (a supplier or invoice reference held off-chain). */
  id: string;
  /** The payout partner's one-payment deposit address for this payee. */
  depositAddress: string;
  /** USDC minor units the payee's deposit receives. */
  amountMinor: bigint;
  /** Splash's fee for this payee (0.10%, min US$2: lib/route-engine/fees.ts), USDC minor units. */
  splashFeeMinor: bigint;
}

export interface BatchPlanInput {
  cluster: Cluster;
  /** bat_ + 16 hex. Chunk memos are <batchId>.c<n>. */
  batchId: string;
  multisigPda: PublicKey;
  vaultPda: PublicKey;
  /** The approver's device key (proposes, approves, executes). */
  member: PublicKey;
  feePayer: PublicKey;
  feeAccountOwner: PublicKey;
  payees: BatchPayee[];
  /** Every Splash-controlled key: none may be a payee. */
  splashKeys: string[];
  /** The vault's next transaction index; chunk n uses firstTransactionIndex + n. */
  firstTransactionIndex: bigint;
  /** For sizing only: the real blockhash is set when the chunk is prepared for signing. */
  sizingBlockhash: string;
}

export interface BatchChunk {
  index: number;
  memo: string;
  transactionIndex: bigint;
  payees: BatchPayee[];
  payoutMinor: bigint;
  feeMinor: bigint;
  vaultInstructions: TransactionInstruction[];
  preExecuteInstructions: TransactionInstruction[];
  /** Put in every proposal transaction of this chunk (measured with it), so each one shows the chunk memo on Solscan. */
  traceInstructions: TransactionInstruction[];
  /** Serialized sizes at plan time, compute budget and memos included. Every one is ≤ 1,232. */
  sizes: { proposal: number[]; execute: number };
}

export class BatchPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchPlanError';
  }
}

const BATCH_ID = /^bat_[0-9a-f]{16}$/;

function chunkInstructions(input: BatchPlanInput, index: number, payees: BatchPayee[]) {
  const mint = usdcMint(input.cluster);
  const source = getAssociatedTokenAddress(mint, input.vaultPda);
  const feeAta = getAssociatedTokenAddress(mint, input.feeAccountOwner);
  const memo = buildPaymentMemo(`${input.batchId}.c${index}`);
  const feeMinor = payees.reduce((a, p) => a + p.splashFeeMinor, 0n);
  const payoutMinor = payees.reduce((a, p) => a + p.amountMinor, 0n);
  const vault: TransactionInstruction[] = payees.map((p) => {
    const owner = new PublicKey(p.depositAddress);
    return buildTransferCheckedInstruction({ source, mint, destination: getAssociatedTokenAddress(mint, owner), owner: input.vaultPda, amount: p.amountMinor, decimals: USDC_DECIMALS });
  });
  if (feeMinor > 0n) vault.push(buildTransferCheckedInstruction({ source, mint, destination: feeAta, owner: input.vaultPda, amount: feeMinor, decimals: USDC_DECIMALS }));
  vault.push(buildMemoInstruction(memo));
  const pre = [
    ...payees.map((p) => buildCreateAtaIdempotentInstruction(input.feePayer, new PublicKey(p.depositAddress), mint)),
    ...(feeMinor > 0n ? [buildCreateAtaIdempotentInstruction(input.feePayer, input.feeAccountOwner, mint)] : []),
  ];
  return { memo, feeMinor, payoutMinor, vault, pre };
}

/** Build and measure one candidate chunk. Returns null when any of its transactions would not fit. */
async function measure(input: BatchPlanInput, index: number, payees: BatchPayee[]): Promise<BatchChunk | null> {
  const transactionIndex = input.firstTransactionIndex + BigInt(index);
  const { memo, feeMinor, payoutMinor, vault, pre } = chunkInstructions(input, index, payees);
  const trace = [buildMemoInstruction(memo)];
  const budget = [...computeBudgetInstructions({ unitLimit: DEFAULT_UNIT_LIMITS.proposal, microLamports: 1n }), ...trace];
  let groups: TransactionInstruction[][];
  try {
    const proposal = buildVaultProposal({ multisigPda: input.multisigPda, transactionIndex, member: input.member, feePayer: input.feePayer, innerInstructions: vault });
    groups = groupProposalTransactions(proposal, input.feePayer, input.sizingBlockhash, budget);
  } catch {
    return null;
  }
  const execute = await buildVaultExecuteInstruction({ multisigPda: input.multisigPda, transactionIndex, member: input.member, innerInstructions: vault });
  const unitLimit = Math.min(MAX_UNIT_LIMIT, DEFAULT_UNIT_LIMITS.execute + 40_000 * payees.length);
  const executeTx = buildSponsoredTransaction(input.feePayer, [...computeBudgetInstructions({ unitLimit, microLamports: 1n }), ...pre, execute], input.sizingBlockhash);
  let executeSize: number;
  try {
    executeSize = transactionSize(executeTx);
  } catch {
    return null; // too many accounts to even serialize
  }
  const proposalSizes = groups.map((g) => transactionSize(buildSponsoredTransaction(input.feePayer, g, input.sizingBlockhash)));
  if (executeSize > MAX_TRANSACTION_BYTES || proposalSizes.some((n) => n > MAX_TRANSACTION_BYTES)) return null;
  return { index, memo, transactionIndex, payees, payoutMinor, feeMinor, vaultInstructions: vault, preExecuteInstructions: pre, traceInstructions: trace, sizes: { proposal: proposalSizes, execute: executeSize } };
}

/**
 * Split a batch into chunks that each fit, greedily, in order. Refuses a payee that cannot fit even
 * alone, a Splash key as a payee, and a duplicate deposit address within the batch.
 */
export async function planBatchChunks(input: BatchPlanInput): Promise<BatchChunk[]> {
  if (!BATCH_ID.test(input.batchId)) throw new BatchPlanError('batch id must be bat_ + 16 hex');
  if (input.payees.length === 0) throw new BatchPlanError('a batch needs at least one payee');
  const seen = new Set<string>();
  for (const p of input.payees) {
    if (p.amountMinor <= 0n) throw new BatchPlanError(`payee ${p.id}: amount must be positive`);
    if (p.splashFeeMinor < 0n) throw new BatchPlanError(`payee ${p.id}: fee cannot be negative`);
    try {
      assertPayoutDestination(p.depositAddress, p.depositAddress, [...input.splashKeys, input.feeAccountOwner.toBase58()], [input.vaultPda, input.feePayer]);
    } catch (e) {
      throw new BatchPlanError(`payee ${p.id}: ${(e as Error).message}`);
    }
    if (seen.has(p.depositAddress)) throw new BatchPlanError(`payee ${p.id}: the same deposit address appears twice`);
    seen.add(p.depositAddress);
  }
  const chunks: BatchChunk[] = [];
  let current: BatchChunk | null = null;
  let members: BatchPayee[] = [];
  for (const payee of input.payees) {
    const candidate = await measure(input, chunks.length, [...members, payee]);
    if (candidate) {
      current = candidate;
      members = candidate.payees;
      continue;
    }
    if (!current) throw new BatchPlanError(`payee ${payee.id} does not fit in a transaction even alone`);
    chunks.push(current);
    const alone = await measure(input, chunks.length, [payee]);
    if (!alone) throw new BatchPlanError(`payee ${payee.id} does not fit in a transaction even alone`);
    current = alone;
    members = [payee];
  }
  chunks.push(current!);
  return chunks;
}

/** What a batch costs, from its chunks: payouts and fees are conserved across the split. */
export function batchTotals(chunks: BatchChunk[]): { payees: number; payoutMinor: bigint; feeMinor: bigint } {
  return {
    payees: chunks.reduce((a, c) => a + c.payees.length, 0),
    payoutMinor: chunks.reduce((a, c) => a + c.payoutMinor, 0n),
    feeMinor: chunks.reduce((a, c) => a + c.feeMinor, 0n),
  };
}
