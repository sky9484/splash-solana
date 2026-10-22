import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '../lib/db/schema.ts';
import {
  assertTransition,
  canTransition,
  chainCallKey,
  FAILURE_STATES,
  HAPPY_PATH,
  IllegalTransitionError,
  isTerminal,
  PAYMENT_STATES,
  STATE_LABEL,
} from '../lib/solana-app/payment-machine.ts';
import {
  createMemoryPaymentRepo,
  createPostgresPaymentRepo,
  decodeRecord,
  encodeRecord,
  IdempotencyConflictError,
  StateConflictError,
} from '../lib/solana-app/payment-repo.ts';

/** Prompt 07 §5.1: the state machine, compare-and-set, idempotency keys. */

/* ------------------------------------------------------------------ the machine */

test('the happy path is exactly the ten states of §5.1, each a legal step from the last', () => {
  assert.deepEqual([...HAPPY_PATH], ['draft', 'quoted', 'checked', 'proposed', 'approved', 'executed', 'confirmed', 'partner_paid', 'evidenced', 'anchored']);
  for (let i = 1; i < HAPPY_PATH.length; i++) assert.ok(canTransition(HAPPY_PATH[i - 1], HAPPY_PATH[i]), `${HAPPY_PATH[i - 1]} → ${HAPPY_PATH[i]}`);
  // §5.1's six ways out, and discarded (Sky, 14 Oct): a person dropped it before anything was sent.
  assert.deepEqual([...FAILURE_STATES], ['quote_expired', 'rejected_by_policy', 'proposal_failed', 'execute_failed', 'partner_failed', 'evidence_failed', 'discarded']);
  for (const s of PAYMENT_STATES) assert.ok(STATE_LABEL[s], `${s} has words for the UI`);
});

test('each failure is reachable from where it can happen, and nothing skips a step', () => {
  assert.ok(canTransition('quoted', 'quote_expired'));
  assert.ok(canTransition('checked', 'rejected_by_policy'));
  assert.ok(canTransition('proposed', 'proposal_failed'));
  assert.ok(canTransition('executed', 'execute_failed'));
  assert.ok(canTransition('confirmed', 'partner_failed'));
  assert.ok(canTransition('partner_paid', 'evidence_failed'));
  // An expired execute is rebuilt and signed again; never straight back to executed.
  assert.ok(canTransition('execute_failed', 'approved'));
  assert.ok(!canTransition('execute_failed', 'executed'));
  for (const [from, to] of [['quoted', 'proposed'], ['checked', 'executed'], ['approved', 'confirmed'], ['confirmed', 'evidenced'], ['partner_paid', 'anchored'], ['proposed', 'executed'], ['executed', 'quoted']]) {
    assert.ok(!canTransition(from, to), `${from} → ${to} must not be legal`);
    assert.throws(() => assertTransition(from, to), IllegalTransitionError);
  }
  assert.ok(isTerminal('anchored') && isTerminal('partner_failed'));
  assert.ok(!isTerminal('execute_failed') && !isTerminal('evidence_failed'), 'both are retried');
});

test('idempotency keys are paymentId:step', () => {
  assert.equal(chainCallKey('pay_0123456789abcdef', 'proposal:0'), 'pay_0123456789abcdef:proposal:0');
  assert.equal(chainCallKey('pay_0123456789abcdef', 'execute:2'), 'pay_0123456789abcdef:execute:2');
  assert.throws(() => chainCallKey('pay_x', 'Execute now'), /bad chain call step/);
});

test('the record codec keeps bigint exact', () => {
  const value = { a: 12_345_678_901_234_567_890n, nested: [{ b: -1n }], s: '1', n: 2 };
  assert.deepEqual(decodeRecord(encodeRecord(value)), value);
  assert.deepEqual(encodeRecord({ x: 5n }), { x: { $bigint: '5' } });
});

/* ------------------------------------------------------------------ both repositories, same tests */

async function pgRepo() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const files = (await readdir(new URL('../drizzle', import.meta.url))).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sqlText = await readFile(new URL(`../drizzle/${file}`, import.meta.url), 'utf8');
    for (const statement of sqlText.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }
  return { repo: createPostgresPaymentRepo(db), close: () => client.close(), client };
}

