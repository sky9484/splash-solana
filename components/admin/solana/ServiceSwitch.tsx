'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

/**
 * Suspend or restore service for one company, with the reason that goes in the audit log. Nothing
 * happens until the reason is written and the button pressed; the page reloads with the new state.
 */
export default function ServiceSwitch({ orgId, companyName, suspended, canAct }: { orgId: string; companyName: string; suspended: boolean; canAct: boolean }) {
  const router = useRouter();
  const id = useId();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = suspended ? 'unsuspend' : 'suspend';

  if (!canAct) return <p className="text-xs text-[#326273]">Compliance or operations staff can change this.</p>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/solana/orgs/${encodeURIComponent(orgId)}/service`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message ?? `Request failed (${res.status}).`);
      setReason('');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-2">
      <label htmlFor={`${id}-reason`} className="text-xs font-semibold text-[#1f4350]">
        Reason for the audit log
      </label>
      <textarea
        id={`${id}-reason`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        maxLength={500}
        className="w-full rounded-xl border border-[#326273]/25 bg-white px-3 py-2 text-sm text-[#1f4350]"
        placeholder={suspended ? 'e.g. New documents verified' : 'e.g. KYB documents expired'}
      />
      {error ? (
        <p role="alert" className="text-xs font-semibold text-[var(--error)]">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy || reason.trim().length < 3}
        className={`w-fit rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-50 ${suspended ? 'bg-[#1f4350] text-white' : 'bg-[var(--error)] text-white'}`}
      >
        {busy ? 'Saving…' : suspended ? `Restore service for ${companyName}` : `Suspend ${companyName}`}
      </button>
    </form>
  );
}
