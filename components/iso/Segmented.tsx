// iso-ui
'use client';

import { radioKeys, tabStop } from './radio';

/** A segmented choice (Business / Individual, Hold / Sweep): a labelled radiogroup of square buttons. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = [],
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  disabled?: T[];
}) {
  const values = options.map((o) => o.value);
  return (
    <div className="iso-seg" role="radiogroup" aria-label={label} onKeyDown={radioKeys(values, value, onChange, disabled)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          className="iso-seg__btn"
          aria-checked={value === o.value}
          tabIndex={tabStop(o.value, values, value, disabled)}
          data-radio-value={o.value}
          disabled={disabled.includes(o.value)}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
