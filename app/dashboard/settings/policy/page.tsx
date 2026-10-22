import { PageHead } from '@/components/dashboard/PageHead';
import { IsoSurface } from '@/components/iso';
import { PolicyRules } from '@/components/solana/PolicyRules';
import { MAX_QUOTE_TTL_SEC } from '@/lib/route-engine/quote';
import { DEMO_LIMITS } from '@/lib/solana-app/service';

export const metadata = { title: 'Payment rules · Splash' };

/** The rules every payment passes before the device prompt, each tagged with where it is enforced. */
export default function PolicyPage() {
  return (
    <div className="iso iso-page">
      <PageHead title="Payment rules" context="These run as code before every approval. Zeke can’t change or skip them." />
      <IsoSurface className="iso-rise iso-rise-2" aria-label="Payment rules">
        <PolicyRules perPaymentMinor={DEMO_LIMITS.perPaymentUsdcMinor.toString()} dailyMinor={DEMO_LIMITS.dailyUsdcMinor.toString()} quoteTtlSec={MAX_QUOTE_TTL_SEC} />
      </IsoSurface>
      <p className="iso-note">Rules are read-only in this build. When editing arrives, loosening a rule takes effect after 24 hours and tells everyone on your team; tightening applies at once.</p>
    </div>
  );
}
