import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify as cryptoVerify } from 'node:crypto';

/**
 * "Continue with Google": plain OpenID Connect, authorization code + PKCE.
 *
 * Google proves WHO is signing in. It never proves anything about money: no
 * key is derived from the Google identity, and approvals are signed by the
 * member's device key (lib/solana/device-key.ts). A stolen Google session
 * gets an account and a setup screen, not a signature on a vault.
 *
 * Every check below is fail-closed and happens on the server:
 *   - the token is a canonical three-segment JWT, RS256 only (no alg confusion);
 *   - the signature verifies against Google's published JWKS;
 *   - `iss` is Google, `aud` is OUR client id for THIS environment, `exp` and
 *     `iat` are fresh;
 *   - `nonce` equals the one this server generated for this browser, kept in
 *     a signed, short-lived, httpOnly cookie. It is REQUIRED, never optional;
 *   - `email_verified` is the boolean `true`, or the sign-in is refused.
 *
 * The strict decoding and claim checks were carried over from the earlier
 * build's Google verifier, minus everything Sui, with the nonce made mandatory.
 */

export type GoogleIdClaims = {
  iss: string;
  sub: string;
  aud: string;
  email: string;
  emailVerified: true;
  name?: string;
  nonce: string;
  exp: number;
  iat: number;
};

export class GoogleOidcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'GoogleOidcError';
    this.code = code;
  }
}

