/**
 * Squads V4 vault: an AUTONOMOUS multisig (configAuthority = null) whose members are only the
 * client's own keys. Splash is never a member (I-1). Built with @sqds/multisig 2.1.4 on web3.js v1.
 *
 * Verified vs unverified:
 *   - Instruction building is tested offline: program id, signer/writable flags, and the
 *     instruction data decoded with the SDK's own `generated` beet codecs.
 *   - `buildVaultExecuteInstruction` recompiles the vault message locally (same SDK function the
 *     on-chain create used), so it needs no RPC. Against a live vault prefer
 *     `buildVaultExecuteInstructionFromChain`, which reads the stored message.
 *   - Squads v4 program rule (programs/squads_multisig_program/src/utils/executable_transaction_message.rs):
 *     an inner signer that is neither the vault nor an ephemeral PDA must also sign the outer
 *     transaction. So the Kora fee payer must never appear inside a vault message; kora.ts enforces it.
 *   - multisigCreateV2 charges ProgramConfig.multisigCreationFee from `creator` to the Squads
 *     treasury. Creator = Kora fee payer here, so that fee is a SOL outflow from the fee payer.
 *     The fee value on devnet/mainnet is UNVERIFIED; the e2e script reads it and stops if > 0.
 *   - Nothing here has run on devnet yet (no RPC in this container).
 */
import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type Connection,
} from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

import { PROGRAM_IDS } from './config.ts';
import type { VaultInfo } from './types.ts';

const { Permissions } = multisig.types;
export const SQUADS_PROGRAM_ID = PROGRAM_IDS.squadsV4;

export type VaultMode = 'solo' | 'dual';
export type MemberRole = VaultInfo['members'][number]['role'];

export interface MemberSpec {
  role: MemberRole;
  publicKey: string;
  /** Free text a UI might attach; validated so nothing named "Splash" is ever a member. */
  label?: string;
  /** Set by any caller that knows the key is Splash-controlled. Always refused. */
  splash?: boolean;
}

export interface MembershipCheck {
  ok: boolean;
  errors: string[];
}

const SOLO_ROLES: MemberRole[] = ['admin_device', 'recovery_kit_a'];
const DUAL_ROLES: MemberRole[] = ['admin_device', 'approver_device', 'recovery_kit_a', 'recovery_kit_b'];

export function thresholdFor(mode: VaultMode): number {
  return mode === 'solo' ? 1 : 2;
}

/**
 * Membership rules (I-1 and the vault design):
 *   - no member flagged `splash`, labelled with "splash", or present in the Splash key deny list
 *     (which must include the Kora fee payer and every Splash server key);
 *   - every key is a valid, distinct public key;
 *   - solo: exactly admin device + kit A (threshold 1);
 *   - dual: exactly admin device, approver device, kit A, kit B (threshold 2), admin != approver,
 *     exactly two kits.
 */
export function validateMembership(mode: VaultMode, members: MemberSpec[], splashKeys: Iterable<string> = []): MembershipCheck {
  const errors: string[] = [];
  const deny = new Set([...splashKeys].map((k) => k.trim()));
  const keys = new Set<string>();
  for (const m of members) {
    let pk: PublicKey | null = null;
    try {
      pk = new PublicKey(m.publicKey);
    } catch {
      errors.push(`${m.role}: not a valid public key`);
    }
    if (pk && pk.equals(PublicKey.default)) errors.push(`${m.role}: the zero key cannot be a member`);
    if (m.splash) errors.push(`${m.role}: a Splash-controlled key cannot be a member`);
    if (m.label && /splash/i.test(m.label)) errors.push(`${m.role}: a member labelled "${m.label}" looks Splash-controlled`);
    if (deny.has(m.publicKey)) errors.push(`${m.role}: key is on the Splash key deny list`);
    if (keys.has(m.publicKey)) errors.push(`${m.role}: duplicate key`);
    keys.add(m.publicKey);
  }
  const roles = members.map((m) => m.role).sort();
  const expected = [...(mode === 'solo' ? SOLO_ROLES : DUAL_ROLES)].sort();
  if (roles.join(',') !== expected.join(',')) {
    errors.push(`${mode} mode needs exactly [${expected.join(', ')}], got [${roles.join(', ')}]`);
  }
  if (mode === 'dual') {
    const admin = members.find((m) => m.role === 'admin_device');
    const approver = members.find((m) => m.role === 'approver_device');
    if (admin && approver && admin.publicKey === approver.publicKey) errors.push('dual mode: admin and approver must be different devices');
    const kits = members.filter((m) => m.role === 'recovery_kit_a' || m.role === 'recovery_kit_b');
    if (kits.length !== 2) errors.push('dual mode: exactly two recovery kits are required');
  }
  return { ok: errors.length === 0, errors };
}

