import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { Keypair } from '@solana/web3.js';
import { AccountRole } from '@solana/kit';
import {
  deriveAttestationPda,
  deriveCredentialPda,
  deriveSchemaPda,
  deserializeAttestationData,
  parseCreateAttestationInstruction,
  parseCreateCredentialInstruction,
  parseCreateSchemaInstruction,
} from 'sas-lib';

import { quoteRoutes } from '../lib/route-engine/index.ts';
import { tenThousandUsdPhpFixture, FIXTURE_NOW } from '../lib/route-engine/fixtures.ts';
import { canonicalJson, CanonicalJsonError } from '../lib/solana-evidence/canonical.ts';
import { buildLevels, hashLeaf, merkleProof, rootFromProof, expectedSiblingSides } from '../lib/solana-evidence/merkle.ts';
import {
  buildCorridorPayoutBundle,
  buildEvidenceBatch,
  bundleLeafHex,
  computeInvoiceCommitment,
  randomSalt,
  walrusBlobIdsRoot,
} from '../lib/solana-evidence/bundle.ts';
import {
  buildSasAnchor,
  buildMemoAnchor,
  parseMemoAnchor,
  rootSchemaAccount,
  toWeb3Instruction,
  validateSasDataLayout,
  assertAttesterIsolated,
  ROOT_SCHEMA_LAYOUT,
  SAS_PROGRAM_ID,
  MEMO_PROGRAM_ID,
} from '../lib/solana-evidence/anchor.ts';
import { verifyBundle, anchoredRootFromSas, anchoredRootFromMemo, decodeRootAttestationData } from '../lib/solana-evidence/verify.ts';
import { InMemoryEvidenceStore, createWalrusEvidenceStore } from '../lib/solana-evidence/store.ts';

const attester = Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey.toBase58();
const deviceKey = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey.toBase58();

const invoiceFields = {
  invoiceNumber: 'INV-0412',
  supplierName: 'Manila Freight Services Inc.',
  supplierBank: 'BDO Unibank, Inc.',
  supplierAccountLast4: '4471',
  amountPhpMinor: 57_400_000n,
  dueDate: '2026-10-30',
};

function payoutBundle(paymentSuffix = '', minuteOffset = 0) {
  const now = new Date(FIXTURE_NOW.getTime() + minuteOffset * 60_000);
  const { partner, payout, input } = tenThousandUsdPhpFixture(now);
  const engine = quoteRoutes(input);
  const q = engine.picks.cheapest;
  const salt = new Uint8Array(32).fill(minuteOffset + 1);
  const commitmentHex = computeInvoiceCommitment(invoiceFields, salt);
  const policyResult = { allowed: true, reasons: [], checks: [{ name: 'quote_expiry', passed: true, detail: 'ok' }] };
  const events = partner.simulateDeposit({ payoutId: payout.payoutId, network: q.target.network, address: q.target.depositAddress, amountUsdcMinor: q.source.amountMinor - q.costs.splashMinor, now });
  return buildCorridorPayoutBundle({
    bundleId: `evb3_${input.paymentId}${paymentSuffix}`,
    paymentId: input.paymentId,
    createdAt: new Date(now.getTime() + 5_000).toISOString(),
    invoice: { commitmentHex, einvoiceRef: null },
    approvals: [
      { who: 'admin@example.test', role: 'admin_device', action: 'propose', at: now.toISOString(), keyPublic: deviceKey, policyResult },
      { who: 'admin@example.test', role: 'admin_device', action: 'approve', at: now.toISOString(), keyPublic: deviceKey, policyResult },
    ],
    kyt: { provider: 'stub', resultId: 'kyt-stub-0011223344556677', verdict: 'clear' },
    quotedRoute: q,
    executedRoute: { quoteId: q.id, network: q.target.network, depositAddress: q.target.depositAddress, amountMinor: q.source.amountMinor - q.costs.splashMinor, steps: q.steps },
    chain: {
      signatures: [
        { purpose: 'squads_proposal_create', network: 'solana', signature: 'SIM1proposal', cluster: 'devnet', simulated: true },
        { purpose: 'squads_vault_execute', network: 'solana', signature: 'SIM1execute', cluster: 'devnet', simulated: true },
      ],
    },
    partner: { partnerId: partner.entry.id, payoutId: payout.payoutId, events },
    bank: { reference: events[1].bankReference, rail: 'PESONet' },
    receipt: { receiptId: `rcpt_${input.paymentId}${paymentSuffix}`, issuedAt: new Date(now.getTime() + 6_000).toISOString(), simulated: true },
  });
}

