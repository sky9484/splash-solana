/**
 * CCTP V2 `deposit_for_burn` FROM the Squads vault to Polygon (domain 7), minting native USDC to the
 * payout partner's EVM deposit address.
 *
 * Ported from Mysten Labs cctp-kit (Apache-2.0), packages/cctp-kit/src/engine/solana.ts at
 * MystenLabs/ts-sdks-incubation origin/pr53 (bb734b4): discriminator, Borsh layout and the account
 * list. Cross-checked against Circle's IDL and source in circlefin/solana-cctp-contracts (ec16e95):
 * examples/target/idl/token_messenger_minter_v2.json (discriminator [215,60,61,46,114,55,128,176],
 * 18 accounts, same order and flags) and add_remote_token_messenger.rs (the remote_token_messenger
 * seed is the decimal domain string).
 *
 * Changes from cctp-kit:
 *   - owner and event_rent_payer are the vault PDA (signed by Squads via invoke_signed), not a wallet;
 *   - message_sent_event_data is a Squads EPHEMERAL SIGNER PDA (getEphemeralSignerPda, index 0)
 *     instead of a fresh keypair, because a vault transaction cannot carry an extra keypair signer;
 *   - the instruction is returned for wrapping in a vault transaction, not sent.
 *
 * UNVERIFIED: a burn executed through Squads with an ephemeral event account has NOT been run on
 * devnet. Circle's source comments the event account as "any non-PDA uninitialized address"; an
 * ephemeral signer is a Squads PDA that signs via invoke_signed, which should satisfy Anchor's
 * `Signer` check, but this must be proven with scripts/solana-devnet-e2e.ts (SPLASH_E2E_CCTP=1).
 * Also UNVERIFIED: whether the vault PDA (event_rent_payer) can fund the event account's rent; it
 * needs a small SOL balance, which conflicts with "you don't need SOL" for this lane until solved.
 * Reclaiming that rent later needs `reclaim_event_account`, signed by the vault again.
 */
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

import { CCTP_DOMAINS, CCTP_FINALITY, PROGRAM_IDS, usdcMint } from './config.ts';
import { getAssociatedTokenAddress } from './payout.ts';
import { ephemeralSignerPdas } from './squads.ts';
import type { Cluster } from './types.ts';

export const DEPOSIT_FOR_BURN_DISCRIMINATOR = Uint8Array.from([215, 60, 61, 46, 114, 55, 128, 176]);
/** Destinations this build allows. Only Polygon. */
export const ALLOWED_DESTINATION_DOMAINS: readonly number[] = [CCTP_DOMAINS.polygon];

const U64_MAX = (1n << 64n) - 1n;

function pda(programId: PublicKey, seeds: Array<string | PublicKey>): PublicKey {
  return PublicKey.findProgramAddressSync(
    seeds.map((s) => (typeof s === 'string' ? Buffer.from(s, 'utf8') : s.toBuffer())),
    programId,
  )[0];
}

/** 0x-prefixed 20-byte EVM address -> 32 bytes, left-padded with zeros. Rejects the zero address. */
export function evmAddressToBytes32(address: string): Uint8Array {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Not a 20-byte 0x EVM address');
  const raw = Buffer.from(address.slice(2), 'hex');
  if (raw.every((b) => b === 0)) throw new Error('Refusing the EVM zero address');
  const out = new Uint8Array(32);
  out.set(raw, 12);
  return out;
}

export function bytes32ToEvmAddress(bytes: Uint8Array): string {
  if (bytes.length !== 32 || bytes.slice(0, 12).some((b) => b !== 0)) throw new Error('Not a left-padded EVM address');
  return `0x${Buffer.from(bytes.slice(12)).toString('hex')}`;
}

export type BurnSpeed = 'standard' | 'fast';

