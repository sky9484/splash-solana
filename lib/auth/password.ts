import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Password hashing: scrypt from node:crypto.
 *
 * Before this, no password was hashed anywhere. `bcrypt`, `argon2`, `scrypt`
 * and `pbkdf2` appeared nowhere in the tree — there was one credential pair in
 * environment variables, compared as a string, and signup stored nothing at
 * all.
 *
 * scrypt rather than argon2id, which is the stronger primitive: argon2 ships
 * an `install` script that compiles a native binding, and CI runs `npm ci
 * --ignore-scripts`. It would install, skip the build, and throw on the first
 * login — a dependency that is present and non-functional. scrypt is in the
 * standard library, so both developers' machines and CI agree by
 * construction. That was the S10 decision.
 *
 * Never `createHash`. A single SHA pass over a password is a rainbow-table
 * lookup with extra steps; the entire point of scrypt is that it is
 * deliberately slow and memory-hard.
 *
 * Stored format, single line, `$`-delimited:
 *
 *   scrypt$N$r$p$<salt base64url>$<hash base64url>
 *
 * The parameters travel with the hash, so they can be raised later without
 * invalidating anyone's existing password: verification uses the parameters
 * the hash was made with, and `needsRehash` reports when a stored hash is
 * weaker than current policy so it can be upgraded on next successful login.
 */

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * OWASP's scrypt guidance: N ≥ 2^17 with r=8, p=1. Roughly 128 MiB of memory
 * and ~100ms per hash on current hardware, which is the point — it bounds how
 * fast an offline attacker can iterate over a stolen table.
 */
export const SCRYPT_PARAMS = { N: 1 << 17, r: 8, p: 1 } as const;

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/** scrypt needs roughly 128 × N × r bytes; give it headroom or it throws. */
function maxmem(N: number, r: number): number {
  return 256 * N * r;
}

const b64 = (buf: Buffer) => buf.toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url');

export class PasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasswordError';
  }
}

/**
 * Minimum acceptable password. Length carries almost all of the entropy, so
 * the floor is 12 rather than a shorter one with character-class rules; the
 * class requirements are kept only because the signup form already advertises
 * them and removing them silently would weaken an existing account's
 * expectations.
 */
export const MIN_PASSWORD_LENGTH = 12;
/** bcrypt's 72-byte truncation does not apply to scrypt, but an unbounded
 *  password is an easy way to make the server do unbounded work. */
export const MAX_PASSWORD_LENGTH = 256;

export function assertPasswordPolicy(password: string): void {
  if (typeof password !== 'string') throw new PasswordError('password must be a string');
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordError(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new PasswordError(`password must be at most ${MAX_PASSWORD_LENGTH} characters`);
  }
  if (!/[A-Za-z]/.test(password)) throw new PasswordError('password must contain a letter');
  if (!/\d/.test(password)) throw new PasswordError('password must contain a digit');
}

/** Hash a password. The result is safe to store verbatim. */
export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);
  const { N, r, p } = SCRYPT_PARAMS;
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH, { N, r, p, maxmem: maxmem(N, r) });
  return `scrypt$${N}$${r}$${p}$${b64(salt)}$${b64(derived)}`;
}

type Parsed = { N: number; r: number; p: number; salt: Buffer; hash: Buffer };

function parse(stored: string): Parsed | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, nStr, rStr, pStr, saltStr, hashStr] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  // N must be a power of two > 1, and the cost is bounded so a crafted hash
  // cannot make verification allocate arbitrarily much memory.
  if (N < 2 || (N & (N - 1)) !== 0 || N > 1 << 22) return null;
  if (r < 1 || r > 32 || p < 1 || p > 16) return null;
  try {
    return { N, r, p, salt: unb64(saltStr), hash: unb64(hashStr) };
  } catch {
    return null;
  }
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false rather than throwing for every failure, including a malformed
 * stored value: a caller must not be able to tell "no such user" from "hash
 * corrupt" from "wrong password", and the one thing that distinguishes them
 * is the shape of the error.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored ?? '');
  if (!parsed) return false;
  if (typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
    return false;
  }
  const { N, r, p, salt, hash } = parsed;
  let derived: Buffer;
  try {
    derived = await scrypt(password, salt, hash.length, { N, r, p, maxmem: maxmem(N, r) });
  } catch {
    return false;
  }
  if (derived.length !== hash.length) return false;
  return timingSafeEqual(derived, hash);
}

/**
 * True when a stored hash was made with weaker parameters than current
 * policy. Call after a successful verification and re-hash if it returns
 * true — that is how a cost increase reaches existing accounts.
 */
export function needsRehash(stored: string): boolean {
  const parsed = parse(stored ?? '');
  if (!parsed) return true;
  return parsed.N < SCRYPT_PARAMS.N || parsed.r < SCRYPT_PARAMS.r || parsed.p < SCRYPT_PARAMS.p;
}
