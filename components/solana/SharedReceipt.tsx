import Image from 'next/image';
import Link from 'next/link';

import { ReceiptView } from './ReceiptView';

import './solana.css';

/**
 * What an auditor sees from "Share with auditor": one receipt, its five checks, its Solscan trace and
 * the evidence pack, with no sign-in. The link opens this receipt and nothing else.
 */
export function SharedReceipt({ token }: { token: string }) {
  return (
    <main className="min-h-screen bg-[#F6F0ED] px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2 text-[#1F4452]">
            <Image src="/splash-main-icon.png" alt="" width={32} height={31} className="h-8 w-8 object-contain" />
            <strong className="text-lg font-semibold">
              Splash<span className="text-[#5C9EAD]">.</span>
            </strong>
          </Link>
          <span className="text-[13px] font-medium text-[#326273]">Read-only receipt</span>
        </header>
        <div className="sx sx-embedded">
          <ReceiptView source={{ kind: 'shared', token }} showTitle />
        </div>
        <p className="text-center text-[13px] font-medium text-[#326273]">Shared by the payer. This link opens this receipt only.</p>
      </div>
    </main>
  );
}
