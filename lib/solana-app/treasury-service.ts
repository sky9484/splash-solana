/**
 * Treasury: the company's operating cash, in vault #1 of its own Squads multisig. Vault #0 pays
 * suppliers. Both are PDAs of the same multisig, with the same members and the same threshold, so
 * Splash holds no key to either, and only a person approving on a device moves USDC between them.
 *
 *   fund      offline, the simulator plays the faucet for the treasury; on devnet the company sends
 *             USDC to the treasury address itself
 *   prepare   one vault transaction from the source vault: transferChecked to the other vault's USDC
 *             account, with the memo `splash:move:v1:<move id>` (its own prefix: no supplier is paid
 *             and Splash takes no fee). Its proposal and execute go to the device in one prompt
 *   submit    sent in order, each signature written to the company record BEFORE it is broadcast; a
 *             pending send is checked, never resent. A failed execute is retried alone, at the same
 *             proposal index with a fresh blockhash, so an approved proposal is never left behind
 *
 * Kora pays the SOL fee (the company needs none); its rules are the same as for payments.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { PublicKey, VersionedTransaction, type TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';

import { usdcMint } from '../solana/config.ts';
import { computeBudgetInstructions, DEFAULT_UNIT_LIMITS } from '../solana/compute-budget.ts';
import { buildCreateAtaIdempotentInstruction, buildMemoInstruction, buildMoveMemo, buildTransferCheckedInstruction, getAssociatedTokenAddress } from '../solana/payout.ts';
import { isSimulator } from '../solana/simulator.ts';
import {
  buildSponsoredTransaction,
  buildVaultExecuteInstruction,
  buildVaultProposal,
  groupProposalTransactions,
  MAX_TRANSACTION_BYTES,
  PAYMENTS_VAULT_INDEX,
  TREASURY_VAULT_INDEX,
  transactionSize,
  vaultPdaAt,
} from '../solana/squads.ts';
import { saveCompany } from './company.ts';
import { awaitCommitment } from './confirm.ts';
import { ServiceError } from './errors.ts';
import { runtime } from './runtime.ts';
import { assertServiceable, budgeted, CIRCLE_FAUCET_URL, confirmWaitMs, deserializeIx, getOrg, moveSummary, requireVault, serializeIx, takeSponsorSlot } from './service.ts';
import type { MoveRecord, OrgRecord, VaultKind } from './store.ts';

/** Offline only: what the simulator's faucet adds to the treasury in one press. */
export const OFFLINE_TREASURY_FUND_MINOR = 100_000_000_000n; // US$100,000.00

const USDC_DECIMALS = 6;
const INDEX: Record<VaultKind, number> = { payments: PAYMENTS_VAULT_INDEX, treasury: TREASURY_VAULT_INDEX };
const NAME: Record<VaultKind, string> = { payments: 'payments vault', treasury: 'treasury' };

const hex = (n: number) => {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
};
const nowIso = (d = new Date()) => d.toISOString();
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

function moves(org: OrgRecord): MoveRecord[] {
  org.moves ??= [];
  return org.moves;
}

/** The two vaults of the company's multisig. */
export function vaultsOf(org: OrgRecord): Record<VaultKind, PublicKey> {
  const multisigPda = new PublicKey(requireVault(org).multisigPda);
  return { payments: vaultPdaAt(multisigPda, PAYMENTS_VAULT_INDEX), treasury: vaultPdaAt(multisigPda, TREASURY_VAULT_INDEX) };
}

export function getMove(orgId: string, moveId: string): MoveRecord {
  const m = moves(getOrg(orgId)).find((x) => x.id === moveId);
  if (!m) throw new ServiceError('payment_not_found', 'That move is not on the server for this company.', 404);
  return m;
}

/* ------------------------------------------------------------------ fund */

/** Offline: the simulator adds test USDC to the treasury. On devnet the company sends it, from the Circle faucet or its own wallet. */
export async function fundTreasury(orgId: string, now = new Date()) {
  const org = getOrg(orgId);
  const treasury = vaultsOf(org).treasury.toBase58();
  const rt = runtime();
  if (!isSimulator(rt.chain)) {
    throw new ServiceError('devnet_fund_manual', 'On devnet, send USDC to your treasury address from the Circle faucet or your own wallet.', 409, { vaultAddress: treasury, faucetUrl: CIRCLE_FAUCET_URL });
  }
  const receipt = await rt.chain.fundUsdc(treasury, OFFLINE_TREASURY_FUND_MINOR);
  org.treasuryFundings ??= [];
  org.treasuryFundings.push({ signature: receipt.signature, amountMinor: OFFLINE_TREASURY_FUND_MINOR, at: nowIso(now), simulated: true, note: 'Test USDC (simulated)' });
  return { receipt, balanceMinor: await rt.chain.getUsdcBalance(treasury) };
}

