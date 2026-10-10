# Confidential transfer preflight

Status: **quarantined; production implementation must not proceed**.

## Decision

Splash does not expose a confidential-transfer path for Circle USDC. The
feature flag remains off:

```dotenv
FEATURE_CONFIDENTIAL_TRANSFER=false
```

## Preflight result

- Native Circle USDC on Sui is a standard `Coin` asset and does not expose a
  confidential-balance or shielded-transfer interface that Splash can call.
- The Sui cryptographic modules needed for an experimental construction,
  including `sui::ristretto255` and `sui::rangeproofs`, are devnet-only APIs.
- Consequently, a testnet or mainnet implementation would either make false
  privacy claims or depend on unsupported interfaces.

## Guardrails

- No production routes, UI controls, or settlement branches may read this flag
  as enabled.
- Any future prototype must live under `experiments/confidential`, target
  devnet explicitly, use non-production assets, and be independently audited.
- Re-open the preflight only after Sui and Circle publish supported production
  primitives for confidential native USDC balances and transfers.
