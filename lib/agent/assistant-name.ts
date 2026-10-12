/**
 * Letting someone rename the assistant.
 *
 * ─── Why this is an in-process map and not a settings column ────────────────
 *
 * The earlier build kept the name in an external semantic-memory store; that
 * store is gone. A preferred name is cosmetic, non-authoritative, and harmless
 * to get wrong — the worst outcome is the assistant answering to the wrong
 * nickname, or to its default after a restart. That is not worth a table, so
 * it lives in a Map keyed by org in this server process. Nothing that decides
 * access, money or identity belongs in a store with those properties, and
 * none of it is here.
 *
 * The key is the org, and the org is the session's. Zeke's tool loop replaces
 * whatever org the model names with it (`scopeToolInputToOrg` in
 * lib/agent/oxwal.ts), so a conversation cannot rename another workspace's
 * assistant.
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
 * Falls back to the default on anything unexpected: only this org's entry is
 * read, it is re-sanitised on the way out, and nothing usable simply means
 * the default name.
 */
export async function recallAssistantName(orgId: string): Promise<string> {
  // Without an org there is nothing to key the lookup on.
  if (!orgId.trim()) return DEFAULT_ASSISTANT_NAME;

  const stored = names().get(orgId);
  return (stored && sanitiseName(stored)) || DEFAULT_ASSISTANT_NAME;
}
