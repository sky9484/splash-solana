# Prompt 11 · what the build shows, what the preview shows, what changes

Phase 0 of prompt 11 (14 Oct 2026). One row per screen captured in `before/` (1440 px and 390 px,
`tests/p9-screens.e2e.mjs`, seeded test account, offline simulator, `http://localhost:3200`).
"Preview" is the approved "Splash dashboard preview" artifact, version 4. It is a React mock, so its
figures are its own; only layout, sizes, words and motion carry over.

Rule for conflicts (Sky, 14 Oct): today's build wins, except on **Transfer** and **Treasury**, where
the prompt wins. Two later instructions from Sky narrow the prompt further and are applied
everywhere below:

- **Nav and header stay as they are.** The sidebar (logo toggle, Account setup card, grouped nav,
  test-mode note, Settings / Support / Log out) and the top row (search, rate strip, Test mode,
  profile) keep today's build. The preview's slimmer sidebar and its missing top row are not copied.
- **Floating Zeke stays exactly as it is.** Its button, nudge and open panel keep today's look and
  code. The only touch is the existing `data-iso-actionbar` / `--iso-actionbar-h` mechanism, so it
  still rises above a pinned bar on Transfer.

## Screens

| # | Screen | Build today (`before/`) | Preview v4 | This prompt changes |
|---|---|---|---|---|
| 01 | Overview | Ground is warm paper with a faint grid. Hero "Your money, all accounts" in an extruded box with a hard offset shadow; split bar; three account figures; trust ticks. "Needs you" list with Review / Plan / Open; ink strip "Zeke read N invoices today". Payments this month (fees line, six stations), Recent payments table, Where you can pay. Page actions Pay an invoice / New transfer / Get paid. | Same sections and order, on warm paper with **no grid**; every box floats on a soft blurred shadow instead of the hard offset. No fees line under "Payments this month". | Surfaces only (decision 12): no grid, soft lift, 3 px rise on hover. Layout and words unchanged. Fees line stays (build has it). |
| 02 | Transfer · bank · 1 Recipient | Five tab strip (1 · Recipient … 5 · Track). "Who are you paying?", Pay again chip, two big rail cards (A bank account / A business on Splash), Saved bank recipients with search and Pay buttons, ink action bar (Cancel / Continue) at the bottom. | Dark **intent header** on top ("Send a payout", Draft, Test mode, step meter 1 of 5, four facts: They receive / You pay / Paid out by / Quote). Under it: step box with Bank account / Splash business switch and recipient rows (initials, bank, Verified), "+ New recipient", double-click hint; right rail **So far** (Paying, They receive, Route, Approval) with "Continue to amount". | New five-step pattern (decision 4): `TransferHeader` on every step, step + sticky So far rail, primary action in the rail (pinned to the bottom under 860 px). Double-click a saved recipient goes straight to step 2. |
| 03 | Transfer · bank · 2 Amount | "How much does Cebu Logistics get?" Amount box (PHP / US$, rate line), big extruded "They receive" figure with payout method, What it's for (reference, Goods / Services, what was bought, how you know them, where the money comes from), Your limits box, ink action bar. | Intent header now "Pay Manila Freight Services · bank ···· · INV-…", facts filled. "How much?" with both amounts and rate line, "Use invoice INV-… " chip, What it's for, So far with Per payment / Left today / "Fits your rules", "See routes and cost", "Back to recipient". | Same fields and limits, moved into the new pattern; limits sit in the rail. The invoice chip opens that invoice's own payment (no second payment). |
| 04 | Transfer · bank · 3 Route | "How ₱75,000 reaches Cebu Logistics": route diagram (your account → payout partner → bank), picked route bar, Compare the other route, How it moves, Rehearse a problem, rules line; Cost box and Money comes from box; ink action bar. | "Pick a route": two route cards (Cheapest / Fastest) each with fee, mini path and "You pay"; "Cost and where it comes from" grid; Pay from; How it moves; So far + "Review and approve". Header Quote shows "New quote in 0:59". | Route cards side by side replace the single diagram + compare link; cost grid; quote timer moves into the header. Build's Rehearse a problem (test mode) and rules line are kept. Route label renamed "Route" (was "Quote & send"). |
| 05 | Transfer · bank · 4 Approve | Modal "Approve this payment" over a dimmed step 3: who, big extruded amount, You pay / All-in cost / Route / Reference / Purpose / Paid from, Rules checked 8 of 8, coral "Approve on this device". | In-page approval: "Approve this payment", receives figure with timer, To / Route / Pay from / You pay, "Approve on this device", "Zeke drafted this payment. Zeke can't approve; only you can.", Your rules 8 of 8 listed, "Back to route". | Approval moves into the page in the new pattern; same facts, same device key, rules listed. Build's Reference / Purpose / For rows are kept. |
| 06 | Transfer · bank · 5 Track | "Cebu Logistics has been paid": six-station tracker in an extruded box, receipt box (rows, Verify this receipt, Share with auditor, Download PDF, Technical details), What's next (Pay another / Save as template / Back to Overview). | Header "Paid", Quote "Locked at 57.40". Tracker row, Receipt rows, Verify receipt / Share with auditor / Technical details, "What happened" timeline, "What's next", "Start a new transfer". | New pattern; tracker, receipt and timeline. Build's Download PDF and Save as template are kept. |
| 07 | Transfer · Splash business · 1 Recipient | Same tab strip; "A business on Splash" card picked; "Find a business on Splash" search (name, handle, registration number) with a verified result and Pay; invite / pay their bank link; ink action bar. | The preview only shows the Bank account / Splash business switch inside step 1; no separate Splash search screen. | New pattern with the switch; the build's search, verified badge, invite and "pay their bank instead" links are kept. |
| 08 | Transfer · Splash business · 2 Amount | "How much are you sending Kuching Marine Supply?" Amount (US$), note, their invoice number, extruded "Into their Splash account" figure, Your limits, ink bar "gets US$1,500.00 · no Splash fee". | Not shown separately (same step-2 pattern as bank). | New pattern; same fields. |
| 09 | Transfer · Splash business · 3 Route | "How US$1,500 reaches Kuching Marine Supply": two-node path, cost box (Splash fee US$0.00), Money comes from, ink bar with Back / Review and approve. | Not shown separately. | New pattern: one route card ("Inside Splash"), cost grid, So far. |
| 10 | Invoices · chooser | Two big extruded cards, Get paid / Pay an invoice, coin art, counts (1 unpaid request · 1 to check · 1 ready to pay), one button each. | Same two cards, floating; counts include "1 waiting for approval"; the clicked card **grows into its page**. | Floating cards with a 5 px hover rise; the clicked card morphs into the page (View Transition, with a fallback and reduced-motion cut). Counts stay the build's. |
| 11 | Invoices · Pay | Breadcrumb, "Pay an invoice", drop / paste box (Choose a file, Paste text, Use the sample invoice), safety note, Forward by email (coming soon), Bills tabs (To check / Ready to pay / Waiting / Paid) and table. | Not in the preview. | Surfaces only. |
| 12 | Invoices · Check | "Check the invoice": the document with highlighted lines, Zeke's draft (Supplier, Invoice number, Due date, Amount, Bank account) each with Change / Tick and its source line, Confirm and pay, Not this one. | Not in the preview. | Surfaces only. |
| 13 | Invoices · Get paid | Requests table (unpaid / paid with receipt), New request form (who pays, business search, invoice number, due date, lines, MyInvois reference, note), live preview of the request. | Not in the preview. | Surfaces only. |
| 14 | Balance | Payments account hero with free / waiting split, Reserve and Investments boxes; Move between accounts / Add money; Add money cards (Bank or card top-up, From a crypto wallet, Get paid); Money in and out table. **The before capture shows the 14 Oct clipping bug** (the page drawn under the sidebar, "alance", "dd money"); see the note below. | Same layout, floating boxes, no grid. | Surfaces only (decision 6). Clipping bug fixed in Phase 1. |
| 15 | Treasury · Hold | All accounts (three nodes, reserve bar with floor and Available to invest); test-mode note; "US Treasury bills" box (3.75 % a year, explanation, 40-day hold, Hold / Sweep switch, Subscribe / Redeem); "US stocks and ETFs · via Ondo" table with 12-month returns; Positions; Risk and rules; Zeke line; Technical details. | All accounts on top; **US T-bill pool card**: big holding, "Interest today · live estimate", Subscribe / Redeem, **Interest per day** bars (7 / 30 days) with This period / Average a day / This quarter so far; US stocks and ETFs (Holding, Value, Today, Dividends, Buy more / Sell); right rail **Hold or sweep** with drafted moves (Approve / Not now), the quarterly "Bring US$… interest back" draft, Fees kept inside Splash, Treasury activity; Risk and rules; Zeke line. | Decision 7: All accounts stays on top; the T-bill pool card with the live estimate and the Interest per day chart goes directly below; stocks become "via Treasurers"; Hold or sweep rail with drafts a person approves; quarterly interest draft; fees kept inside Splash; Treasury activity. |
| 16 | Treasury · Sweep | Same page with Sweep on: Zeke drafts each move "from your owner's rule"; the Zeke page log shows a sweep as "approved" from the rule. | Sweep: "Zeke drafts a move into the T-bill pool. Nothing moves until you approve it." with Approve / Not now per draft. | Decision 9: every move is a draft a person approves; "Not now" dismisses it; no standing rule moves money by itself. |
| 17 | Zeke | Stats (Drafts today, Need you, Notices); chat "What should we look at?" with four prompts and file attach; Waiting for you; Today log; How Zeke is kept safe; What each part of Zeke does. | Narrower: Ask Zeke chat, Drafts waiting, Today's log, What Zeke can't do. | Surfaces only (decision 12). Build's layout and sections stay. |
| 18 | Floating Zeke, open | Ink button with nudge ("N drafts need your approval"), open panel over the page. | "Ask Zeke" pill. | **Nothing** (Sky, 14 Oct: "do not follow this prompt for the floating zeke"). It still rises above a pinned bar through the existing mechanism. |

