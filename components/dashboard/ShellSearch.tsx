// iso-ui
'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import clsx from 'clsx';

type Result = { kind: 'payment' | 'bill' | 'recipient'; id: string; title: string; detail: string; href: string };
type Group = { kind: Result['kind']; label: string; results: Result[] };

/**
 * The top row's search (prompt 10 §3.3): payments, invoices and recipients of this company, at most 8,
 * grouped. "/" focuses it; ↑ and ↓ move, Enter opens, Esc closes. The server reads only this
 * company's records and never returns a full account number.
 */
export function ShellSearch() {
  const router = useRouter();
  const inputId = useId();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [state, setState] = useState<'idle' | 'searching' | 'done' | 'error'>('idle');
  const flat = groups.flatMap((g) => g.results);

  // "/" anywhere (outside a field) puts the cursor here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.isContentEditable)) return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Search after 200 ms of no typing; the last answer wins.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    let live = true;
    const t = setTimeout(async () => {
      setState('searching');
      try {
        const res = await fetch(`/api/solana/search?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
        const body = (await res.json()) as { groups?: Group[] };
        if (!live) return;
        setGroups(res.ok ? (body.groups ?? []) : []);
        setState(res.ok ? 'done' : 'error');
        setActive(0);
      } catch {
        if (live) setState('error');
      }
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  function go(r: Result | undefined) {
    if (!r) return;
    setOpen(false);
    setQ('');
    setGroups([]);
    router.push(r.href);
  }

  const showList = open && q.trim().length >= 2;
  let index = -1;
  return (
    <div className="iso-search" role="search">
      <label htmlFor={inputId} className="iso-sr">
        Search payments, invoices and recipients
      </label>
      <div className="iso-search__box">
        <Search size={16} aria-hidden="true" />
        <input
          ref={input}
          id={inputId}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && flat[active] ? `${listId}-${active}` : undefined}
          placeholder="Search payments, invoices, recipients"
          autoComplete="off"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            if (e.target.value.trim().length < 2) {
              setGroups([]);
              setState('idle');
            }
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(flat.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter' && showList) {
              e.preventDefault();
              go(flat[active]);
            } else if (e.key === 'Escape') {
              setOpen(false);
              input.current?.blur();
            }
          }}
        />
        <kbd className="iso-search__key" aria-hidden="true">
          /
        </kbd>
      </div>
      {showList ? (
        <div id={listId} role="listbox" aria-label="Search results" className="iso-search__list">
          {groups.length === 0 ? (
            <p className="iso-search__empty" role="status">
              {state === 'searching' ? 'Searching…' : state === 'error' ? 'Search didn’t answer. Try again.' : `Nothing matches “${q.trim()}”.`}
            </p>
          ) : (
            groups.map((g) => (
              <div key={g.kind} role="group" aria-label={g.label}>
                <p className="iso-search__group" aria-hidden="true">
                  {g.label}
                </p>
                {g.results.map((r) => {
                  index += 1;
                  const i = index;
                  return (
                    <div
                      key={`${r.kind}-${r.id}`}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === active}
                      className={clsx('iso-search__opt', i === active && 'iso-search__opt--active')}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(r)}
                    >
                      <strong>{r.title}</strong>
                      <span className="iso-search__detail">{r.detail}</span>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
