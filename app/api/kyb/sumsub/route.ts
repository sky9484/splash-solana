import { NextResponse } from 'next/server';

import { createSumsubKybSession, getSumsubConfig } from '@/lib/compliance/sumsub';
import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { readJsonBody } from '@/lib/server/http';
import { attachSumsubApplicant, readKybCase } from '@/lib/server/kyb';
import { kybOrgIdForSession } from '@/lib/server/kyb-org';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const kybCaseId = String(body.kybCaseId ?? '');

  if (!kybCaseId) {
    return NextResponse.json({ error: 'KYB case ID is required' }, { status: 400 });
  }

  // The case id comes from the request body, so it has to be this caller's
  // case. It used to be any case: a signed-in customer could open a Sumsub
  // session — an access token to act as that applicant in the WebSDK — on
  // another company's KYB case, and write the applicant id and an audit event
  // onto it. A new sign-up reaches the case its upload filed: see kyb-org.ts.
  const orgId = await kybOrgIdForSession(auth.session);
  const kybCase = await readKybCase(orgId, kybCaseId);

  // 404 rather than 403 for someone else's case, as GET /api/kyb/cases/[id]
  // answers: the difference would confirm that a guessed id exists.
  if (!kybCase) {
    return NextResponse.json({ error: 'KYB case not found' }, { status: 404 });
  }

  if (!getSumsubConfig()) {
    return NextResponse.json({ configured: false, error: 'Sumsub environment variables are not configured' }, { status: 200 });
  }

  try {
    // The company Sumsub is asked to verify is the one on the case, not
    // whatever name and number the request body carries.
    const session = await createSumsubKybSession({
      kybCaseId: kybCase.id,
      businessName: kybCase.businessName,
      registrationNumber: kybCase.registrationNumber,
    });
    await attachSumsubApplicant(orgId, kybCase.id, session.applicantId);

    return NextResponse.json({ configured: true, ...session });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sumsub KYB session failed';

    return NextResponse.json({ configured: true, error: message }, { status: 502 });
  }
}
