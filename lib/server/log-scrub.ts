/**
 * No bank number in a log line (prompt 10 Phase S §S.1.6).
 *
 * Two rules, applied to everything the server writes through `console`:
 *
 *   free text    a run of 8 to 20 digits that stands alone (plain, or grouped 4-4-4 with spaces or
 *                dashes, the way people type account numbers) keeps only its last 4: "••••4471". A
 *                date (2026-10-14) or a hex or base58 id is left alone. Large plain numbers (a 13-digit
 *                timestamp, an amount in minor units) are masked too: a false alarm costs a debugging
 *                minute, a miss costs a breach notice.
 *   bank fields  in an object, a value under a key that names an account or IBAN keeps its last 4 at
 *                any length.
 *
 * Errors keep their name; their message and stack are scrubbed. Installed once, at server start
 * (instrumentation.ts). There is no other logger in the app: everything goes through `console`.
 */

const RUN = /(?<![A-Za-z0-9])(?:\d{4}(?:[ -]\d{4}){1,4}|\d{8,20})(?![A-Za-z0-9])/g;
// accountNumber, account_number, supplierAccountNumber, bankAccount, acctNo, iban; not accountLast4 or usdcTokenAccount.
const BANK_KEY = /(?:account_?(?:number|no)|acct_?(?:number|no)?|iban|bank_?account)$/i;
const MASK = '••••';

export function scrubText(text: string): string {
  return text.replace(RUN, (m) => {
    const digits = m.replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 20 ? `${MASK}${digits.slice(-4)}` : m;
  });
}

function maskField(v: unknown): unknown {
  if (typeof v === 'number' || typeof v === 'bigint') v = String(v);
  if (typeof v !== 'string') return scrubValue(v);
  const digits = v.replace(/\D/g, '');
  return digits.length > 4 ? `${MASK}${digits.slice(-4)}` : v;
}

export function scrubValue(value: unknown, seen: WeakSet<object> = new WeakSet(), depth = 0): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value) || depth > 6) return '[…]';
  seen.add(value);
  if (value instanceof Error) {
    const copy = new Error(scrubText(value.message));
    copy.name = value.name;
    copy.stack = value.stack ? scrubText(value.stack) : undefined;
    const code = (value as { code?: unknown }).code;
    if (code !== undefined) (copy as { code?: unknown }).code = code;
    return copy;
  }
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, seen, depth + 1));
  if (value instanceof Date || value instanceof Uint8Array) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = BANK_KEY.test(k) ? maskField(v) : scrubValue(v, seen, depth + 1);
  return out;
}

const METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
const INSTALLED = Symbol.for('splash.logScrubber');

/** Wrap `console` so every argument is scrubbed before it is written. Safe to call twice. */
export function installLogScrubber(target: Console = console): void {
  const c = target as Console & { [INSTALLED]?: true };
  if (c[INSTALLED]) return;
  for (const m of METHODS) {
    const original = c[m].bind(c);
    c[m] = (...args: unknown[]) => original(...args.map((a) => scrubValue(a)));
  }
  c[INSTALLED] = true;
}
