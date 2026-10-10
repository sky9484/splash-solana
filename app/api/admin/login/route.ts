import { NextResponse } from 'next/server';

import { setAdminSessionCookie, validateAdminCredentials } from '@/lib/server/admin-auth';
import { readJsonBody } from '@/lib/server/http';

export async function POST(request: Request) {
  const body = await readJsonBody(request);
  const email = String(body.email ?? '');
  const password = String(body.password ?? '');
  const session = validateAdminCredentials(email, password);

  if (!session) {
    return NextResponse.json({ error: 'Invalid staff credentials' }, { status: 401 });
  }

  // Cookie is `secure` in production (HTTPS) and non-secure only in local dev,
  // derived from NODE_ENV inside setAdminSessionCookie — never from the
  // client-supplied Host header.
  await setAdminSessionCookie();

  return NextResponse.json({ session });
}
