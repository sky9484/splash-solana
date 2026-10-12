import { headers } from 'next/headers';
import Link from 'next/link';

import { Addr, Badge, PageHeader, SimulatedNote, Table, Td, when } from '@/components/admin/solana/parts';
import { adminConsolePath } from '@/lib/admin-routing';
import { adminOrgs } from '@/lib/solana-app/admin-service';
import { runtime } from '@/lib/solana-app/runtime';

export const dynamic = 'force-dynamic';

/**
 * Orgs and vaults (prompt 07 §7.1): each company's Squads multisig and its two vaults, the threshold
 * and members, and the config authority AS THE CHAIN REPORTS IT. It must read "none": nobody outside
 * the vault, Splash included, can change who controls it. Anything else is red.
 */
export default async function AdminOrgsPage() {
  const [rows, h] = await Promise.all([adminOrgs(), headers()]);
  const host = h.get('host');
  const bad = rows.filter((r) => r.vault && !r.configAuthorityNone);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader kicker="Solana" title="Orgs and vaults">
        Every company&rsquo;s multisig, read from the chain. The config authority must be <strong>none</strong>: then only the vault&rsquo;s own members can change it, and Splash cannot.
      </PageHeader>
      <SimulatedNote simulated={runtime().env.mode === 'offline'} />
      <p className="text-sm font-semibold text-[#1f4350]" role="status">
        {rows.length} {rows.length === 1 ? 'company' : 'companies'} · {rows.filter((r) => r.vault).length} with a vault ·{' '}
        {bad.length === 0 ? 'every config authority reads none' : `${bad.length} not reading none`} · {rows.filter((r) => r.suspended).length} suspended
      </p>
      {rows.length === 0 ? (
        <p className="dash-surface p-6 text-sm text-[#326273]">No company has finished account setup on this server yet.</p>
      ) : (
        <Table caption="Companies and their vaults" head={['Company', 'Multisig', 'Payments vault #0', 'Treasury vault #1', 'Approvals', 'Config authority (chain)', 'Service']}>
          {rows.map((r) => (
            <tr key={r.orgId}>
              <Td>
                <div className="font-bold">{r.companyName}</div>
                <div className="font-mono text-xs text-[#326273]">{r.orgId}</div>
                <div className="text-xs text-[#326273]">since {when(r.createdAt)}</div>
              </Td>
              {r.vault ? (
                <>
                  <Td><Addr value={r.vault.multisigPda} href={r.vault.multisig.solscanUrl} /></Td>
                  <Td><Addr value={r.vault.paymentsVault.address} href={r.vault.paymentsVault.solscanUrl} /></Td>
                  <Td><Addr value={r.vault.treasuryVault.address} href={r.vault.treasuryVault.solscanUrl} /></Td>
                  <Td>
                    <span className="tabular-nums">{r.vault.threshold} of {r.vault.memberCount}</span>
                    {r.chain.found && (r.chain.threshold !== r.vault.threshold || r.chain.members !== r.vault.memberCount) ? (
                      <div className="mt-1"><Badge tone="warn">chain: {r.chain.threshold} of {r.chain.members}</Badge></div>
                    ) : null}
                  </Td>
                  <Td>
                    {!r.chain.found ? (
                      <Badge tone="warn">not read from the chain</Badge>
                    ) : r.configAuthorityNone ? (
                      <Badge tone="ok">none</Badge>
                    ) : (
                      <span className="inline-flex flex-col gap-1">
                        <Badge tone="error">SET: someone outside can change it</Badge>
                        <span className="font-mono text-xs text-[var(--error)]">{r.chain.configAuthority}</span>
                      </span>
                    )}
                  </Td>
                </>
              ) : (
                <td colSpan={5} className="px-4 py-3 align-top text-[#326273]">
                  No vault yet: account setup is not finished.
                </td>
              )}
              <Td>
                {r.suspended ? (
                  <span className="inline-flex flex-col gap-1">
                    <Badge tone="error">Suspended</Badge>
                    <span className="text-xs text-[#326273]">{r.suspended.reason}</span>
                  </span>
                ) : (
                  <Badge tone="ok">Served</Badge>
                )}
                <div className="mt-1">
                  <Link href={adminConsolePath('/compliance', host)} className="text-xs font-semibold text-[var(--info)] underline-offset-4 hover:underline">
                    Compliance
                  </Link>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