const period = { start: new Date('2026-10-11T00:00:00Z'), end: new Date('2026-10-12T00:00:00Z') };

test('canonical JSON: sorted keys, bigint as string, rejects ambiguous values', () => {
  assert.equal(canonicalJson({ b: 1n, a: [true, null, 'x'], c: undefined, d: { z: 1.5, y: -0 } }), '{"a":[true,null,"x"],"b":"1","d":{"y":0,"z":1.5}}');
  assert.throws(() => canonicalJson({ t: new Date() }), CanonicalJsonError);
  assert.throws(() => canonicalJson({ n: NaN }), CanonicalJsonError);
  assert.throws(() => canonicalJson([undefined]), CanonicalJsonError);
  assert.throws(() => canonicalJson({ u: new Uint8Array(2) }), CanonicalJsonError);
});

test('Merkle: every leaf of trees with 1..9 leaves proves; wrong index, side or sibling fails', () => {
  for (let n = 1; n <= 9; n++) {
    const leaves = Array.from({ length: n }, (_, i) => hashLeaf(`leaf-${i}`));
    const levels = buildLevels(leaves);
    const root = Buffer.from(levels.at(-1)[0]).toString('hex');
    for (let i = 0; i < n; i++) {
      const proof = merkleProof(levels, i);
      assert.equal(Buffer.from(rootFromProof(leaves[i], proof)).toString('hex'), root, `n=${n} i=${i}`);
      assert.deepEqual(proof.siblings.map((s) => s.position), expectedSiblingSides(i, n));
      if (n > 1) {
        const other = (i + 1) % n;
        assert.throws(() => assert.equal(Buffer.from(rootFromProof(leaves[i], { ...proof, index: other })).toString('hex'), root));
        if (proof.siblings.length) {
          const flipped = { ...proof, siblings: proof.siblings.map((s, k) => (k === 0 ? { ...s, position: s.position === 'left' ? 'right' : 'left' } : s)) };
          assert.throws(() => rootFromProof(leaves[i], flipped));
          const bad = { ...proof, siblings: proof.siblings.map((s, k) => (k === 0 ? { ...s, hashHex: '00'.repeat(32) } : s)) };
          assert.notEqual(Buffer.from(rootFromProof(leaves[i], bad)).toString('hex'), root);
        }
      }
    }
  }
  // a leaf can never be passed off as an internal node: domain tags differ
  const [a, b] = [hashLeaf('a'), hashLeaf('b')];
  assert.notDeepEqual(buildLevels([a, b]).at(-1)[0], hashLeaf(Buffer.concat([a, b])));
});

test('invoice commitment is salted sha256 and the bundle carries no plaintext invoice fields', () => {
  const s1 = randomSalt();
  const c1 = computeInvoiceCommitment(invoiceFields, s1);
  assert.match(c1, /^[0-9a-f]{64}$/);
  assert.notEqual(c1, computeInvoiceCommitment(invoiceFields, randomSalt()));
  assert.equal(c1, computeInvoiceCommitment({ ...invoiceFields }, s1));
  assert.throws(() => computeInvoiceCommitment(invoiceFields, new Uint8Array(16)));
  const text = canonicalJson(payoutBundle());
  for (const plain of ['INV-0412', 'Manila Freight', '4471', 'BDO']) assert.ok(!text.includes(plain), `bundle leaks ${plain}`);
});

test('bundle builder enforces I-2, I-4 and I-7', () => {
  const ok = payoutBundle();
  const input = { ...ok };
  delete input.version;
  delete input.kind;
  delete input.kindName;
  assert.throws(() => buildCorridorPayoutBundle({ ...input, approvals: [] }), /approval/);
  assert.throws(() => buildCorridorPayoutBundle({ ...input, executedRoute: { ...ok.executedRoute, depositAddress: attester } }), /deposit address/);
  assert.throws(() => buildCorridorPayoutBundle({ ...input, receipt: { ...ok.receipt, simulated: false } }), /simulated/);
  assert.throws(() => buildCorridorPayoutBundle({ ...input, bank: { ...ok.bank, reference: 'MOCK-PESONET-X' } }), /bank reference/);
  assert.throws(() => buildCorridorPayoutBundle({ ...input, fx: { ...ok.fx, rate: '58.00' } }), /fx/);
});

