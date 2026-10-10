import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import KybSettings from "@/components/KybSettings";
import { getCustomerSession } from "@/lib/server/customer-auth";

export const dynamic = "force-dynamic";

export default async function KybPage() {
  const session = await getCustomerSession();

  if (!session) {
    redirect("/login");
  }

  return (
    <main className="min-h-svh splash-page-bg px-6 py-8 text-[#326273]">
      <div className="mx-auto w-full max-w-6xl space-y-8">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-[#326273]/70 hover:text-[#326273]">
          <ArrowLeft className="size-4" />
          Back to landing
        </Link>
        <KybSettings />
      </div>
    </main>
  );
}