export function assertMembership(mode: VaultMode, members: MemberSpec[], splashKeys: Iterable<string> = []): void {
  const r = validateMembership(mode, members, splashKeys);
  if (!r.ok) throw new Error(`Vault membership refused: ${r.errors.join('; ')}`);
}

export interface VaultAddresses {
  multisigPda: PublicKey;
  vaultPda: PublicKey;
}

export function deriveVaultAddresses(createKey: PublicKey, vaultIndex = 0, programId = SQUADS_PROGRAM_ID): VaultAddresses {
  const [multisigPda] = multisig.getMultisigPda({ createKey, programId });
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: vaultIndex, programId });
  return { multisigPda, vaultPda };
}

export interface CreateVaultParams {
  mode: VaultMode;
  members: MemberSpec[];
  /** Fresh keypair's public key; it must sign the create transaction once and is then discarded. */
  createKey: PublicKey;
  /** Kora fee payer: pays the network fee and the multisig account rent. Never a member. */
  feePayer: PublicKey;
  /** Squads ProgramConfig.treasury (read from chain in devnet mode). */
  treasury: PublicKey;
  /** Every Splash-controlled key (fee payer included automatically). */
  splashKeys?: string[];
  programId?: PublicKey;
}

export interface CreateVaultPlan {
  instruction: TransactionInstruction;
  multisigPda: PublicKey;
  vaultPda: PublicKey;
  vault: VaultInfo;
  /** Public keys that must sign: the fee payer (Kora) and the create key. */
  requiredSigners: PublicKey[];
}

/** Fresh create key. Callers sign with it once and drop it; it gains no authority. */
export function newCreateKey(): Keypair {
  return Keypair.generate();
}

/** Build multisigCreateV2 for an autonomous vault: configAuthority null, timeLock 0, rentCollector null. */
export function buildCreateVaultInstruction(p: CreateVaultParams): CreateVaultPlan {
  const programId = p.programId ?? SQUADS_PROGRAM_ID;
  const splashKeys = [...(p.splashKeys ?? []), p.feePayer.toBase58()];
  assertMembership(p.mode, p.members, splashKeys);
  if (p.members.some((m) => m.publicKey === p.createKey.toBase58())) throw new Error('createKey must not be a member');
  const threshold = thresholdFor(p.mode);
  const { multisigPda, vaultPda } = deriveVaultAddresses(p.createKey, 0, programId);
  const instruction = multisig.instructions.multisigCreateV2({
    treasury: p.treasury,
    creator: p.feePayer,
    multisigPda,
    configAuthority: null,
    threshold,
    members: p.members.map((m) => ({ key: new PublicKey(m.publicKey), permissions: Permissions.all() })),
    timeLock: 0,
    createKey: p.createKey,
    rentCollector: null,
    programId,
  });
  return {
    instruction,
    multisigPda,
    vaultPda,
    requiredSigners: [p.feePayer, p.createKey],
    vault: {
      multisigPda: multisigPda.toBase58(),
      vaultPda: vaultPda.toBase58(),
      threshold,
      members: p.members.map((m) => ({ role: m.role, publicKey: m.publicKey })),
      configAuthority: null,
    },
  };
}