/** Walrus blob ids for the three bundles below, in upload order (not sorted). */
const BLOB_IDS = ['xQ3vB-blob_c', 'aZ9kL-blob_a', 'mN2pR-blob_b'];

async function anchoredBatch() {
  const bundles = [payoutBundle('', 0), payoutBundle('_b', 10), payoutBundle('_c', 20)];
  const batch = buildEvidenceBatch(bundles, period);
  const plan = await buildSasAnchor({ attester, batch, walrusBlobIdsRoot: walrusBlobIdsRoot(BLOB_IDS), setup: { createCredential: true, createSchema: true } });
  return { bundles, batch, plan };
}

test('one bundle verifies against a SAS-anchored root and a memo-anchored root', async () => {
  const { bundles, batch, plan } = await anchoredBatch();
  assert.equal(batch.count, 3);
  const anchor = anchoredRootFromSas(plan.dataBytes, { signature: 'SIManchor', simulated: true });
  for (const b of bundles) {
    const leaf = batch.leaves.find((l) => l.bundleId === b.bundleId);
    assert.equal(leaf.leafHex, bundleLeafHex(b));
    const r = verifyBundle({ bundle: b, proof: leaf.proof, anchor });
    assert.equal(r.ok, true, JSON.stringify(r.checks));
    assert.equal(r.simulated, true);
    assert.equal(r.computedRootHex, batch.rootHex);
  }
  const memo = buildMemoAnchor({ attester, rootHex: batch.rootHex, count: batch.count });
  const memoAnchor = anchoredRootFromMemo(memo.memo, { simulated: true });
  assert.equal(verifyBundle({ bundle: bundles[0], proof: batch.leaves[0].proof, anchor: memoAnchor }).ok, true);
});

test('changing ANY field of a bundle fails verification', async () => {
  const { bundles, batch, plan } = await anchoredBatch();
  const anchor = anchoredRootFromSas(plan.dataBytes, { simulated: true });
  const bundle = bundles[0];
  const proof = batch.leaves.find((l) => l.bundleId === bundle.bundleId).proof;
  const paths = [];
  (function walk(v, path) {
    if (v !== null && typeof v === 'object') for (const [k, c] of Object.entries(v)) walk(c, [...path, k]);
    else paths.push(path);
  })(bundle, []);
  assert.ok(paths.length > 80, `walked ${paths.length} fields`);
  for (const path of paths) {
    const t = structuredClone(bundle);
    let o = t;
    for (const k of path.slice(0, -1)) o = o[k];
    const k = path.at(-1);
    const v = o[k];
    o[k] = typeof v === 'bigint' ? v + 1n : typeof v === 'number' ? v + 1 : typeof v === 'boolean' ? !v : v === null ? 'x' : `${v}x`;
    const r = verifyBundle({ bundle: t, proof, anchor });
    assert.equal(r.ok, false, `tamper at ${path.join('.')} went undetected`);
  }
  // swapping two bundles' proofs fails; a different anchored root fails; a wrong count fails
  assert.equal(verifyBundle({ bundle, proof: batch.leaves.find((l) => l.bundleId !== bundle.bundleId).proof, anchor }).ok, false);
  assert.equal(verifyBundle({ bundle, proof, anchor: { ...anchor, rootHex: '11'.repeat(32) } }).ok, false);
  assert.equal(verifyBundle({ bundle, proof, anchor: { ...anchor, count: 4 } }).ok, false);
});

test('a simulated anchor cannot back a receipt claiming to be real (I-7)', async () => {
  const { bundles, batch, plan } = await anchoredBatch();
  const real = structuredClone(bundles[0]);
  real.receipt.simulated = false;
  const r = verifyBundle({ bundle: real, proof: batch.leaves[0].proof, anchor: anchoredRootFromSas(plan.dataBytes, { simulated: true }) });
  assert.equal(r.checks.find((c) => c.name === 'simulated_label').passed, false);
});