export interface DepositForBurnParams {
  cluster: Cluster;
  /** Squads vault PDA: owner of the burned USDC and rent payer of the event account. */
  vaultPda: PublicKey;
  /** The vault transaction PDA this burn will live in (for the ephemeral signer). */
  transactionPda: PublicKey;
  amountMinor: bigint;
  destinationDomain?: number;
  /** Partner's EVM deposit address (0x...). */
  mintRecipientEvm: string;
  /** The deposit address from the quote (RouteQuote.target.depositAddress). Must match (I-2). */
  expectedMintRecipientEvm: string;
  /** EVM addresses Splash controls; the mint recipient must not be one of them. */
  splashEvmAddresses?: string[];
  speed: BurnSpeed;
  /** Standard: must be 0. Fast: the fee Circle's API quoted, in USDC minor units (> 0). */
  maxFeeMinor?: bigint;
  /** Kora fee payer. Refused as event_rent_payer (I-3). Passed so the check is explicit. */
  feePayer: PublicKey;
}

export interface DepositForBurnPlan {
  instruction: TransactionInstruction;
  /** Squads ephemeral signer index 0 of `transactionPda`. */
  messageSentEventData: PublicKey;
  /** Pass to buildVaultProposal / buildVaultExecuteInstruction as `ephemeralSigners`. */
  ephemeralSigners: 1;
  burnTokenAccount: PublicKey;
  mintRecipient: Uint8Array;
  minFinalityThreshold: number;
  maxFeeMinor: bigint;
}

export function cctpAccounts(cluster: Cluster, owner: PublicKey, destinationDomain: number) {
  const mt = PROGRAM_IDS.cctpMessageTransmitterV2;
  const tmm = PROGRAM_IDS.cctpTokenMessengerMinterV2;
  const mint = usdcMint(cluster);
  return {
    mt,
    tmm,
    mint,
    senderAuthority: pda(tmm, ['sender_authority']),
    burnTokenAccount: getAssociatedTokenAddress(mint, owner),
    denylist: pda(tmm, ['denylist_account', owner]),
    messageTransmitter: pda(mt, ['message_transmitter']),
    tokenMessenger: pda(tmm, ['token_messenger']),
    remoteTokenMessenger: pda(tmm, ['remote_token_messenger', destinationDomain.toString()]),
    tokenMinter: pda(tmm, ['token_minter']),
    localToken: pda(tmm, ['local_token', mint]),
    eventAuthority: pda(tmm, ['__event_authority']),
  };
}

