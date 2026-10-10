import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * Regression guard for scripts/check-core-no-balance.mjs.
 *
 * That script IS the non-custody claim — `move/splash_core/Move.toml`, STATUS.md
 * and SECURITY.md all point at it as the evidence that Splash structurally
 * cannot hold client funds. A control quoted as evidence has to actually work.
 *
 * The first version did not. It matched `^\s*<name>\s*:\s*<Type><` — field name
 * and unwrapped type at the start of one physical line — and an adversarial
 * review compiled a complete client omnibus into splash_core while the check
 * reported "invariant holds". Every bypass it found is pinned below, so the
 * script cannot regress to a weaker match without failing here.
 */

const CHECKER = path.resolve('scripts/check-core-no-balance.mjs');

/** Run the checker against a scratch package containing `moduleSource`. */
function runAgainst(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'splash-invariant-'));
  try {
    const sources = path.join(root, 'move', 'splash_core', 'sources');
    mkdirSync(sources, { recursive: true });
    cpSync(path.resolve('move/splash_core/sources'), sources, { recursive: true });
    for (const [relative, contents] of Object.entries(files)) {
      const full = path.join(sources, relative);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, contents);
    }
    try {
      execFileSync(process.execPath, [CHECKER], { cwd: root, stdio: 'pipe' });
      return { exitCode: 0 };
    } catch (error) {
      return { exitCode: error.status ?? 1, output: String(error.stderr ?? '') };
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('the real splash_core passes', () => {
  assert.equal(runAgainst({}).exitCode, 0, 'splash_core must hold no value today');
});

test('a plain Balance field is caught', () => {
  const r = runAgainst({
    'v.move': 'module splash_core::v;\nuse sui::balance::Balance;\nuse sui::sui::SUI;\npublic struct V has key {\n    id: UID,\n    pot: Balance<SUI>,\n}\n',
  });
  assert.equal(r.exitCode, 1);
  assert.match(r.output, /CORE INVARIANT VIOLATED/);
});

test('a Balance nested inside a Table is caught', () => {
  // The omnibus shape: per-client balances inside a container. v1 missed this,
  // which is precisely how you would build a custody ledger past the check.
  const r = runAgainst({
    'v.move': 'module splash_core::v;\nuse sui::balance::Balance;\nuse sui::table::Table;\nuse sui::sui::SUI;\npublic struct V has key {\n    id: UID,\n    per_client: Table<address, Balance<SUI>>,\n}\n',
  });
  assert.equal(r.exitCode, 1);
});

test('a Coin inside a vector is caught', () => {
  const r = runAgainst({
    'v.move': 'module splash_core::v;\nuse sui::coin::Coin;\nuse sui::sui::SUI;\npublic struct V has key {\n    id: UID,\n    float: vector<Coin<SUI>>,\n}\n',
  });
  assert.equal(r.exitCode, 1);
});

test('a Balance inside an Option is caught', () => {
  const r = runAgainst({
    'v.move': 'module splash_core::v;\nuse sui::balance::Balance;\nuse sui::sui::SUI;\npublic struct V has key {\n    id: UID,\n    reserve: Option<Balance<SUI>>,\n}\n',
  });
  assert.equal(r.exitCode, 1);
});

test('an aliased import is caught', () => {
  // `use sui::balance::Balance as Ledger;` renames the type at the import, so a
  // name-based check that does not resolve aliases sees nothing.
  const r = runAgainst({
    'v.move': 'module splash_core::v;\nuse sui::balance::Balance as Ledger;\nuse sui::sui::SUI;\npublic struct V has key {\n    id: UID,\n    house: Ledger<SUI>,\n}\n',
  });
  assert.equal(r.exitCode, 1);
  assert.match(r.output, /alias of Balance/);
});

test('a field split across two lines is caught', () => {
  const r = runAgainst({
    'v.move': 'module splash_core::v;\nuse sui::balance::Balance;\nuse sui::sui::SUI;\npublic struct V has key {\n    id: UID,\n    slush:\n        Balance<SUI>,\n}\n',
  });
  assert.equal(r.exitCode, 1);
});

test('a single-line struct is caught', () => {
  const r = runAgainst({
    'v.move': 'module splash_core::v;\nuse sui::balance::Balance;\nuse sui::sui::SUI;\npublic struct V has key { id: UID, pot: Balance<SUI> }\n',
  });
  assert.equal(r.exitCode, 1);
});

test('a module in a SUBDIRECTORY is caught', () => {
  // The Move compiler walks sources/ recursively and publishes what it finds;
  // a non-recursive readdir does not. SECURITY.md I-03 recommends a scaffolds/
  // subdirectory, so this is one refactor away from mattering.
  const r = runAgainst({
    'custody/vault.move': 'module splash_core::vault;\nuse sui::balance::Balance;\nuse sui::sui::SUI;\npublic struct HiddenVault has key {\n    id: UID,\n    pot: Balance<SUI>,\n}\n',
  });
  assert.equal(r.exitCode, 1);
  assert.match(r.output, /vault\.move/);
});

test('a TreasuryCap is caught', () => {
  const r = runAgainst({
    'v.move': 'module splash_core::v;\nuse sui::coin::TreasuryCap;\nuse sui::sui::SUI;\npublic struct V has key {\n    id: UID,\n    minter: TreasuryCap<SUI>,\n}\n',
  });
  assert.equal(r.exitCode, 1);
});

test('a Coin PARAMETER is allowed — that is the non-custodial path', () => {
  // The whole design: a coin enters and leaves within one PTB. Flagging this
  // would make the check useless, so the distinction is stored-vs-passed.
  const r = runAgainst({
    'v.move': 'module splash_core::v;\nuse sui::coin::{Self, Coin};\nuse sui::sui::SUI;\npublic fun pay(c: Coin<SUI>, to: address) {\n    transfer::public_transfer(c, to);\n}\n',
  });
  assert.equal(r.exitCode, 0, 'a Coin parameter is not custody');
});

test('the word Balance in a comment does not trip the check', () => {
  const r = runAgainst({
    'v.move': '/// This module deliberately holds no Balance<SUI> and no Coin<SUI>.\nmodule splash_core::v;\npublic struct V has key {\n    id: UID,\n    // not a Balance<SUI> field, just prose\n    n: u64,\n}\n',
  });
  assert.equal(r.exitCode, 0, 'comments are prose, not code');
});
