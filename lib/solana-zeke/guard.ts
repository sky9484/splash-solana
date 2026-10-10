/**
 * Zeke's authority boundary, as code.
 *
 * Zeke (Reader, Router) produces DRAFTS. It has no function that signs,
 * sends, approves or executes, and holds no key. Deterministic policy
 * (lib/route-engine/policy.ts) runs outside it; a person signs with their
 * device key (I-4). These asserts are called by the API layer before a Zeke
 * output is shown, and the tests check that no such function exists here.
 */
import type { RouteQuote } from '../solana/types.ts';

export const ZEKE_AUTHORITY = Object.freeze({
  output: 'draft' as const,
  canSign: false as const,
  canSend: false as const,
  canApprove: false as const,
  canChangeAmounts: false as const,
  canChangeRecipients: false as const,
  holdsKeys: false as const,
  tools: Object.freeze([] as string[]),
});

export class ZekeGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZekeGuardError';
  }
}

/** Keys that would mean a Zeke output is trying to be an action rather than a draft. */
const ACTION_KEYS = /^(signature|signatures|signed\w*|serialized\w*|transaction|transactions|tx|instructions?|privateKey|secretKey|seed|mnemonic|execute|approve|send|submit|sendTransaction)$/i;

function scan(value: unknown, path: string, seen: WeakSet<object>): void {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function') throw new ZekeGuardError(`${path} is a function; drafts are data only`);
    return;
  }
  if (seen.has(value)) return;
  seen.add(value);
  for (const [k, v] of Object.entries(value)) {
    if (ACTION_KEYS.test(k)) throw new ZekeGuardError(`${path}.${k}: drafts cannot carry action fields`);
    if (typeof v === 'function') throw new ZekeGuardError(`${path}.${k} is a function; drafts are data only`);
    scan(v, `${path}.${k}`, seen);
  }
}

/** Throws unless `output` is a plain-data draft with no action fields. */
export function assertDraftOnly(output: unknown): void {
  if (!output || typeof output !== 'object' || (output as { draft?: unknown }).draft !== true) {
    throw new ZekeGuardError('Zeke output must be marked draft: true');
  }
  scan(output, '$', new WeakSet());
}

/**
 * The Router may only point at a quote the engine produced, and may not carry
 * amounts, addresses or steps of its own.
 */
export function assertRouterRefersToEngineQuote(output: { draft: true; primary: { refersTo: string }; alternative: { refersTo: string } | null }, quotes: RouteQuote[]): void {
  assertDraftOnly(output);
  const ids = new Set(quotes.map((q) => q.id));
  for (const e of [output.primary, output.alternative]) {
    if (!e) continue;
    if (!ids.has(e.refersTo)) throw new ZekeGuardError(`Router refers to unknown quote ${e.refersTo}`);
    const extra = Object.keys(e).filter((k) => !['refersTo', 'policy', 'text'].includes(k));
    if (extra.length) throw new ZekeGuardError(`Router explanation carries non-text fields: ${extra.join(', ')}`);
  }
}
