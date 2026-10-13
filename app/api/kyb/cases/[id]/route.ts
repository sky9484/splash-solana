import { NextResponse } from 'next/server';

import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { readKybCase } from '@/lib/server/kyb';
import { kybOrgIdForSession } from '@/lib/server/kyb-org';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const { id } = await params;

  // Authenticated is not the same as entitled. This read used to be scoped to
  // "any signed-in user", so one customer could fetch another company's case by
  // id and receive their registration number, the SHA-256 of every document
  // they uploaded, the reviewer's notes and the reason they were rejected.
  //
  // A new sign-up with no membership reads the case its upload filed, as the
  // upload and Sumsub routes resolve it (kyb-org.ts). It used to get a 403 here,
  // so it could start Sumsub on its case but not see the case's status.
  const orgId = await kybOrgIdForSession(auth.session);
  const record = await readKybCase(orgId, id);

  // 404 rather than 403 for a case belonging to someone else: the difference
  // would confirm that a guessed id exists, which is the enumeration this fixes.
  if (!record) {
    return NextResponse.json({ error: 'KYB case not found' }, { status: 404 });
  }

  return NextResponse.json({
    case: {
      id: record.id,
      businessName: record.businessName,
      registrationNumber: record.registrationNumber,
      state: record.state,
      riskTier: record.riskTier,
      corridorAccess: record.corridorAccess,
      submittedAt: record.submittedAt,
      updatedAt: record.updatedAt,
      sumsubApplicantId: record.sumsubApplicantId,
      reviewNotes: record.reviewNotes,
      decisionReason: record.decisionReason,
      documents: record.documents.map((document) => ({
        name: document.name,
        kind: document.kind,
        type: document.type,
        size: document.size,
        sha256: document.sha256,
        virusScanResult: document.virusScanResult,
        uploadedAt: document.uploadedAt,
      })),
    },
  });
}
