import { Addr, Badge, PageHeader, SimulatedNote, Stat, Table, Td, mist, short, when } from '@/components/admin/solana/parts';
import { adminEvidence } from '@/lib/solana-app/admin-service';
import { runtime } from '@/lib/solana-app/runtime';

export const dynamic = 'force-dynamic';

const SPONSOR_LABEL = 'Sui sponsor (evidence only)';

/**
 * Evidence (prompt 07 §7.4): the anchors on Solana (each batch root, how many records it covers and
 * the period), where each encrypted record is stored and when its Walrus epochs run out, and the gas
 * money of the key that pays for evidence allowlist updates (it holds nothing else).
 */
export default async function AdminEvidencePage() {
  const ev = await adminEvidence();
  const fmtPeriod = (start: bigint, end: bigint) => `${when(new Date(Number(start) * 1000).toISOString())} to ${when(new Date(Number(end) * 1000).toISOString())}`;
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader kicker="Solana" title="Evidence">
        Each payment&rsquo;s record is encrypted and stored, and its batch root is anchored on Solana by the attester key. The attester signs roots only; it is never a vault member and holds no money.
      </PageHeader>
      <SimulatedNote simulated={runtime().env.mode === 'offline'} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Anchors" value={String(ev.anchors.length)} note={`${ev.anchors.filter((a) => a.status !== 'anchored').length} pending`} />
        <Stat label="Records on Walrus" value={String(ev.walrus.onWalrus)} note={`${ev.walrus.epochs} epochs each (${ev.walrus.epochDays} day${ev.walrus.epochDays === 1 ? '' : 's'} an epoch)`} />
        <Stat label="Records offline" value={String(ev.walrus.offline)} note="The offline stand-in store: nothing expires, nothing is on Walrus" />
        <Stat label="Expiring within 7 days" value={String(ev.walrus.expiringSoon)} tone={ev.walrus.expiringSoon > 0 ? 'error' : undefined} note={ev.walrus.expiringSoon > 0 ? 'Extend their epochs before they lapse' : 'None'} />
      </div>

      <section aria-labelledby="ev-anchors" className="space-y-3">
        <h2 id="ev-anchors" className="text-lg font-black text-[#1f4350]">Anchors</h2>
        <p className="text-sm text-[#326273]">
          Attester <Addr value={ev.attester} /> · method: SPL Memo carrying the root. A Solana Attestation Service attestation is built but not live yet.
        </p>
        {ev.anchors.length === 0 ? (
          <p className="dash-surface p-6 text-sm text-[#326273]">No anchors yet.</p>
        ) : (
          <Table caption="Evidence anchors" head={['Root', 'Records', 'Period', 'Method', 'Status', 'Transaction']}>
            {ev.anchors.map((a) => (
              <tr key={a.rootHex}>
                <Td><span className="font-mono text-[13px]" title={a.rootHex}>{short(a.rootHex, 10)}</span></Td>
                <Td className="tabular-nums">{a.count} in the batch · {a.receipts} here</Td>
                <Td className="text-xs">{fmtPeriod(a.periodStart, a.periodEnd)}</Td>
                <Td>{a.method === 'memo' ? 'SPL Memo' : a.method}</Td>
                <Td><Badge tone={a.status === 'anchored' ? 'ok' : 'warn'}>{a.status}</Badge></Td>
                <Td>{a.signature ? <><Addr value={a.signature} href={a.solscanUrl} />{a.simulated ? <span className="ml-2 text-xs text-[#326273]">simulated</span> : null}</> : <span className="text-xs text-[#326273]">not sent</span>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section aria-labelledby="ev-stored" className="space-y-3">
        <h2 id="ev-stored" className="text-lg font-black text-[#1f4350]">Stored records</h2>
        {ev.stored.length === 0 ? (
          <p className="dash-surface p-6 text-sm text-[#326273]">No records stored yet.</p>
        ) : (
          <Table caption="Stored evidence records" head={['Receipt', 'Company', 'Stored', 'Where', 'Size', 'Epochs run out']}>
            {ev.stored.map((s) => (
              <tr key={s.receiptId}>
                <Td><span className="font-mono text-xs">{s.receiptId}</span></Td>
                <Td>{s.companyName}</Td>
                <Td className="whitespace-nowrap text-xs tabular-nums">{when(s.createdAt)}</Td>
                <Td>
                  {s.mode === 'memory' ? <Badge tone="muted">offline store</Badge> : <Badge tone="info">Walrus{s.mode === 'walrus-demo' ? ' (demo)' : ''}</Badge>}
                  <div className="mt-1 font-mono text-xs text-[#326273]" title={s.blobId}>{short(s.blobId, 8)}</div>
                </Td>
                <Td className="tabular-nums">{s.sizeBytes.toLocaleString('en-US')} bytes</Td>
                <Td>{s.expiresAt ? <span className={s.expiringSoon ? 'font-bold text-[var(--error)]' : ''}>{when(s.expiresAt)}</span> : <span className="text-xs text-[#326273]">does not expire</span>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section aria-labelledby="ev-sponsor" className="dash-surface space-y-2 p-5 md:p-6">
        <h2 id="ev-sponsor" className="text-lg font-black text-[#1f4350]">{SPONSOR_LABEL}</h2>
        <p className="text-sm leading-6 text-[#326273]">Pays the gas when a company changes who can open its evidence. It signs nothing else and holds no customer money.</p>
        {ev.sponsor ? (
          <p className="text-sm text-[#1f4350]">
            <span className="font-mono">{short(ev.sponsor.address, 10)}</span> · <strong className="tabular-nums">{mist(ev.sponsor.balanceMist)}</strong> of gas
          </p>
        ) : (
          <p className="text-sm text-[#1f4350]">{ev.sponsorProblem ? `Not available: ${ev.sponsorProblem}` : 'Not configured on this server (offline, no evidence network).'}</p>
        )}
      </section>
    </div>
  );
}
