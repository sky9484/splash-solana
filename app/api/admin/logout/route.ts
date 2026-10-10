import { NextResponse } from 'next/server';

import { clearAdminSessionCookie } from '@/lib/server/admin-auth';

export async function POST() {
  await clearAdminSessionCookie();

  return NextResponse.json({ ok: true });
}
