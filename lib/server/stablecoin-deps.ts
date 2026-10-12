/**
 * Whether a destination address belongs to Splash's own customers.
 *
 * On the Solana build a customer's money sits in their organisation's Squads
 * vault, so "a Splash wallet" is a vault recorded in org_vaults (drizzle/0027).
 * The earlier build answered this from passkey-derived addresses; passkeys
 * no longer derive any address.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function isSplashWallet(db: any, address: string): Promise<boolean> {
  const { orgVaults } = await import('@/lib/db/schema');
  const { eq } = await import('drizzle-orm');
  const rows = await db
    .select({ orgId: orgVaults.orgId })
    .from(orgVaults)
    .where(eq(orgVaults.vaultPda, address.trim()))
    .limit(1);
  return rows.length > 0;
}

export const NO_LEDGER_RESPONSE = {
  error: 'Wallet transfers need the database: the 30-day allowance is a ledger. Set DATABASE_URL.',
  code: 'ledger_unavailable',
};
