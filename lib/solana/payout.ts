/**
 * Payout from the Squads vault to the payout partner's one-payment Solana deposit address.
 *
 * Shape of a payout (the execute transaction):
 *   outer:  ATA CreateIdempotent for the partner deposit owner (payer = Kora fee payer: ATA rent)
 *   vault:  USDC transferChecked vault ATA -> partner deposit ATA (6 decimals),
 *           + a Solana Pay style reference key (read-only, non-signer) on the transfer,
 *           + SPL Memo "splash:v1:<commitmentHex>"
 *   outer:  the same memo again, top level, because RPC `getSignaturesForAddress().memo` is filled
 *           from top-level memo instructions (inner CPI memos are not reliably surfaced).
 * The vault-level memo is the one the approver signed; the outer copy is for indexing only and the
 * reconciler must compare the two.
 *
 * Verified vs unverified:
 *   - Instruction layouts (transferChecked = tag 12 | u64 LE | u8 decimals; ATA CreateIdempotent =
 *     tag 1; Memo = raw UTF-8) follow the SPL programs and Mysten's cctp-kit; tests decode them.
 *   - The partner ATA is derived with allowOwnerOffCurve semantics (owners may be PDAs).
 *   - Not yet executed on devnet; run scripts/solana-devnet-e2e.ts.
 *
 * Invariants enforced here: I-2 (destination is exactly the partner's deposit address and never a
 * Splash key) and I-5 (memo carries only the salted commitment).
 */
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

import { PROGRAM_IDS, USDC_DECIMALS, usdcMint } from './config.ts';
import type { Cluster } from './types.ts';

export const SPLASH_MEMO_PREFIX = 'splash:v1:';
const COMMITMENT_RE = /^[0-9a-f]{64}$/;
const MEMO_RE = /^splash:v1:[0-9a-f]{64}$/;
const U64_MAX = (1n << 64n) - 1n;

/** I-5: the only memo Splash ever writes. commitmentHex = sha256(salt || canonical invoice), lowercase hex. */
export function buildSplashMemo(commitmentHex: string): string {
  if (typeof commitmentHex !== 'string' || !COMMITMENT_RE.test(commitmentHex)) {
    throw new Error('Memo refused: commitment must be 64 lowercase hex chars (sha256), never an invoice number or name');
  }
  return `${SPLASH_MEMO_PREFIX}${commitmentHex}`;
}

export function isSplashMemo(memo: string): boolean {
  return MEMO_RE.test(memo);
}

export function assertSplashMemo(memo: string): void {
  if (!isSplashMemo(memo)) throw new Error('Memo refused: only "splash:v1:<sha256 hex>" is allowed');
}

/** SPL Memo with no signer accounts. Rejects anything but a Splash commitment memo. */
export function buildMemoInstruction(memo: string): TransactionInstruction {
  assertSplashMemo(memo);
  return new TransactionInstruction({ programId: PROGRAM_IDS.memo, keys: [], data: Buffer.from(memo, 'utf8') });
}

export function getAssociatedTokenAddress(mint: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), PROGRAM_IDS.token.toBuffer(), mint.toBuffer()], PROGRAM_IDS.associatedToken)[0];
}

