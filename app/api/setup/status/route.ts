import { readSetupStatus } from '@/lib/auth/devices';
import { jsonResponse } from '@/lib/solana-app/json';
import { syncSetupCookie } from '@/lib/server/setup-cookie';
import { setupDb, setupMemberForRequest } from '@/lib/server/setup-member';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Where this member stands in setup. Public keys and vault addresses only. */
export async function GET(request: Request) {
  const { member, email, session, response } = await setupMemberForRequest(request);
  if (!member) return response;
  const status = await readSetupStatus(await setupDb(), email);
  // Keep the proxy's optimistic cookie in step with the authoritative status.
  await syncSetupCookie(session, status);
  return jsonResponse({
    state: status.state,
    isOwner: member.isOwner,
    // Where this browser keeps the member's device key (IndexedDB), so the
    // page can tell "registered" from "registered AND held by this browser".
    keyId: `acct:${member.orgId}:${member.userId}`,
    device: 'device' in status ? { publicKey: status.device.publicKey, label: status.device.label, provenAt: status.device.provenAt } : null,
    vault: 'vault' in status && status.vault
      ? {
          cluster: status.vault.cluster,
          simulated: status.vault.simulated,
          multisigPda: status.vault.multisigPda,
          vaultPda: status.vault.vaultPda,
          threshold: status.vault.threshold,
          members: status.vault.members,
          createSignature: status.vault.createSignature,
        }
      : null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
