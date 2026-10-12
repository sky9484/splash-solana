import { PolicyRules } from '@/components/solana/PolicyRules';
import { SolanaDashPage } from '@/components/solana/SolanaDashPage';
import { MAX_QUOTE_TTL_SEC } from '@/lib/route-engine/quote';
import { DEMO_LIMITS } from '@/lib/solana-app/service';

export const metadata = { title: 'Payment rules · Splash' };

/** The rules every payment passes before the device prompt, each tagged with where it is enforced. */
export default function PolicyPage() {
  return (
    <SolanaDashPage kicker="Settings" title="Payment rules" description="These run as code before every approval. Zeke can’t change or skip them.">
      <div className="sx-stack-lg">
        <section className="sx-card">
          <PolicyRules perPaymentMinor={DEMO_LIMITS.perPaymentUsdcMinor.toString()} dailyMinor={DEMO_LIMITS.dailyUsdcMinor.toString()} quoteTtlSec={MAX_QUOTE_TTL_SEC} />
        </section>
        <div className="sx-notice sx-notice-info">
          <p>Rules are read-only in this build. When editing arrives, loosening a rule takes effect after 24 hours and tells everyone on your team; tightening applies at once.</p>
        </div>
      </div>
    </SolanaDashPage>
  );
}