/* ------------------------------------------------------------------ prepare */

function assertApprover(org: OrgRecord, signer: string) {
  const vault = requireVault(org);
  if (!vault.members.some((m) => m.publicKey === signer && (m.role === 'admin_device' || m.role === 'approver_device'))) {
    throw new ServiceError('not_an_approver', 'That device is not an approver of this vault.', 403);
  }
  if (vault.threshold !== 1) {
    throw new ServiceError('wrong_state', 'Moves between vaults need a 1-of-N vault in this build: a second approver would need a second prompt.', 409);
  }
}

/** The move's inner instructions: one transferChecked between the company's own vaults, and its memo. */
function moveInstructions(org: OrgRecord, m: Pick<MoveRecord, 'id' | 'from' | 'to' | 'amountMinor'>, feePayer: PublicKey) {
  const rt = runtime();
  const mint = usdcMint(rt.env.cluster);
  const v = vaultsOf(org);
  const from = v[m.from];
  const to = v[m.to];
  const memo = buildMoveMemo(m.id);
  const vault: TransactionInstruction[] = [
    buildTransferCheckedInstruction({ source: getAssociatedTokenAddress(mint, from), mint, destination: getAssociatedTokenAddress(mint, to), owner: from, amount: m.amountMinor, decimals: USDC_DECIMALS }),
    buildMemoInstruction(memo),
  ];
  // The destination vault's USDC account, if it was never funded. Kora pays its rent, as for a payout.
  const pre = [buildCreateAtaIdempotentInstruction(feePayer, to, mint)];
  return { memo, vault, pre };
}

/**
 * The unsigned transactions this device signs: proposal and execute for a new move, or the execute
 * alone for a move whose proposal landed and whose execute did not.
 */