function record(id = 'pay_0123456789abcdef', state = 'draft') {
  const at = '2026-10-13T00:00:00.000Z';
  return {
    id,
    orgId: 'org_aaaaaaaaaaaaaaaa',
    invoiceId: 'inv_aaaaaaaaaaaaaaaa',
    createdAt: at,
    updatedAt: at,
    state,
    version: 0,
    threshold: 1,
    approvedBy: [],
    pendingApprover: null,
    payeeHash: null,
    transactionIndex: null,
    plan: null,
    execution: { attempt: 0, signature: null, confirmedAt: null, finalizedAt: null, lastLogs: null },
    payout: { amountPhpMinor: 57_400_000n },
    engine: {},
    router: {},
    selectedQuoteId: null,
    policy: null,
    approval: null,
    rehearsal: 'none',
    prepared: null,
    signatures: [],
    approvals: [],
    partnerEvents: [],
    timeline: {},
    executedRoute: null,
    receiptId: null,
    problem: null,
  };
}

for (const kind of ['memory', 'postgres']) {
  const open = async () => (kind === 'memory' ? { repo: createMemoryPaymentRepo(), close: async () => {} } : pgRepo());

  test(`${kind}: create, compare-and-set, and an append-only history`, async () => {
    const { repo, close } = await open();
    const created = await repo.create(record(), 'invoice confirmed');
    assert.equal(created.version, 1);
    assert.equal(created.payout.amountPhpMinor, 57_400_000n, 'bigint survives the store');
    const quoted = await repo.transition(created.id, { from: 'draft', version: 1 }, 'quoted', (d) => { d.selectedQuoteId = 'q1'; }, 'quoted');
    assert.equal(quoted.state, 'quoted');
    assert.equal(quoted.version, 2);
    assert.equal(quoted.selectedQuoteId, 'q1');
    const self = await repo.transition(created.id, { from: 'quoted' }, 'quoted', undefined, 're-quoted');
    assert.equal(self.version, 3, 'a self-transition still bumps the version');
    const history = await repo.transitions(created.id);
    assert.deepEqual(history.map((h) => [h.from, h.to, h.version]), [[null, 'draft', 1], ['draft', 'quoted', 2], ['quoted', 'quoted', 3]]);
    await assert.rejects(repo.create(record()), StateConflictError, 'one payment per id');
    await close();
  });

  test(`${kind}: a stale version or wrong state loses, changes nothing, and says what it found`, async () => {
    const { repo, close } = await open();
    await repo.create(record());
    await repo.transition('pay_0123456789abcdef', { from: 'draft' }, 'quoted');
    await assert.rejects(
      repo.transition('pay_0123456789abcdef', { from: 'quoted', version: 1 }, 'checked'),
      (e) => e instanceof StateConflictError && e.actual.state === 'quoted' && e.actual.version === 2,
    );
    await assert.rejects(repo.transition('pay_0123456789abcdef', { from: 'checked' }, 'proposed'), StateConflictError);
    await assert.rejects(repo.transition('pay_0123456789abcdef', { from: 'quoted' }, 'executed'), IllegalTransitionError);
    await assert.rejects(repo.update('pay_0123456789abcdef', { version: 1 }, () => {}), StateConflictError);
    const now = await repo.get('pay_0123456789abcdef');
    assert.equal(now.state, 'quoted');
    assert.equal(now.version, 2);
    assert.equal((await repo.transitions('pay_0123456789abcdef')).length, 2, 'no row for a refused change');
    await close();
  });

  test(`${kind}: two racers on the same version, exactly one wins`, async () => {
    const { repo, close } = await open();
    await repo.create(record());
    await repo.transition('pay_0123456789abcdef', { from: 'draft' }, 'quoted');
    await repo.transition('pay_0123456789abcdef', { from: 'quoted' }, 'checked');
    const p = await repo.get('pay_0123456789abcdef');
    const results = await Promise.allSettled([
      repo.transition(p.id, { from: 'checked', version: p.version }, 'proposed', (d) => { d.pendingApprover = 'A'; }),
      repo.transition(p.id, { from: 'checked', version: p.version }, 'proposed', (d) => { d.pendingApprover = 'B'; }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter((r) => r.status === 'rejected' && r.reason instanceof StateConflictError).length, 1);
    const after = await repo.get(p.id);
    assert.equal(after.state, 'proposed');
    assert.equal(after.version, p.version + 1);
    await close();
  });

  test(`${kind}: what comes back is a copy; changing it changes nothing stored`, async () => {
    const { repo, close } = await open();
    const r = await repo.create(record());
    r.state = 'anchored';
    r.approvedBy.push('mallory');
    const stored = await repo.get(r.id);
    assert.equal(stored.state, 'draft');
    assert.deepEqual(stored.approvedBy, []);
    await close();
  });

  test(`${kind}: a chain call is recorded once per key; a second signature under it is a double send and is refused`, async () => {
    const { repo, close } = await open();
    await repo.create(record());
    const key = 'pay_0123456789abcdef:execute:0';
    const first = await repo.recordSigned({ key, paymentId: 'pay_0123456789abcdef', step: 'execute:0', signature: 'SIG1', lastValidBlockHeight: 1150 });
    assert.equal(first.status, 'signed');
    assert.equal(first.lastValidBlockHeight, 1150);
    const again = await repo.recordSigned({ key, paymentId: 'pay_0123456789abcdef', step: 'execute:0', signature: 'SIG1', lastValidBlockHeight: 1150 });
    assert.equal(again.signature, 'SIG1', 'same key, same signature: a retry, not a second send');
    await assert.rejects(repo.recordSigned({ key, paymentId: 'pay_0123456789abcdef', step: 'execute:0', signature: 'SIG2', lastValidBlockHeight: 1150 }), IdempotencyConflictError);
    await assert.rejects(repo.recordSigned({ key: 'pay_0123456789abcdef:execute:1', paymentId: 'pay_0123456789abcdef', step: 'execute:1', signature: 'SIG1', lastValidBlockHeight: 1300 }), IdempotencyConflictError, 'one signature, one call');
    await assert.rejects(repo.recordSigned({ key: 'pay_0123456789abcdef:x', paymentId: 'pay_0123456789abcdef', step: 'execute:0', signature: 'SIG3', lastValidBlockHeight: null }), /paymentId:step/);
    const done = await repo.updateCall(key, { status: 'finalized' });
    assert.equal(done.status, 'finalized');
    assert.deepEqual((await repo.listCalls('pay_0123456789abcdef')).map((c) => [c.step, c.status]), [['execute:0', 'finalized']]);
    await close();
  });

  test(`${kind}: listInStates finds what a resume pass must look at`, async () => {
    const { repo, close } = await open();
    await repo.create(record('pay_aaaaaaaaaaaaaaaa'));
    await repo.create(record('pay_bbbbbbbbbbbbbbbb'));
    await repo.transition('pay_bbbbbbbbbbbbbbbb', { from: 'draft' }, 'quoted');
    assert.deepEqual((await repo.listInStates(['quoted'])).map((p) => p.id), ['pay_bbbbbbbbbbbbbbbb']);
    assert.equal((await repo.listByOrg('org_aaaaaaaaaaaaaaaa')).length, 2);
    await close();
  });
}

test('postgres: the table itself refuses an unknown state and a malformed id', async () => {
  const { client, close } = await pgRepo();
  await assert.rejects(client.exec(`INSERT INTO solana_payments (id, org_id, state, version, record) VALUES ('pay_0123456789abcdef', 'o', 'paid', 1, '{}')`), /check/i);
  await assert.rejects(client.exec(`INSERT INTO solana_payments (id, org_id, state, version, record) VALUES ('INV-0412', 'o', 'draft', 1, '{}')`), /check/i);
  await close();
});

test('a payment to a Splash business (peer) goes confirmed → evidenced, with no partner states; a bank payout cannot', () => {
  // Prompt 10 §5.2: the peer kind has no partner_paid.
  assert.ok(canTransition('confirmed', 'evidenced', 'peer'));
  assert.ok(!canTransition('confirmed', 'partner_paid', 'peer'));
  assert.ok(!canTransition('confirmed', 'partner_failed', 'peer'));
  assert.ok(!canTransition('confirmed', 'evidenced', 'bank'), 'a bank payout waits for the partner');
  assert.ok(!canTransition('confirmed', 'evidenced'), 'bank is the default');
  // Everything before confirmed is the same machine.
  for (let i = 1; i < 7; i++) assert.ok(canTransition(HAPPY_PATH[i - 1], HAPPY_PATH[i], 'peer'), `${HAPPY_PATH[i - 1]} → ${HAPPY_PATH[i]}`);
});
