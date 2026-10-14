// iso-ui
'use client';

import { useId, type ReactNode } from 'react';

import { radioKeys, tabStop } from './radio';

export interface LaneOption<T extends string> {
  value: T;
  /** The engine's ranking labels: "Cheapest", "Fastest", or both when one route wins both. */
  labels: string[];
  price: ReactNode;
  sub: ReactNode;
}

/**
 * Route choice as lanes (§2.3 Lane): a card with a small isometric road. The chosen lane gets a mint
 * road with a teal edge, a 2 px ink border and the 5 px ledge, lifted 2 px. A labelled radiogroup.
 * Lanes are labelled by the engine's ranking only, never by a network.
 */
export function LaneGroup<T extends string>({ label, options, value, onChange }: { label: string; options: LaneOption<T>[]; value: T | null; onChange: (v: T) => void }) {
  const id = useId();
  const values = options.map((o) => o.value);
  return (
    <div>
      <span id={id} className="iso-sr">
        {label}
      </span>
      <div className="iso-lanes" role="radiogroup" aria-labelledby={id} onKeyDown={radioKeys(values, value, onChange)}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            tabIndex={tabStop(o.value, values, value)}
            data-radio-value={o.value}
            className="iso-lane"
            onClick={() => onChange(o.value)}
          >
            <span className="iso-lane__road" aria-hidden="true" />
            <span className="iso-lane__edge" aria-hidden="true" />
            <span className="iso-lane__head">
              <span className="iso-lane__labels">
                {o.labels.map((l, i) => (
                  <strong key={l} className="iso-lane__name">
                    {i > 0 ? <span aria-hidden="true">· </span> : null}
                    {l}
                  </strong>
                ))}
              </span>
              <span className="iso-lane__price">{o.price}</span>
            </span>
            <span className="iso-lane__sub">{o.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
