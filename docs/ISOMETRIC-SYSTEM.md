# Splash Isometric System

Status: v3 frontend baseline.

## Signature Scene

The memorable brand element is the Southeast Asia settlement network: dimetric
city nodes for Kuala Lumpur, Manila, Singapore, Jakarta, and Bangkok connected
by route pulses. It appears in three approved places: the landing hero, the
corridors section, and the future social/OG image.

## Geometry

- Projection: dimetric 2:1, roughly 26.57 degrees.
- Grid: 8px iso-unit. Nodes and rail lines snap to this visual rhythm.
- Light: one top-left source.
- Shadows: flat ink-tinted offset shapes. No blurred glows inside the scenes.

## Materials

Use only the locked brand token family:

- Ink and slate for outlines, roofs, rails, and labels.
- Surface and surface-2 for planes, walls, receipts, and vault faces.
- Teal for active settlement routes, glass, checks, and positive flow.
- Gold only for selected opportunity or early-pay/yield emphasis.
- Coral is not decorative. It is reserved for caution and approval-required UI.

## Line And Type

- Scene outlines: 1.5px to 3px ink, non-glowing, with rounded joins where
  routes curve.
- Labels inside scenes: flat, caps, small, never extruded below readable size.
- No crypto coin imagery, no neon, no chain jargon above the fold, no raster
  screenshots, and no AI-generated text inside images.

## Asset Inventory

- `public/isometric/v3/hero-network.svg`
- `public/isometric/v3/corridors-map.svg`
- `public/isometric/v3/receivable-flow.svg`
- `public/isometric/v3/security-vault.svg`
- `public/isometric/v3/empty-queue-clear.svg`
- `public/isometric/v3/empty-no-transfers.svg`
- `public/isometric/v3/empty-no-receivables.svg`
- `public/isometric/v3/empty-no-offers.svg`
- `public/isometric/v3/empty-no-counterparties.svg`
- `public/isometric/v3/empty-no-netting-pairs.svg`

The landing page uses the first four assets. Empty-state assets are ready for the
dashboard visual layer milestone.
