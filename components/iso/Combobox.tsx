// iso-ui
'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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

/** The list's tallest, its gap from the field, and the margin it keeps from the window's edges. */
const LIST_MAX = 280;
const GAP = 4;
const EDGE = 8;

/** What a bar pinned to the bottom of the window takes (Transfer's action bar publishes its height). */
function bottomBarHeight(): number {
  const root = document.documentElement;
  if (!root.hasAttribute('data-iso-actionbar')) return 0;
  const h = Number.parseFloat(getComputedStyle(root).getPropertyValue('--iso-actionbar-h'));
  return Number.isFinite(h) ? h : 0;
}

/**
 * Where the open list goes (prompt 11 §1.3): under the field when it fits, else above it when there
 * is more room there; never taller than the room it has (it scrolls inside), and never under a bar
 * pinned to the bottom of the window. Written straight onto the list every frame while it is open, so
 * it follows the field through a scroll, a resize, or the box it sits in rising on hover. The list is
 * `position: fixed`; its origin is measured, so a host that is itself moving (a sheet sliding in) is
 * allowed for.
 */
function place(control: HTMLElement, list: HTMLElement) {
  const r = control.getBoundingClientRect();
  const viewH = window.visualViewport?.height ?? window.innerHeight;
  const below = viewH - bottomBarHeight() - EDGE - (r.bottom + GAP);
  const above = r.top - GAP - EDGE;
  const natural = Math.min(list.scrollHeight, LIST_MAX);
  const down = below >= natural || below >= above;
  const height = Math.max(0, Math.min(natural, Math.floor(down ? below : above)));
  const s = list.style;
  s.left = '0px';
  s.top = '0px';
  const origin = list.getBoundingClientRect();
  s.width = `${Math.round(r.width)}px`;
  s.maxHeight = `${height}px`;
  s.left = `${Math.round(r.left - origin.left)}px`;
  s.top = `${Math.round((down ? r.bottom + GAP : r.top - GAP - height) - origin.top)}px`;
  list.dataset.side = down ? 'below' : 'above';
}

/**
 * A searchable choice (§2.3 Combobox), in place of a native <select>: type to filter, arrows to move,
 * Enter to choose, Esc to close. ARIA 1.2 combobox with a listbox.
 *
 * The list is drawn in a portal (prompt 11 §1.3), so no sticky bar, box or scrolling area covers or
 * clips it: on document.body at z-index 70, above sheets (60) and the approval moment (65). Inside a
 * dialog it goes into that dialog, so a screen reader that keeps to the dialog still reaches it. While
 * the floating Zeke's panel is open the list sits just under it (styles/iso-ui.css).
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
  const [host, setHost] = useState<HTMLElement | null>(null);
  const control = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const shown = useMemo(() => {
    const q = (query ?? '').trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.meta ?? ''} ${o.keywords ?? ''}`.toLowerCase().includes(q));
  }, [options, query]);

  // Where the portal goes: the dialog the field is in, else the page's body. Read from the DOM on open.
  useLayoutEffect(() => {
    if (!open || !control.current) return;
    setHost(control.current.closest<HTMLElement>('[aria-modal="true"]') ?? document.body);
  }, [open]);

  // Follow the field while the list is open.
  useLayoutEffect(() => {
    if (!open || !host) return;
    let frame = 0;
    const tick = () => {
      if (control.current && list.current) place(control.current, list.current);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [open, host, shown.length]);

  // The option the arrows reach stays in view in a list that scrolls.
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, listId]);

  function choose(o: ComboOption | undefined) {
    if (!o || o.disabled) return;
    onChange(o.value);
    setQuery(null);
    setOpen(false);
  }

  const listbox =
    open && host
      ? createPortal(
          <div className="iso iso-combo-layer">
            <ul ref={list} id={listId} role="listbox" className="iso-combo__list" aria-label={typeof label === 'string' ? label : undefined}>
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
          </div>,
          host,
        )
      : null;

  return (
    <Field label={label} help={help} error={error} id={given}>
      {({ id, describedBy, invalid }) => (
        <div className="iso-combo">
          <div ref={control} className={clsx('iso-field__control', invalid && 'iso-field__control--invalid')}>
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
          {listbox}
        </div>
      )}
    </Field>
  );
}
