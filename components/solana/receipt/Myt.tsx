'use client';

import LocalTime from '@/components/LocalTime';

/**
 * Times on a receipt and a statement are Malaysia time (MYT, UTC+8), whoever reads them (prompt 12
 * §5.4): an auditor in another country reads the same clock the company paid on. Formatting goes
 * through LocalTime, the one client module that formats dates.
 */
const MYT = 'Asia/Kuala_Lumpur';

/** "18 Oct 2026". */
export function MytDate({ at }: { at: string }) {
  return <LocalTime value={at} format="date" locale="en-GB" options={{ timeZone: MYT, day: 'numeric', month: 'short', year: 'numeric' }} />;
}

/** "01:38:21", 24-hour. */
export function MytTime({ at }: { at: string }) {
  return <LocalTime value={at} format="time" locale="en-GB" options={{ timeZone: MYT, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }} />;
}

/** "18 Oct 2026, 01:38:21". */
export function MytDateTime({ at }: { at: string }) {
  return <LocalTime value={at} format="datetime" locale="en-GB" options={{ timeZone: MYT, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }} />;
}

/** The MYT calendar day of a moment (YYYY-MM-DD), for grouping rows by day. Arithmetic, not formatting. */
export const mytDay = (iso: string) => new Date(Date.parse(iso) + 8 * 3_600_000).toISOString().slice(0, 10);

/** "19 Oct, 04:21": a statement line, whose month and year are in the page's header. */
export function MytDayTime({ at }: { at: string }) {
  return <LocalTime value={at} format="datetime" locale="en-GB" options={{ timeZone: MYT, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }} />;
}
