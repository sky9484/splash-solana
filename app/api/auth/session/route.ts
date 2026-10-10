import { NextResponse } from 'next/server';

import { getCustomerSession } from '@/lib/server/customer-auth';

export const dynamic = 'force-dynamic';

/** Light session echo for client surfaces that render the operator's name
 *  (e.g. the receipt's "Approved by" line). No secrets — name/org/email only. */
export async function GET() {
  const session = await getCustomerSession();
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  return NextResponse.json({ name: session.name, email: session.email, organization: session.organization });
}
