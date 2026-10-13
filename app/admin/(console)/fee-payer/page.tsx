import { Addr, PageHeader, SimulatedNote, Stat, Table, Td, lamports, sol } from '@/components/admin/solana/parts';
import { adminFeePayer } from '@/lib/solana-app/admin-service';

export const dynamic = 'force-dynamic';

/**
 * The fee payer (prompt 07 §7.3): Kora's SOL, what it paid today and over 7 days, per company, and the
 * rent it has put into accounts. Kora pays network fees and account rent so nobody needs SOL; it
 * never sends SOL or tokens (I-3). Fees are exact, read from each transaction; rent is exact offline
 * and an estimate from account sizes on devnet.
 */
export default async function AdminFeePayerPage() {
  const k = await adminFeePayer();
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader kicker="Solana" title="Fee payer (Kora)">
        Kora pays every sponsored transaction&rsquo;s fee and the rent of the accounts it creates, so no company needs SOL. It never sends SOL or tokens, and holds no customer money.
      </PageHeader>
      <SimulatedNote simulated={k.simulated} />

      {k.low ? (
        <div role="alert" className="rounded-2xl border border-[var(--error)]/40 bg-[var(--error-bg)] p-4 text-sm text-[var(--error)]">
          <strong>Top up the fee payer.</strong> It holds {sol(k.solLamports)}, under the {sol(k.alertBelowLamports)} alert line. Below what a send costs, sponsored transactions fail and no company can pay.
        </div>
      ) : null}

      <section aria-labelledby="fp-balance" className="dash-surface space-y-4 p-5 md:p-6">
        <h2 id="fp-balance" className="text-lg font-black text-[#1f4350]">Balance and spend</h2>
        <p className="text-sm text-[#326273]">
          Fee payer <Addr value={k.feePayer.address} href={k.feePayer.solscanUrl} label="fee payer on Solscan" />
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="SOL now" value={sol(k.solLamports)} note={`Alert below ${sol(k.alertBelowLamports)}`} tone={k.low ? 'error' : undefined} />
          <Stat label="Today (UTC)" value={sol(k.today.feeLamports + k.today.rentLamports)} note={`${k.today.count} sends · fees ${lamports(k.today.feeLamports)} · rent ${lamports(k.today.rentLamports)}`} />
          <Stat label="Last 7 days" value={sol(k.week.feeLamports + k.week.rentLamports)} note={`${k.week.count} sends · fees ${lamports(k.week.feeLamports)}`} />
          <Stat label="Rent locked in accounts" value={sol(k.rentLocked)} note="Splash's vaults set no rent collector, so this rent stays in the accounts it paid for." />
        </div>
      </section>

      <section aria-labelledby="fp-orgs" className="space-y-3">
        <h2 id="fp-orgs" className="text-lg font-black text-[#1f4350]">Per company, last 7 days</h2>
        <p className="text-sm text-[#326273]">Each company may have {k.perOrgCap} sponsored transactions a day (Splash&rsquo;s counter, checked before Kora; Kora keeps its own).</p>
        {k.perOrg.length === 0 ? (
          <p className="dash-surface p-6 text-sm text-[#326273]">Nothing sponsored in the last 7 days.</p>
        ) : (
          <Table caption="Fee payer spend per company" head={['Company', 'Today', 'Cap used today', 'Fees, 7 days', 'Rent, 7 days', 'Total, 7 days']}>
            {k.perOrg.map((r) => (
              <tr key={r.orgId}>
                <Td>
                  <div className="font-bold">{r.companyName}</div>
                  <div className="font-mono text-xs text-[#326273]">{r.orgId}</div>
                </Td>
                <Td className="tabular-nums">{sol(r.today.feeLamports + r.today.rentLamports)}</Td>
                <Td className="tabular-nums">
                  {r.capUsedToday} of {k.perOrgCap}
                </Td>
                <Td className="tabular-nums">{lamports(r.week.feeLamports)}</Td>
                <Td className="tabular-nums">{lamports(r.week.rentLamports)}</Td>
                <Td className="font-semibold tabular-nums">{sol(r.week.feeLamports + r.week.rentLamports)}</Td>
              </tr>
            ))}
          </Table>
        )}
        <p className="text-xs leading-5 text-[#326273]">
          Fees are exact: 5,000 lamports per signature plus the priority fee, read from each transaction. Rent is the rent-exempt minimum of each account a send created (a token account is 2,039,280 lamports); on devnet the Squads account sizes make it an estimate.
        </p>
      </section>
    </div>
  );
}
