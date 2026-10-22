# Prompt 12 Phase 6 evidence: dashboard fixes from the audit

Taken on 19 Oct 2026 from `sol/b0-p12-6-dashboard-fixes`, on `next dev` (port 3300, its own Postgres on 5435), with the
data the walkthrough left: the seeded demo company (Acme Manufacturing), signed in as its demo owner. Batch, payment and
receipt ids in these pictures belong to that throwaway local database.

Each file pairs with the Phase 0 picture of the same name in [`../../before/`](../../before/) (same page, same widths).
[`pairs/`](pairs/) has every pair side by side, before on the left (1440 at half size, 390 at full size).

## 6.1 Pages still on the old design (audit A)

| Row | Before | After | What changed |
|---|---|---|---|
| Recipients | `23-recipients` | `23-recipients`, `23-recipients-new` | The saved bank recipients Transfer pays from: name, bank •••• last 4, country, "Verified by call-back {date}" or "Not verified" (coral dot), last paid amount and date, Details. No "No recipients found" after payments, no Corridor mix, Compliance check, Quick actions, Beneficiary stats or the History sentence (B12). `23-recipients-new`: "New recipient" opens Transfer's sheet. A row's Details is Transfer's recipient sheet; its "Pay …" opens Transfer on Step 2 with that recipient (`?recipient=`, checked on the walk's data: an unknown id stays on Step 1 and says why) |
| Batch payout | `24-batch`, `24-batch-review` | `24-batch`, `24-batch-review`, `24-batch-paid` | The page head without an eyebrow, the new boxes, the summary rows, ticks for the rules, chunk boxes, the dashboard table with status tags. The review's "Rehearse a problem (offline only)" is the iso Combobox (B11) |
| Settings tabs | `25-settings-general` … `29-settings-account` | the same five | Invoices' tab style instead of the dark pills; General's caps labels in sentence case; Devices in the new boxes, text at the normal size, the yellow banner an amber note; Payment rules and Recovery kit in the same boxes and tags |
| History | `30-history` | `30-history` | The filters are Invoices' tabs, with their counts |

## 6.2 Restyled pages, flaws (audit B)

| Row | Before | After | What changed |
|---|---|---|---|
| B2 | `31-zeke` | `31-zeke` | The chat is `min(64vh, 560px)` tall and its log scrolls inside; the right column sets the row's height (on a wide screen the chat is sticky beside it) |
| B3 | `32-treasury` | `32-treasury` | No empty chart: "Interest shows here after your first full day." |
| B4 | `32-treasury` (no activity rows in that state) | `32-treasury` | Every activity row has its day, its time in MYT and where the money went. The walk's rows: "Moved in · you approved · Today, 06:46 MYT · into your Investments account", "Moved out · … · to your company’s bank account, by wire", "Moved out · … · into your Payments account" |
| B5 | `20-overview` | `20-overview` | "Needs you" no longer lists the optional second approver |
| B6 | `20-overview` (and every page's sidebar) | `20-overview` | No "Account setup 5 of 6" box once the required steps are done |
| B8 | `33-balance-390` (the strip under the title) | `33-balance-390` | "USD → PHP 57.40 test rate" only, no "USD → IDR next corridor". At 1440 the top row's pill already hid it with CSS; the data, the markup and that rule are gone |
| B9 | `34-invoices` | `34-invoices`, `pairs/34-invoices-coins-4x`, `pairs/34-invoices-coins-served` | The chooser's coins are cut-out copies (`token-*-cut.png`): every faint edge pixel takes the colour of its nearest solid pixel and every transparent pixel the card's cyan. **On this base the rim is faint to the eye** (the audit saw it on `6a65016`): the pictures look alike at this size. Measured on Next's served 256 px copies, the faint edge pixels (alpha under 128) average rgb(83,111,114) for the dollar coin and rgb(80,95,89) for the peso coin before, rgb(42,73,76) and rgb(54,68,59) after: darker, so nothing light shows on the dark card. `coins-4x` is the page shots enlarged; `coins-served` is the served copies on the card's cyan |
| B10 | `33-balance` | `33-balance` | Top up, Choose a wallet and Request a payment are all quiet buttons; the header's Add money is the page's one primary |

- The black "N" circle at the bottom left is Next's dev badge, not part of the page.
