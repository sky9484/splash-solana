import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

import { evidenceSuiClient, evidenceSuiNetwork } from '@/lib/evidence-sui/client';

/**
 * The Sui gas sponsor for the evidence allowlist, and for nothing else
 * (prompt 07 §4.1, §4.4).
 *
 * A member's allowlist update (add or remove a member, grant an auditor) is a
 * Sui transaction whose SENDER is the member's own Sui address, signed by
 * their device key. Splash pays the gas as sponsor so no member needs SUI.
 * The sponsor:
 *   - is never an allowlist member and has no capability that adds itself
 *     (enforced in move/splash_evidence);
 *   - signs only transactions whose every command is a call into the
 *     evidence package's `allowlist` module (assertSponsorable below), so its
 *     gas coin cannot be spent on anything else;
 *   - is called only after the route has checked an authenticated member
 *     session.
 * It holds only gas money and can move no customer funds.
 *
 * Keys: devnet/testnet from EVIDENCE_SPONSOR_SUI_PRIVATE_KEY. Production must
 * come from a KMS (TODO below): an env private key is refused on mainnet.
 */

export interface EvidenceSponsor {
  /** The sponsor's Sui address (gas owner). */
  address(): Promise<string>;
  /** Sign sponsored transaction bytes (TransactionData) as the gas owner. Returns a Sui serialized signature. */
  signTransaction(bytes: Uint8Array): Promise<string>;
}

export class SponsorRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SponsorRefusedError';
  }
}

/**
 * The sponsor's gas money, in MIST (1 SUI = 10^9 MIST), for the admin console. null when the Sui
 * node cannot be reached (the offline demo has no network). Reads only; holds no key.
 */
export async function sponsorBalanceMist(address: string): Promise<bigint | null> {
  try {
    const res = await evidenceSuiClient().core.getBalance({ owner: address });
    return BigInt(res.balance.balance);
  } catch {
    return null;
  }
}

/** Devnet/testnet only. null when no key is configured. */
export function evidenceSponsorFromEnv(env: NodeJS.ProcessEnv = process.env): EvidenceSponsor | null {
  const raw = env.EVIDENCE_SPONSOR_SUI_PRIVATE_KEY?.trim();
  if (!raw) return null;
  if (evidenceSuiNetwork(env) === 'mainnet') {
    // TODO(KMS): a production sponsor is an EvidenceSponsor backed by a KMS
    // signing key with two-person control, not a key in the environment.
    throw new SponsorRefusedError('The evidence sponsor on mainnet must come from a KMS, not EVIDENCE_SPONSOR_SUI_PRIVATE_KEY.');
  }
  const { scheme, secretKey } = decodeSuiPrivateKey(raw);
  if (scheme !== 'ED25519') throw new SponsorRefusedError(`EVIDENCE_SPONSOR_SUI_PRIVATE_KEY must be an Ed25519 key (got ${scheme}).`);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  return {
    async address() {
      return keypair.toSuiAddress();
    },
    async signTransaction(bytes) {
      return (await keypair.signTransaction(bytes)).signature;
    },
  };
}

/**
 * Refuse to sponsor anything but calls into `<packageId>::allowlist::*`. A
 * sponsored transaction that split the gas coin, transferred an object, or
 * called any other module would let a member spend Splash's gas money.
 */
export function assertSponsorable(transactionKindBytes: Uint8Array, evidencePackageId: string): void {
  if (!evidencePackageId) throw new SponsorRefusedError('The evidence package is not published yet; nothing can be sponsored.');
  const tx = Transaction.fromKind(transactionKindBytes);
  const commands = tx.getData().commands;
  if (commands.length === 0) throw new SponsorRefusedError('Empty transaction.');
  const want = normalizeId(evidencePackageId);
  for (const command of commands) {
    if (command.$kind !== 'MoveCall' || !command.MoveCall) {
      throw new SponsorRefusedError(`Only allowlist calls are sponsored; refused a ${command.$kind} command.`);
    }
    const call = command.MoveCall;
    if (normalizeId(call.package) !== want || call.module !== 'allowlist') {
      throw new SponsorRefusedError(`Only ${evidencePackageId}::allowlist calls are sponsored; refused ${call.package}::${call.module}::${call.function}.`);
    }
  }
}

function normalizeId(id: string): string {
  const hex = id.toLowerCase().replace(/^0x/, '');
  return `0x${hex.padStart(64, '0')}`;
}
