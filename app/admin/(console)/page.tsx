import Link from 'next/link';
import { headers } from 'next/headers';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Headphones, ShieldCheck } from 'lucide-react';

import { adminConsolePath } from '@/lib/admin-routing';
import { listKybCasesForStaff } from '@/lib/server/kyb';
import { listSupportTickets } from '@/lib/server/support';

export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  const headerStore = await headers();
  const hostname = headerStore.get('host');
  const kybCases = await listKybCasesForStaff();
  const tickets = listSupportTickets();
  const pendingKyb = kybCases.filter((item) => item.state === 'SUBMITTED' || item.state === 'IN_REVIEW' || item.state === 'NEEDS_INFORMATION');
  const openTickets = tickets.filter((ticket) => ticket.status === 'OPEN' || ticket.status === 'IN_REVIEW');
  const complaints = tickets.filter((ticket) => ticket.type === 'complaint' && ticket.status !== 'CLOSED');

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="dash-surface p-6 md:p-8">
        <div className="mb-3 inline-flex rounded-full bg-[#5C9EAD]/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#237284]">admin.splash.xyz</div>
        <div className="grid gap-5 xl:grid-cols-[1fr_auto] xl:items-end">
          <div>
            <span className="dash-kicker">Control room</span>
            <h1 className="dash-title mt-2 text-4xl">Staff operations console</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[#326273]/90">Separate internal workspace for compliance approvals, manual customer operations, complaint handling, and regulator-facing review evidence.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-2xl bg-[#F6F0ED] p-2 text-center">
            <Metric label="KYB queue" value={pendingKyb.length} />
            <Metric label="Open tickets" value={openTickets.length} />
            <Metric label="Complaints" value={complaints.length} />
          </div>
        </div>
      </header>

      <section className="grid gap-5 lg:grid-cols-2">
        <Link href={adminConsolePath('/kyb', hostname)} className="dash-block dash-block-interactive group p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#5C9EAD]/10 text-[#237284]"><ClipboardCheck className="h-6 w-6" /></div>
              <h2 className="mt-5 text-2xl font-black text-[#1f4350]">KYB approval verification</h2>
              <p className="mt-2 text-sm leading-6 text-[#326273]/90">Review submitted businesses, documents, Sumsub applicant references, missing-info requests, and approval or rejection rationale.</p>
            </div>
            <span className="rounded-full bg-[#F6F0ED] px-3 py-1 text-xs font-bold text-[#326273]">{pendingKyb.length} pending</span>
          </div>
          <div className="mt-6 space-y-3">
            {pendingKyb.slice(0, 3).map((item) => (
              <div key={item.id} className="rounded-2xl bg-[#F6F0ED] p-4 text-sm">
                <div className="font-bold text-[#1f4350]">{item.businessName}</div>
                <div className="mt-1 text-xs text-[#326273]/90">{item.state.replace('_', ' ')} · {item.registrationNumber}</div>
              </div>
            ))}
            {pendingKyb.length === 0 && <div className="rounded-2xl bg-[#F6F0ED] p-4 text-sm text-[#326273]/90">No pending KYB cases.</div>}
          </div>
        </Link>

        <Link href={adminConsolePath('/support', hostname)} className="dash-block dash-block-interactive group p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E39774]/10 text-[#9f5839]"><Headphones className="h-6 w-6" /></div>
              <h2 className="mt-5 text-2xl font-black text-[#1f4350]">Feedback and complaints</h2>
              <p className="mt-2 text-sm leading-6 text-[#326273]/90">Triage support tickets from the customer dashboard, assign ownership, reply manually, and close resolved complaints.</p>
            </div>
            <span className="rounded-full bg-[#F6F0ED] px-3 py-1 text-xs font-bold text-[#326273]">{openTickets.length} open</span>
          </div>
          <div className="mt-6 space-y-3">
            {openTickets.slice(0, 3).map((ticket) => (
              <div key={ticket.id} className="rounded-2xl bg-[#F6F0ED] p-4 text-sm">
                <div className="font-bold text-[#1f4350]">{ticket.subject}</div>
                <div className="mt-1 text-xs text-[#326273]/90">{ticket.type} · {ticket.priority}</div>
              </div>
            ))}
            {openTickets.length === 0 && <div className="rounded-2xl bg-[#F6F0ED] p-4 text-sm text-[#326273]/90">No open support tickets.</div>}
          </div>
        </Link>
      </section>

      <section className="grid gap-5 md:grid-cols-3">
        <Control icon={ShieldCheck} title="Separated admin domain" detail="Use `/admin/*` locally and map the same routes to `admin.splash.xyz/*` at deploy/proxy level." />
        <Control icon={CheckCircle2} title="Off-chain approval" detail="KYB state controls customer access and policy decisions before settlement execution." />
        <Control icon={AlertTriangle} title="Contract boundary" detail="Smart contracts handle receipts and settlement state, not business identity verification." />
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white px-5 py-3">
      <div className="dash-num text-2xl font-black text-[#1f4350]">{value}</div>
      <div className="text-[12px] font-bold uppercase tracking-wide text-[#326273]/90">{label}</div>
    </div>
  );
}

function Control({ icon: Icon, title, detail }: { icon: typeof ShieldCheck; title: string; detail: string }) {
  return (
    <div className="dash-block p-5">
      <Icon className="h-5 w-5 text-[#237284]" />
      <div className="mt-4 font-bold text-[#1f4350]">{title}</div>
      <p className="mt-2 text-sm leading-6 text-[#326273]/90">{detail}</p>
    </div>
  );
}
