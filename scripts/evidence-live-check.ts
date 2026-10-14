/**
 * Evidence layer, live: the opt-in check prompt 07 §4.5 asks for. Offline,
 * the same pipeline is covered by tests/solana-engine-evidence.test.mjs; this
 * script is the part that needs real Walrus (and, once the Seal allowlist is
 * published, real Seal) and is run by hand with keys:
 *
 *   WALRUS_PUBLISHER_URL=https://publisher.walrus-testnet.walrus.space \
 *   WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space \
 *     node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types \
 *       --import ./scripts/alias-hook.mjs scripts/evidence-live-check.ts --live
 *
 * Steps, each reported pass / fail / skipped:
 *   1. walrus   store a synthetic ciphertext (random bytes, no customer data),
 *               read it back through the aggregator, compare sha256
 *   2. root     walrus_blob_ids_root over the stored blob id(s), as the SAS v2
 *               anchor would carry it
 *   3. seal     encrypt to an allowlist with the live committee. Needs
 *               EVIDENCE_ALLOWLIST_OBJECT_ID, which exists only after the
 *               splash_evidence package is published (gate G1, Sebastian).
 *               Until then this step is skipped and says why. Decrypting is
 *               browser-only by design, so it is not attempted here.
 *
 * Without --live it prints the plan and touches no network. It never reads a
 * private key and prints no secret: URLs are reduced to their host.
 */
import { createHash, randomBytes } from 'node:crypto';

import { walrusBlobIdsRoot } from '../lib/solana-evidence/bundle.ts';

type Step = { step: string; status: 'pass' | 'fail' | 'skipped'; detail: string };

const live = process.argv.includes('--live');
const host = (url: string | undefined) => {
  if (!url) return '(unset)';
  try {
    return new URL(url).host;
  } catch {
    return '(unparseable url)';
  }
};

const plan = {
  walrusPublisher: host(process.env.WALRUS_PUBLISHER_URL),
  walrusAggregator: host(process.env.WALRUS_AGGREGATOR_URL),
  walrusEpochs: process.env.WALRUS_EPOCHS ?? '53 (default)',
  sealAllowlist: process.env.EVIDENCE_ALLOWLIST_OBJECT_ID ? 'set' : 'unset (step 3 will be skipped)',
};

if (!live) {
  console.log('Evidence live check — dry run (add --live to run against the network).');
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

if (process.env.USE_MOCK_APIS === 'true') {
  console.error('USE_MOCK_APIS=true would answer from the demo store; unset it for a live check.');
  process.exit(2);
}
if (!process.env.WALRUS_PUBLISHER_URL || !process.env.WALRUS_AGGREGATOR_URL) {
  console.error('Set WALRUS_PUBLISHER_URL and WALRUS_AGGREGATOR_URL (testnet endpoints are fine).');
  process.exit(2);
}

const steps: Step[] = [];
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// 1. Walrus round trip, on ciphertext-shaped random bytes.
const { storeEncryptedInvoice, retrieveBlob } = await import('../lib/evidence-sui/walrus.ts');
let blobId: string | null = null;
try {
  const ciphertext = randomBytes(256).toString('base64');
  const stored = await storeEncryptedInvoice(ciphertext);
  if (stored.mode !== 'live') throw new Error(`publisher answered in ${stored.mode} mode`);
  const read = await retrieveBlob(stored.blobId);
  const same = read?.encryptedData !== undefined && sha(read.encryptedData) === sha(ciphertext);
  blobId = stored.blobId;
  steps.push({ step: 'walrus', status: same ? 'pass' : 'fail', detail: `${stored.blobId} (${stored.sizeBytes} bytes) ${same ? 'read back identical' : 'read back DIFFERENT'}` });
} catch (error) {
  steps.push({ step: 'walrus', status: 'fail', detail: error instanceof Error ? error.message : String(error) });
}

// 2. The SAS v2 field, over what was stored.
if (blobId) {
  try {
    steps.push({ step: 'root', status: 'pass', detail: `walrus_blob_ids_root ${walrusBlobIdsRoot([blobId])}` });
  } catch (error) {
    steps.push({ step: 'root', status: 'fail', detail: `the publisher's blob id is not one the anchor accepts: ${error instanceof Error ? error.message : String(error)}` });
  }
} else {
  steps.push({ step: 'root', status: 'skipped', detail: 'no blob was stored' });
}

// 3. Seal encrypt to the org allowlist (gated on the published package).
const allowlistObjectId = process.env.EVIDENCE_ALLOWLIST_OBJECT_ID?.trim();
if (!allowlistObjectId) {
  steps.push({ step: 'seal', status: 'skipped', detail: 'EVIDENCE_ALLOWLIST_OBJECT_ID unset: the splash_evidence allowlist is not published yet (gate G1)' });
} else {
  try {
    const { liveSealAdapter } = await import('../lib/evidence-sui/seal.ts');
    const { ciphertext, policy } = await liveSealAdapter.encrypt(JSON.stringify({ check: 'evidence-live', at: new Date().toISOString() }), [], { allowlistObjectId });
    steps.push({ step: 'seal', status: policy.mode === 'live' ? 'pass' : 'fail', detail: `${policy.mode} encryption, ${ciphertext.length} chars, identity under ${allowlistObjectId.slice(0, 10)}…` });
  } catch (error) {
    steps.push({ step: 'seal', status: 'fail', detail: error instanceof Error ? error.message : String(error) });
  }
}

console.log(JSON.stringify({ plan, steps }, null, 2));
process.exitCode = steps.some((s) => s.status === 'fail') ? 1 : 0;
