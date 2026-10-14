// iso-ui
'use client';

import { useRef, type KeyboardEvent } from 'react';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  /** A live count shown after the label ("To check 3"); hidden when null. */
  count?: number | null;
}

/**
 * Tabs (§2.3): a tablist of square tabs on a 2 px ink rule, the chosen one underlined in teal.
 * Arrow keys move between them, Home and End jump, and only the chosen tab is in the Tab order. The
 * caller renders the panel with `tabPanelProps(prefix, value)`.
 */
export function Tabs<T extends string>({ label, prefix, items, value, onChange }: { label: string; prefix: string; items: Array<TabItem<T>>; value: T; onChange: (v: T) => void }) {
  const list = useRef<HTMLDivElement>(null);
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = items.findIndex((t) => t.id === value);
    const next = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const t = items[(next + items.length) % items.length]!;
    onChange(t.id);
    requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>(`#${prefix}-tab-${t.id}`)?.focus());
  };
  return (
    <div ref={list} className="iso-tabs" role="tablist" aria-label={label} onKeyDown={move}>
      {items.map((t) => (
        <button
          key={t.id}
          id={`${prefix}-tab-${t.id}`}
          type="button"
          role="tab"
          className="iso-tabs__tab"
          aria-selected={t.id === value}
          aria-controls={`${prefix}-panel`}
          tabIndex={t.id === value ? 0 : -1}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count !== null && t.count !== undefined ? <span className="iso-tabs__count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** The panel's props: labelled by the chosen tab, focusable so a keyboard user lands in it. */
export function tabPanelProps(prefix: string, value: string) {
  return { id: `${prefix}-panel`, role: 'tabpanel' as const, 'aria-labelledby': `${prefix}-tab-${value}`, tabIndex: 0, className: 'iso-tabpanel' };
}
