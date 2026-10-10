/**
 * JSON over the wire for the Solana app: bigint travels as a decimal string.
 *
 * canonicalJson (lib/solana-evidence/canonical.ts) also encodes a bigint as a
 * decimal string, so a bundle that went through `toWire` hashes to the same
 * leaf in the browser as on the server. That is what lets the receipt page
 * verify without the server.
 */

export type Wire<T> = T extends bigint
  ? string
  : T extends Date
    ? string
    : T extends Uint8Array
      ? string
      : T extends Array<infer U>
        ? Array<Wire<U>>
        : T extends object
          ? { [K in keyof T]: Wire<T[K]> }
          : T;

export function toWire<T>(value: T): Wire<T> {
  return convert(value) as Wire<T>;
}

function convert(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return Array.from(value, (b) => b.toString(16).padStart(2, '0')).join('');
  if (Array.isArray(value)) return value.map(convert);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined || typeof v === 'function') continue;
      out[k] = convert(v);
    }
    return out;
  }
  return value;
}

/** Parse a non-negative integer string (minor units) into bigint, or throw. */
export function parseMinorString(s: string, field = 'amount'): bigint {
  if (typeof s !== 'string' || !/^\d{1,30}$/.test(s)) throw new Error(`${field} must be an integer string of minor units`);
  return BigInt(s);
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(toWire(body)), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(init.headers ?? {}) },
  });
}