export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
/** Google publishes two spellings of its issuer. */
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export interface GoogleOidcConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** null when Google sign-in is off or not fully configured: the button is hidden and the routes 404. */
export function readGoogleOidcConfig(env: NodeJS.ProcessEnv = process.env): GoogleOidcConfig | null {
  if (env.FEATURE_GOOGLE_SIGNIN !== 'true') return null;
  const clientId = (env.GOOGLE_OIDC_CLIENT_ID ?? '').trim();
  const clientSecret = (env.GOOGLE_OIDC_CLIENT_SECRET ?? '').trim();
  const redirectUri = (env.GOOGLE_OIDC_REDIRECT_URI ?? '').trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

// ── Strict JWT decoding ─────────────────────────────────────────────────────

const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;

function decodeSegment(segment: string, what: string): Record<string, unknown> {
  // Canonical base64url only: no '=' padding, no '+' or '/', nothing exotic.
  if (!BASE64URL_SEGMENT.test(segment)) {
    throw new GoogleOidcError('malformed_token', `${what} is not canonical base64url`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    throw new GoogleOidcError('malformed_token', `${what} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new GoogleOidcError('malformed_token', `${what} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function requireString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new GoogleOidcError('missing_claim', `${key} claim is missing or not a string`);
  }
  return value;
}

function requireNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new GoogleOidcError('missing_claim', `${key} claim is missing or not a number`);
  }
  return value;
}

// ── JWKS ────────────────────────────────────────────────────────────────────

type Jwk = { kid?: string; kty?: string; alg?: string; use?: string; n?: string; e?: string };

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 10 * 60 * 1000;

async function fetchJwks(): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  const response = await fetch(GOOGLE_JWKS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new GoogleOidcError('jwks_unavailable', `Google JWKS returned HTTP ${response.status}`);
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  if (keys.length === 0) throw new GoogleOidcError('jwks_unavailable', 'Google JWKS contained no keys');
  jwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

/** Test seam: lets the suite inject a key set without network access. */
export function primeGoogleJwksForTesting(keys: Jwk[]): void {
  jwksCache = { keys, fetchedAt: Date.now() };
}

export function clearGoogleJwksForTesting(): void {
  jwksCache = null;
}

// ── ID token verification ───────────────────────────────────────────────────

export interface VerifyGoogleIdTokenInput {
  idToken: string;
  /** Our client id for this environment. A token minted for any other app is refused. */
  clientId: string;
  /** The nonce this server generated for this sign-in attempt. Required. */
  expectedNonce: string;
  now?: Date;
  /** Allowed clock skew for exp/iat, seconds. */
  skewSeconds?: number;
}

export async function verifyGoogleIdToken(input: VerifyGoogleIdTokenInput): Promise<GoogleIdClaims> {
  if (!input.clientId) throw new GoogleOidcError('not_configured', 'no Google client id configured');
  if (!input.expectedNonce) throw new GoogleOidcError('bad_nonce', 'a nonce is required for every sign-in');
  const nowMs = (input.now ?? new Date()).getTime();
  const skew = input.skewSeconds ?? 60;

  const segments = input.idToken.split('.');
  if (segments.length !== 3) throw new GoogleOidcError('malformed_token', 'JWT must have exactly three segments');
  const [headerSeg, payloadSeg, signatureSeg] = segments;
  const header = decodeSegment(headerSeg, 'header');
  const payload = decodeSegment(payloadSeg, 'payload');

  // Only RS256. Refusing to read `alg` loosely is what blocks alg-confusion.
  if (header.alg !== 'RS256') {
    throw new GoogleOidcError('bad_algorithm', `unsupported alg ${String(header.alg)}; only RS256 is accepted`);
  }
  if (!BASE64URL_SEGMENT.test(signatureSeg)) throw new GoogleOidcError('malformed_token', 'signature is not canonical base64url');

  const keys = await fetchJwks();
  const kid = typeof header.kid === 'string' ? header.kid : '';
  const candidates = kid ? keys.filter((key) => key.kid === kid) : keys;
  if (candidates.length === 0) throw new GoogleOidcError('unknown_key', `no JWKS key matched kid ${kid || '(none)'}`);

  const signingInput = Buffer.from(`${headerSeg}.${payloadSeg}`, 'utf8');
  const signature = Buffer.from(signatureSeg, 'base64url');
  const signatureValid = candidates.some((jwk) => {
    try {
      return cryptoVerify('RSA-SHA256', signingInput, createPublicKey({ key: jwk as never, format: 'jwk' }), signature);
    } catch {
      return false;
    }
  });
  if (!signatureValid) throw new GoogleOidcError('bad_signature', 'JWT signature did not verify against Google JWKS');

  // Claims are read AFTER the signature, never before, and field by field.
  const iss = requireString(payload, 'iss');
  if (!GOOGLE_ISSUERS.has(iss)) throw new GoogleOidcError('bad_issuer', `issuer ${iss} is not Google`);

  const aud = requireString(payload, 'aud');
  if (aud !== input.clientId) {
    // The cross-app impersonation guard: a token minted for another app is
    // cryptographically valid and must still be refused.
    throw new GoogleOidcError('bad_audience', 'token audience does not match this environment');
  }

  const exp = requireNumber(payload, 'exp');
  if (exp * 1000 + skew * 1000 <= nowMs) throw new GoogleOidcError('expired', 'token has expired');
  const iat = requireNumber(payload, 'iat');
  if (iat * 1000 - skew * 1000 > nowMs) throw new GoogleOidcError('not_yet_valid', 'token was issued in the future');

  const nonce = typeof payload.nonce === 'string' ? payload.nonce : '';
  if (!nonce || !constantTimeEqual(nonce, input.expectedNonce)) {
    // Without this, a token captured from another sign-in attempt could be replayed into ours.
    throw new GoogleOidcError('bad_nonce', 'token nonce does not match this sign-in attempt');
  }

  const sub = requireString(payload, 'sub');
  const email = requireString(payload, 'email').trim().toLowerCase();
  // Strict: the boolean true only. Absent, false or the string "true" all refuse.
  if (payload.email_verified !== true) {
    throw new GoogleOidcError('email_unverified', 'Google has not verified this email address');
  }

  return {
    iss,
    sub,
    aud,
    email,
    emailVerified: true,
    ...(typeof payload.name === 'string' && payload.name ? { name: payload.name } : {}),
    nonce,
    exp,
    iat,
  };
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ── Authorization request (state, nonce, PKCE) ──────────────────────────────

export interface OidcFlowState {
  state: string;
  nonce: string;
  /** PKCE code verifier: stays on the server side of the cookie, never in a URL. */
  codeVerifier: string;
  /** Where to land after sign-in; a same-origin path only. */
  returnTo: string;
  /** Seconds since epoch. The flow cookie is refused after FLOW_TTL_SECONDS. */
  iat: number;
}

export const FLOW_TTL_SECONDS = 10 * 60;
export const OIDC_FLOW_COOKIE = 'splash_oidc_flow';

const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** RFC 7636 S256 challenge. */
export function pkceChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
}

/** Only same-origin paths survive; anything else (absolute URLs, `//host`, backslashes) becomes /dashboard. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string') return '/dashboard';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.length > 200) return '/dashboard';
  return value;
}

export function beginGoogleSignIn(config: GoogleOidcConfig, opts: { returnTo?: unknown; now?: Date } = {}) {
  const flow: OidcFlowState = {
    state: randomToken(),
    nonce: randomToken(),
    codeVerifier: randomToken(48),
    returnTo: safeReturnTo(opts.returnTo),
    iat: Math.floor((opts.now ?? new Date()).getTime() / 1000),
  };
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', flow.state);
  url.searchParams.set('nonce', flow.nonce);
  url.searchParams.set('code_challenge', pkceChallenge(flow.codeVerifier));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'select_account');
  return { flow, authorizeUrl: url.toString() };
}

// ── The flow cookie: signed, short-lived, domain-separated from sessions ────

function flowKey(sessionSecret: string): Buffer {
  // A different key from the session MAC, so a flow cookie can never be read as a session.
  return createHmac('sha256', sessionSecret).update('splash:oidc-flow:v1').digest();
}

export function sealFlowState(flow: OidcFlowState, sessionSecret: string): string {
  const body = Buffer.from(JSON.stringify(flow), 'utf8').toString('base64url');
  const mac = createHmac('sha256', flowKey(sessionSecret)).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function openFlowState(sealed: string | undefined, sessionSecret: string, now = new Date()): OidcFlowState {
  if (!sealed) throw new GoogleOidcError('no_flow', 'no sign-in attempt in progress in this browser');
  const dot = sealed.indexOf('.');
  if (dot <= 0) throw new GoogleOidcError('bad_flow', 'sign-in state is malformed');
  const body = sealed.slice(0, dot);
  const mac = sealed.slice(dot + 1);
  const expected = createHmac('sha256', flowKey(sessionSecret)).update(body).digest('base64url');
  if (!constantTimeEqual(mac, expected)) throw new GoogleOidcError('bad_flow', 'sign-in state failed its integrity check');
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new GoogleOidcError('bad_flow', 'sign-in state is malformed');
  }
  const flow: OidcFlowState = {
    state: requireFlowString(raw, 'state'),
    nonce: requireFlowString(raw, 'nonce'),
    codeVerifier: requireFlowString(raw, 'codeVerifier'),
    returnTo: safeReturnTo(raw.returnTo),
    iat: typeof raw.iat === 'number' ? raw.iat : 0,
  };
  if (flow.iat * 1000 + FLOW_TTL_SECONDS * 1000 <= now.getTime()) {
    throw new GoogleOidcError('flow_expired', 'the sign-in attempt took too long; start again');
  }
  return flow;
}

function requireFlowString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== 'string' || !value) throw new GoogleOidcError('bad_flow', `sign-in state is missing ${key}`);
  return value;
}

/** The callback's `state` must equal the cookie's: the CSRF guard for the redirect. */
export function assertStateMatches(flow: OidcFlowState, returnedState: string | null): void {
  if (!returnedState || !constantTimeEqual(returnedState, flow.state)) {
    throw new GoogleOidcError('bad_state', 'sign-in state does not match this browser');
  }
}

// ── Code exchange ───────────────────────────────────────────────────────────

export async function exchangeCodeForIdToken(
  config: GoogleOidcConfig,
  input: { code: string; codeVerifier: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    code_verifier: input.codeVerifier,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
  });
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new GoogleOidcError('code_exchange_failed', `Google token endpoint returned HTTP ${response.status}`);
  const json = (await response.json()) as { id_token?: unknown };
  if (typeof json.id_token !== 'string' || !json.id_token) {
    throw new GoogleOidcError('code_exchange_failed', 'Google returned no id_token');
  }
  return json.id_token;
}

/** A stable, non-reversible subject for logs: never log the raw `sub` or the email. */
export function hashSubjectForLog(claims: Pick<GoogleIdClaims, 'iss' | 'sub' | 'aud'>): string {
  return createHash('sha256').update(`${claims.iss}|${claims.sub}|${claims.aud}`).digest('hex').slice(0, 16);
}
