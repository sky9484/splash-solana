# config/

Configuration that must be identical on every machine. Committed, one file
per environment, selected by `NODE_ENV`. Nothing in here is a secret; secrets
stay in `.env.local` and are declared in `lib/env.ts`.

## Why a file and not an env var

Seal's key-server list used to live in `SEAL_KEY_SERVER_ENDPOINTS` — a JSON
array of object IDs, aggregator URLs and integer weights, hand-typed into each
developer's `.env.local`. `lib/server/seal-config.ts` validates that blob on
twelve conditions, all at request time. Two developers' machines each started
cleanly and then diverged on the first route that touched Seal. A committed
file is identical on both machines by construction, and the same validation
now runs once at boot.

## Files

| File | Used when | State |
|---|---|---|
| `seal.development.json` | `NODE_ENV=development` (the default) | No servers: Seal runs **unconfigured**, which `lib/server/seal-health.ts` reports as such. Local development uses the visibly-labelled demo records. |
| `seal.test.json` | `NODE_ENV=test` | Same as development. Tests that need a real list point `SEAL_CONFIG_FILE` at a fixture. |
| `seal.production.json` | `NODE_ENV=production` | The live committee. Production **refuses to boot** without it — that is the regulatory posture, not a misconfiguration. |

`SEAL_CONFIG_FILE=<path>` overrides the selection; tests use it.

## Shape

```json
{
  "mode": "decentralized",
  "threshold": 2,
  "packageId": "0x…64 hex…",
  "policyObjectId": "0x…64 hex…",
  "approveTarget": "0x…::allowlist::seal_approve",
  "servers": [
    { "objectId": "0x…64 hex…", "aggregatorUrl": "https://…", "weight": 1 }
  ]
}
```

- `mode`: `decentralized` (every server needs an `aggregatorUrl`) or `independent`.
- `threshold` must be satisfiable by the sum of `weight`s.
- `approveTarget` is optional; it defaults to `<packageId>::allowlist::seal_approve`.
- Aggregator URLs must be `https://` (or `localhost`). Object IDs are `0x` + 64 hex.

## One source of truth

The file is authoritative. If any of `SEAL_KEY_SERVER_ENDPOINTS`,
`SEAL_KEY_SERVER_URLS`, `SEAL_KEY_SERVER_MODE`, `SEAL_THRESHOLD`,
`SEAL_PACKAGE_ID`, `SEAL_POLICY_OBJECT_ID` or `SEAL_APPROVE_TARGET` is still
set in the environment, boot fails and names it: delete it from `.env.local`
and from the host's environment panel. Two sources for one setting is how the
divergence started.

What stays in env, because it is operational or sensitive rather than shared
configuration: `SEAL_HEALTH_TIMEOUT_MS`, `SEAL_ALERT_WEBHOOK_URL`.

## Adding an environment

Copy `seal.development.json` to `seal.<name>.json`, fill it in, run
`npm run doctor`. The loader validates the file exactly as it validated the
env var; the difference is that it now does so before the first request.
