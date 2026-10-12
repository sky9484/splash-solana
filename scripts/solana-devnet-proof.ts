/**
 * The devnet proof (prompt 07 §5.7): one real payment against the mock payout partner, through the
 * SAME service and state machine the app uses — vault, quote, approve with a device key, execute,
 * partner webhooks, evidence — and a record of what happened.
 *
 *   --dry-run   offline: SPLASH_SOLANA_MODE=offline, the simulator, no network, writes nothing.
 *               Prints the plan and the state path. Runs anywhere, including CI.
 *
 *   live        Sky or Sebastian, with RPC and Kora:
 *     SPLASH_SOLANA_MODE=devnet SOLANA_CLUSTER=devnet KORA_RPC_URL=… [KORA_API_KEY=…] \
 *       node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types \
 *         --import ./scripts/alias-hook.mjs scripts/solana-devnet-proof.ts
 *     The script creates a throwaway company and vault, prints the vault address and waits for it to
 *     be funded with devnet USDC (Circle faucet), then pays. It appends to
 *     docs/solana-build/devnet-run.json under proofRuns[] and never erases an earlier run.
 *
 * Keys: the device key and recovery kit are generated in memory for this run and dropped after it.
 * Nothing secret is written or printed: only public keys, signatures and explorer links.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import bs58 from 'bs58';

const dryRun = process.argv.includes('--dry-run');
if (dryRun) {
  process.env.SPLASH_SOLANA_MODE = 'offline';
  process.env.SOLANA_PAYMENT_STORE = 'memory';
} else if (process.env.SPLASH_SOLANA_MODE !== 'devnet') {
  console.error('Live proof needs SPLASH_SOLANA_MODE=devnet (and KORA_RPC_URL). For the offline plan, pass --dry-run.');
  process.exit(2);
}

const { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } = await import('../lib/solana/device-key.ts');
const { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } = await import('../lib/solana/recovery-kit.ts');
const { explorerAddressUrl, explorerTxUrl, solscanAccount, solscanTx } = await import('../lib/solana/config.ts');
const { buildSasAnchor } = await import('../lib/solana-evidence/anchor.ts');
const { walrusBlobIdsRoot } = await import('../lib/solana-evidence/bundle.ts');
const { toWire } = await import('../lib/solana-app/json.ts');
const { runtime } = await import('../lib/solana-app/runtime.ts');
const svc = await import('../lib/solana-app/service.ts');

const rt = runtime();
const FIELDS = ['invoiceNumber', 'supplierName', 'supplierBank', 'supplierAccountLast4', 'amountPhpMinor', 'dueDate'];
const log = (step: string, detail: Record<string, unknown> = {}) => console.log(`• ${step}${Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : ''}`);
// Solscan first (the link a person follows), Solana Explorer second. None for a simulated signature.
const links = (sig: string, simulated: boolean) => (simulated ? { solscanUrl: null, explorerUrl: null } : { solscanUrl: solscanTx(sig, rt.env.cluster), explorerUrl: explorerTxUrl(sig, rt.env.cluster) });

console.log(`Splash devnet proof — ${dryRun ? 'DRY RUN (offline simulator, nothing written)' : `LIVE on ${rt.env.cluster}`}\n`);

// 1. Company, keys (proof of possession), autonomous vault.
const org = svc.createOrg({ companyName: 'Splash Proof Run', personName: 'Proof runner' });
const kit = deriveRecoveryKey(generateRecoveryWords());
const keys = createMemoryDeviceKeyStore();
const device = await createDeviceKey(keys, org.id);
const proofs = [];
for (const c of svc.issueChallenges(org.id, [{ role: 'device', publicKey: device.publicKey }, { role: 'kit', publicKey: kit.publicKey }])) {
  const signer = c.role === 'kit' ? kit : { sign: (m: Uint8Array) => signWithDeviceKey(keys, org.id, m) };
  proofs.push({ role: c.role, publicKey: c.publicKey, nonce: c.nonce, signature: await signPossessionChallenge(signer, c) });
}
await svc.registerKeys(org.id, proofs);
kit.destroy();
const vault = await svc.createVault(org.id);
log('vault created (autonomous: configAuthority null, no Splash key a member)', { vault: vault.vaultPda, threshold: vault.threshold, signature: vault.signature });

// 2. Fund.
if (dryRun) {
  await svc.fund(org.id);
  log('vault funded (simulated faucet)');
} else {
  console.log(`\nFund the vault with devnet USDC (https://faucet.circle.com/, Solana devnet):\n  ${vault.vaultPda}\n  ${solscanAccount(vault.vaultPda, rt.env.cluster)}\nWaiting up to 15 minutes…`);
  const deadline = Date.now() + 15 * 60_000;
  while ((await rt.chain.getUsdcBalance(vault.vaultPda)) === 0n) {
    if (Date.now() > deadline) throw new Error('The vault was not funded in time.');
    await new Promise((r) => setTimeout(r, 10_000));
  }
  log('vault funded', { usdcMinor: (await rt.chain.getUsdcBalance(vault.vaultPda)).toString() });
}

// 3. Invoice (the sample; Zeke drafts, a person confirms), quote, the direct Solana route.
const { invoice } = await svc.readInvoiceDraft(org.id, { sample: true });
svc.verifyBank(org.id, invoice.id, { by: 'Proof runner', method: 'call-back', bank: invoice.draft.fields.supplierBank, accountLast4: invoice.draft.fields.supplierAccountLast4 });
svc.confirmInvoice(org.id, invoice.id, { fields: toWire(invoice.draft.fields) as Record<string, string>, confirmed: [...FIELDS] });
const quoted = await svc.quote(org.id, invoice.id);
const direct = (await svc.paymentView(quoted.id)).cards.find((c) => c.kind === 'solana_direct');
if (!direct) throw new Error('No Solana direct route was offered.');
const selected = await svc.selectRoute(quoted.id, { quoteId: direct.quoteId });
log('route chosen', { payment: selected.id, state: selected.state, youPayUsdcMinor: direct.youPayUsdcMinor.toString(), allInBps: direct.allInBps });

// 4. Approve with the device key (the only signer), execute through the fee payer.
const prepared = await svc.prepareApproval(selected.id);
const signatures = [];
for (const m of prepared.messages) signatures.push({ id: m.id, signature: bs58.encode(await signWithDeviceKey(keys, org.id, new Uint8Array(Buffer.from(m.messageBase64, 'base64')))) });
let payment = await svc.submitApproval(selected.id, { signatures });
log('approved and executed', { state: payment.state, steps: prepared.messages.map((m) => m.purpose) });

// 5. The mock partner sees the deposit and pays; evidence once the execute is finalized.
await svc.deliverPartnerEvents(payment.id);
for (let i = 0; i < 60 && !['evidenced', 'anchored'].includes((payment = await svc.resumePayment(payment.id, { timeoutMs: dryRun ? 0 : 5_000 })).state); i++) {
  if (dryRun) break;
}
log('partner paid; evidence', { state: payment.state, receipt: payment.receiptId });

// 6. What the run proves.
const calls = await rt.payments.listCalls(payment.id);
const transitions = (await rt.payments.transitions(payment.id)).map((t) => t.to);
const evidence = payment.receiptId ? svc.getEvidence(payment.receiptId) : null;
const sas = evidence
  ? await buildSasAnchor({ attester: evidence.anchor.attester, batch: { rootHex: evidence.batch.rootHex, count: evidence.batch.count, periodStart: evidence.batch.periodStart, periodEnd: evidence.batch.periodEnd }, walrusBlobIdsRoot: walrusBlobIdsRoot([evidence.stored.blobId]) })
  : null;
const simulated = rt.env.mode === 'offline';
const run = {
  at: new Date().toISOString(),
  mode: rt.env.mode,
  cluster: rt.env.cluster,
  simulated,
  paymentId: payment.id,
  statePath: transitions,
  memo: `splash:pay:v1:${payment.id}`,
  vault: {
    address: vault.vaultPda,
    multisig: vault.multisigPda,
    threshold: vault.threshold,
    solscanUrl: simulated ? null : solscanAccount(vault.vaultPda, rt.env.cluster),
    explorerUrl: simulated ? null : explorerAddressUrl(vault.vaultPda, rt.env.cluster),
  },
  vaultCreate: { signature: vault.signature, ...links(vault.signature, simulated) },
  chainCalls: calls.map((c) => ({ step: c.step, status: c.status, signature: c.signature, ...links(c.signature, simulated) })),
  evidence: evidence
    ? {
        receiptId: evidence.receiptId,
        root: evidence.batch.rootHex,
        anchor: { method: evidence.anchor.method, status: evidence.anchor.status, signature: evidence.anchor.signature, ...(evidence.anchor.signature ? links(evidence.anchor.signature, simulated) : { solscanUrl: null, explorerUrl: null }) },
        sasAttestationAddress: sas?.attestationPda ?? null,
        walrus: { blobId: evidence.stored.blobId, mode: evidence.stored.mode },
      }
    : null,
};
console.log(`\n${JSON.stringify(run, null, 2)}`);

if (dryRun) {
  console.log('\nDry run: nothing written. A live run appends this record to docs/solana-build/devnet-run.json (proofRuns[]).');
} else {
  const file = path.join(process.cwd(), 'docs', 'solana-build', 'devnet-run.json');
  const existing = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  existing.proofRuns = [...(existing.proofRuns ?? []), run];
  writeFileSync(file, `${JSON.stringify(existing, null, 2)}\n`);
  console.log(`\nAppended to ${path.relative(process.cwd(), file)} (proofRuns[${existing.proofRuns.length - 1}]).`);
}
