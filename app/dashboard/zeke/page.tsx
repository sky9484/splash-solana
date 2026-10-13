import '@/components/solana/solana.css';

import { ZekeRoster } from '@/components/solana/ZekeRoster';

import ZekeDesk from './ZekeDesk';

export const metadata = { title: 'Zeke · Splash' };

/**
 * Zeke in one place (prompt 07 §6.2): the desk where it drafts, and who it is, agent by agent, with
 * what it can do read from the code. The copilot and 0xwal pages redirect here.
 */
export default function ZekePage() {
  return (
    <div className="space-y-8">
      <ZekeDesk />
      <div className="mx-auto w-full max-w-7xl">
        <div className="sx sx-embedded">
          <ZekeRoster />
        </div>
      </div>
    </div>
  );
}
