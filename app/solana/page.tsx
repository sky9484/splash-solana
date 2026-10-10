import Link from 'next/link';

import { IsoFlow } from '@/components/solana/IsoFlow';
import { readSolanaEnv } from '@/lib/solana/config';

export default function SolanaLanding() {
  const { mode } = readSolanaEnv();
  return (
    <div className="sx-stack-lg">
      <section className="sx-hero" aria-labelledby="hero-title">
        <h1 id="hero-title" className="sx-display">
          <span>Pay suppliers.</span>
          <span>Prove everything.</span>
        </h1>
        <div className="sx-hero-grid">
        <div>
          <p className="sx-hero-copy">
            Every month, finance teams across Southeast Asia pay suppliers abroad, then spend days proving it: invoice in email, approval in WhatsApp, rate in a
            screenshot. Splash fixes both halves on Solana. Businesses pay suppliers in USDC, built so suppliers receive local currency in their bank. Your vault, your
            keys: every business gets its own Squads vault, and Splash holds no key that can move your money. AI that works, never spends: Zeke reads invoices and
            compares routes; your approvers sign every payment. One record per payment: invoice, approval, transfer and rate, together, ready for your auditor.
          </p>
          <div className="sx-row sx-hero-actions">
            <Link className="sx-btn" href="/solana/onboarding">
              Start the demo
            </Link>
            <Link className="sx-btn sx-btn-ghost" href="/solana/policy">
              See the rules
            </Link>
          </div>
        </div>
        <IsoFlow />
        </div>
      </section>

      <section className="sx-landing-foot" aria-label="About this build">
        <div className="sx-card-quiet">
          <h2>What is mock</h2>
          <ul className="sx-mock-list">
            <li>The payout partner is a mock: it is shown as &ldquo;Mock partner · devnet&rdquo; and pays no real bank.</li>
            <li>Wallet screening (KYT) is a stub, not a real screening.</li>
            <li>The exchange rate is a fixed reference (57.40 pesos per USDC), not a live rate.</li>
            <li>
              The chain is {mode === 'offline' ? 'simulated offline right now' : 'Solana devnet right now'}: offline, every transaction runs in a local simulator and
              every receipt says &ldquo;Simulated&rdquo;; the same code runs on devnet. Mainnet is switched off.
            </li>
          </ul>
        </div>
        <div className="sx-card-quiet sx-stack">
          <h2>What is real</h2>
          <p className="sx-muted">
            The recovery kit and device key are made in your browser and never sent to Splash. The vault is a Squads V4 multisig with no config authority. Every payment
            needs your device&rsquo;s signature. The receipt is checked in your browser against the anchored record.
          </p>
          <p className="sx-small">
            Splash never holds the money. Prior work: <Link href="/">the Sui build</Link>.
          </p>
        </div>
      </section>
    </div>
  );
}
