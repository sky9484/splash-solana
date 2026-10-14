import assert from 'node:assert/strict';
import test from 'node:test';

import { EnvValidationError, ENV_KEYS, parseEnv } from '../lib/env.ts';

/* parseEnv is pure — it takes the raw object and never touches process.env —
   so every case here is a literal environment, and nothing on this machine
   leaks into the assertions. */

/** A well-formed base58 Solana address (44 characters). */
const SOL_ADDRESS = '9fZ34EK7' + 'q'.repeat(36);
const KEY = 'suiprivkey1' + 'q'.repeat(58);

/** A production environment that passes. Cases below remove one thing. */
const PROD_OK = {
  NODE_ENV: 'production',
  CUSTOMER_SESSION_SECRET: 's'.repeat(32),
  ADMIN_SESSION_SECRET: 'a'.repeat(32),
  CRON_SECRET: 'c'.repeat(32),
  DATABASE_URL: 'postgresql://user:pw@db.example/splash?sslmode=require',
  NEXT_PUBLIC_APP_URL: 'https://v1.splashz.xyz',
  ADMIN_PASSWORD: 'not-the-demo-value-either',
  // Sandbox posture: mocks on, demo on, so no vendor key is demanded.
  USE_MOCK_APIS: 'true',
  NEXT_PUBLIC_DEMO_MODE: 'true',
  // Verification links need a real transport in production (WS1, X5).
  EMAIL_TRANSPORT: 'resend',
  EMAIL_API_KEY: 're_test_key',
  EMAIL_FROM: 'no-reply@splash.example',
};

const keysOf = (fn) => {
  try { fn(); } catch (e) {
    assert.ok(e instanceof EnvValidationError, `expected EnvValidationError, got ${e?.constructor?.name}: ${e?.message}`);
    return e.issues.map((i) => i.key);
  }
  assert.fail('expected parseEnv to throw');
};

test('development: an empty environment boots on the documented defaults', () => {
  const env = parseEnv({ NODE_ENV: 'development' });
  assert.equal(env.SPLASH_SOLANA_MODE, undefined, 'unset is offline (lib/solana/config.ts)');
  assert.equal(env.SPLASH_CUSTODY_PHASE, '0');
  assert.equal(env.NEXT_PUBLIC_APP_URL, 'http://localhost:3000');
  assert.equal(env.QUOTE_TTL_SECONDS, 30);
  // Defaults match what the read sites actually do, not what .env.example
  // suggests: registry.ts enables these rails unless told otherwise.
  assert.equal(env.FUNDING_RAIL_SOLANA_ENABLED, true);
  assert.equal(env.FUNDING_RAIL_CCTP_ENABLED, true);
  assert.equal(env.SWEEP_ACCOUNT_ENABLED, true);
  assert.equal(env.USE_MOCK_APIS, false);
});

test('a blank value counts as unset, which is how .env.example ships every key', () => {
  const env = parseEnv({ NODE_ENV: 'development', SPLASH_FEE_ADDRESS: '', QUOTE_TTL_SECONDS: '', SOLANA_CLUSTER: '' });
  assert.equal(env.SPLASH_FEE_ADDRESS, undefined);
  assert.equal(env.QUOTE_TTL_SECONDS, 30);
  assert.equal(env.SOLANA_CLUSTER, undefined);
});

test('production: an empty environment refuses to start and names every missing key at once', () => {
  const keys = keysOf(() => parseEnv({ NODE_ENV: 'production' }));
  for (const k of ['CUSTOMER_SESSION_SECRET', 'ADMIN_SESSION_SECRET', 'CRON_SECRET', 'DATABASE_URL', 'NEXT_PUBLIC_APP_URL']) {
    assert.ok(keys.includes(k), `${k} should be named; got ${keys.join(', ')}`);
  }
});

test('a credential key removed with the single-credential login is refused if still set', () => {
  // Accounts are rows in `users` now. A password left in .env.local governs
  // nothing, so leaving it there silently would misrepresent a control.
  const keys = keysOf(() => parseEnv({ NODE_ENV: 'development', CUSTOMER_PASSWORD: 'anything' }));
  assert.deepEqual(keys, ['CUSTOMER_PASSWORD']);
  assert.doesNotThrow(() => parseEnv({ NODE_ENV: 'development', CUSTOMER_PASSWORD: '' }));
});

test('a signer removed with the earlier settlement rail is refused if still set, in any mode', () => {
  // A stale private key on a host is a key nobody watches.
  const keys = keysOf(() => parseEnv({ NODE_ENV: 'development', OPERATOR_SUI_PRIVATE_KEY: KEY, SUI_SPONSOR_PRIVATE_KEY: KEY }));
  assert.deepEqual(keys.sort(), ['OPERATOR_SUI_PRIVATE_KEY', 'SUI_SPONSOR_PRIVATE_KEY']);
  assert.doesNotThrow(() => parseEnv({ NODE_ENV: 'development', OPERATOR_SUI_PRIVATE_KEY: '' }));
});

