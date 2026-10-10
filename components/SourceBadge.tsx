import { CheckCircle2, FlaskConical, Radio, ShieldOff, Sigma } from 'lucide-react';

import type { ClaimStatus } from '@/content/claims';

import styles from './SourceBadge.module.css';

type SourceBadgeProps = {
  state: ClaimStatus;
  href?: string;
};

const labels: Record<ClaimStatus, string> = {
  live: 'live',
  'testnet-verified': 'testnet-verified',
  modeled: 'modeled',
  simulated: 'simulated',
  'not-licensed': 'not licensed',
};

const icons = {
  live: Radio,
  'testnet-verified': CheckCircle2,
  modeled: Sigma,
  simulated: FlaskConical,
  'not-licensed': ShieldOff,
} satisfies Record<ClaimStatus, typeof Radio>;

function stateClass(state: ClaimStatus) {
  if (state === 'testnet-verified') return styles.testnetVerified;
  if (state === 'not-licensed') return styles.notLicensed;
  return styles[state];
}

export function SourceBadge({ state, href }: SourceBadgeProps) {
  const Icon = icons[state];
  const className = `${styles.badge} ${stateClass(state)}`;
  const content = (
    <>
      <Icon aria-hidden="true" />
      {labels[state]}
    </>
  );

  if (href) {
    return (
      <a className={className} href={href}>
        {content}
      </a>
    );
  }

  return <span className={className}>{content}</span>;
}