export function buildDepositForBurnInstruction(p: DepositForBurnParams): DepositForBurnPlan {
  const destinationDomain = p.destinationDomain ?? CCTP_DOMAINS.polygon;
  if (!ALLOWED_DESTINATION_DOMAINS.includes(destinationDomain)) throw new Error(`Destination domain ${destinationDomain} is not allowed`);
  if (p.amountMinor <= 0n || p.amountMinor > U64_MAX) throw new Error('Burn amount must be in 1..u64::MAX minor units');
  if (p.mintRecipientEvm.toLowerCase() !== p.expectedMintRecipientEvm.toLowerCase()) {
    throw new Error('Burn refused (I-2): mintRecipient differs from the partner deposit address in the quote');
  }
  if ((p.splashEvmAddresses ?? []).some((a) => a.toLowerCase() === p.mintRecipientEvm.toLowerCase())) {
    throw new Error('Burn refused (I-2): mintRecipient is a Splash-controlled address');
  }
  if (p.feePayer.equals(p.vaultPda)) throw new Error('Fee payer cannot be the vault');
  const mintRecipient = evmAddressToBytes32(p.mintRecipientEvm);
  const maxFee = p.maxFeeMinor ?? 0n;
  if (p.speed === 'standard' && maxFee !== 0n) throw new Error('Standard transfer: maxFee must be 0');
  if (p.speed === 'fast' && (maxFee <= 0n || maxFee >= p.amountMinor)) {
    throw new Error('Fast transfer: maxFee must be the fee quoted by Circle (> 0 and < amount)');
  }
  const minFinalityThreshold = p.speed === 'fast' ? CCTP_FINALITY.fast : CCTP_FINALITY.standard;
  const [eventData] = ephemeralSignerPdas(p.transactionPda, 1);
  const a = cctpAccounts(p.cluster, p.vaultPda, destinationDomain);

  const data = Buffer.alloc(8 + 8 + 4 + 32 + 32 + 8 + 4);
  let o = 0;
  data.set(DEPOSIT_FOR_BURN_DISCRIMINATOR, o); o += 8;
  data.writeBigUInt64LE(p.amountMinor, o); o += 8;
  data.writeUInt32LE(destinationDomain, o); o += 4;
  data.set(mintRecipient, o); o += 32;
  data.set(new Uint8Array(32), o); o += 32; // destination_caller = default: anyone may relay the mint
  data.writeBigUInt64LE(maxFee, o); o += 8;
  data.writeUInt32LE(minFinalityThreshold, o);

  const instruction = new TransactionInstruction({
    programId: a.tmm,
    data,
    keys: [
      { pubkey: p.vaultPda, isSigner: true, isWritable: false }, // owner
      { pubkey: p.vaultPda, isSigner: true, isWritable: true }, // event_rent_payer (vault, never the fee payer)
      { pubkey: a.senderAuthority, isSigner: false, isWritable: false },
      { pubkey: a.burnTokenAccount, isSigner: false, isWritable: true },
      { pubkey: a.denylist, isSigner: false, isWritable: false },
      { pubkey: a.messageTransmitter, isSigner: false, isWritable: true },
      { pubkey: a.tokenMessenger, isSigner: false, isWritable: false },
      { pubkey: a.remoteTokenMessenger, isSigner: false, isWritable: false },
      { pubkey: a.tokenMinter, isSigner: false, isWritable: false },
      { pubkey: a.localToken, isSigner: false, isWritable: true },
      { pubkey: a.mint, isSigner: false, isWritable: true },
      { pubkey: eventData, isSigner: true, isWritable: true }, // message_sent_event_data: Squads ephemeral signer
      { pubkey: a.mt, isSigner: false, isWritable: false },
      { pubkey: a.tmm, isSigner: false, isWritable: false },
      { pubkey: PROGRAM_IDS.token, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: a.eventAuthority, isSigner: false, isWritable: false },
      { pubkey: a.tmm, isSigner: false, isWritable: false }, // program (Anchor event CPI)
    ],
  });
  return {
    instruction,
    messageSentEventData: eventData,
    ephemeralSigners: 1,
    burnTokenAccount: a.burnTokenAccount,
    mintRecipient,
    minFinalityThreshold,
    maxFeeMinor: maxFee,
  };
}

export interface DecodedDepositForBurn {
  amount: bigint;
  destinationDomain: number;
  mintRecipient: Uint8Array;
  destinationCaller: Uint8Array;
  maxFee: bigint;
  minFinalityThreshold: number;
}

export function decodeDepositForBurn(data: Uint8Array): DecodedDepositForBurn {
  const b = Buffer.from(data);
  if (b.length !== 96 || !b.subarray(0, 8).equals(Buffer.from(DEPOSIT_FOR_BURN_DISCRIMINATOR))) throw new Error('Not a deposit_for_burn instruction');
  return {
    amount: b.readBigUInt64LE(8),
    destinationDomain: b.readUInt32LE(16),
    mintRecipient: new Uint8Array(b.subarray(20, 52)),
    destinationCaller: new Uint8Array(b.subarray(52, 84)),
    maxFee: b.readBigUInt64LE(84),
    minFinalityThreshold: b.readUInt32LE(92),
  };
}

/** Circle Iris (attestation) lookup URL for a Solana burn signature. Sandbox for devnet. */
export function irisMessagesUrl(cluster: Cluster, signature: string): string {
  const host = cluster === 'mainnet-beta' ? 'https://iris-api.circle.com' : 'https://iris-api-sandbox.circle.com';
  return `${host}/v2/messages/${CCTP_DOMAINS.solana}?transactionHash=${signature}`;
}
