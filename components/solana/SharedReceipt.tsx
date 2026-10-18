import Image from 'next/image';
import Link from 'next/link';

import { BRAND } from '@/content/brand';
import { ServiceError } from '@/lib/solana-app/errors';
import { sharedReceipt } from '@/lib/solana-app/shared-receipt';

import { ReceiptView } from './ReceiptView';

import './solana.css';

/**
 * What an auditor sees from "Share with auditor" (prompt 12 §5.4): Paper, the receipt as one A4 page,
 * one live Verify, and nothing from the dashboard (no sidebar, no account beyond what the receipt
 * shows). The link opens this receipt and nothing else. A link that was stopped, has expired or never
 * existed gets the not-valid page in the 404's style, and says nothing about which.
 */
export async function SharedReceipt({ token }: { token: string }) {
  const valid = await sharedReceipt(token).then(
    () => true,
    (e) => {
      if (e instanceof ServiceError && e.code === 'receipt_not_found') return false;
      throw e;
    },
  );
  if (!valid) {
    return (
      <main className="st sp-page sp-ground-paper">
        <section className="st-card">
          <h1>This receipt link isn’t valid</h1>
          <p>Ask the business that shared it for a new one.</p>
          <div className="st-actions">
            <Link href="/" className="st-btn st-btn--primary">Go to Splash</Link>
            <a href={`mailto:${BRAND.supportEmail}`} className="st-btn st-btn--quiet">Contact support</a>
          </div>
        </section>
      </main>
    );
  }
  return (
    <main className="iso iso-ground iso-shared">
      <header className="iso-shared__head">
        <Link href="/" className="iso-shared__brand">
          <Image src="/splash-main-icon.png" alt="" width={48} height={47} />
          <strong>Splash</strong>
        </Link>
        <span className="iso-shared__what">Read-only receipt</span>
      </header>
      <div className="sx sx-embedded">
        <ReceiptView source={{ kind: 'shared', token }} />
      </div>
      <p className="iso-shared__note">Shared by the payer. This link opens this receipt only.</p>
    </main>
  );
}
