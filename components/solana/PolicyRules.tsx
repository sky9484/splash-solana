// iso-ui
'use client';

import { Tag as Chip, type TagTone } from '@/components/iso';

import { usd } from './client';
import { useCompany } from './useCompany';

type Tag = { text: string; tone: 'locked' | 'splash' | 'vault' | 'planned' | 'stub' };

/** Locked rules are ok, a stub is a warning, the rest say where they run in plain ink. */
const TONE: Record<Tag['tone'], TagTone> = { locked: 'ok', splash: 'ink', vault: 'ink', stub: 'amber', planned: 'ink' };

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
          Up to {usd(dailyMinor)} per day{used !== null ? <span className="iso-polrules__muted"> ({usd(used)} used today)</span> : null}.
        </>
      ),
      tags: [{ text: 'Enforced by Splash', tone: 'splash' }],
    },
    {
      text: (
        <>
          Only verified suppliers. New or changed bank details need a call-back first.{' '}
          <details className="iso-polrules__more">
            <summary>View list ({suppliers.length})</summary>
            {suppliers.length === 0 ? (
              <p className="iso-small" style={{ margin: '6px 0 0' }}>No verified suppliers yet. A supplier joins the list after its first paid invoice.</p>
            ) : (
              <ul className="iso-small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
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
    { text: 'Not built yet: Zeke could buy listed data (weather only) up to US$50 a month, only if your company’s owner turns it on.', tags: [{ text: 'Planned · needs the owner', tone: 'planned' }] },
  ];
  return (
    <ul className="iso-polrules">
      {rules.map((r, i) => (
        <li key={i}>
          <div className="iso-polrules__text">{r.text}</div>
          <div className="iso-polrules__tags">
            {r.tags.map((t) => (
              <Chip key={t.text} tone={TONE[t.tone]} tick={t.tone === 'locked'}>
                {t.text}
              </Chip>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
