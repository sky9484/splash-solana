import { PolicyRules } from '@/components/solana/PolicyRules';
import { MAX_QUOTE_TTL_SEC } from '@/lib/route-engine/quote';
import { DEMO_LIMITS } from '@/lib/solana-app/service';

export const metadata = { title: 'Rules · Splash on Solana' };

export default function PolicyPage() {
  return (
    <div className="sx-stack-lg">
      <div>
        <h1>Rules</h1>
        <p className="sx-lede">
          These run as code before every approval. Zeke can&rsquo;t change or skip them. Only the Company Authority can edit rules; in this demo they are read-only.
        </p>
      </div>
      <section className="sx-card">
        <PolicyRules perPaymentMinor={DEMO_LIMITS.perPaymentUsdcMinor.toString()} dailyMinor={DEMO_LIMITS.dailyUsdcMinor.toString()} quoteTtlSec={MAX_QUOTE_TTL_SEC} />
      </section>
      <div className="sx-notice sx-notice-info">
        <p>When editing arrives: loosening a rule takes effect in 24 hours and notifies everyone on your team. Tightening applies at once.</p>
      </div>
    </div>
  );
}