## Build has, preview lacks (the build's version is kept)

- **Shell:** the top row (search, USD → PHP rate strip with next corridor, Test mode, profile), the
  Account setup card, nav groups (Pay / Money / Contacts / Control) with Batch payout, History,
  Recipients and Rules, and the sidebar test-mode note. The preview has a short flat nav and no top
  row. Kept per Sky.
- **Overview:** the fees line under "Payments this month" (Splash and partner fees, average all-in).
- **Transfer:** Pay again chip; the Splash-business search with verified badge, invite link and
  "pay their bank instead"; Rehearse a problem (test mode only); the rules line on the route; the
  "Money comes from" box with Add money another way; Reference, Purpose and For rows on the
  approval; Download PDF and Save as template after payment.
- **Invoices:** Pay, Check and Get paid pages in full (the preview stops at the chooser); the Bills
  tabs; the request form with MyInvois reference and live preview.
- **Balance:** the empty-state line when the Payments account is empty; the account-details pointer.
- **Treasury:** the USDY explanation (what it is, not a bank deposit, 40-day hold on direct
  subscription, non-US companies only), the stocks 12-month returns with sources and the Tesla
  example, the Positions table, the US-person confirmation, Technical details. Kept where the new
  layout has room; the prompt decides on Treasury.
- **Zeke page:** stats, attach, How Zeke is kept safe, What each part of Zeke does.