test('production: a complete sandbox environment passes', () => {
  const env = parseEnv(PROD_OK);
  assert.equal(env.NODE_ENV, 'production');
});

test('production: devnet mode needs the fee payer; offline does not', () => {
  const devnet = keysOf(() => parseEnv({ ...PROD_OK, SPLASH_SOLANA_MODE: 'devnet' }));
  assert.deepEqual(devnet, ['KORA_RPC_URL']);
  assert.doesNotThrow(() => parseEnv({ ...PROD_OK, SPLASH_SOLANA_MODE: 'devnet', KORA_RPC_URL: 'https://kora.example' }));
  assert.doesNotThrow(() => parseEnv({ ...PROD_OK, SPLASH_SOLANA_MODE: 'offline' }));
});

test('production: an anchor fee needs a named Solana destination', () => {
  const keys = keysOf(() => parseEnv({ ...PROD_OK, STABLECOIN_ANCHOR_FEE: 'on' }));
  assert.deepEqual(keys, ['SPLASH_FEE_ADDRESS']);
  assert.doesNotThrow(() => parseEnv({ ...PROD_OK, STABLECOIN_ANCHOR_FEE: 'on', SPLASH_FEE_ADDRESS: SOL_ADDRESS }));
});

test('production: vendor keys are demanded only when mocks and demo mode are both off', () => {
  const keys = keysOf(() => parseEnv({ ...PROD_OK, USE_MOCK_APIS: 'false', NEXT_PUBLIC_DEMO_MODE: 'false' }));
  for (const k of ['PDAX_API_KEY', 'WALRUS_PUBLISHER_URL', 'AIRWALLEX_API_KEY', 'STRIPE_SECRET_KEY']) {
    assert.ok(keys.includes(k), `${k} should be named once vendors are live`);
  }
});

test('production: FEATURE_GOOGLE_SIGNIN=true requires the client id, secret and redirect URI', () => {
  const keys = keysOf(() => parseEnv({ ...PROD_OK, FEATURE_GOOGLE_SIGNIN: 'true' }));
  assert.deepEqual(keys.sort(), ['GOOGLE_OIDC_CLIENT_ID', 'GOOGLE_OIDC_CLIENT_SECRET', 'GOOGLE_OIDC_REDIRECT_URI']);
});

test('Google sign-in off: none of its keys is demanded', () => {
  assert.doesNotThrow(() => parseEnv({ ...PROD_OK }), 'production boots without any GOOGLE_OIDC_* key while the flag is off');
});

test('a Seal key that moved into config/ is refused by name if still set, in any mode', () => {
  const dev = keysOf(() => parseEnv({ NODE_ENV: 'development', SEAL_THRESHOLD: '2', SEAL_KEY_SERVER_ENDPOINTS: '[]' }));
  assert.deepEqual(dev.sort(), ['SEAL_KEY_SERVER_ENDPOINTS', 'SEAL_THRESHOLD']);
  // blank is unset, which is how .env.example ships it — not an error
  assert.doesNotThrow(() => parseEnv({ NODE_ENV: 'development', SEAL_THRESHOLD: '' }));
});

test('a malformed Solana address is rejected with the shape it needs, in any mode', () => {
  const dev = keysOf(() => parseEnv({ NODE_ENV: 'development', SPLASH_FEE_ADDRESS: '0x' + 'ab'.repeat(32) }));
  assert.deepEqual(dev, ['SPLASH_FEE_ADDRESS']);
  const prod = keysOf(() => parseEnv({ ...PROD_OK, SPLASH_FEE_ADDRESS: 'not-an-address' }));
  assert.ok(prod.includes('SPLASH_FEE_ADDRESS'));
});

test('the error message names the mode, the count, and every key, so a fresh clone can act on it', () => {
  try {
    parseEnv({ NODE_ENV: 'production' });
    assert.fail('should throw');
  } catch (e) {
    assert.match(e.message, /NODE_ENV=production/);
    assert.match(e.message, /\d+ problems?:/);
    assert.match(e.message, /DATABASE_URL: required in production/);
    assert.match(e.message, /npm run doctor/);
  }
});

test('the schema declares every key the guard will look for', () => {
  assert.ok(ENV_KEYS.length >= 120, `expected the full inventory, got ${ENV_KEYS.length}`);
  assert.ok(ENV_KEYS.includes('SOLANA_CLUSTER'));
  assert.ok(ENV_KEYS.includes('EVIDENCE_SUI_NETWORK'), 'the evidence layer keeps its own keys');
  assert.ok(ENV_KEYS.includes('SEAL_KEY_SERVER_ENDPOINTS'));
  assert.ok(ENV_KEYS.includes('FEATURE_DUAL_FUNDING'));
});
