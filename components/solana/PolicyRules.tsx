'use client';

import { usd } from './client';
import { useCompany } from './useCompany';

type Tag = { text: string; tone: 'locked' | 'splash' | 'vault' | 'planned' | 'stub' };

const TONE: Record<Tag['tone'], string> = {
  locked: 'sx-pill sx-pill-ok',
  splash: 'sx-pill',
  vault: 'sx-pill sx-pill-sim',
  stub: 'sx-pill sx-pill-warn',
  planned: 'sx-pill sx-pill-pending',
};

/** Rules as sentences with real values, each tagged with where it is enforced (design brief §6). */
export function PolicyRules({ perPaymentMinor, dailyMinor, quoteTtlSec }: { perPaymentMinor: string; dailyMinor: string; quoteTtlSec: number }) {
  const { state } = useCompany();
  const suppliers = state.status === 'ready' ? state.company.suppliers : [];
  const used = state.status === 'ready' ? state.company.limits.usedTodayUsdcMinor : null;
  const rules: Array<{ text: React.ReactNode; tags: Tag[] }> = [
    { text: 'Every supplier payment needs an approval on this device. Nothing pays on its own.', tags: [{ text: 'Locked · always on', tone: 'locked' }, { text: 'Enforced by your own accounts', tone: 'vault' }] },
    { text: <>Per payment up to {usd(perPaymentMinor)}.</>, tags: [{ text: 'Enforced by Splash', tone: 'splash' }] },
    {
      text: (
        <>
          Up to {usd(dailyMinor)} per day{used !== null ? <span className="sx-muted"> ({usd(used)} used today)</span> : null}.
        </>
      ),
      tags: [{ text: 'Enforced by Splash', tone: 'splash' }],
    },
    {
      text: (
        <>
          Only verified suppliers. New or changed bank details need a call-back first.{' '}
          <details style={{ display: 'inline-block' }}>
            <summary>View list ({suppliers.length})</summary>
            {suppliers.length === 0 ? (
              <p className="sx-small sx-muted">No verified suppliers yet. A supplier joins the list after its first paid invoice.</p>
            ) : (
              <ul className="sx-small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {suppliers.map((s) => (
                  <li key={`${s.name}-${s.accountLast4}`}>
                    {s.name}, {s.bank} •••• {s.accountLast4}
                  </li>
                ))}
              </ul>
            )}
          </details>
        </>
      ),
      tags: [{ text: 'Enforced by Splash', tone: 'splash' }],
    },
    { text: 'An invoice is paid once. A second payment of the same invoice is blocked.', tags: [{ text: 'Enforced by Splash', tone: 'splash' }] },
    { text: `A quote lasts at most ${quoteTtlSec} seconds. An expired quote can't be approved.`, tags: [{ text: 'Enforced by Splash', tone: 'splash' }] },
    { text: 'Every account a supplier is paid into is screened before you approve.', tags: [{ text: 'Enforced by Splash', tone: 'splash' }, { text: 'Stub, not a real screening', tone: 'stub' }] },
    { text: 'Processing is included. The account Splash pays processing from can’t send money anywhere.', tags: [{ text: 'Enforced by Splash', tone: 'splash' }] },
    { text: <>Two people approve payments above {usd(10_000_000_000n)}.</>, tags: [{ text: 'Planned · two approvers', tone: 'planned' }] },
    { text: 'Zeke may pay for data services up to US$50 a month (Weather API only).', tags: [{ text: 'Planned · mandate', tone: 'planned' }] },
  ];
  return (
    <ul className="sx-rules">
      {rules.map((r, i) => (
        <li key={i}>
          <div className="sx-rule-text">{r.text}</div>
          <div className="sx-row" style={{ gap: 6 }}>
            {r.tags.map((t) => (
              <span key={t.text} className={TONE[t.tone]}>
                {t.text}
              </span>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
