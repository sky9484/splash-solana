import ServiceSwitch from '@/components/admin/solana/ServiceSwitch';
import { Badge, PageHeader, Table, Td, when } from '@/components/admin/solana/parts';
import { adminOrgs } from '@/lib/solana-app/admin-service';
import { getAdminSession } from '@/lib/server/admin-auth';

export const dynamic = 'force-dynamic';

/**
 * Compliance (prompt 07 §7.5), subtractive only. Splash can refuse service: a suspended company gets
 * no fee-payer signature and can start no new proposal. Splash cannot freeze or move a customer's
 * funds: the vault is the company's multisig, with no config authority, and Splash is not a member.
 */
export default async function AdminCompliancePage() {
  const [rows, session] = await Promise.all([adminOrgs(), getAdminSession()]);
  const canAct = session?.role === 'compliance' || session?.role === 'operations';
  const log = rows
    .flatMap((r) => r.serviceLog.map((l) => ({ ...l, companyName: r.companyName, orgId: r.orgId })))
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader kicker="Compliance" title="Refuse service">
        <p className="text-base font-bold text-[#1f4350]">Splash can refuse service. Splash cannot freeze or move a customer&rsquo;s funds.</p>
        <p className="mt-2">
          Suspending a company stops Kora sponsoring its transactions and blocks new proposals. Its vault stays its own: its approvers can still move the money with their own keys. Every change goes in the audit log below.
        </p>
      </PageHeader>

      <section aria-labelledby="cp-orgs" className="space-y-3">
        <h2 id="cp-orgs" className="text-lg font-black text-[#1f4350]">Companies</h2>
        {rows.length === 0 ? (
          <p className="dash-surface p-6 text-sm text-[#326273]">No companies yet.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {rows.map((r) => (
              <li key={r.orgId} className="dash-surface grid gap-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-[#1f4350]">{r.companyName}</div>
                    <div className="font-mono text-xs text-[#326273]">{r.orgId}</div>
                  </div>
                  {r.suspended ? <Badge tone="error">Suspended</Badge> : <Badge tone="ok">Served</Badge>}
                </div>
                {r.suspended ? (
                  <p className="text-sm text-[#1f4350]">
                    Since {when(r.suspended.at)} by {r.suspended.by}: {r.suspended.reason}
                  </p>
                ) : null}
                <ServiceSwitch orgId={r.orgId} companyName={r.companyName} suspended={!!r.suspended} canAct={canAct} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="cp-log" className="space-y-3">
        <h2 id="cp-log" className="text-lg font-black text-[#1f4350]">Audit log</h2>
        {log.length === 0 ? (
          <p className="dash-surface p-6 text-sm text-[#326273]">No company has been suspended.</p>
        ) : (
          <Table caption="Suspend and unsuspend, newest first" head={['When', 'Company', 'Change', 'By', 'Reason']}>
            {log.map((l, i) => (
              <tr key={`${l.orgId}-${l.at}-${i}`}>
                <Td className="whitespace-nowrap tabular-nums">{when(l.at)}</Td>
                <Td>{l.companyName}</Td>
                <Td>{l.action === 'suspend' ? <Badge tone="error">Suspended</Badge> : <Badge tone="ok">Restored</Badge>}</Td>
                <Td className="font-mono text-xs">{l.by}</Td>
                <Td>{l.reason}</Td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}