export function buildCreateAtaIdempotentInstruction(payer: PublicKey, owner: PublicKey, mint: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_IDS.associatedToken,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: getAssociatedTokenAddress(mint, owner), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: PROGRAM_IDS.token, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

export interface TransferCheckedParams {
  source: PublicKey;
  mint: PublicKey;
  destination: PublicKey;
  owner: PublicKey;
  amount: bigint;
  decimals: number;
  /** Extra read-only non-signer keys (Solana Pay reference). The Token program ignores them. */
  references?: PublicKey[];
}

export function buildTransferCheckedInstruction(p: TransferCheckedParams): TransactionInstruction {
  if (p.amount <= 0n || p.amount > U64_MAX) throw new Error('Transfer amount must be in 1..u64::MAX minor units');
  const data = Buffer.alloc(10);
  data.writeUInt8(12, 0);
  data.writeBigUInt64LE(p.amount, 1);
  data.writeUInt8(p.decimals, 9);
  return new TransactionInstruction({
    programId: PROGRAM_IDS.token,
    keys: [
      { pubkey: p.source, isSigner: false, isWritable: true },
      { pubkey: p.mint, isSigner: false, isWritable: false },
      { pubkey: p.destination, isSigner: false, isWritable: true },
      { pubkey: p.owner, isSigner: true, isWritable: false },
      ...(p.references ?? []).map((r) => ({ pubkey: r, isSigner: false, isWritable: false })),
    ],
    data,
  });
}

export function decodeTransferChecked(data: Uint8Array): { amount: bigint; decimals: number } {
  const b = Buffer.from(data);
  if (b.length !== 10 || b[0] !== 12) throw new Error('Not a transferChecked instruction');
  return { amount: b.readBigUInt64LE(1), decimals: b.readUInt8(9) };
}

export interface PayoutParams {
  cluster: Cluster;
  /** Squads vault PDA (index 0): owner of the source USDC account. */
  vaultPda: PublicKey;
  /** Kora fee payer: pays ATA rent only. */
  feePayer: PublicKey;
  /** The partner's one-payment deposit address (a wallet owner) the payout is sent to. */
  destination: string;
  /** The deposit address from the quote (RouteQuote.target.depositAddress). Must equal `destination`. */
  expectedDepositAddress: string;
  amountMinor: bigint;
  commitmentHex: string;
  /** Unique per payment, for indexing (Solana Pay reference). */
  reference: PublicKey;
  /** Every Splash-controlled key: fee payer, server keys, any Splash wallet or token account. */
  splashKeys: string[];
}

export interface PayoutPlan {
  /** Top-level instructions placed before vaultTransactionExecute (ATA create). */
  preExecuteInstructions: TransactionInstruction[];
  /** Instructions that go inside the Squads vault transaction (the approver signs these). */
  vaultInstructions: TransactionInstruction[];
  /** Top-level instructions placed after vaultTransactionExecute (memo copy for indexing). */
  postExecuteInstructions: TransactionInstruction[];
  memo: string;
  sourceTokenAccount: PublicKey;
  destinationOwner: PublicKey;
  destinationTokenAccount: PublicKey;
  mint: PublicKey;
}

/** I-2 check, separate so the route engine and evidence layer can call it too. */
export function assertPayoutDestination(destination: string, expectedDepositAddress: string, splashKeys: Iterable<string>, extraForbidden: PublicKey[] = []): PublicKey {
  let owner: PublicKey;
  try {
    owner = new PublicKey(destination);
  } catch {
    throw new Error('Payout refused: destination is not a valid Solana address');
  }
  if (destination !== expectedDepositAddress) throw new Error('Payout refused (I-2): destination differs from the partner deposit address in the quote');
  if (owner.equals(PublicKey.default)) throw new Error('Payout refused: zero address');
  const deny = new Set(splashKeys);
  if (deny.has(destination)) throw new Error('Payout refused (I-2): destination is a Splash-controlled key');
  if (extraForbidden.some((k) => k.equals(owner))) throw new Error('Payout refused (I-2): destination is the vault or fee payer');
  return owner;
}

export function buildPayoutInstructions(p: PayoutParams): PayoutPlan {
  const mint = usdcMint(p.cluster);
  const destinationOwner = assertPayoutDestination(p.destination, p.expectedDepositAddress, p.splashKeys, [p.vaultPda, p.feePayer]);
  const destinationTokenAccount = getAssociatedTokenAddress(mint, destinationOwner);
  const deny = new Set(p.splashKeys);
  if (deny.has(destinationTokenAccount.toBase58())) throw new Error('Payout refused (I-2): destination token account is Splash-controlled');
  for (const key of p.splashKeys) {
    try {
      if (getAssociatedTokenAddress(mint, new PublicKey(key)).equals(destinationTokenAccount)) {
        throw new Error('Payout refused (I-2): destination token account belongs to a Splash key');
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Payout refused')) throw e;
    }
  }
  const sourceTokenAccount = getAssociatedTokenAddress(mint, p.vaultPda);
  if (sourceTokenAccount.equals(destinationTokenAccount)) throw new Error('Payout refused: source and destination are the same account');
  if (p.reference.equals(p.vaultPda) || p.reference.equals(p.feePayer) || p.reference.equals(destinationOwner)) {
    throw new Error('Reference key must be a fresh, unrelated public key');
  }
  const memo = buildSplashMemo(p.commitmentHex);
  return {
    preExecuteInstructions: [buildCreateAtaIdempotentInstruction(p.feePayer, destinationOwner, mint)],
    vaultInstructions: [
      buildTransferCheckedInstruction({
        source: sourceTokenAccount,
        mint,
        destination: destinationTokenAccount,
        owner: p.vaultPda,
        amount: p.amountMinor,
        decimals: USDC_DECIMALS,
        references: [p.reference],
      }),
      buildMemoInstruction(memo),
    ],
    postExecuteInstructions: [buildMemoInstruction(memo)],
    memo,
    sourceTokenAccount,
    destinationOwner,
    destinationTokenAccount,
    mint,
  };
}