export async function prepareMove(
  orgId: string,
  /** A new move names the source vault and the amount; a retry names the failed move only. */
  input: { from?: VaultKind; amountMinor?: bigint; signer: string; by: string; retryMoveId?: string },
  now = new Date(),
) {
  assertServiceable(orgId);
  const org = getOrg(orgId);
  const vault = requireVault(org);
  assertApprover(org, input.signer);
  const rt = runtime();
  const multisigPda = new PublicKey(vault.multisigPda);
  const member = new PublicKey(input.signer);
  const feePayer = await rt.chain.getFeePayer();
  const list = moves(org);
  if (list.some((x) => x.state === 'sending' || x.state === 'checking')) {
    throw new ServiceError('wrong_state', 'Another move is still on its way. Wait for it to finish, then move again.', 409);
  }

  let m: MoveRecord;
  let proposalLanded = false;
  if (input.retryMoveId) {
    m = getMove(orgId, input.retryMoveId);
    if (m.state !== 'failed') throw new ServiceError('wrong_state', 'Only a move that failed can be retried.', 409);
    proposalLanded = m.calls.some((c) => c.step === 'proposal' && (c.status === 'confirmed' || c.status === 'finalized'));
    // A proposal that never landed used no index: it goes at the vault's next one.
    if (!proposalLanded) m.transactionIndex = await rt.chain.getNextTransactionIndex(multisigPda);
    m.problem = null;
  } else {
    if (input.from !== 'payments' && input.from !== 'treasury') throw new ServiceError('bad_request', 'Choose which vault to move from.');
    if (typeof input.amountMinor !== 'bigint' || input.amountMinor <= 0n) throw new ServiceError('bad_request', 'Enter an amount above zero.');
    const to: VaultKind = input.from === 'treasury' ? 'payments' : 'treasury';
    const available = await rt.chain.getUsdcBalance(vaultsOf(org)[input.from].toBase58());
    if (input.amountMinor > available) {
      throw new ServiceError('insufficient_balance', `Your ${NAME[input.from]} holds less than that. Move what it holds or less.`, 409, { availableMinor: available.toString() });
    }
    // A prepared move nobody signed is replaced: only one move waits for this device at a time.
    for (const old of list.filter((x) => x.state === 'prepared')) {
      old.state = 'failed';
      old.prepared = null;
      old.problem = { code: 'replaced', message: 'Replaced by a newer move before it was approved. Nothing moved.' };
      old.updatedAt = nowIso(now);
    }
    const id = `mov_${hex(8)}`;
    m = {
      id,
      orgId,
      from: input.from,
      to,
      amountMinor: input.amountMinor,
      memo: '',
      transactionIndex: await rt.chain.getNextTransactionIndex(multisigPda),
      state: 'prepared',
      createdAt: nowIso(now),
      updatedAt: nowIso(now),
      createdBy: input.by,
      approvedBy: null,
      vault: [],
      preExecute: [],
      prepared: null,
      calls: [],
      problem: null,
    };
    const ixs = moveInstructions(org, m, feePayer);
    m.memo = ixs.memo;
    m.vault = ixs.vault.map(serializeIx);
    m.preExecute = ixs.pre.map(serializeIx);
    list.push(m);
  }

  const { blockhash, lastValidBlockHeight } = await rt.chain.getBlockhashWithExpiry();
  const vaultIndex = INDEX[m.from];
  const vaultIxs = m.vault.map(deserializeIx);
  const messages: NonNullable<MoveRecord['prepared']>['messages'] = [];
  const push = (step: 'proposal' | 'execute', part: number, ixs: TransactionInstruction[]) => {
    const tx = buildSponsoredTransaction(feePayer, ixs, blockhash);
    const size = transactionSize(tx);
    if (size > MAX_TRANSACTION_BYTES) throw new ServiceError('transaction_too_large', `The move is ${size} bytes, over the ${MAX_TRANSACTION_BYTES}-byte limit.`, 500);
    messages.push({ id: step === 'proposal' ? `p${part}` : 'x', step, part, txBase64: b64(tx.serialize()), messageBase64: b64(tx.message.serialize()), lastValidBlockHeight });
  };
  if (!proposalLanded) {
    const proposal = buildVaultProposal({ multisigPda, transactionIndex: m.transactionIndex, member, feePayer, innerInstructions: vaultIxs, vaultIndex });
    // The memo also sits at the top level of the proposal, so Solscan shows it on the first transaction.
    const placeholder = [...computeBudgetInstructions({ unitLimit: DEFAULT_UNIT_LIMITS.proposal, microLamports: 1n }), buildMemoInstruction(m.memo)];
    for (const [part, raw] of groupProposalTransactions(proposal, feePayer, blockhash, placeholder).entries()) {
      const budget = await budgeted(feePayer, raw.slice(2), blockhash, DEFAULT_UNIT_LIMITS.proposal, false);
      push('proposal', part, budget.ixs);
    }
  }
  const execute = await buildVaultExecuteInstruction({ multisigPda, transactionIndex: m.transactionIndex, member, innerInstructions: vaultIxs, vaultIndex });
  const budget = await budgeted(feePayer, [...m.preExecute.map(deserializeIx), execute], blockhash, DEFAULT_UNIT_LIMITS.execute + 40_000, false);
  push('execute', 0, budget.ixs);
  m.prepared = { signer: input.signer, messages };
  m.updatedAt = nowIso(now);
  return { move: moveSummary(m), signer: input.signer, messages: messages.map((x) => ({ id: x.id, step: x.step, messageBase64: x.messageBase64 })) };
}

/* ------------------------------------------------------------------ submit */

type Outcome = { status: 'confirmed' | 'finalized' } | { status: 'failed'; error: string } | { status: 'expired' } | { status: 'pending' };

/** Simulate, have the fee payer sign, write the signature to the move, THEN broadcast; wait for confirmed. */
async function sendMoveTx(m: MoveRecord, msg: NonNullable<MoveRecord['prepared']>['messages'][number], tx: VersionedTransaction): Promise<Outcome> {
  const rt = runtime();
  assertServiceable(m.orgId);
  const sim = await rt.chain.simulate(tx);
  if (!sim.ok) return { status: 'failed', error: sim.error ?? 'simulation failed' };
  const slot = await takeSponsorSlot(m.orgId);
  let signature: string | null = null;
  try {
    const receipt = await rt.chain.sendSponsored(tx, {
      orgId: m.orgId,
      onSigned: async (sig) => {
        m.calls.push({ step: msg.step, part: msg.part, signature: sig, lastValidBlockHeight: msg.lastValidBlockHeight, status: 'signed', at: nowIso() });
        signature = sig;
        await saveCompany(m.orgId); // recorded before broadcast: a restart polls this, never resends
      },
    });
    signature = receipt.signature;
  } catch (e) {
    if (!signature) {
      await slot.release();
      return { status: 'failed', error: (e as Error).message };
    }
  }
  const call = m.calls[m.calls.length - 1]!;
  const out = await awaitCommitment(rt.chain, { signature: signature!, lastValidBlockHeight: msg.lastValidBlockHeight, target: 'confirmed', timeoutMs: confirmWaitMs() });
  call.status = out.status === 'failed' ? 'failed' : out.status;
  if (out.status === 'failed') return { status: 'failed', error: out.err };
  return out.status === 'confirmed' || out.status === 'finalized' ? { status: out.status } : out.status === 'expired' ? { status: 'expired' } : { status: 'pending' };
}

