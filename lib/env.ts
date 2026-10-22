/**
 * The environment contract.
 *
 * Every variable the application reads is declared here, once, with its
 * shape and its development default. `validateEnvAtBoot()` runs from
 * instrumentation.ts before the first request is served: in production a
 * missing or malformed key refuses to start and names every problem at once;
 * in development the documented defaults apply and the app runs.
 *
 * Why this exists. There were 146 distinct keys read across app/, lib/ and
 * components/ through three different patterns — `process.env.X`, an aliased
 * `env.X`, and string-keyed lookups such as `process.env[FIELD_TO_ENV[f]]` —
 * with no validation anywhere. Seal's loader alone throws on twelve
 * conditions, all at request time, so two machines with different .env.local
 * files both started cleanly and then diverged on whichever route one of them
 * happened to hit first. Loud failure at boot beats silent divergence at
 * request time.
 *
 * Two rules keep it true:
 *
 *   1. Any new `process.env` read is added here in the same commit.
 *      scripts/check-env-reads.mjs enforces it under `npm run lint`: a key
 *      read anywhere that is not declared below fails the build.
 *   2. Configuration that must match between machines is a committed file,
 *      not an env var. The Seal server list moves to config/seal.<env>.json;
 *      only secrets stay here.
 *
 * Existing read sites keep working unchanged — this file validates the same
 * names they read. New code should read `getEnv()` instead, which returns the
 * coerced, typed values.
 *
 * What is required in production, and why. Unconditionally: the things the
 * app cannot run safely without — session secrets (and not the demo values
 * .env.example ships), the database, the published package, an https app
 * URL, and the cron secret. Conditionally, decided by the flags themselves:
 * settlement keys when settlement is live, vendor keys when their feature is
 * on or mocks are off. Development requires nothing and defaults everything,
 * which is what a fresh clone needs to boot.
 */
import { DEFAULT_COPILOT_MODEL } from './ai/model.ts';
import { z } from 'zod';

/* ── Shapes ───────────────────────────────────────────────────────────── */

/** bech32 secret key as printed by `sui keytool`, for the evidence sponsor only (lib/evidence-sui/sponsor.ts). */
const EVIDENCE_PRIVKEY = /^suiprivkey1[a-z0-9]{50,}$/;
/** A Solana address: base58, 32 to 44 characters. */
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const str = z.string().trim();
const optional = str.optional();
/** Empty string counts as unset, which is how `.env.example` ships blanks. */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const opt = <Out>(schema: z.ZodType<Out, unknown>) => z.preprocess(blankToUndefined, schema.optional());
const withDefault = <Out extends string | number | boolean>(schema: z.ZodType<Out, unknown>, def: Out) =>
  z.preprocess(blankToUndefined, schema.default(def));

const evidencePrivkey = opt(str.regex(EVIDENCE_PRIVKEY, 'must be a suiprivkey1… secret key'));
const solanaAddress = opt(str.regex(SOLANA_ADDRESS, 'must be a base58 Solana address'));
const url = opt(str.url());
const httpsUrl = opt(str.url().refine((u) => u.startsWith('https://') || u.startsWith('http://localhost'), 'must be https (or http://localhost)'));
const int = (def: number, min = 0) => withDefault(z.coerce.number().int().min(min), def);
const num = (def: number) => withDefault(z.coerce.number(), def);
/** The code tests `=== 'true'`; anything else is false. */
/** A key that moved into config/seal.<env>.json. Unset is the only valid
 *  state; a value means a stale .env.local or host panel, and boot names it. */
/** A key whose feature was removed. Unset is the only valid state. */
const removedFromEnv = z.preprocess(
  blankToUndefined,
  z.undefined({ error: 'no longer used — accounts are rows in `users`; remove it from .env.local and from the host' }),
);

/** A secret whose signer was removed with the earlier settlement rail. Unset is the only
 *  valid state: a stale private key left on a host is a key nobody watches. */
const removedSigner = z.preprocess(
  blankToUndefined,
  z.undefined({ error: 'its signer was removed with the earlier settlement rail (prompt 07 §4.2) — delete this secret from .env.local and from the host' }),
);