test('SAS anchor: instructions round-trip through sas-lib, PDAs match, data passes the program layout check', async () => {
  const { batch, plan } = await anchoredBatch();
  assert.equal(plan.programAddress, SAS_PROGRAM_ID);
  assert.equal(plan.instructions.length, 3);
  const [credIx, schemaIx, attIx] = plan.instructions;
  for (const ix of plan.instructions) assert.equal(ix.programAddress, SAS_PROGRAM_ID);

  const cred = parseCreateCredentialInstruction(credIx);
  assert.equal(cred.data.name, 'splash-evidence');
  assert.deepEqual(cred.data.signers, [attester]);
  const schema = parseCreateSchemaInstruction(schemaIx);
  assert.equal(schema.data.name, 'splash.evidence.root.v2');
  assert.deepEqual([...schema.data.layout], [13, 2, 8, 8, 12]);
  assert.deepEqual(schema.data.fieldNames, ['root', 'count', 'period_start', 'period_end', 'walrus_blob_ids_root']);
  const att = parseCreateAttestationInstruction(attIx);
  assert.equal(att.data.expiry, 0n);
  assert.equal(att.accounts.attestation.address, plan.attestationPda);
  assert.equal(att.accounts.authority.address, attester);
  assert.equal(att.accounts.payer.address, attester);

  const [credPda] = await deriveCredentialPda({ authority: attester, name: 'splash-evidence' });
  const [schemaPda] = await deriveSchemaPda({ credential: credPda, name: 'splash.evidence.root.v2', version: 1 });
  const [attPda] = await deriveAttestationPda({ credential: credPda, schema: schemaPda, nonce: plan.nonce });
  assert.deepEqual([plan.credentialPda, plan.schemaPda, plan.attestationPda], [credPda, schemaPda, attPda]);

  const bytes = Uint8Array.from(att.data.data);
  assert.ok(validateSasDataLayout(ROOT_SCHEMA_LAYOUT, bytes));
  const viaSas = deserializeAttestationData(rootSchemaAccount(credPda), bytes);
  assert.equal(Buffer.from(viaSas.root).toString('hex'), batch.rootHex);
  assert.equal(viaSas.count, 3);
  const blobsRoot = walrusBlobIdsRoot(BLOB_IDS);
  assert.deepEqual(decodeRootAttestationData(bytes), { rootHex: batch.rootHex, count: 3, periodStart: batch.periodStart, periodEnd: batch.periodEnd, walrusBlobIdsRoot: blobsRoot });
  // hand-encoded borsh equals sas-lib's
  const manual = Buffer.alloc(4 + 32 + 4 + 8 + 8 + 4 + 64);
  manual.writeUInt32LE(32, 0);
  Buffer.from(batch.rootHex, 'hex').copy(manual, 4);
  manual.writeUInt32LE(3, 36);
  manual.writeBigInt64LE(batch.periodStart, 40);
  manual.writeBigInt64LE(batch.periodEnd, 48);
  manual.writeUInt32LE(64, 56);
  Buffer.from(blobsRoot, 'utf8').copy(manual, 60);
  assert.deepEqual(Buffer.from(bytes), manual);
  // a truncated root would be rejected by the program check
  assert.equal(validateSasDataLayout(ROOT_SCHEMA_LAYOUT, bytes.slice(0, -1)), false);

  // web3.js conversion: the attester is the only signer
  const w = toWeb3Instruction(attIx);
  assert.equal(w.programId.toBase58(), SAS_PROGRAM_ID);
  // payer and authority slots both hold the attester; it is the only signing key
  assert.deepEqual([...new Set(w.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58()))], [attester]);
  assert.equal(attIx.accounts.find((a) => a.address === attester).role, AccountRole.WRITABLE_SIGNER);

  // without setup flags only the attestation instruction is built
  const only = await buildSasAnchor({ attester, batch, walrusBlobIdsRoot: blobsRoot });
  assert.equal(only.instructions.length, 1);
  assert.equal(only.attestationPda, plan.attestationPda, 'nonce is deterministic per root');
});

test('memo fallback carries only root and count', () => {
  const rootHex = 'ab'.repeat(32);
  const m = buildMemoAnchor({ attester, rootHex, count: 7 });
  assert.equal(m.memo, `splash:root:v1:${rootHex}:7`);
  assert.equal(m.instruction.programId.toBase58(), MEMO_PROGRAM_ID);
  assert.deepEqual(parseMemoAnchor(m.memo), { rootHex, count: 7 });
  assert.equal(parseMemoAnchor('splash:root:v1:INV-0412:1'), null);
  assert.throws(() => buildMemoAnchor({ attester, rootHex: 'AB'.repeat(32), count: 1 }));
  assert.throws(() => buildMemoAnchor({ attester, rootHex, count: 0 }));
});

