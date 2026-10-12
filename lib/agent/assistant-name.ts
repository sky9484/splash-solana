/**
 * Letting someone rename the assistant.
 *
 * ─── Why this is stored in MemWal and not a settings column ─────────────────
 *
 * MemWal is free-text semantic memory: `rememberForOrg(orgId, text)` and
 * `recallForOrg(orgId, query)`. There is no key/value get and set, so a name
 * stored there is recalled by SEARCHING for it, and the newest one is not
 * guaranteed to rank first.
 *
 * That is a real constraint and it shapes what is safe to put there. A
 * preferred name is: cosmetic, non-authoritative, and harmless to get wrong —
 * the worst outcome is the assistant answering to the wrong nickname. Nothing
 * that decides access, money or identity belongs in a store with those
 * properties, and none of it is here.
 *
 * Both calls are scoped to the org (lib/server/memwal-scope.ts): its own
 * namespace, and its key at the start of the stored text, checked again on
 * recall. The org is the session's. Zeke's tool loop replaces whatever org the
 * model names with it (`scopeToolInputToOrg` in lib/agent/oxwal.ts), so a
 * conversation cannot rename another workspace's assistant.
 */
import { DEFAULT_ASSISTANT_NAME } from '@/lib/agent/assistant-name-shared';

export { DEFAULT_ASSISTANT_NAME };

/**
 * Names people may actually choose.
 *
 * Letters, digits, spaces and a few joiners, two to twenty-four characters. The
 * limit is not decoration: this string is interpolated into the system prompt,
 * and a "name" containing instructions is a prompt-injection vector aimed at
 * the assistant's own persona. Length and character class remove it.
 */
export function isUsableName(candidate: string): boolean {
  const name = candidate.trim();
  if (name.length < 2 || name.length > 24) return false;
  return /^[\p{L}\p{N} ._'-]+$/u.test(name);
}

export function sanitiseName(candidate: string): string | null {
  const name = candidate.trim().replace(/\s+/g, ' ');
  return isUsableName(name) ? name : null;
}

/** Remember what this workspace wants the assistant called. */
export async function rememberAssistantName(input: unknown): Promise<{
  ok: boolean;
  name?: string;
  message: string;
}> {
  const { orgId, name } = (input ?? {}) as { orgId?: string; name?: string };
  if (!orgId || !name) return { ok: false, message: 'A name is required.' };

  const clean = sanitiseName(name);
  if (!clean) {
    return {
      ok: false,
      message:
        'That name will not work — it needs to be 2 to 24 characters, letters and numbers only. ' +
        'It goes into how I introduce myself, so it has to be a name rather than an instruction.',
    };
  }

  // Cosmetic, and kept per organisation in this server process only: the
  // earlier build's behaviour-memory store is gone, and a nickname is not
  // worth a table. A restart brings back the default name.
  if (!orgId.trim()) {
    return { ok: false, message: `I could not save that just now, so I will still answer to ${DEFAULT_ASSISTANT_NAME}.` };
  }
  names().set(orgId, clean);
  return { ok: true, name: clean, message: `Noted — I will answer to ${clean} from now on.` };
}

const globalNames = globalThis as typeof globalThis & { splashAssistantNames?: Map<string, string> };
function names(): Map<string, string> {
  globalNames.splashAssistantNames ??= new Map();
  return globalNames.splashAssistantNames;
}

/**
 * What this workspace calls the assistant.
 *
 * Falls back to the default on anything unexpected. Recall only returns this
 * org's memories; of those, only one that is a stored name counts, so an
 * invoice memory that happens to contain `is "…"` cannot rename anything. A
 * recall that returns nothing usable simply means the default name.
 */
export async function recallAssistantName(orgId: string): Promise<string> {
  // Without an org there is nothing to anchor recall to. The scoped adapter
  // refuses a blank org too; this answers before importing it.
  if (!orgId.trim()) return DEFAULT_ASSISTANT_NAME;

  const stored = names().get(orgId);
  return (stored && sanitiseName(stored)) || DEFAULT_ASSISTANT_NAME;
}
