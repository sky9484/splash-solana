// iso-ui
'use client';

import LocalTime from '@/components/LocalTime';

/** A calendar day ("2026-10-30") as people read it ("30 Oct 2026"), the same day everywhere (UTC). */
export function DayWords({ iso }: { iso: string | null | undefined }) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return <>—</>;
  return <LocalTime value={`${iso}T00:00:00Z`} format="date" options={{ day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }} />;
}