test('attester key is isolated from client vaults (I-1)', () => {
  const vault = { multisigPda: 'M', vaultPda: 'V', threshold: 1, configAuthority: null, members: [{ role: 'admin_device', publicKey: deviceKey }] };
  assert.doesNotThrow(() => assertAttesterIsolated(attester, [vault]));
  assert.throws(() => assertAttesterIsolated(attester, [{ ...vault, members: [...vault.members, { role: 'recovery_kit_a', publicKey: attester }] }]));
  assert.throws(() => assertAttesterIsolated(attester, [{ ...vault, configAuthority: attester }]));
});

test('batch is reproducible and rejects duplicates and out-of-period bundles', () => {
  const b = [payoutBundle('', 0), payoutBundle('_b', 10)];
  assert.deepEqual(buildEvidenceBatch(b, period), buildEvidenceBatch([...b].reverse(), period));
  assert.throws(() => buildEvidenceBatch([b[0], b[0]], period), /duplicate/);
  assert.throws(() => buildEvidenceBatch(b, { start: new Date('2026-10-12T00:00:00Z'), end: new Date('2026-10-13T00:00:00Z') }), /outside/);
});

test('evidence store takes ciphertext only; Walrus adapter loads lazily', async () => {
  const store = new InMemoryEvidenceStore();
  await assert.rejects(store.put('b', canonicalJson(payoutBundle())), /ciphertext only/);
  const put = await store.put('b', 'seal:v1:Zm9vYmFy');
  assert.equal(put.mode, 'memory');
  assert.equal(await store.get(put.blobId), 'seal:v1:Zm9vYmFy');
  assert.equal(typeof createWalrusEvidenceStore().put, 'function'); // constructing it imports nothing
});

test('walrus_blob_ids_root: order-independent, exact, and refuses duplicates or junk', () => {
  const root = walrusBlobIdsRoot(BLOB_IDS);
  assert.match(root, /^[0-9a-f]{64}$/);
  assert.equal(walrusBlobIdsRoot([...BLOB_IDS].reverse()), root, 'upload order does not matter');
  const expected = createHash('sha256').update([...BLOB_IDS].sort().join('\n')).digest('hex');
  assert.equal(root, expected, 'sha256 over the sorted ids joined by newline');
  assert.notEqual(walrusBlobIdsRoot(BLOB_IDS.slice(0, 2)), root, 'a missing blob changes it');
  assert.throws(() => walrusBlobIdsRoot([]), /at least one/);
  assert.throws(() => walrusBlobIdsRoot([BLOB_IDS[0], BLOB_IDS[0]]), /duplicate/);
  assert.throws(() => walrusBlobIdsRoot(['has space']), /not a blob id/);
  assert.throws(() => walrusBlobIdsRoot(['a\nb']), /not a blob id/);
});

test('a v2 anchor binds the batch to its Walrus blobs: a swapped blob id fails verification', async () => {
  const { bundles, batch, plan } = await anchoredBatch();
  const anchor = anchoredRootFromSas(plan.dataBytes, { signature: 'SIManchor', simulated: true });
  const leaf = batch.leaves.find((l) => l.bundleId === bundles[0].bundleId);
  const good = verifyBundle({ bundle: bundles[0], proof: leaf.proof, anchor, blobIds: BLOB_IDS });
  assert.equal(good.ok, true);
  assert.equal(good.checks.find((c) => c.name === 'blob_ids').passed, true);

  const swapped = verifyBundle({ bundle: bundles[0], proof: leaf.proof, anchor, blobIds: [BLOB_IDS[0], BLOB_IDS[1], 'evil-blob'] });
  assert.equal(swapped.ok, false);
  assert.equal(swapped.checks.find((c) => c.name === 'blob_ids').passed, false);

  // Without the blob ids the check is not claimed either way.
  const without = verifyBundle({ bundle: bundles[0], proof: leaf.proof, anchor });
  assert.equal(without.checks.some((c) => c.name === 'blob_ids'), false);
});

test('a SAS anchor refuses a blob-ids root that is not 32-byte hex', async () => {
  const bundles = [payoutBundle('', 0)];
  const batch = buildEvidenceBatch(bundles, period);
  await assert.rejects(() => buildSasAnchor({ attester, batch, walrusBlobIdsRoot: '' }), /walrus_blob_ids_root/);
  await assert.rejects(() => buildSasAnchor({ attester, batch, walrusBlobIdsRoot: 'AB'.repeat(32) }), /walrus_blob_ids_root/);
});
