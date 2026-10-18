'use client';

import { useRef, useState, type KeyboardEvent } from 'react';

import { WC_ILLUSTRATION as X } from '@/lib/working-capital/illustration';

/**
 * The working-capital hero's one interactive moment (prompt 12 Phase 4, preview tab 3): invoice
 * INV-4471 and the supplier's one choice, hold it to maturity or take the buyer's early payment. Every
 * figure is illustrative and computed in integer cents (lib/working-capital/illustration.ts). The
 * switch is a radio group: arrow keys move the choice, and the rows below are announced politely.
 */
type Choice = 'hold' | 'early';

const CHOICES: { id: Choice; label: string }[] = [
  { id: 'hold', label: 'Hold to maturity' },
  { id: 'early', label: 'Take early payment' },
];

const OUTCOME: Record<Choice, { settles: string; receives: string; discount: string[]; note: string }> = {
  hold: {
    settles: `In ${X.tenorDays} days`,
    receives: X.face,
    discount: ['None'],
    note: 'Nothing changes. The invoice settles on its due date on the same rail.',
  },
  early: {
    settles: 'Today, on the same rail',
    receives: X.early,
    discount: [X.discountRate, X.discount],
    note: `Buyer saves (illustrative) ${X.discount} on idle US dollars held about ${X.tenorDays} days, about ${X.buyerSavesAYear} a year.`,
  },
};

export default function ReceivableCard() {
  const [choice, setChoice] = useState<Choice>('early');
  const buttons = useRef<Record<Choice, HTMLButtonElement | null>>({ hold: null, early: null });
  const outcome = OUTCOME[choice];

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    const keys: Record<string, Choice> = { ArrowLeft: 'hold', ArrowUp: 'hold', Home: 'hold', ArrowRight: 'early', ArrowDown: 'early', End: 'early' };
    const next = keys[event.key];
    if (!next) return;
    event.preventDefault();
    setChoice(next);
    buttons.current[next]?.focus();
  }

  return (
    <div className="lp-card wk-inv" role="group" aria-labelledby="wk-inv-id">
      <div className="wk-inv__top">
        <span className="lp-tag wk-tag--teal">Receivable</span>
        <span className="wk-inv__id" id="wk-inv-id">
          <span>{X.invoice}</span>
          <span>Net {X.tenorDays}</span>
        </span>
      </div>
      <div className="wk-inv__label">
        <span className="wk-lbl">Invoice face value</span>
        <span className="lp-tag">Illustrative</span>
      </div>
      <p className="wk-inv__face">{X.face}</p>

      <div className="wk-switch" role="radiogroup" aria-label="The supplier’s choice" onKeyDown={onKey}>
        {CHOICES.map((c) => (
          <button
            key={c.id}
            ref={(el) => {
              buttons.current[c.id] = el;
            }}
            type="button"
            role="radio"
            aria-checked={choice === c.id}
            tabIndex={choice === c.id ? 0 : -1}
            onClick={() => setChoice(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div aria-live="polite">
        <dl className="wk-rows">
          <div>
            <dt>Settles</dt>
            <dd>{outcome.settles}</dd>
          </div>
          <div>
            <dt>Supplier receives</dt>
            <dd>{outcome.receives}</dd>
          </div>
          <div>
            <dt>Discount</dt>
            <dd>
              {outcome.discount.map((part) => (
                <span key={part}>{part}</span>
              ))}
            </dd>
          </div>
        </dl>
        <p className="wk-inv__note">{outcome.note}</p>
      </div>

      <ul className="lp-tags wk-inv__tags" aria-label="About this example">
        {['Buyer-funded', 'No lender', 'Approval-gated', 'Illustrative'].map((t) => (
          <li className="lp-tag" key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}
