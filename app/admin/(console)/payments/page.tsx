import { Addr, Badge, PageHeader, SimulatedNote, Table, Td, when } from '@/components/admin/solana/parts';
import { adminPayments } from '@/lib/solana-app/admin-service';
import { runtime } from '@/lib/solana-app/runtime';
import { formatPhp, formatUsd } from '@/lib/solana-zeke/router';

export const dynamic = 'force-dynamic';

const STATE_TONE: Record<string, 'ok' | 'warn' | 'error' | 'info' | 'muted'> = {
  anchored: 'ok',
  evidenced: 'ok',
  partner_paid: 'ok',
  confirmed: 'info',
  executed: 'info',
  approved: 'info',
  proposed: 'info',
  checked: 'muted',
  quoted: 'muted',
  draft: 'muted',
  quote_expired: 'warn',
  rejected_by_policy: 'warn',
  proposal_failed: 'error',
  execute_failed: 'error',
  partner_failed: 'error',
  evidence_failed: 'error',
};

const STEP_LABEL = { create: 'Create', approve: 'Approve', execute: 'Execute', anchor: 'Anchor', other: 'Other' } as const;

/**
 * Payments (prompt 07 §7.2): every payment on the Solana build, newest first: its state, the pesos and
 * the USDC, the proposal create / approve / execute transactions, what the payout partner last said,
 * and whether its proof is anchored.
 */
export default async function AdminPaymentsPage() {
  const rows = await adminPayments();
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader kicker="Solana" title="Payments">
        Every payment, newest first. A transaction on a network links to Solscan; a simulated one shows its signature only.
      </PageHeader>
      <SimulatedNote simulated={runtime().env.mode === 'offline'} />
      <p className="text-sm font-semibold text-[#1f4350]" role="status">
        {rows.length} {rows.length === 1 ? 'payment' : 'payments'} · {rows.filter((r) => r.state === 'anchored' || r.state === 'evidenced').length} paid with proof ·{' '}
        {rows.filter((r) => /failed|expired|rejected/.test(r.state)).length} need attention
      </p>
      {rows.length === 0 ? (
        <p className="dash-surface p-6 text-sm text-[#326273]">No payments yet.</p>
      ) : (
        <Table caption="Payments" head={['When', 'Company and recipient', 'Amount', 'State', 'Transactions', 'Payout partner', 'Evidence']}>
          {rows.map((p) => (
            <tr key={p.id}>
              <Td>
                <div className="whitespace-nowrap tabular-nums">{when(p.createdAt)}</div>
                <div className="font-mono text-xs text-[#326273]">{p.id}</div>
              </Td>
              <Td>
                <div className="font-bold">{p.companyName}</div>
                <div className="text-xs text-[#326273]">
                  {p.supplierName || 'Recipient'} · {p.kind === 'transfer' ? 'transfer' : 'invoice'}
                </div>
              </Td>
              <Td>
                <div className="whitespace-nowrap font-semibold tabular-nums">{formatPhp(p.amountPhpMinor)}</div>
                <div className="whitespace-nowrap text-xs tabular-nums text-[#326273]">{p.youPayUsdcMinor !== null ? formatUsd(p.youPayUsdcMinor) : 'not approved'}</div>
              </Td>
              <Td>
                <Badge tone={STATE_TONE[p.state] ?? 'muted'}>{p.stateLabel}</Badge>
                {p.problem ? <div className="mt-1 max-w-[16rem] text-xs text-[#326273]">{p.problem.message}</div> : null}
              </Td>
              <Td>
                {p.transactions.length === 0 ? (
                  <span className="text-xs text-[#326273]">None sent</span>
                ) : (
                  <ul className="space-y-1">
                    {p.transactions.map((t) => (
                      <li key={`${t.purpose}:${t.signature}`} className="flex items-baseline gap-2 text-xs">
                        <span className="w-16 font-semibold text-[#326273]">{STEP_LABEL[t.step]}</span>
                        <Addr value={t.signature} href={t.solscanUrl} />
                        {t.simulated ? <span className="text-[#326273]">simulated</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Td>
              <Td>
                {p.partner ? (
                  <>
                    <Badge tone={p.partner.status === 'paid' ? 'ok' : p.partner.status === 'returned' ? 'error' : 'info'}>{p.partner.status}</Badge>
                    {p.partner.bankReference ? <div className="mt-1 font-mono text-xs text-[#326273]">{p.partner.bankReference}</div> : null}
                  </>
                ) : (
                  <span className="text-xs text-[#326273]">No report yet</span>
                )}
              </Td>
              <Td>
                {p.evidence ? (
                  <>
                    <Badge tone={p.evidence.anchor === 'anchored' ? 'ok' : 'warn'}>{p.evidence.anchor}</Badge>
                    <div className="mt-1 font-mono text-xs text-[#326273]">{p.evidence.receiptId}</div>
                  </>
                ) : (
                  <span className="text-xs text-[#326273]">Not yet</span>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
