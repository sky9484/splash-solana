import { usdcPlain } from './client';
import type { OrgDTO } from './types';

/** Total first; the parts underneath must add up to it exactly (design brief §5). */
export function BalanceHeader({ balance, simulated }: { balance: OrgDTO['balance']; simulated: boolean }) {
  const sum = balance.parts.reduce((a, p) => a + BigInt(p.amountMinor), 0n);
  const total = BigInt(balance.totalMinor);
  return (
    <section className="sx-card sx-balance" aria-label="Balance">
      <div>
        <p className="sx-muted sx-small">Available to pay suppliers</p>
        <p className="sx-balance-total" aria-live="polite">
          US${usdcPlain(total)}
        </p>
        <p className="sx-balance-parts">
          {balance.parts.map((p) => `${p.lane} ${usdcPlain(p.amountMinor)}`).join(' · ')}
          {sum !== total ? ` · includes US$${usdcPlain(total - sum)} pending` : ''}
        </p>
      </div>
      {simulated ? <span className="sx-pill sx-pill-sim">Simulated test USDC</span> : <span className="sx-pill sx-pill-warn">Devnet test USDC</span>}
    </section>
  );
}
