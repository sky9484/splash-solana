import Link from 'next/link';

import { BRAND } from '@/content/brand';
import { getCustomerSession } from '@/lib/server/customer-auth';

/**
 * The 404 (prompt 12 §3.3): one white card on Paper, no image. A signed-in reader goes back to the desk
 * and asks support there; anyone else goes to the landing page and writes to the support address. Also
 * what Next shows for any address no route matches, and for every notFound().
 */
export default async function NotFound() {
  // A session that can't be read (a database that's down, say) counts as signed out: the page must still render.
  const signedIn = await getCustomerSession().then(Boolean, () => false);
  return (
    <main className="st sp-page sp-ground-paper">
      <section className="st-card">
        <h1>This page isn’t here</h1>
        <p>The link may be old, or the page moved.</p>
        <div className="st-actions">
          {signedIn ? (
            <Link href="/dashboard" className="st-btn st-btn--primary">Go to your desk</Link>
          ) : (
            <Link href="/" className="st-btn st-btn--primary">Go to Splash</Link>
          )}
          {signedIn ? (
            <Link href="/dashboard/customer-service" className="st-btn st-btn--quiet">Contact support</Link>
          ) : (
            <a href={`mailto:${BRAND.supportEmail}`} className="st-btn st-btn--quiet">Contact support</a>
          )}
        </div>
      </section>
    </main>
  );
}