const movedToSealFile = z.preprocess(
  blankToUndefined,
  z.undefined({ error: 'moved to config/seal.<env>.json — remove it from .env.local and from the host' }),
);

const flag = (def: 'true' | 'false' = 'false') =>
  withDefault(z.enum(['true', 'false']), def).transform((v) => v === 'true');

/* ── The schema ───────────────────────────────────────────────────────── */

export const envSchema = z.object({
  NODE_ENV: withDefault(z.enum(['development', 'test', 'production']), 'development'),

  /* Solana. lib/solana/config.ts readSolanaEnv validates the values; offline
     is the default and touches no network. The client sees the cluster as
     NEXT_PUBLIC_SOLANA_CLUSTER (lib/explorer.ts). */
  SPLASH_SOLANA_MODE: opt(z.enum(['offline', 'devnet'])),
  SOLANA_CLUSTER: opt(z.enum(['devnet', 'mainnet-beta'])),
  NEXT_PUBLIC_SOLANA_CLUSTER: opt(z.enum(['devnet', 'mainnet-beta'])),
  SOLANA_RPC_URL: optional,
  /** Kora: Splash's fee payer, so nobody needs SOL. Required in devnet mode. */
  KORA_RPC_URL: optional,
  KORA_API_KEY: optional,
  /** Where Solana payments live (lib/solana-app/runtime.ts): Postgres when DATABASE_URL is set, unless 'memory'. */
  SOLANA_PAYMENT_STORE: opt(z.enum(['memory', 'postgres'])),
  /** The non-custody gate (lib/server/custody-phase.ts). '2' only when a licence allows holding funds; anything else is Phase 0. */
  SPLASH_CUSTODY_PHASE: withDefault(z.enum(['0', '2']), '0'),
  /** Splash's fee wallet on Solana: receives the audit-anchor fee on USDC sent
   *  out of Splash, in the same transaction, when STABLECOIN_ANCHOR_FEE is on.
   *  A real fee must have a real, named destination: never defaulted. */
  SPLASH_FEE_ADDRESS: solanaAddress,
  /* 'on' charges the audit-anchor fee on USDC sent out of Splash (lib/payments/stablecoin-lane.ts). */
  STABLECOIN_ANCHOR_FEE: opt(z.enum(['on', 'off'])),
  /* Signers removed with the earlier settlement rail: must be unset. */
  OPERATOR_SUI_PRIVATE_KEY: removedSigner,
  SUI_SPONSOR_PRIVATE_KEY: removedSigner,
  /** Chainalysis's free sanctions-screening API. Unset: wallet recipients
   *  are saved unscreened, and reach mainnet only through a named admin's
   *  attestation (lib/server/wallet-screening.ts). */
  CHAINALYSIS_SANCTIONS_API_KEY: opt(str.min(8)),
  USE_MOCK_APIS: flag('false'),
  /* 'stablecoin' opens the USDC wallet lane only (lib/launch-scope-rules.ts):
     fiat, payout runs and treasury answer 403, and the keys only they use
     stop being required. Default 'full'. */
  LAUNCH_SCOPE: withDefault(z.enum(['full', 'stablecoin']), 'full'),

  /* Zeke drafts. lib/agent/simulate-draft.ts: 'live' fails closed until the
     Solana simulation lands (Phase 3). */
  OXWAL_CHAIN_MODE: withDefault(z.enum(['mock', 'live']), 'mock'),
  OXWAL_FORCE_LOCAL: flag('false'),
  OXWAL_OPERATOR_ROLE: withDefault(str, 'APPROVER'),

  /* Seal. The committee, threshold, package and policy live in a committed
     file — config/seal.<NODE_ENV>.json — loaded and validated by
     lib/evidence-sui/seal-config.ts, which validateEnvAtBoot() runs so its twelve
     checks happen at boot. The seven keys below MOVED into that file: each
     is declared here only so that, if one is still set, boot fails and
     names it. Two sources for one setting is how Seal diverged. */
  SEAL_CONFIG_FILE: optional,

  /* Evidence on Sui (lib/evidence-sui/): Seal encryption + Walrus storage +
     the allowlist sponsor. The only Sui the Solana build uses. */
  EVIDENCE_SUI_NETWORK: withDefault(z.enum(['testnet', 'mainnet']), 'testnet'),
  EVIDENCE_SUI_RPC_URL: url,
  /** Gas for allowlist updates only. Devnet/testnet; mainnet must use a KMS (refused here). */
  EVIDENCE_SPONSOR_SUI_PRIVATE_KEY: evidencePrivkey,
  /** Walrus storage period in epochs for each evidence blob (stored permanent). */
  WALRUS_EPOCHS: int(53, 1),
  SEAL_KEY_SERVER_ENDPOINTS: movedToSealFile,
  SEAL_KEY_SERVER_URLS: movedToSealFile,
  SEAL_KEY_SERVER_MODE: movedToSealFile,
  SEAL_THRESHOLD: movedToSealFile,
  SEAL_PACKAGE_ID: movedToSealFile,
  SEAL_POLICY_OBJECT_ID: movedToSealFile,
  SEAL_APPROVE_TARGET: movedToSealFile,
  /* What stays in env: operational and sensitive, not shared config. */
  SEAL_HEALTH_TIMEOUT_MS: int(10_000, 1),
  SEAL_ALERT_WEBHOOK_URL: httpsUrl,

  /* Walrus. lib/evidence-sui/walrus.ts. Mocked when USE_MOCK_APIS or unset. */
  WALRUS_PUBLISHER_URL: url,
  WALRUS_AGGREGATOR_URL: url,

  /* Storage and data directory. */
  DATABASE_URL: opt(str.regex(/^postgres(ql)?:\/\//, 'must be a postgres:// or postgresql:// URL')),
  DATABASE_POOL_MAX: int(10, 1),
  REDIS_URL: url,
  /* How many proxies sit in front of the app; the client address for rate
     limits is read that many places from the end of X-Forwarded-For
     (lib/server/rate-limit.ts). Default 1 (nginx on the Droplet). */
  TRUSTED_PROXY_HOPS: int(1, 0),
  /* A header the edge sets to the caller's address, read instead of
     X-Forwarded-For: `do-connecting-ip` on App Platform. Blank on the
     Droplet, where a caller could send it. */
  CLIENT_IP_HEADER: opt(str.regex(/^[A-Za-z0-9-]{1,64}$/, 'must be a header name, e.g. do-connecting-ip')),
  REDIS_TIMEOUT_MS: int(500, 1),
  SPLASH_DATA_DIR: optional,

  /* Sessions and staff auth. lib/server/customer-auth.ts, admin-auth.ts.
     The demo values are refused in production below. */
  CUSTOMER_SESSION_SECRET: optional,
  /* Removed with the single-credential login. Accounts are rows in `users`
     with a scrypt hash, so these two governed nothing after that — and a
     password sitting in an environment file that no longer decides anything
     is worse than none, because it reads as a control. Declared so a stale
     value fails boot by name. */
  CUSTOMER_EMAIL: removedFromEnv,
  CUSTOMER_PASSWORD: removedFromEnv,
  CUSTOMER_ORGANIZATION: optional,
  CUSTOMER_SELF_SIGNUP_ENABLED: flag('false'),
  CUSTOMER_RECOVERY_EMAIL: opt(str.email()),
  /* Email delivery. lib/auth/email-transport.ts. Verification links and
     password resets go through it, and a membership grant requires a
     verified mailbox, so without delivery nobody can be granted anything.
     `console` prints the link to the server log and is development only. */
  EMAIL_TRANSPORT: withDefault(z.enum(['console', 'resend']), 'console'),
  EMAIL_API_KEY: optional,
  EMAIL_FROM: opt(str.email()),
  ADMIN_SESSION_SECRET: optional,
  ADMIN_EMAIL: opt(str.email()),
  ADMIN_PASSWORD: optional,
  SPLASH_TOTP_SECRET: optional,
  KILLED_ENTITY_DOMAINS: optional,
  CRON_SECRET: optional,
  ALLOWED_ORIGINS: optional,
  NEXT_PUBLIC_APP_URL: withDefault(str.url(), 'http://localhost:3000'),
  NEXT_PUBLIC_SUPPORT_EMAIL: opt(str.email()),

  /**
   * "Continue with Google" (lib/auth/google-oidc.ts): plain OIDC, code + PKCE.
   * Identity only; no key material comes from Google. Use a separate OAuth
   * client per environment: the ID token's `aud` must equal this client id.
   */
  FEATURE_GOOGLE_SIGNIN: flag('false'),
  GOOGLE_OIDC_CLIENT_ID: optional,
  GOOGLE_OIDC_CLIENT_SECRET: optional,
  /** Must be registered with Google exactly, e.g. https://app.example/api/auth/google/callback. */
  GOOGLE_OIDC_REDIRECT_URI: httpsUrl,

  /**
   * WebAuthn relying-party id. A credential is bound to it and the browser
   * will not offer it on any other host, so a passkey enrolled on localhost
   * cannot be used on v1.splashz.xyz. Decided once per environment; changing
   * it after anyone has enrolled orphans every existing credential.
   *
   * Deliberately configuration rather than derived from the request Host —
   * an attacker who could influence that header could otherwise enrol a
   * credential under an rpId they control.
   */
  PASSKEY_RP_ID: optional,

  /* KYB and compliance. lib/compliance/*. */
  FEATURE_KYB_GATE: flag('false'),
  SUMSUB_APP_TOKEN: optional,
  SUMSUB_SECRET_KEY: optional,
  SUMSUB_LEVEL_NAME: withDefault(str, 'splash-kyb'),
  SUMSUB_BASE_URL: withDefault(str.url(), 'https://api.sumsub.com'),
  DEFAULT_KYC_TIER: int(1, 0),
  KYB_TIER1_MAX_USD: int(50_000),
  KYB_TIER2_MAX_USD: int(250_000),
  KYB_TIER3_MAX_USD: int(1_000_000),
  AML_REVIEW_THRESHOLD_USD: int(10_000),
  RAIL_MAX_ACH_USD: int(1_000_000),
  RAIL_MAX_WIRE_USD: int(1_000_000),
  RAIL_MAX_FPX_USD: int(250_000),
  RAIL_MAX_AIRWALLEX_USD: int(1_000_000),
  MIN_SETTLEMENT_USD: opt(z.coerce.number().min(0)),
  LEGAL_APPROVED: flag('false'),

  /* Quotes, fees, corridors. lib/server/quote.ts, pdax.ts, operations.ts. */
  PLATFORM_FEE_BPS: opt(z.coerce.number().int().min(0).max(200)),
  FIXED_FEE_CENTS: int(0),
  QUOTE_TTL_SECONDS: int(30, 1),
  FUNDING_DISCOUNT_BPS: int(0),
  PHP_PER_USDC: num(56.5),
  MYR_TO_USD_RATE: opt(z.coerce.number().positive()),
  FALLBACK_MYR_USD_RATE: opt(z.coerce.number().positive()),
  RATE_HOLD_HOURS: int(48, 1),
  NEXT_PUBLIC_DEMO_MODE: flag('false'),
  NEXT_PUBLIC_STORED_BALANCE_CORRIDORS: optional,
  STORED_BALANCE_CORRIDORS: optional,
  SWEEP_ACCOUNT_ENABLED: withDefault(z.enum(['true', 'false']), 'true').transform((v) => v !== 'false'),
  TREASURY_EXECUTION_ENABLED: flag('false'),
  COMPOSED_TREASURY_ALLOCATION_BPS: int(100, 0),
  MAYBANK_INTERCOMPANY_ENABLED: flag('true'),

  /* Funding rails and providers. lib/server/funding-*.ts, stripe.ts,
     airwallex.ts, lib/funding/registry.ts. */
  CARD_FUNDING_ENABLED: flag('false'),
  FEATURE_DUAL_FUNDING: flag('true'),
  CARD_FUNDING_SURCHARGE_BPS: int(290),
  STRIPE_SECRET_KEY: optional,
  AIRWALLEX_API_KEY: optional,
  FUNDING_WEBHOOK_SECRET: optional,
  FUNDING_CCTP_DEPOSIT_ADDRESSES_JSON: opt(str.refine((s) => { try { return typeof JSON.parse(s) === 'object'; } catch { return false; } }, 'must be a JSON object')),
  FUNDING_SELF_CUSTODY_STAGED_LIMIT_USD: int(10_000),
  FUNDING_ASSET_USDC_ENABLED: flag('true'),
  FUNDING_RAIL_SOLANA_ENABLED: flag('true'),
  FUNDING_RAIL_CCTP_ENABLED: flag('true'),
  FUNDING_CCTP_ETHEREUM_ENABLED: flag('false'),
  FUNDING_CCTP_BASE_ENABLED: flag('false'),
  FUNDING_CCTP_ARBITRUM_ENABLED: flag('false'),
  FUNDING_PROVIDER_STRIPE_ENABLED: flag('true'),
  FUNDING_PROVIDER_AIRWALLEX_ENABLED: flag('true'),
  USDC_AVAILABLE_MICRO: opt(z.coerce.number().int().min(0)),

  /* Payout and settlement partners. Mocked when USE_MOCK_APIS or unset. */
  PDAX_API_BASE_URL: url,
  PDAX_API_KEY: optional,
  LABUAN_API_BASE_URL: withDefault(str.url(), 'https://settlement.splash-labuan.internal'),
  LABUAN_API_KEY: optional,
  LABUAN_OTC_MIN_USD: int(10_000),

  OPERATING_BUFFER_USD: int(5_000),
  BATCH_SAVED_BPS_PER_ROW: int(6),
  SPLASH_BUSINESS_TIMEZONE: withDefault(str, 'Asia/Singapore'),
  PROOF_TX_1: optional,
  PROOF_TX_2: optional,

  /* Copilot and memory. */
  ANTHROPIC_API_KEY: optional,
  /** Overrides lib/ai/model.ts. The old default here was a model id that does
   *  not exist, so every call threw and fell back to canned text. */
  ANTHROPIC_MODEL: withDefault(str, DEFAULT_COPILOT_MODEL),

  // WhatsApp approvals, through Twilio. All three are needed together —
  // `whatsappConfigured()` is false unless every one is set, because a
  // half-configured sender fails at the moment an approval is requested.
  TWILIO_ACCOUNT_SID: optional,
  TWILIO_AUTH_TOKEN: optional,
  /** The WhatsApp-enabled sender, E.164. */
  TWILIO_WHATSAPP_FROM: optional,
  /** The URL Twilio was configured to call. Twilio signs the URL it was
   *  given, which behind a proxy is not the URL the request arrives at — so
   *  signature verification uses this when set, and the request URL when not. */
  TWILIO_WEBHOOK_URL: optional,
  /** The Content SID (HX…) of an approved "verification code" template,
   *  `Your {{1}} code is {{2}}`. WhatsApp delivers a business-initiated message
   *  only as an approved template; free text reaches a number only within 24
   *  hours of it last messaging the sender. Unset: step-up codes go as free
   *  text (lib/server/whatsapp.ts sendWhatsAppCode). */
  TWILIO_WHATSAPP_CODE_CONTENT_SID: opt(str.regex(/^HX[0-9a-fA-F]{32}$/, 'must be a Twilio Content SID (HX + 32 hex)')),

  /** Signs Sumsub's inbound webhooks. Without it the KYB verdict endpoint
   *  refuses every request, which is the correct direction: an unverified
   *  webhook could launder an unchecked business into the state a human
   *  signs off on the basis that a provider already checked it. */
  SUMSUB_WEBHOOK_SECRET: optional,

  /** Route engine home lane for this build. */
  ENGINE_HOME_CHAIN: opt(z.enum(['solana', 'arbitrum'])),
  /** HMAC secret for the mock payout partner's webhooks (devnet demo only). */
  MOCK_PARTNER_WEBHOOK_SECRET: optional,
});

export type Env = z.infer<typeof envSchema>;

/** Every declared key. scripts/check-env-reads.mjs compares reads to this. */
export const ENV_KEYS: readonly string[] = Object.keys(envSchema.shape);

/** Keys read by dynamic name. lib/auth/totp.ts reads
 *  `SPLASH_TOTP_SECRET_${ACCOUNT}` for per-tenant secrets; lib/chain/compose.ts
 *  reads `OXWAL_MOVE_TARGET_${KIND}` for per-proposal-kind Move targets. */
export const ENV_KEY_PREFIXES: readonly string[] = ['SPLASH_TOTP_SECRET_', 'OXWAL_MOVE_TARGET_'];

/* ── Production rules ─────────────────────────────────────────────────── */

/** The values .env.example ships for local demo. Never acceptable in prod. */
const DEMO_VALUES: Partial<Record<keyof Env, string[]>> = {
  ADMIN_PASSWORD: ['splash-admin-demo'],
};

type Issue = { key: string; message: string };

function productionIssues(env: Env): Issue[] {
  const issues: Issue[] = [];
  const need = (key: keyof Env, why: string) => {
    if (env[key] === undefined || env[key] === '') issues.push({ key, message: `required in production — ${why}` });
  };
  const notDemo = (key: keyof Env) => {
    const v = env[key];
    if (typeof v === 'string' && DEMO_VALUES[key]?.includes(v)) {
      issues.push({ key, message: `is the demo value from .env.example; set a real one` });
    }
  };

  /* Unconditional: what the app cannot run safely without. */
  need('CUSTOMER_SESSION_SECRET', 'sessions would be signed with nothing');
  need('ADMIN_SESSION_SECRET', 'staff sessions would be signed with nothing, and lib/evidence-sui/seal.ts falls back to a hard-coded dev key');
  need('CRON_SECRET', 'every /api/cron route would accept any caller');
  need('DATABASE_URL', 'authority and persistence require Postgres');
  notDemo('ADMIN_PASSWORD');
  if (!env.NEXT_PUBLIC_APP_URL.startsWith('https://')) {
    issues.push({ key: 'NEXT_PUBLIC_APP_URL', message: 'must be https in production' });
  }

  /* Email: a grant requires a verified mailbox, and verification is a link
     delivered to it. `console` only prints the link to the server log, so a
     production deployment on it can never verify anyone — and therefore
     never grant anyone anything. */
  if (env.EMAIL_TRANSPORT === 'console') {
    issues.push({
      key: 'EMAIL_TRANSPORT',
      message: 'is `console`, which only prints verification links to the server log; set `resend` — no account can be verified, and so none granted access, without delivery',
    });
  }
  if (env.EMAIL_TRANSPORT === 'resend') {
    need('EMAIL_API_KEY', 'EMAIL_TRANSPORT=resend');
    need('EMAIL_FROM', 'EMAIL_TRANSPORT=resend — the sender address');
  }

  /* Solana: in devnet mode every vault transaction is sponsored, so the fee
     payer must be named. Mainnet is refused by readSolanaEnv in this build. */
  if (env.SPLASH_SOLANA_MODE === 'devnet') {
    need('KORA_RPC_URL', 'SPLASH_SOLANA_MODE=devnet sends sponsored transactions; without the fee payer they are refused');
  }
  if (env.STABLECOIN_ANCHOR_FEE === 'on') {
    need('SPLASH_FEE_ADDRESS', 'STABLECOIN_ANCHOR_FEE=on charges a fee, which needs a named destination');
  }

  /* LAUNCH_SCOPE=stablecoin: the USDC wallet lane only. Every route that would
     pay out or take fiat answers 403 (lib/server/launch-scope.ts), so the
     keys only those routes use are not required — and nothing may fake what
     the scope leaves out. */
  const stablecoinOnly = env.LAUNCH_SCOPE === 'stablecoin';
  if (stablecoinOnly) {
    const scoped = 'LAUNCH_SCOPE=stablecoin opens the USDC wallet lane only';
    if (env.USE_MOCK_APIS) issues.push({ key: 'USE_MOCK_APIS', message: `must be false: ${scoped}, and mocks would fake settlement` });
    if (env.NEXT_PUBLIC_DEMO_MODE) issues.push({ key: 'NEXT_PUBLIC_DEMO_MODE', message: `must be false: ${scoped}, and demo mode credits deposits nobody made` });
    if (env.CARD_FUNDING_ENABLED) issues.push({ key: 'CARD_FUNDING_ENABLED', message: `must be false: ${scoped}` });
    if (env.TREASURY_EXECUTION_ENABLED) issues.push({ key: 'TREASURY_EXECUTION_ENABLED', message: `must be false: ${scoped}` });
  }

  /* Vendors: required when their feature is on. Mocks and demo mode make
     them optional, which is a posture decision recorded by those flags. */
  const vendorsLive = !env.USE_MOCK_APIS && !env.NEXT_PUBLIC_DEMO_MODE && !stablecoinOnly;
  if (vendorsLive) {
    need('PDAX_API_KEY', 'PHP payout is live (USE_MOCK_APIS and NEXT_PUBLIC_DEMO_MODE are both off)');
    need('WALRUS_PUBLISHER_URL', 'audit proofs are live');
    need('WALRUS_AGGREGATOR_URL', 'audit proofs are live');
  }
  if (env.CARD_FUNDING_ENABLED || (vendorsLive && env.FUNDING_PROVIDER_STRIPE_ENABLED)) {
    need('STRIPE_SECRET_KEY', env.CARD_FUNDING_ENABLED ? 'CARD_FUNDING_ENABLED=true' : 'Stripe funding is enabled and mocks are off');
  }
  if (vendorsLive && env.FUNDING_PROVIDER_AIRWALLEX_ENABLED) need('AIRWALLEX_API_KEY', 'Airwallex funding is enabled and mocks are off');
  if (env.FEATURE_KYB_GATE) {
    need('SUMSUB_APP_TOKEN', 'FEATURE_KYB_GATE=true');
    need('SUMSUB_SECRET_KEY', 'FEATURE_KYB_GATE=true');
  }
  if (env.FEATURE_GOOGLE_SIGNIN) {
    need('GOOGLE_OIDC_CLIENT_ID', 'FEATURE_GOOGLE_SIGNIN=true');
    need('GOOGLE_OIDC_CLIENT_SECRET', 'FEATURE_GOOGLE_SIGNIN=true');
    need('GOOGLE_OIDC_REDIRECT_URI', 'FEATURE_GOOGLE_SIGNIN=true');
  }

  return issues;
}

/* ── Entry points ─────────────────────────────────────────────────────── */

export class EnvValidationError extends Error {
  readonly issues: Issue[];

  constructor(issues: Issue[], mode: string) {
    super(
      `Environment is invalid for NODE_ENV=${mode} — ${issues.length} problem${issues.length === 1 ? '' : 's'}:\n` +
        issues.map((i) => `  ${i.key}: ${i.message}`).join('\n') +
        '\n\nEvery variable is declared in lib/env.ts. Run `npm run doctor` for a full table.',
    );
    this.issues = issues;
    this.name = 'EnvValidationError';
  }
}

/**
 * Validate a raw environment. Pure: takes the object, returns the typed env
 * or throws EnvValidationError naming every problem. Tests call this with
 * literal objects; the boot path calls it with process.env.
 */
export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(raw);
  const mode = raw.NODE_ENV ?? 'development';
  const issues: Issue[] = [];

  if (!result.success) {
    for (const issue of result.error.issues) {
      issues.push({ key: issue.path.map(String).join('.') || '(root)', message: issue.message });
    }
  }
  if (mode === 'production' && result.success) {
    issues.push(...productionIssues(result.data));
  }
  if (issues.length) throw new EnvValidationError(issues, mode);
  return result.data as Env;
}

let cached: Env | undefined;

/** The validated environment. Memoised; first call validates. */
export function getEnv(): Env {
  return (cached ??= parseEnv(process.env));
}

/**
 * Boot-time check. Called from instrumentation.ts before anything else so a
 * bad environment refuses to start rather than failing on the first request
 * that happens to touch the bad key. Also runs the Seal loader, whose twelve
 * request-time throws become boot-time ones.
 */
export async function validateEnvAtBoot(): Promise<Env> {
  const env = getEnv();
  const { getSealConfig } = await import('./evidence-sui/seal-config.ts');
  try {
    getSealConfig();
  } catch (error) {
    throw new EnvValidationError(
      [{ key: 'SEAL_*', message: error instanceof Error ? error.message : String(error) }],
      env.NODE_ENV,
    );
  }
  return env;
}