export async function submitMove(orgId: string, moveId: string, input: { signatures: Array<{ id: string; signature: string }>; who: string }, now = new Date()): Promise<MoveRecord> {
  assertServiceable(orgId);
  const m = getMove(orgId, moveId);
  const prepared = m.prepared;
  if (!prepared) throw new ServiceError('not_prepared', 'Nothing to sign yet. Press move again.', 409);
  const signer = new PublicKey(prepared.signer);
  const byId = new Map(input.signatures.map((s) => [s.id, s.signature]));
  const signed = new Map<string, VersionedTransaction>();
  for (const msg of prepared.messages) {
    const sigB58 = byId.get(msg.id);
    if (!sigB58) throw new ServiceError('signature_required', 'Every transaction of the move needs this device’s signature. Nothing was sent.', 403);
    let sig: Uint8Array;
    try {
      sig = bs58.decode(sigB58);
    } catch {
      throw new ServiceError('signature_invalid', 'That signature is not readable. Nothing was sent.', 400);
    }
    let valid = false;
    try {
      valid = sig.length === 64 && ed25519.verify(sig, fromB64(msg.messageBase64), signer.toBytes());
    } catch {
      valid = false;
    }
    if (!valid) throw new ServiceError('signature_invalid', 'That signature is not from this vault’s device key. Nothing was sent.', 403);
    const tx = VersionedTransaction.deserialize(fromB64(msg.txBase64));
    tx.addSignature(signer, sig);
    signed.set(msg.id, tx);
  }
  // Claim the prepared set before anything is sent: a second submit of the same signatures finds nothing.
  m.prepared = null;
  m.state = 'sending';
  m.approvedBy = { who: input.who, keyPublic: prepared.signer, at: nowIso(now) };
  m.problem = null;
  await saveCompany(orgId);

  for (const msg of prepared.messages.filter((x) => x.step === 'proposal')) {
    const out = await sendMoveTx(m, msg, signed.get(msg.id)!);
    if (out.status === 'pending') {
      m.state = 'checking';
      m.problem = { code: 'uncertain', message: 'Checking whether the move’s proposal landed. Don’t move again yet; this updates on its own.' };
      return finish(m, now);
    }
    if (out.status !== 'confirmed' && out.status !== 'finalized') {
      m.state = 'failed';
      m.problem = { code: 'proposal_failed', message: `The move’s proposal did not land (${out.status === 'failed' ? out.error : 'it expired'}). Nothing moved. Try again.` };
      return finish(m, now);
    }
  }
  const exec = prepared.messages.find((x) => x.step === 'execute')!;
  const out = await sendMoveTx(m, exec, signed.get(exec.id)!);
  if (out.status === 'confirmed' || out.status === 'finalized') {
    m.state = 'confirmed';
  } else if (out.status === 'pending') {
    m.state = 'checking';
    m.problem = { code: 'uncertain', message: 'Checking whether the move landed. Don’t move again yet; this updates on its own.' };
  } else {
    m.state = 'failed';
    m.problem =
      out.status === 'failed'
        ? { code: 'execute_failed', message: `The transfer between your vaults failed (${out.error}). Nothing moved. Retry it.` }
        : { code: 'expired', message: 'The transfer between your vaults expired before it landed. Nothing moved. Retry it.' };
  }
  return finish(m, now);
}

async function finish(m: MoveRecord, now: Date): Promise<MoveRecord> {
  m.updatedAt = nowIso(now);
  await saveCompany(m.orgId);
  return m;
}

/** Poll a move whose outcome was unknown when the request ended; never sends anything. */
export async function resumeMove(orgId: string, moveId: string, now = new Date()): Promise<MoveRecord> {
  const m = getMove(orgId, moveId);
  if (m.state !== 'checking') return m;
  const last = m.calls[m.calls.length - 1];
  if (!last) return m;
  const out = await awaitCommitment(runtime().chain, { signature: last.signature, lastValidBlockHeight: last.lastValidBlockHeight, target: 'confirmed', timeoutMs: 0 });
  if (out.status === 'pending') return m;
  last.status = out.status === 'failed' ? 'failed' : out.status;
  if (out.status === 'confirmed' || out.status === 'finalized') {
    if (last.step === 'execute') {
      m.state = 'confirmed';
      m.problem = null;
    } else {
      m.state = 'failed';
      m.problem = { code: 'execute_missing', message: 'The proposal landed; the transfer was not sent. Retry it.' };
    }
  } else {
    m.state = 'failed';
    m.problem = { code: out.status, message: 'The move did not land. Nothing moved. Retry it.' };
  }
  return finish(m, now);
}
