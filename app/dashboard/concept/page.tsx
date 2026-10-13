// iso-ui
import { notFound } from 'next/navigation';

import { ConceptSheet } from './ConceptSheet';

export const metadata = { title: 'Splash Iso UI · Splash' };

/**
 * The living style sheet for look 9 (prompt 10 §2): every primitive in components/iso in every state.
 * Development only: a production build answers 404, and the sidebar never links here.
 */
export default function ConceptPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <ConceptSheet />;
}
