import { CalendarClock } from 'lucide-react';

/**
 * Marks a capability that is NOT live: future-tense copy only, and the
 * licensing caveat travels with the chip so it cannot be cropped away.
 * Used across the Supply loop surfaces (landing flywheel + /working-capital).
 */
export default function RoadmapChip({ detail = 'subject to licensing' }: { detail?: string }) {
  return (
    <span className="iso-roadmap-chip">
      <CalendarClock aria-hidden="true" />
      <strong>Roadmap</strong>
      <small>· {detail}</small>
    </span>
  );
}
