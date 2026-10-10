# Dual-funding research gates

Status: **USDC and USDsui enabled; USDT and direct Stripe-to-USDsui remain gated**.

## Production feature flag

The payment-method selector and server-side funding registry are controlled by:

```dotenv
FEATURE_DUAL_FUNDING=true
```

Provider, asset, rail, and CCTP source-chain flags can disable individual
options. The server registry is authoritative; client state cannot enable a
disabled combination.

## USDT decision

USDT stays disabled:

```dotenv
FUNDING_ASSET_USDT_ENABLED=false
```

Promotion requires all of the following evidence:

1. Runtime Sui USDT/USDC depth exceeds the configured minimum for target settlement sizes.
2. Tether-specific KYT and Travel Rule policy has written compliance approval.
3. Measured effective conversion slippage stays within the on-chain compliance limit.
4. The payout and FX partners confirm in writing that USDT-origin flows are accepted through the target off-ramp corridors.

The normalize adapter is present but unreachable while the registry flag is
off. Enabling the flag also requires a configured `USDT_TYPE`.

## Stripe to USDsui spike

Direct Stripe-to-Bridge USDsui minting is research-only. Before promotion,
validate supported merchant geography, bank-only payment methods, native Sui
asset provenance, webhook finality, refund handling, and the effect on the
existing USD-to-USDC settlement boundary. It must not introduce Stripe into the
stablecoin intake branch or change USDC as the canonical settlement asset.

## Evidence log

- Pool-depth threshold: pending measurement.
- Tether KYT approval: pending.
- Slippage sample: pending.
- Payout/FX partner origin acceptance: pending.
- Stripe/Bridge architecture review: pending.
