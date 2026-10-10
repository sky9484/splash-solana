import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { readJsonBody } from '@/lib/server/http';

/**
 * Public waitlist capture for the landing page.
 *
 * - Strict email validation (this address genuinely gets mailed later).
 * - `company` is a honeypot: humans never see it, bots fill it — those
 *   submissions get a friendly 200 and are dropped.
 * - Duplicates return the same success shape (no email enumeration).
 * - Entries persist to SPLASH_DATA_DIR/waitlist.json via atomic rename,
 *   the same pattern as the other file-backed stores in data/.
 */

const waitlistSchema = z.object({
  email: z.string().trim().max(254).email(),
  company: z.string().optional(),
  source: z.string().trim().max(64).optional(),
});

type WaitlistEntry = { email: string; joinedAt: string; source: string };

const DATA_DIR = process.env.SPLASH_DATA_DIR ?? path.join(process.cwd(), 'data');
const WAITLIST_PATH = path.join(DATA_DIR, 'waitlist.json');

function readWaitlist(): WaitlistEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(WAITLIST_PATH, 'utf8')) as WaitlistEntry[];
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry?.email === 'string') : [];
  } catch {
    return [];
  }
}

function persistWaitlist(entries: WaitlistEntry[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tempPath = `${WAITLIST_PATH}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, WAITLIST_PATH);
}

export async function POST(request: Request) {
  const parsed = waitlistSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Enter a valid work email so we can reach you when your corridor opens.' },
      { status: 400 },
    );
  }

  // Honeypot tripped — pretend success, store nothing.
  if (parsed.data.company?.trim()) {
    return NextResponse.json({ ok: true });
  }

  const email = parsed.data.email.toLowerCase();
  const entries = readWaitlist();
  if (!entries.some((entry) => entry.email === email)) {
    entries.push({
      email,
      joinedAt: new Date().toISOString(),
      source: parsed.data.source ?? 'landing',
    });
    persistWaitlist(entries);
  }

  return NextResponse.json({ ok: true });
}