/* ---------------------------------------------------------------- proposals */

/** The inner message Squads stores. Payer is the vault; the blockhash is ignored by Squads. */
export function buildVaultTransactionMessage(vaultPda: PublicKey, instructions: TransactionInstruction[]): TransactionMessage {
  if (instructions.length === 0) throw new Error('A vault transaction needs at least one instruction');
  return new TransactionMessage({ payerKey: vaultPda, recentBlockhash: PublicKey.default.toBase58(), instructions });
}

export function ephemeralSignerPdas(transactionPda: PublicKey, count: number, programId = SQUADS_PROGRAM_ID): PublicKey[] {
  return Array.from({ length: count }, (_, i) => multisig.getEphemeralSignerPda({ transactionPda, ephemeralSignerIndex: i, programId })[0]);
}

export interface ProposalAddresses {
  transactionPda: PublicKey;
  proposalPda: PublicKey;
  /** Ephemeral signer PDAs for this transaction index (index 0 first). */
  ephemeralSigners: PublicKey[];
}

export function deriveProposalAddresses(multisigPda: PublicKey, transactionIndex: bigint, ephemeralSigners = 0, programId = SQUADS_PROGRAM_ID): ProposalAddresses {
  const [transactionPda] = multisig.getTransactionPda({ multisigPda, index: transactionIndex, programId });
  const [proposalPda] = multisig.getProposalPda({ multisigPda, transactionIndex, programId });
  return { transactionPda, proposalPda, ephemeralSigners: ephemeralSignerPdas(transactionPda, ephemeralSigners, programId) };
}

export interface VaultProposalParams {
  multisigPda: PublicKey;
  /** multisig.transactionIndex + 1, read from chain (1n for a fresh vault). */
  transactionIndex: bigint;
  /** The member proposing and approving: the person's device key. */
  member: PublicKey;
  /** Kora fee payer: rent for the transaction and proposal accounts. */
  feePayer: PublicKey;
  innerInstructions: TransactionInstruction[];
  /** How many Squads ephemeral signer PDAs the inner instructions use (1 for a CCTP burn). */
  ephemeralSigners?: number;
  vaultIndex?: number;
  programId?: PublicKey;
}

export interface VaultProposalPlan extends ProposalAddresses {
  vaultPda: PublicKey;
  message: TransactionMessage;
  create: TransactionInstruction;
  proposalCreate: TransactionInstruction;
  approve: TransactionInstruction;
}

/**
 * vaultTransactionCreate + proposalCreate + proposalApprove for an arbitrary inner instruction
 * list. Refuses an inner message that references the fee payer: Squads would pass the outer fee
 * payer signature through to the inner instruction (see header).
 */
export function buildVaultProposal(p: VaultProposalParams): VaultProposalPlan {
  const programId = p.programId ?? SQUADS_PROGRAM_ID;
  const vaultIndex = p.vaultIndex ?? 0;
  const ephemeral = p.ephemeralSigners ?? 0;
  if (p.transactionIndex < 1n) throw new Error('transactionIndex starts at 1');
  const [vaultPda] = multisig.getVaultPda({ multisigPda: p.multisigPda, index: vaultIndex, programId });
  for (const ix of p.innerInstructions) {
    if (ix.keys.some((k) => k.pubkey.equals(p.feePayer))) throw new Error('The fee payer must not appear in a vault transaction');
    if (ix.programId.equals(programId)) throw new Error('A vault transaction must not call Squads itself');
  }
  const addresses = deriveProposalAddresses(p.multisigPda, p.transactionIndex, ephemeral, programId);
  const message = buildVaultTransactionMessage(vaultPda, p.innerInstructions);
  const create = multisig.instructions.vaultTransactionCreate({
    multisigPda: p.multisigPda,
    transactionIndex: p.transactionIndex,
    creator: p.member,
    rentPayer: p.feePayer,
    vaultIndex,
    ephemeralSigners: ephemeral,
    transactionMessage: message,
    programId,
  });
  const proposalCreate = multisig.instructions.proposalCreate({
    multisigPda: p.multisigPda,
    creator: p.member,
    rentPayer: p.feePayer,
    transactionIndex: p.transactionIndex,
    isDraft: false,
    programId,
  });
  const approve = buildProposalApprove(p.multisigPda, p.transactionIndex, p.member, programId);
  return { ...addresses, vaultPda, message, create, proposalCreate, approve };
}

