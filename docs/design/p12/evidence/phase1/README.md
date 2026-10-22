# Prompt 12 Phase 1 evidence: Paper and Pale grounds

Taken on 18 Oct 2026 from `sol/b0-p12-1-ground`, on `next dev` (port 3300) with its own Postgres (5435), after the
walkthrough below had run on it, so the dashboard shows the demo company's real payments.

## Screenshots

One viewport per route, at 1440 × 900 (`-1440`) and 390 × 844 (`-390`), taken at the top of the page.

| Ground | Files |
|---|---|
| **Paper**, `#FFFAF4` at the top of the window to `#F3EBE0` at the bottom, fixed | `landing`, `working-capital`, `trust`, `not-found` (`/nope`), `error`, `onboarding-intent`, `settings-kyb`, `settings-security`, `overview`, `history`, `receipt` (`/dashboard/receipts/[id]`), `shared-receipt` (`/receipt/shr_…`) |
| **Pale**, `#EFF4F3` to `#E1E9E8`, fixed | `login`, `signup`, `forgot-password`, `reset-password`, `verify-email`, `admin-login`, `admin`, `admin-orgs` |
| **Unchanged** | `pay-link` (`/pay/[slug]`: `--ground-grid` and its 24 px grid), `queue` (`bg-[#F6F0ED]`, pinned by `tests/queue-contrast.test.mjs`) |

- `error` was rendered through a temporary route that throws, deleted straight afterwards. Next's dev badge on it
  reads "1 Issue": that is Next reporting the thrown error, not a second fault.
- `onboarding-intent` is signed in as `fresh@acme.test` (the seeded new business). The demo owner, already onboarded,
  is sent on to the dashboard.
- The page designs themselves change in later phases (the landing in 2, the auth pages, 404 and error in 3, working
  capital in 4, the receipts in 5). Phase 1 changes only the grounds and removes the grids.

## `grounds.json`

For 33 routes, signed out, as the demo owner, as staff and as a new business: the element that paints behind the
left gutter (`ground`) and behind the right gutter (`groundRight`, the main column's ground beside a sidebar), and
every visible element or pseudo-element whose background is a 1 px hairline grid (`grids`).

- Every dashboard page, both receipts, settings and onboarding: Paper, fixed.
- The five auth pages, `/admin/login` and the staff console: Pale, fixed.
- The only grid on any route is `main.iso.iso-paypage` on `/pay/[slug]`.
- `/queue`: `#F6F0ED`.
- The landing, `/working-capital`, `/trust`, `/privacy-policy` and `/terms-of-service` start with a section that paints
  its own flat Paper (`#FFFAF4`): the landing's hero, and the `wc-hero` with two faint radial glows. Their root is the
  Paper ground.

## Walkthrough

`tests/solana-ui.e2e.mjs` on a fresh database (`.p12-tools/walk.sh`): **1 test, 1 pass, 551 s**, at 1440 and 390 px,
through setup, Invoices, step 5, the receipt and shared receipt, Transfer, Batch payout, History, **Payment rules
reached through Settings' tabs**, Balance, Get paid, **Treasury** (where Phase 0's run failed) and the staff console.
