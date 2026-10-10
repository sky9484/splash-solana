import { NextResponse } from 'next/server';

import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { retrieveBlob, WalrusAdapterError } from '@/lib/server/walrus';

export async function GET(request: Request, { params }: { params: Promise<{ blobId: string }> }) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const { blobId } = await params;
  try {
    const blob = await retrieveBlob(blobId);
    if (!blob) return NextResponse.json({ error: 'Walrus blob not found' }, { status: 404 });
    return NextResponse.json({
      blobId: blob.blobId,
      sizeBytes: blob.sizeBytes,
      epochs: blob.epochs,
      mode: blob.mode,
      createdAt: blob.createdAt,
    });
  } catch (error) {
    if (error instanceof WalrusAdapterError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Walrus proof unavailable' }, { status: 500 });
  }
}
