# Sui Contract Standards

Splash follows the Sui-specific OpenZeppelin architecture rather than applying
EVM ownership patterns to Move.

## Applied controls

- Privileged operations use owned, unforgeable capabilities. `AdminCap` owns
  package administration; `ComplianceCap` owns bounded settlement-risk updates.
- Shared objects hold composable protocol state and verify that the supplied
  capability is bound to the exact configuration object.
- Fee, peg, staleness, slippage, and depth settings are bounded on-chain.
- Settlement is fail-closed: the pause switch, stale Pyth data, a broken peg,
  insufficient DeepBook depth, or excessive amount-sized slippage aborts the PTB.
- Overflow-sensitive multiply/divide calculations use OpenZeppelin
  `openzeppelin_math::u64::mul_div` with explicit downward rounding.

## Oracle separation

Pyth is the canonical stablecoin peg and staleness source. DeepBook V3 is an
independent execution-liquidity source. A favorable order book can never
override a stale or broken Pyth peg.

## Deployment consequence

The new settlement signatures and `ComplianceConfig` require a fresh package
publish and fresh shared objects. Do not point production at the new package
until the compliance object, DeepBook pool/type pair, business account, peg
state, and settlement pool have all been initialized and verified together.

OpenZeppelin AccessControl is not retrofitted into the old package. Its
one-time-witness initialization only runs on a fresh publish, and the current
single-operator design is more directly represented by owned capabilities.
If authority is later split among guardian, treasury, and risk roles, introduce
OpenZeppelin AccessControl in that fresh package from its initial publish.
