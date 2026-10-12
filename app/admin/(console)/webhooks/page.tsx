import { Badge, PageHeader, Stat, Table, Td, when } from '@/components/admin/solana/parts';
import { adminWebhooks } from '@/lib/solana-app/admin-service';

export const dynamic = 'force-dynamic';

/**
 * Partner webhooks (prompt 07 §7.6): what the payout partner last told Splash, whether each message's
 * signature checked out, and the rules that stop a replay. A webhook changes a payment only after all
 * of them pass.
 */
export default function AdminWebhooksPage() {
  const w = adminWebhooks();
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader kicker="Payout partner" title="Partner webhooks">
        The payout partner reports each payout (received, paid, returned) by webhook. A webhook changes a payment only if its signature, age and amount all check out.
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Accepted" value={String(w.counts.accepted)} />
        <Stat label="Replays ignored" value={String(w.counts.duplicate)} note="Same payment and status again" />
        <Stat label="Refused" value={String(w.counts.refused)} tone={w.counts.refused > 0 ? 'error' : undefined} />
        <Stat label="Bad signatures" value={String(w.counts.badSignature)} tone={w.counts.badSignature > 0 ? 'error' : undefined} />
      </div>

      <section aria-labelledby="wh-rules" className="dash-surface space-y-3 p-5 md:p-6">
        <h2 id="wh-rules" className="text-lg font-black text-[#1f4350]">Checks before a webhook counts</h2>
        <p className="text-sm text-[#326273]">
          Partner: <strong className="text-[#1f4350]">{w.partner.name}</strong>
          {w.partner.sandbox ? ' (sandbox: pays no real bank)' : ''}
        </p>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
          <dt className="font-semibold text-[#1f4350]">Signature</dt>
          <dd className="text-[#326273]">{w.protection.signature}</dd>
          <dt className="font-semibold text-[#1f4350]">Replay window</dt>
          <dd className="text-[#326273]">
            Refused when older than {w.protection.maxAgeSec / 60} minutes, or more than {w.protection.futureSkewSec / 60} minutes in the future
          </dd>
          <dt className="font-semibold text-[#1f4350]">Replay of a valid one</dt>
          <dd className="text-[#326273]">{w.protection.duplicateRule}</dd>
          <dt className="font-semibold text-[#1f4350]">Amount</dt>
          <dd className="text-[#326273]">{w.protection.amountRule}</dd>
        </dl>
      </section>

      <section aria-labelledby="wh-log" className="space-y-3">
        <h2 id="wh-log" className="text-lg font-black text-[#1f4350]">Last webhooks</h2>
        <p className="text-sm text-[#326273]">The last 50 this server received since it started, newest first.</p>
        {w.log.length === 0 ? (
          <p className="dash-surface p-6 text-sm text-[#326273]">No webhooks yet.</p>
        ) : (
          <Table caption="Partner webhooks, newest first" head={['When', 'Payment', 'Status', 'Signature', 'Result', 'Why']}>
            {w.log.map((l, i) => (
              <tr key={`${l.at}-${i}`}>
                <Td className="whitespace-nowrap tabular-nums">{when(l.at)}</Td>
                <Td><span className="font-mono text-xs">{l.paymentId || '(none)'}</span></Td>
                <Td>{l.status || '(none)'}</Td>
                <Td>{l.signatureOk === true ? <Badge tone="ok">valid</Badge> : l.signatureOk === false ? <Badge tone="error">invalid</Badge> : <Badge tone="muted">not checked</Badge>}</Td>
                <Td>{l.result === 'accepted' ? <Badge tone="ok">applied</Badge> : l.result === 'duplicate' ? <Badge tone="info">replay, no change</Badge> : <Badge tone="error">refused</Badge>}</Td>
                <Td className="max-w-[22rem] text-xs text-[#326273]">{l.reason ?? ''}</Td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}
