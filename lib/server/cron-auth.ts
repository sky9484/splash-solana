import { timingSafeEqual } from 'node:crypto';

/**
 * Whether a request comes from the scheduler: `Authorization: Bearer <CRON_SECRET>`, compared in
 * constant time. With no CRON_SECRET set, every call is refused (production refuses to start without
 * one, lib/env.ts). Every /api/cron route starts here.
 */
export function cronAuthorized(request: Request, secret = process.env.CRON_SECRET): boolean {
  const expected = secret?.trim();
  if (!expected) return false;
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
