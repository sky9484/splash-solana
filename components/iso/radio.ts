'use client';

import type { KeyboardEvent } from 'react';

/**
 * Keyboard for a group of role="radio" buttons (lanes, destination cards, segmented controls):
 * arrows move and select, Home and End jump, and only the chosen one is in the tab order.
 */
export function radioKeys<T extends string>(values: readonly T[], value: T | null, onChange: (v: T) => void, disabled: readonly T[] = []) {
  return (e: KeyboardEvent<HTMLElement>) => {
    const open = values.filter((v) => !disabled.includes(v));
    if (open.length === 0) return;
    const i = value ? open.indexOf(value) : -1;
    let next: T | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = open[(i + 1 + open.length) % open.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = open[(i - 1 + open.length) % open.length];
    else if (e.key === 'Home') next = open[0];
    else if (e.key === 'End') next = open[open.length - 1];
    if (next === null) return;
    e.preventDefault();
    onChange(next);
    const group = e.currentTarget;
    requestAnimationFrame(() => group.querySelector<HTMLElement>(`[data-radio-value="${CSS.escape(next)}"]`)?.focus());
  };
}

/** The tab stop: the chosen radio, or the first open one when none is chosen. */
export function tabStop<T extends string>(v: T, values: readonly T[], value: T | null, disabled: readonly T[] = []): 0 | -1 {
  if (value !== null && values.includes(value)) return v === value ? 0 : -1;
  return v === values.find((x) => !disabled.includes(x)) ? 0 : -1;
}