export function buildProposalApprove(multisigPda: PublicKey, transactionIndex: bigint, member: PublicKey, programId = SQUADS_PROGRAM_ID): TransactionInstruction {
  return multisig.instructions.proposalApprove({ multisigPda, transactionIndex, member, programId });
}

export interface VaultExecuteParams {
  multisigPda: PublicKey;
  transactionIndex: bigint;
  /** Member with Execute permission who signs the execute transaction. */
  member: PublicKey;
  /** The same inner instructions passed to buildVaultProposal. */
  innerInstructions: TransactionInstruction[];
  ephemeralSigners?: number;
  vaultIndex?: number;
  programId?: PublicKey;
}

/**
 * vaultTransactionExecute without RPC: recompile the inner message with the SDK's own compiler
 * and derive remaining accounts exactly as `accountsForTransactionExecute` does. Only valid when
 * the inner message uses no address lookup tables (ours never do).
 */
export async function buildVaultExecuteInstruction(p: VaultExecuteParams): Promise<TransactionInstruction> {
  const programId = p.programId ?? SQUADS_PROGRAM_ID;
  const vaultIndex = p.vaultIndex ?? 0;
  const [vaultPda] = multisig.getVaultPda({ multisigPda: p.multisigPda, index: vaultIndex, programId });
  const { transactionPda, proposalPda } = deriveProposalAddresses(p.multisigPda, p.transactionIndex, 0, programId);
  const bytes = multisig.utils.transactionMessageToMultisigTransactionMessageBytes({
    message: buildVaultTransactionMessage(vaultPda, p.innerInstructions),
    vaultPda,
  });
  const [message] = multisig.types.transactionMessageBeet.deserialize(Buffer.from(bytes));
  if (message.addressTableLookups.length > 0) throw new Error('Offline execute does not support lookup tables');
  const { accountMetas } = await multisig.utils.accountsForTransactionExecute({
    connection: undefined as unknown as Connection, // unused without lookup tables
    message: message as unknown as multisig.generated.VaultTransactionMessage,
    ephemeralSignerBumps: new Array<number>(p.ephemeralSigners ?? 0).fill(0),
    vaultPda,
    transactionPda,
    programId,
  });
  return multisig.generated.createVaultTransactionExecuteInstruction(
    { multisig: p.multisigPda, member: p.member, proposal: proposalPda, transaction: transactionPda, anchorRemainingAccounts: accountMetas },
    programId,
  );
}

/** vaultTransactionExecute from the on-chain stored message (devnet mode). */
export async function buildVaultExecuteInstructionFromChain(
  connection: Connection,
  multisigPda: PublicKey,
  transactionIndex: bigint,
  member: PublicKey,
  programId = SQUADS_PROGRAM_ID,
): Promise<{ instruction: TransactionInstruction; lookupTableAccounts: AddressLookupTableAccount[] }> {
  return multisig.instructions.vaultTransactionExecute({ connection, multisigPda, transactionIndex, member, programId });
}

/** v0 transaction with the Kora fee payer in slot 0. Nobody has signed yet. */
export function buildSponsoredTransaction(feePayer: PublicKey, instructions: TransactionInstruction[], recentBlockhash: string): VersionedTransaction {
  const message = new TransactionMessage({ payerKey: feePayer, recentBlockhash, instructions }).compileToV0Message();
  return new VersionedTransaction(message);
}

