// iso-ui
'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';

import { Field } from './Field';

export interface ComboOption {
  value: string;
  label: string;
  /** A short second line ("InstaPay and PESONet"). */
  meta?: string;
  disabled?: boolean;
  /** Extra words the search matches ("BDO" for "BDO Unibank"). */
  keywords?: string;
}

/**
 * A searchable choice (§2.3 Combobox), in place of a native <select>: type to filter, arrows to move,
 * Enter to choose, Esc to close. ARIA 1.2 combobox with a listbox.
 */
export function Combobox({
  label,
  options,
  value,
  onChange,
  placeholder,
  help,
  error,
  empty = 'Nothing matches. Check the spelling.',
  id: given,
}: {
  label: ReactNode;
  options: ComboOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  help?: ReactNode;
  error?: string | null;
  empty?: string;
  id?: string;
}) {
  const listId = useId();
  const chosen = options.find((o) => o.value === value) ?? null;
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const shown = useMemo(() => {
    const q = (query ?? '').trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.meta ?? ''} ${o.keywords ?? ''}`.toLowerCase().includes(q));
  }, [options, query]);

  function choose(o: ComboOption | undefined) {
    if (!o || o.disabled) return;
    onChange(o.value);
    setQuery(null);
    setOpen(false);
  }

  return (
    <Field label={label} help={help} error={error} id={given}>
      {({ id, describedBy, invalid }) => (
        <div className="iso-combo">
          <div className={clsx('iso-field__control', invalid && 'iso-field__control--invalid')}>
            <input
              id={id}
              className="iso-field__input"
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              autoComplete="off"
              placeholder={placeholder}
              value={query ?? chosen?.label ?? ''}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => {
                setOpen(false);
                setQuery(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  if (!open) setOpen(true);
                  else setActive((i) => Math.min(shown.length - 1, i + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((i) => Math.max(0, i - 1));
                } else if (e.key === 'Enter' && open) {
                  e.preventDefault();
                  choose(shown[active]);
                } else if (e.key === 'Escape') {
                  setOpen(false);
                  setQuery(null);
                }
              }}
            />
            <ChevronDown size={18} aria-hidden="true" />
          </div>
          {open ? (
            <ul id={listId} role="listbox" className="iso-combo__list" aria-label={typeof label === 'string' ? label : undefined}>
              {shown.length === 0 ? (
                <li className="iso-combo__empty" role="presentation">
                  {empty}
                </li>
              ) : (
                shown.map((o, i) => (
                  <li
                    key={o.value}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={o.value === value}
                    aria-disabled={o.disabled || undefined}
                    className={clsx('iso-combo__opt', i === active && 'iso-combo__opt--active')}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(o)}
                  >
                    <span>{o.label}</span>
                    {o.meta ? <span className="iso-combo__meta">{o.meta}</span> : null}
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </div>
      )}
    </Field>
  );
}
