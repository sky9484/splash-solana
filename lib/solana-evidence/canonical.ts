/**
 * Canonical JSON for hashing and signing.
 *
 * The form is RFC 8785 (JCS) with one extension: a `bigint` serialises as a
 * decimal string. Concretely:
 *   - object keys sorted by UTF-16 code units (JavaScript's default sort, which
 *     is what JCS specifies), no whitespace;
 *   - a key whose value is `undefined` is dropped, as JSON.stringify does;
 *   - numbers use ECMAScript's shortest round-trip form (also JCS); NaN and
 *     Infinity are rejected;
 *   - bigint → "123" (a string). Money is bigint minor units everywhere in
 *     this build, so amounts always hash as strings and never meet a float;
 *   - only plain objects and arrays. A Date, Map, Set, Uint8Array or class
 *     instance is rejected rather than silently stringified: carry ISO strings
 *     and hex instead, so the hashed form is the form a verifier sees.
 *
 * Shared by the evidence bundle (leaf hashing) and the partner webhook (HMAC
 * body). Pure; no Node built-ins, so the receipt page can verify in a browser.
 */

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

export function canonicalJson(value: unknown): string {
  return encode(value, '$');
}

function encode(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'bigint':
      return JSON.stringify(value.toString());
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalJsonError(`${path}: non-finite number`);
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value
          .map((item, i) => {
            if (item === undefined) throw new CanonicalJsonError(`${path}[${i}]: undefined in array`);
            return encode(item, `${path}[${i}]`);
          })
          .join(',')}]`;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new CanonicalJsonError(`${path}: only plain objects are canonicalisable (got ${proto?.constructor?.name ?? 'unknown'})`);
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((k) => record[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${encode(record[k], `${path}.${k}`)}`).join(',')}}`;
    }
    default:
      throw new CanonicalJsonError(`${path}: cannot canonicalise a ${typeof value}`);
  }
}