/** Solana's packet limit for a serialized transaction. */
export const MAX_TRANSACTION_BYTES = 1232;

export function transactionSize(tx: VersionedTransaction): number {
  return tx.serialize().length;
}

/**
 * Group the proposal instructions into as few transactions as fit the packet limit:
 * [create, proposalCreate, approve] when it fits, else [create] then [proposalCreate, approve].
 * A CCTP burn proposal measures 1202 bytes in one transaction (tests), so a priority-fee
 * instruction can push it over; this keeps the flow working either way.
 */
export function groupProposalTransactions(plan: VaultProposalPlan, feePayer: PublicKey, recentBlockhash: string, prefix: TransactionInstruction[] = []): TransactionInstruction[][] {
  const all = [...prefix, plan.create, plan.proposalCreate, plan.approve];
  if (transactionSize(buildSponsoredTransaction(feePayer, all, recentBlockhash)) <= MAX_TRANSACTION_BYTES) return [all];
  const first = [...prefix, plan.create];
  if (transactionSize(buildSponsoredTransaction(feePayer, first, recentBlockhash)) > MAX_TRANSACTION_BYTES) {
    throw new Error('vaultTransactionCreate alone exceeds the transaction size limit; use a Squads transaction buffer');
  }
  return [first, [...prefix, plan.proposalCreate, plan.approve]];
}

/* ---------------------------------------------------------------- autonomy check */

export interface MultisigSummary {
  configAuthority: string | null;
  threshold: number;
  timeLock: number;
  transactionIndex: bigint;
  members: Array<{ publicKey: string; mask: number }>;
}

export function decodeMultisigAccount(data: Uint8Array): MultisigSummary {
  const [account] = multisig.accounts.Multisig.deserialize(Buffer.from(data));
  const ca = account.configAuthority;
  return {
    configAuthority: ca.equals(PublicKey.default) ? null : ca.toBase58(),
    threshold: account.threshold,
    timeLock: account.timeLock,
    transactionIndex: BigInt(account.transactionIndex.toString()),
    members: account.members.map((m) => ({ publicKey: m.key.toBase58(), mask: m.permissions.mask })),
  };
}

/**
 * Assert the on-chain multisig is autonomous and matches expectations: configAuthority is the
 * default key (Squads' "none"), timeLock 0, threshold sane, no Splash key among members and,
 * when given, exactly the expected members.
 */
export function assertAutonomous(
  data: Uint8Array,
  opts: { splashKeys?: Iterable<string>; expectedMembers?: string[]; expectedThreshold?: number } = {},
): MultisigSummary {
  const s = decodeMultisigAccount(data);
  if (s.configAuthority !== null) throw new Error(`Multisig is not autonomous: configAuthority is ${s.configAuthority}`);
  if (s.timeLock !== 0) throw new Error(`Unexpected timeLock ${s.timeLock}`);
  const voters = s.members.filter((m) => (m.mask & multisig.types.Permission.Vote) !== 0).length;
  if (s.threshold < 1 || s.threshold > voters) throw new Error(`Threshold ${s.threshold} is outside 1..${voters}`);
  if (opts.expectedThreshold !== undefined && s.threshold !== opts.expectedThreshold) throw new Error(`Threshold ${s.threshold} != expected ${opts.expectedThreshold}`);
  const deny = new Set(opts.splashKeys ?? []);
  for (const m of s.members) if (deny.has(m.publicKey)) throw new Error(`Splash key ${m.publicKey} is a member`);
  if (opts.expectedMembers) {
    const got = s.members.map((m) => m.publicKey).sort().join(',');
    const want = [...opts.expectedMembers].sort().join(',');
    if (got !== want) throw new Error('Multisig members differ from the expected set');
  }
  return s;
}