## Preview has, build lacks (added by this prompt)

- Warm paper with no grid; floating boxes on a soft shadow that rise on hover.
- Transfer: the dark intent header on every step; the So far rail; route cards side by side; the
  quote timer in the header; double-click a saved recipient to skip to the amount.
- Invoices: the clicked chooser card growing into its page.
- Treasury: the live "Interest today" estimate, the Interest per day chart and its three figures,
  the Hold or sweep rail with approvable drafts and Not now, the quarterly interest draft, Fees kept
  inside Splash, Treasury activity.

## Note on the 14 Oct clipping bug (01 and 14)

`before/01-overview-1440.webp` and `before/14-balance-1440.webp` show the page drawn under the
sidebar ("verview", "alance", "dd money"). The live page never sat there: measured in the browser,
`main` starts at 264 px and the title at 300 px, with nothing scrolled. The full-page capture resizes
the viewport, and the shell animated `main`'s left margin (the 320 ms slide that belongs to
collapsing the sidebar) on that resize; the capture caught the slide part-way. Six full-page captures
in a row before the fix: 3 drawn under the sidebar. Phase 1 makes the slide run only when a person
collapses or expands the sidebar, and switches `main` from `overflow-x: hidden` to `clip`; after the
fix: 6 of 6 clean. The before captures are left as they were, as the record of the bug.
