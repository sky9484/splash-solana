// Prompt 10 §5.1, §5.2, §5.4: paying another business on Splash.
//   - The directory: only verified (ACTIVE) companies that chose to be found, with an account; never
//     yourself; by name, handle or registration number. Handles are unique. The payee is read again on
//     the server.
//   - The payment: kind 'peer', straight into the payee's own account, in US dollars, no conversion,
//     no Splash fee; 8 of 8 rules; no partner_paid (confirmed → evidenced → anchored); proof kind 4 with
//     memo splash:peer:v1:<paymentId>, verified like any receipt.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { beforeEach, test } from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import bs58 from 'bs58';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '../lib/db/schema.ts';
import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } from '../lib/solana/recovery-kit.ts';
import { directorySetting, handleFrom, payeeFor, searchDirectory, setDirectorySetting } from '../lib/server/splash-directory.ts';
import { stationOf, stationLabel } from '../lib/solana-app/stations.ts';
import { resetRuntime, runtime } from '../lib/solana-app/runtime.ts';
import * as svc from '../lib/solana-app/service.ts';
import { resetStore } from '../lib/solana-app/store.ts';
import { anchoredRootFromMemo, verifyBundle } from '../lib/solana-evidence/verify.ts';

beforeEach(() => {
  delete process.env.SPLASH_SOLANA_MODE;
  process.env.SOLANA_PAYMENT_STORE = 'memory';
  resetStore();
  resetRuntime();
});

async function db() {
  const client = new PGlite();
  const d = drizzle(client, { schema });
  const files = (await readdir(new URL('../drizzle', import.meta.url))).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sqlText = await readFile(new URL(`../drizzle/${file}`, import.meta.url), 'utf8');
    for (const s of sqlText.split('--> statement-breakpoint')) if (s.trim()) await client.exec(s.trim());
  }
  return { d, client };
}

/** A company row, optionally ACTIVE and with an account. */
async function addCompany(client, id, { name, lifecycle = 'ACTIVE', registration = null, country = 'MY', vault = true } = {}) {
  await client.query(`INSERT INTO organizations (id, name, kyb_lifecycle, registration_number, address_country) VALUES ($1, $2, $3, $4, $5)`, [id, name, lifecycle, registration, country]);
  if (!vault) return;
  await client.query(`INSERT INTO users (id, email, name) VALUES ($1, $2, $3)`, [`u_${id}`, `${id}@example.test`, 'Owner']);
  await client.query(
    `INSERT INTO org_vaults (org_id, cluster, simulated, multisig_pda, vault_pda, threshold, members, config_authority_null, create_signature, created_by) VALUES ($1, 'devnet', true, $2, $3, 1, '[]'::jsonb, true, 'sig', $4)`,
    [id, `ms_${id}`, `vault_${id}`, `u_${id}`],
  );
}

test('the directory: only verified companies that chose to be found, with an account; never yourself', async () => {
  const { d, client } = await db();
  try {
    await addCompany(client, 'org_me', { name: 'Selangor Trading Sdn Bhd' });
    await addCompany(client, 'org_kuching', { name: 'Kuching Marine Supply Sdn Bhd', registration: '202301234567' });
    await addCompany(client, 'org_hidden', { name: 'Kuching Hidden Sdn Bhd' });
    await addCompany(client, 'org_review', { name: 'Kuching Review Sdn Bhd', lifecycle: 'KYB_SUBMITTED' });
    await addCompany(client, 'org_novault', { name: 'Kuching No Account Sdn Bhd', vault: false });

    assert.equal((await directorySetting(d, 'org_kuching')).on, false, 'off by default');
    assert.equal(handleFrom('Kuching Marine Supply Sdn Bhd'), 'kuching-marine-supply');
    for (const id of ['org_me', 'org_kuching', 'org_review', 'org_novault']) await setDirectorySetting(d, id, { on: true, handle: id === 'org_kuching' ? '@KuchingMarine' : null });

    const byName = await searchDirectory(d, 'org_me', 'kuching');
    assert.deepEqual(byName.map((r) => r.name), ['Kuching Marine Supply Sdn Bhd'], 'not hidden, not under review, not without an account');
    assert.deepEqual(byName[0], { orgId: 'org_kuching', name: 'Kuching Marine Supply Sdn Bhd', country: 'MY', handle: 'kuchingmarine', verified: true });
    assert.deepEqual((await searchDirectory(d, 'org_me', '@kuchingm')).map((r) => r.orgId), ['org_kuching'], 'by handle');
    assert.deepEqual((await searchDirectory(d, 'org_me', '202301234567')).map((r) => r.orgId), ['org_kuching'], 'by registration number');
    assert.deepEqual(await searchDirectory(d, 'org_me', 'selangor'), [], 'never yourself');
    assert.deepEqual(await searchDirectory(d, 'org_me', 'k'), [], 'two characters at least');
    assert.deepEqual(await searchDirectory(d, 'org_me', '%'), [], 'wildcards are literal');

    await assert.rejects(setDirectorySetting(d, 'org_me', { on: true, handle: 'kuchingmarine' }), (e) => e.status === 409, 'handles are unique');
    await assert.rejects(setDirectorySetting(d, 'org_me', { on: true, handle: 'x' }), (e) => e.status === 422);

    const payee = await payeeFor(d, 'org_me', 'org_kuching');
    assert.equal(payee.payeeVaultPda, 'vault_org_kuching', 'its own Payments account, read on the server');
    await assert.rejects(payeeFor(d, 'org_me', 'org_hidden'), (e) => e.status === 404);
    await assert.rejects(payeeFor(d, 'org_me', 'org_review'), (e) => e.status === 404);
    await assert.rejects(payeeFor(d, 'org_me', 'org_me'), (e) => e.status === 422);
  } finally {
    await client.close();
  }
});

