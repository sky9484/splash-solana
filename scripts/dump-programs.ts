/**
 * Dump the on-chain programs the LiteSVM suite loads (prompt 07 §5.7). Run once, by Sky or
 * Sebastian, with devnet RPC access; commit what it writes. Read-only: it fetches public
 * accounts and signs nothing.
 *
 *   SOLANA_RPC_URL=https://api.devnet.solana.com \
 *     node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types \
 *       --import ./scripts/alias-hook.mjs scripts/dump-programs.ts
 *
 * Writes to tests/fixtures/programs/:
 *   squads_v4.so                    the Squads V4 program (ELF, from its ProgramData account)
 *   squads_program_config.json      the ProgramConfig PDA multisigCreateV2 reads (treasury, fee)
 *   manifest.json                   cluster, slot, sizes and sha256 of everything written
 *
 * SPL Token, Associated Token and Memo come with LiteSVM's default programs, so they are not
 * dumped. Equivalent CLI: `solana program dump -u devnet SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf
 * tests/fixtures/programs/squads_v4.so`.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { Connection, PublicKey } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

import { SOLANA_PROGRAMS } from '../lib/solana/config.ts';

const BPF_UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
/** UpgradeableLoaderState::ProgramData header: enum tag (4) + slot (8) + Option<Pubkey> (1 + 32). */
const PROGRAM_DATA_HEADER = 45;
const OUT = path.join(process.cwd(), 'tests', 'fixtures', 'programs');

const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || 'https://api.devnet.solana.com';
const connection = new Connection(rpcUrl, 'finalized');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function programBytes(programId: string): Promise<{ bytes: Uint8Array; programData: string; slot: number }> {
  const program = await connection.getAccountInfo(new PublicKey(programId));
  if (!program) throw new Error(`${programId} not found on this cluster`);
  if (program.owner.toBase58() !== BPF_UPGRADEABLE_LOADER) throw new Error(`${programId} is not an upgradeable-loader program`);
  // UpgradeableLoaderState::Program { programdata_address } = tag 2 (u32) + 32 bytes.
  if (program.data.readUInt32LE(0) !== 2) throw new Error(`${programId} account is not a Program`);
  const programData = new PublicKey(program.data.subarray(4, 36));
  const { context, value } = await connection.getAccountInfoAndContext(programData);
  if (!value) throw new Error(`ProgramData ${programData.toBase58()} not found`);
  if (value.data.readUInt32LE(0) !== 3) throw new Error('ProgramData account has an unexpected tag');
  return { bytes: new Uint8Array(value.data.subarray(PROGRAM_DATA_HEADER)), programData: programData.toBase58(), slot: context.slot };
}

mkdirSync(OUT, { recursive: true });
const host = (() => { try { return new URL(rpcUrl).host; } catch { return '(unparseable)'; } })();

const squads = await programBytes(SOLANA_PROGRAMS.squadsV4);
writeFileSync(path.join(OUT, 'squads_v4.so'), squads.bytes);

const [programConfigPda] = multisig.getProgramConfigPda({});
const config = await connection.getAccountInfo(programConfigPda);
if (!config) throw new Error('Squads ProgramConfig not found on this cluster');
const configJson = {
  address: programConfigPda.toBase58(),
  owner: config.owner.toBase58(),
  lamports: config.lamports,
  executable: config.executable,
  dataBase64: Buffer.from(config.data).toString('base64'),
};
writeFileSync(path.join(OUT, 'squads_program_config.json'), `${JSON.stringify(configJson, null, 2)}\n`);

const manifest = {
  dumpedAt: new Date().toISOString(),
  rpcHost: host,
  squadsV4: {
    programId: SOLANA_PROGRAMS.squadsV4,
    programData: squads.programData,
    slot: squads.slot,
    bytes: squads.bytes.length,
    sha256: sha(squads.bytes),
  },
  programConfig: { address: configJson.address, bytes: config.data.length, sha256: sha(config.data) },
};
writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
