// copy: technical
// A recipient paid to a crypto wallet (prompt 10 §0.6: the crypto-wallet zone). The asset and the
// network are named here on purpose: money sent on the wrong network is lost, so the person adding the
// address must see which one it is. Everything else on Recipients reads in plain words.

/** The payment-method choice for a wallet recipient. */
export const WALLET_METHOD_LABEL = 'Crypto wallet · USDC on Solana';

/** The badge on a wallet recipient's row. */
export function WalletNetworkBadge() {
  return <span className="rounded-full bg-[#5C9EAD]/10 px-2 py-0.5 font-semibold text-[var(--info)]">USDC · Solana</span>;
}

/** The address field, with what a valid address looks like and what happens on the wrong network. */
export function WalletAddressField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="md:col-span-2">
      <label htmlFor="wallet-address" className="text-[13px] font-medium text-[#326273]/90">
        Their Solana wallet address
      </label>
      <div className="mt-1">
        <input
          id="wallet-address"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder="e.g. 7xKX…9fQp (32 to 44 letters and digits)"
          spellCheck={false}
          autoComplete="off"
          className="w-full rounded-lg border border-[#326273]/20 bg-[#F6F0ED] px-3 py-2 font-mono text-sm text-[#326273] focus:border-[#5C9EAD] focus:outline-none"
          aria-describedby="wallet-address-help"
        />
        <p id="wallet-address-help" className="mt-1 text-[12px] leading-5 text-[#326273]/90">
          A <strong>Solana</strong> address: 32 to 44 letters and digits, with no 0x. Copy it exactly; capital letters matter. An Ethereum address will not work, and USDC sent to
          the wrong network is lost.
        </p>
      </div>
    </div>
  );
}