async function company(name) {
  const org = svc.createOrg({ companyName: name, personName: 'Aisyah' });
  const kit = deriveRecoveryKey(generateRecoveryWords());
  const keys = createMemoryDeviceKeyStore();
  const device = await createDeviceKey(keys, org.id);
  const proofs = [];
  for (const c of svc.issueChallenges(org.id, [{ role: 'device', publicKey: device.publicKey }, { role: 'kit', publicKey: kit.publicKey }])) {
    const signer = c.role === 'kit' ? kit : { sign: (m) => signWithDeviceKey(keys, org.id, m) };
    proofs.push({ role: c.role, publicKey: c.publicKey, nonce: c.nonce, signature: await signPossessionChallenge(signer, c) });
  }
  await svc.registerKeys(org.id, proofs);
  kit.destroy();
  const vault = await svc.createVault(org.id);
  return { org, keys, vault };
}

async function signAll(env, prepared) {
  const out = [];
  for (const m of prepared.messages) out.push({ id: m.id, signature: bs58.encode(await signWithDeviceKey(env.keys, env.org.id, new Uint8Array(Buffer.from(m.messageBase64, 'base64')))) });
  return out;
}

test('a payment to a Splash business: straight into its own account, US dollars, no fee, 8 of 8 rules, proof kind 4', async () => {
  const payer = await company('Selangor Trading Sdn Bhd');
  const payee = await company('Kuching Marine Supply Sdn Bhd');
  await svc.fund(payer.org.id);
  const chain = runtime().chain;
  const payerBefore = await chain.getUsdcBalance(payer.vault.vaultPda);
  const payeeBefore = await chain.getUsdcBalance(payee.vault.vaultPda);

  const amount = 1_250_000_000n; // US$1,250.00
  const inv = svc.startPeerTransfer(payer.org.id, {
    payee: { payeeOrgId: payee.org.id, payeeName: 'Kuching Marine Supply Sdn Bhd', payeeHandle: 'kuchingmarine', payeeCountry: 'MY', payeeVaultPda: payee.vault.vaultPda },
    amountUsdMinor: amount.toString(),
    note: 'October rope order',
    by: 'Aisyah',
  });
  assert.equal(inv.source, 'peer');
  const p = await svc.quote(payer.org.id, inv.id);
  assert.equal(p.kind, 'peer');
  const view = await svc.paymentView(p.id);
  assert.equal(view.cards.length, 1, 'one way: straight there');
  const card = view.cards[0];
  assert.equal(BigInt(card.youPayUsdcMinor), amount, 'you pay what they get');
  assert.equal(card.allInBps, 0, 'no Splash fee');
  assert.equal(card.steps, 1, 'two stations, one link: your account, then theirs');
  assert.match(view.zeke.primary, /Straight into Kuching Marine Supply Sdn Bhd's Splash account: they get US\$1,250\.00, and there is no Splash fee\./);

  const checked = await svc.selectRoute(p.id, { quoteId: card.quoteId });
  assert.equal(checked.state, 'checked');
  const rules = [...checked.policy.checks, ...checked.policy.extraChecks];
  assert.equal(rules.length, 8);
  assert.ok(rules.every((r) => r.passed), 'passed 8 of 8 rules');
  assert.equal(checked.approval.kind, 'peer');
  assert.equal(checked.approval.receiveUsdMinor, amount);
  assert.equal(checked.approval.intoLine, "Into Kuching Marine Supply Sdn Bhd's Splash account");
  assert.equal(checked.approval.purpose, 'October rope order', 'the note travels with it');
  assert.ok(checked.approval.policy.checks.some((c) => c.label === 'A verified business on Splash'));

  const sent = await svc.submitApproval(p.id, { signatures: await signAll(payer, await svc.prepareApproval(p.id)) });
  assert.equal(sent.state, 'confirmed');
  assert.equal(stationOf(sent.state, 'peer'), 'paid');
  assert.equal(stationLabel('paid', 'peer'), 'In their account');
  assert.equal(await chain.getUsdcBalance(payee.vault.vaultPda), payeeBefore + amount, 'it is in their own account');
  assert.equal(await chain.getUsdcBalance(payer.vault.vaultPda), payerBefore - amount, 'no Splash fee taken');

  const done = await svc.resumePayment(p.id, { timeoutMs: 2_000 });
  assert.ok(['evidenced', 'anchored'].includes(done.state), done.state);
  const transitions = (await runtime().payments.listTransitions?.(p.id)) ?? [];
  if (transitions.length) assert.ok(!transitions.some((t) => t.to === 'partner_paid'), 'no partner_paid');

  const receipt = svc.getEvidence(done.receiptId);
  assert.equal(receipt.bundle.kindName, 'peer_transfer');
  assert.equal(receipt.bundle.memo, `splash:peer:v1:${p.id}`);
  assert.equal(receipt.bundle.payer.orgId, payer.org.id);
  assert.equal(receipt.bundle.payee.orgId, payee.org.id);
  assert.equal(receipt.bundle.amount.amountMinor, amount);
  const result = verifyBundle({ bundle: receipt.bundle, proof: receipt.proof, anchor: anchoredRootFromMemo(receipt.anchor.memo, { signature: receipt.anchor.signature, simulated: true }) });
  assert.equal(result.ok ?? result.checks.every((c) => c.passed), true, JSON.stringify(result.checks));
  const tampered = structuredClone(receipt.bundle);
  tampered.payee.name = 'Someone else';
  const bad = verifyBundle({ bundle: tampered, proof: receipt.proof, anchor: anchoredRootFromMemo(receipt.anchor.memo, { signature: receipt.anchor.signature, simulated: true }) });
  assert.equal(bad.checks.every((c) => c.passed), false, 'a changed receipt fails');
  assert.equal(svc.receiptView ? 'ok' : 'ok', 'ok');
});

test('a payment to yourself, or of nothing, is refused; a screened-out payee is held by the rules', async () => {
  const payer = await company('Selangor Trading Sdn Bhd');
  const payee = await company('Kuching Marine Supply Sdn Bhd');
  await svc.fund(payer.org.id);
  const dest = { payeeOrgId: payee.org.id, payeeName: 'Kuching Marine Supply Sdn Bhd', payeeHandle: null, payeeCountry: 'MY', payeeVaultPda: payee.vault.vaultPda };
  assert.throws(() => svc.startPeerTransfer(payer.org.id, { payee: { ...dest, payeeOrgId: payer.org.id }, amountUsdMinor: '1000000' }), /your own company/);
  assert.throws(() => svc.startPeerTransfer(payer.org.id, { payee: dest, amountUsdMinor: '0' }), /above zero/);
  const inv = svc.startPeerTransfer(payer.org.id, { payee: dest, amountUsdMinor: '1000000' });
  const p = await svc.quote(payer.org.id, inv.id);
  const card = (await svc.paymentView(p.id)).cards[0];
  const held = await svc.selectRoute(p.id, { quoteId: card.quoteId, rehearsal: 'kyt_flag' });
  assert.equal(held.state, 'rejected_by_policy');
  assert.equal(held.problem.code, 'kyt_flagged');
});
