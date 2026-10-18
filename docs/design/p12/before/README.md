# Prompt 12 · before pictures (Phase 0)

What the app looked like on 18 Oct 2026, before any Prompt 12 app code: `sol/b0-p12-base` @ `092497c`
(Sky's restyle `6a65016`, plus `86579f1`, merged with `origin/sol/b0-p9-base`). Phase 7 re-shoots the same screens
into `docs/design/p12/after/` and pairs them in `docs/design/p12/COMPARE.md`.

**These are not exactly what the audit saw.** `AUDIT.md` was written on `6a65016`. This base also carries `86579f1`,
which already gave several of audit A's pages the dashboard's titles and boxes (no "PAYMENTS" or "MONEY" kicker) and
turned the receipt into a fintech receipt. The table below says what each shot actually shows, and marks the audit
items it no longer shows.

## How they were taken

- **App:** `next dev` on its own port (3300) with its own Postgres (5435, `scripts/dev-db.mjs`), seeded with the demo
  company (Acme Manufacturing, owner `demo@acme.test`), `SPLASH_SOLANA_MODE=offline`. Not `next start`: in production
  mode the dev staff login fails closed (§0.7).
- **Browser:** headless Chrome through `tests/helpers/cdp-browser.mjs`, at 1440 × 900 and 390 × 844. At 390 the page
  is a phone viewport with touch. Shots are full page unless the name says otherwise. Signed out for the public pages,
  as the demo owner for `/dashboard`, as staff for `/admin`.
- **The landing at 390 px:** the shots named `-390` keep a desktop browser's user agent, so they show what a narrow
  desktop window gets: the desktop pinned hero, reflowed. A phone gets a different hero, chosen on the server from its
  user agent (`app/page.tsx`, `isPhoneUserAgent`). `01-landing-phone-390` and `02-landing-hero-phone-390` are that
  hero, taken with an iPhone Safari user agent.
- **Loader and error page:** one shows only while a route loads, the other only on a thrown error. Both were rendered
  through temporary routes, deleted afterwards. Nothing from them is committed.
- **`24-batch-review`, 36–39 and 50** are the walkthrough's own screenshots (`tests/solana-ui.e2e.mjs`, run 2 below),
  copied unchanged.
- **Next's dev badge** (the round "N", bottom left) is on every shot because these come from `next dev`. On
  `13-error` it reads "1 Issue": that is Next reporting the error the page was made to throw, not a second fault.

## The walkthrough (Phase 0 step 3)

`tests/solana-ui.e2e.mjs`, run as its header says against the server above (fresh database, `BASE_URL=http://localhost:3300`):

| Run | When (MYT) | Result |
|---|---|---|
| 1 | 18 Oct, 09:35–09:42 | 1 test, 0 pass, 1 fail, at Treasury |
| 2 | 18 Oct, 10:52–10:59 | 1 test, 0 pass, 1 fail, at Treasury (same assertion; 395 s) |

**This is not the failure the prompt expected.** Phase 0 step 3 says the walk fails at the sidebar assertion
(audit B7). It no longer does: `86579f1` already changed the expected groups to
`['Overview', 'Pay|Transfer|Invoices|Batch payout', 'Money|Balance|Treasury|History', 'Contacts|Recipients', 'Control|Zeke']`
(line 233), and that check passes. The walk then gets through setup, the shell, Invoices, approval, step 5, the
receipt and the shared receipt, Transfer, Batch payout, History, Rules, Balance, Settings and Get paid, and stops in
Treasury's "Subscribe to US Treasury bills" sheet (`50-walk-failed-treasury-1440`):

```
AssertionError [ERR_ASSERTION]: 71138.55 units at US$1.1245
    at run (tests/solana-ui.e2e.mjs:998:10)
```

The test allows the units to differ from 80,000 / price by 5 in 100,000 (rounding a 4-decimal price):

| | Units shown | 80,000 / price shown | Off by | Allowed |
|---|---|---|---|---|
| Price shown truncated: US$1.1245 (today) | 71,138.55 | 71,142.73 | 4.18 | 3.56 |
| Price rounded: US$1.1246 | 71,138.55 | 71,136.40 | 2.15 | 3.56 |

The real price that day is about US$1.124566. `priceText` (`lib/solana-app/investments.ts`, line 75) **truncates** it
to 4 decimals, which can be off by up to 0.0001 (about 8.9 in 100,000 at this price). Rounding half-up is off by at most
0.00005 (about 4.5 in 100,000), inside the test's allowance. The simulator's price rises daily from its anchor day
(13 Oct), so whether truncation trips the test depends on the date. Phase 1 rounds `priceText` half-up, re-checks
`tests/treasury.test.mjs` (which pins `'8,896.79 units at US$1.1240'`), and makes the walk green.

## The shots

Every name has a `-1440` and a `-390` file unless a width is given.

| File | What it shows | Audit |
|---|---|---|
| `01-landing` | Landing, full page | C |
| `01-landing-phone-390` | Landing, full page, as a phone gets it (phone user agent) | C |
| `02-landing-hero-0` … `-6` | The pinned hero at seven scroll points, start to end: the callouts around the island, the zoom and fade, then "Payments are the feature. Proof is the product." At 390 with a desktop user agent, points 5 and 6 are an empty page: the island has faded out and nothing takes its place at that width. | C |
| `02-landing-hero-phone-390` | The phone hero (static, not pinned), top of the page | C |
| `03-working-capital` | `/working-capital`: extruded headlines, §01 to §03 chapters with faint 01/02/03 watermarks on the cards, caps mono labels, ledged cards | C |
| `04-login` | Sign in | A |
| `05-signup` | Sign up | A |
| `06-forgot-password` | Forgot password | A |
| `07-reset-password` | Reset password (`?token=sample`) | A |
| `08-verify-email` | Verify email without a link token: "Need a new link?" | A |
| `09-verify-email-link` | Verify email from a link (`?token=sample`): "Confirm your email", choose a password | A |
| `10-loader` | `app/loading.tsx`: droplet on a ring, shimmer bar, "Preparing your desk" | A |
| `11-loader-signin` | `components/SplashLoading.tsx`: "Loading your dashboard", dark card, settlement-machine art, USDC / Solana / local wire. **The loader Prompt 12 rebuilds (Sky, 18 Oct).** | A |
| `12-not-found` | `/nope`: Next's default 404 ("404, This page could not be found.") on a bare gradient | A |
| `13-error` | `app/error.tsx` with a digest, "This screen could not load" | A |
| `20-overview` | Overview after the walk's payments. "Needs you" lists only the optional second approver (B5); the sidebar keeps "Account setup 5 of 6" (B6). The top row's rate pill already reads only "USD → PHP 57.40 test rate": B8's "IDR next corridor" isn't on this base. | B5, B6 |
| `21-receipt` | `/dashboard/receipts/[id]`: `86579f1`'s receipt (status, amount, label and value rows, Download evidence pack, Share with auditor, Print), then two "Technical details" boxes, Trace it on Solscan and Verify this receipt. Not the 2025 look the audit saw; Phase 5 replaces it with the A4 document. | A |
| `22-shared-receipt` | `/receipt/[token]`: the auditor's copy, the same receipt on the sand ground with no dashboard shell | A |
| `23-recipients` | Recipients: "No recipients found" after two suppliers were paid; Corridor mix with made-up percentages, Compliance check, Quick actions, Beneficiary stats; "Payment status and history live in History" | A, B12 |
| `24-batch` | Batch payout's start page after a paid batch. The caps "PAYMENTS" kicker is already gone (`86579f1`). | A |
| `24-batch-review` | Batch payout's review step (walk shot `39-batch-review`): the native "Rehearse a problem (offline only)" select | B11 |
| `25-settings-general` … `29-settings-account` | Settings: General, Payment rules, Devices, Recovery kit, Account details. No caps kicker, but dark pill tabs, and caps labels inside General's boxes ("PER-TRANSFER LIMIT", "HOW AN APPROVER RESPONDS", "CUSTODY") | A |
| `30-history` | History: no caps kicker now, but the filters are still dark pills, not Invoices' tabs | A |
| `31-zeke` | Zeke: the chat is a tall cyan-bordered frame, mostly empty | B2 |
| `32-treasury` | Treasury: the empty "Interest per day" box (B3). Treasury activity is empty in this state ("Nothing yet"), so B4's rows without times don't show here. | B3 |
| `33-balance` | Balance: the "Add money" row has a primary "Top up" beside quiet "Choose a wallet" and "Request a payment" | B10 |
| `34-invoices` | Invoices chooser: the two dark cyan cards with gold buttons and their coin art | B9 |
| `35-transfer` | Transfer, step 1 | |
| `36-step5-transfer-paid` | Transfer step 5 after a payment (walk shot `37-transfer-track-paid`): the receipt card's three columns, values wrapping under their labels, actions split between the top right and the bottom | B1 |
| `37-step5-invoice-paid` | Step 5 for an invoice paid through Transfer (walk shot `23-done-evidence`) | B1 |
| `38-receipt-verified` | `/dashboard/receipts/[id]` after Verify (walk shot `24-receipt-verified`) | A |
| `39-receipt-shared-auditor` | `/receipt/shr_…` after Verify, the auditor's read-only copy (walk shot `26-receipt-shared-auditor`) | A |
| `40-admin` | `/admin`, the staff console | |
| `41-admin-login` | `/admin/login` | |
| `42-admin-orgs` | `/admin/orgs` | |
| `50-walk-failed-treasury-1440` | Where the walkthrough stopped (desktop only): the T-bill sheet with "71,138.55 units at US$1.1245" | |

Audit letters refer to `docs/design/p12/AUDIT.md`: A, pages still on the old design; B, flaws on restyled pages
(numbered); C, the landing. B7, the broken walkthrough, is covered above.
