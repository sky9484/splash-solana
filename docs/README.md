# Splash docs

Internal documentation for the Splash protocol app.

## Contents

| Doc | Purpose |
|---|---|
| [`contract-config.md`](./contract-config.md) | Operator guide for the admin **Contract config** page (no-restart deploys). |
| [`ISOMETRIC-SYSTEM.md`](./ISOMETRIC-SYSTEM.md) | v3 isometric geometry, material, and asset rules. |
| [`KEY-POLICY.md`](./KEY-POLICY.md) | Custody roles, signer split, and current key gaps. |
| [`openapi.yaml`](./openapi.yaml) | OpenAPI 3.1 spec for admin endpoints. |
| [`UPGRADE-POLICY.md`](./UPGRADE-POLICY.md) | Upgrade authority, gates, rollback, and pause rules. |

## Viewing the OpenAPI spec

Drop `openapi.yaml` into any of these:

- **Swagger UI** — `https://editor.swagger.io/` (paste the file)
- **Redocly** — `npx @redocly/cli preview-docs docs/openapi.yaml`
- **Scalar** — `npx @scalar/cli serve docs/openapi.yaml`

If we end up wanting it served live alongside the app, add a route at
`app/api/docs/route.ts` that streams the file and mount Scalar's React
component at `/docs`. Single file, ~30 lines.
