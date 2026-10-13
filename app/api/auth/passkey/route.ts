import { NextResponse } from 'next/server';
import { z } from 'zod';

import { eq } from 'drizzle-orm';

import { users } from '@/lib/db/schema';
import {
  PasskeyError,
  enrolPasskey,
  findCredential,
  relyingPartyId,
  revokePasskey,
} from '@/lib/auth/passkey';
import { spkiToCompressedP256 } from '@/lib/auth/webauthn';
import { requireCustomerSession } from '@/lib/server/customer-auth';
import { readJsonBody } from '@/lib/server/http';

/**
 * Passkey enrolment.
 *
 * GET  — what this account has on this origin, and the rpId to enrol against.
 * POST — record a newly created credential's public key.
 * DELETE — retire it.
 *
 * The POST body carries a public key the browser has just been given by the
 * authenticator. That is the one moment it exists outside the device: WebAuthn
 * returns it in the attestation at creation and never again. Storing it here
 * is what lets a later signature be attributed without asking the user to sign
 * twice so the key can be recovered by intersection.
 *
 * Enrolment requires an authenticated session, so a credential is always bound
 * to a known identity. It grants nothing on its own: a passkey is a second
 * check at sign-in and on step-up, never a vault signer and never permission
 * to approve. Authority is still a membership row, read per request.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const enrolSchema = z.object({
  /** WebAuthn credential id, base64url, as returned by the authenticator. */
  credentialId: z.string().trim().min(1).max(512),
  /** The SPKI public key from PublicKeyCredential.getPublicKey(), base64url. Stored as a compressed P-256 point. */
  spkiPublicKey: z.string().trim().min(1).max(512),
});

async function db() {
  const { getDb } = await import('@/lib/db/client');
  return getDb() as never;
}

/**
 * The signed-in person's user id, from the users table. It was derived from
 * the email (userIdFromEmail), which matches accounts made by signup but not
 * ones seeded with their own ids — for those, enrolment failed on the foreign
 * key and a lookup found nothing. Every other reader of passkeys
 * (step-up approvals, the Splash wallet) uses the database id, so this must.
 */
async function sessionUserId(email: string): Promise<string | null> {
  const { getDb } = await import('@/lib/db/client');
  const [row] = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  return row?.id ?? null;
}

export async function GET() {
  const auth = await requireCustomerSession();
  if (auth.response) return auth.response;

  const rpId = relyingPartyId();
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ rpId, credential: null, storage: false }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const userId = await sessionUserId(auth.session.email);
  const credential = userId ? await findCredential(await db(), { userId, rpId }) : null;

  return NextResponse.json(
    {
      rpId,
      storage: true,
      credential: credential
        ? {
            id: credential.id,
            // What the browser needs to ask for this passkey (lib/auth/webauthn-client.ts).
            credentialId: credential.credentialId,
            // The public key is not returned. Nothing client-side needs it —
            // verification happens here — and it is the value the design
            // depends on retaining.
          }
        : null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const auth = await requireCustomerSession();
  if (auth.response) return auth.response;

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Passkey storage is not configured on this deployment' }, { status: 503 });
  }

  const parsed = enrolSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: 'A credential id and public key are required' }, { status: 400 });
  }

  const userId = await sessionUserId(auth.session.email);
  if (!userId) return NextResponse.json({ error: 'No account found for this session.' }, { status: 404 });

  try {
    let publicKey: string;
    try {
      publicKey = spkiToCompressedP256(Buffer.from(parsed.data.spkiPublicKey, 'base64url'));
    } catch {
      return NextResponse.json({ error: 'That passkey is not a P-256 key.', code: 'bad_public_key' }, { status: 400 });
    }
    const credential = await enrolPasskey(await db(), {
      userId,
      credentialId: parsed.data.credentialId,
      publicKey,
      rpId: relyingPartyId(),
    });
    return NextResponse.json(
      { enrolled: true, rpId: credential.rpId },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof PasskeyError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    throw error;
  }
}

export async function DELETE() {
  const auth = await requireCustomerSession();
  if (auth.response) return auth.response;
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Passkey storage is not configured on this deployment' }, { status: 503 });
  }

  const database = await db();
  const rpId = relyingPartyId();
  const userId = await sessionUserId(auth.session.email);
  const credential = userId ? await findCredential(database, { userId, rpId }) : null;
  if (!credential) return NextResponse.json({ revoked: false }, { status: 404 });

  await revokePasskey(database, credential.id);
  return NextResponse.json({ revoked: true });
}
