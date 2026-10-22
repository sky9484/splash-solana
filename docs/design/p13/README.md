# Landing art refresh and the hero's coin flight

Sky's art refresh (22 Oct 2026, `CLAUDE-CODE-PROMPT.md`): a new art set on the landing and gold coins arcing
between the countries on the hero's opening map. Screenshots from a freshly started dev server, 1440 × 900 and
390 × 844. The black "N" at the bottom left is Next's dev badge.

| Picture | What it shows |
|---|---|
| [`01-hero-map-coins-1440.webp`](01-hero-map-coins-1440.webp) | The opening beat: the ASEAN map with coins in flight |
| [`02-hero-beats-01-03-04-1440.webp`](02-hero-beats-01-03-04-1440.webp) | Beats 01, 03 and 04 with their new art |
| [`03-loops-platform-1440.webp`](03-loops-platform-1440.webp) | The three loops and Platform 01 |
| [`04-routes-copilot-1440.webp`](04-routes-copilot-1440.webp) | The routes board and Zeke at the desk, each inside its old box |
| [`05-closing-card-1440.webp`](05-closing-card-1440.webp) | The closing receipt card |
| [`06-phone-390.webp`](06-phone-390.webp) | The phone hero (map, coins, lede) and its rail of beats |
| [`07-reduced-motion-1440.webp`](07-reduced-motion-1440.webp) | Reduced motion: four coins standing still mid-flight |
| [`08-coin-landing-points.webp`](08-coin-landing-points.webp) | A red marker on every landing point: each sits on its island's coin stack |
| [`09-coins-close-up.webp`](09-coins-close-up.webp) | The coins up close: gold face, darker edge, rim, the currency sign |

## Images swapped

| Slot | Old | New |
|---|---|---|
| Hero beat 0 (opening map) | `/isometric/gen/hero-sea-map.webp` | `/isometric/gen/hero-asean-map-2400.webp` |
| Hero beat 01 | `/isometric/gen/hero-01-zeke-reads-invoice.webp` | `/isometric/gen/hero-01-zeke-reads-invoice-v2.webp` |
| Hero beat 03 | `/isometric/gen/hero-03-two-routes.webp` | `/isometric/gen/hero-03-two-routes-v2.webp` |
| Hero beat 04 | `/isometric/gen/hero-04-receipt-proof.webp` | `/isometric/gen/hero-04-receipt-proof-v2.webp` |
| Loop 01 Settle | `/isometric/loop-settle-v4.png` | `/isometric/gen/loop-01-corridor.webp` |
| Loop 02 Keep | `/cinematic/hero-district-v5.png` | `/isometric/gen/loop-02-keep-vault.webp` |
| Loop 03 Supply | `/isometric/loop-supply.png` | `/isometric/gen/loop-03-supply.webp` |
| Platform 01 Vault | `/cinematic/liquidity-pools.png` | `/isometric/gen/platform-01-vault-pools.webp` |
| Routes | `/cinematic/corridor-bridge-v3.png` | `/isometric/gen/routes-asean-board.webp` |
| Zeke (copilot) | `/cinematic/copilot-desk.png` | `/isometric/gen/copilot-zeke-desk.webp` |
| Closing card | `/isometric/gen/close-payment-card.webp` | `/isometric/gen/close-receipt-card.webp` |

`hero-asean-map-960.webp` and `hero-asean-map-1600.webp` are copied for reference only; the page uses the 2400
source and `next/image` makes the smaller sizes.

Hero beat 02 still shows `/isometric/gen/hero-02-person-approves.webp`: its new door (eight lamps) waits for
Sky's PNG to be converted.

## Files deleted

Only `public/isometric/gen/hero-sea-map.webp`: `git grep` finds no reference to it. The old
`hero-01-zeke-reads-invoice.webp`, `hero-03-two-routes.webp`, `hero-04-receipt-proof.webp`, `loop-settle-v4.png`
and `close-payment-card.webp` are no longer on any page, but Prompt 12's documents still name them
(`docs/design/p12/PROMPT-12.md`, the asset pack's `SHA256SUMS`, a comment in `tests/claims.test.mjs`), so they stay.
`corridor-bridge-v3.png`, `copilot-desk.png` and `hero-district-v5.png` stay as the refresh asks.
