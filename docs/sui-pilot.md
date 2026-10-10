# Sui Pilot development workflow

Splash uses [contract-hero/sui-pilot](https://github.com/contract-hero/sui-pilot)
as a development-time documentation and review aid for Move code. It is not a
runtime dependency and is never bundled into the application.

## Install or update

From the repository root, on any platform:

```bash
npm run setup:sui-pilot
```

The script clones Sui Pilot into `.tools/sui-pilot`, which is gitignored. Run
the same command later to fast-forward the checkout.

## Contract workflow

1. Read `.tools/sui-pilot/agents/sui-pilot-agent.md` and the relevant bundled
   Sui documentation before editing a Move module.
2. Apply the checks represented by `/move-code-quality` and
   `/move-code-review` to every contract change.
3. Use `/oz-math` when changing fixed-point, fee, price, or slippage math.
4. Use `/specify` for high-value invariants where the installed Sui Prover and
   project dependency versions support formal specifications.
5. Run `sui move build` and `sui move test` locally. Advisory output is never a
   substitute for compiler and test results.

The Sui CLI and `move-analyzer` must use matching versions. The project pins
its Move dependencies in `move/Move.toml`; review those pins before upgrading
the local toolchain.
