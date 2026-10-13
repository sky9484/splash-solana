/**
 * The Philippine banks a payout can reach, as the payout partner lists them (prompt 10 §5.3: the bank
 * picker, "showing InstaPay/PESONet support", and the account number's format "from the bank entry").
 *
 * Test mode: this is the test payout partner's list. A signed partner's own list replaces it, with its
 * own formats; until then the lengths below are the common ones, used only to help a person type the
 * number (grouped 4-4-4) and to catch a wrong length before anything is saved. Which rail pays a given
 * amount is the partner's routing (mock-partner.ts: InstaPay up to ₱50,000.00, PESONet above).
 */
import type { PayoutRail } from './registry.ts';

/** InstaPay's per-transfer ceiling, PHP 50,000.00. Above it the partner uses PESONet. Pure: safe in the browser. */
export const INSTAPAY_MAX_PHP_MINOR = 5_000_000n;

export interface PartnerBank {
  /** The partner's code for the bank. */
  code: string;
  name: string;
  rails: readonly PayoutRail[];
  /** Account number lengths the bank issues, in digits. */
  accountDigits: readonly number[];
}

export const PH_BANKS: readonly PartnerBank[] = Object.freeze([
  { code: 'BDO', name: 'BDO Unibank', rails: ['InstaPay', 'PESONet'], accountDigits: [10, 12] },
  { code: 'BPI', name: 'BPI', rails: ['InstaPay', 'PESONet'], accountDigits: [10] },
  { code: 'MBTC', name: 'Metrobank', rails: ['InstaPay', 'PESONet'], accountDigits: [13] },
  { code: 'LBP', name: 'Landbank', rails: ['InstaPay', 'PESONet'], accountDigits: [10] },
  { code: 'PNB', name: 'PNB', rails: ['InstaPay', 'PESONet'], accountDigits: [12] },
  { code: 'SECB', name: 'Security Bank', rails: ['InstaPay', 'PESONet'], accountDigits: [13] },
  { code: 'UBP', name: 'UnionBank', rails: ['InstaPay', 'PESONet'], accountDigits: [12] },
  { code: 'RCBC', name: 'RCBC', rails: ['InstaPay', 'PESONet'], accountDigits: [10] },
  { code: 'CBC', name: 'China Bank', rails: ['InstaPay', 'PESONet'], accountDigits: [12] },
  { code: 'EWB', name: 'EastWest Bank', rails: ['InstaPay', 'PESONet'], accountDigits: [12] },
  { code: 'PSB', name: 'PSBank', rails: ['InstaPay', 'PESONet'], accountDigits: [12] },
  { code: 'AUB', name: 'Asia United Bank', rails: ['PESONet'], accountDigits: [12] },
]);

export function bankByCode(code: string): PartnerBank | null {
  return PH_BANKS.find((b) => b.code === code.trim().toUpperCase()) ?? null;
}

/** "InstaPay and PESONet", "PESONet": the picker's second line. */
export function railsLine(bank: PartnerBank): string {
  return bank.rails.join(' and ');
}

/** Which rail pays this amount at this bank (the partner's routing). */
export function railFor(bank: PartnerBank, amountPhpMinor: bigint): PayoutRail {
  if (amountPhpMinor <= INSTAPAY_MAX_PHP_MINOR && bank.rails.includes('InstaPay')) return 'InstaPay';
  return 'PESONet';
}

/** Is this many digits a length the bank issues? */
export function accountLengthOk(bank: PartnerBank, digits: string): boolean {
  return /^\d+$/.test(digits) && bank.accountDigits.includes(digits.length);
}

/** "12 digits for BDO Unibank", "10 or 12 digits for BDO Unibank": the field's hint. */
export function accountHint(bank: PartnerBank): string {
  const lengths = [...bank.accountDigits].sort((a, b) => a - b);
  const n = lengths.length === 1 ? `${lengths[0]}` : `${lengths.slice(0, -1).join(', ')} or ${lengths.at(-1)}`;
  return `${n} digits for ${bank.name}`;
}
