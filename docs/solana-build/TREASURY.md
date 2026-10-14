# Treasury (prompt 10 Phase 5): what is built, and what is not verified

Treasury shows the company's three accounts: the Payments account (vault #0), the Reserve (vault #1) and Investments (vault #2). All three are vaults of the company's own Squads multisig, with the same members and the same threshold. Splash holds no key to any of them.

Investments run in **test mode only** until legal sign-off in Malaysia. The page says so in a ribbon on every investment surface.

## How an order works in test mode

1. **Quote.** `POST /api/solana/treasury/orders/quote` is a read. It returns:
   - the units and the test price;
   - the path: on the market, or straight from Ondo;
   - how far the order moves the price, against the 0.30% limit;
   - where the result lands, and the most this order may be today, with the reason.
2. **Prepare.** `POST /api/solana/treasury/orders` checks the following, then writes the exact order text. The text is valid for 60 seconds.
   - The eligibility gate. The owner confirms once that no owner (25% or more), director or approver is a US person or in a restricted country.
   - The reserve rules in `lib/treasury/reserve.ts`.
   - The 20% stock cap.
   - The market's price-moved limit.

   The text starts with `splash:challenge:v1:treasury-order`. It is domain-separated, so it can never be a valid Solana transaction.
3. **Approve.** The member's device signs that text with the device key, via `approveTextWithDevice`. `POST /api/solana/treasury/orders/[id]/approve` then:
   - checks the ed25519 signature against the member's key;
   - checks the rules again;
   - settles through the simulator (`settleTestOrder`).
4. **Settle.** Where the money goes:
   - **Subscribe or buy:** money comes from the Reserve's surplus first, then from the Payments account's surplus. It never comes from below the floor or from what is waiting for approval.
   - **Redeem or sell on the market:** the money comes back into the Payments account.
   - **Redeem with Ondo:** the money goes by bank wire to the company's bank account, outside Splash. It never credits the Payments account; `tests/treasury.test.mjs` checks this.
5. **Receipt.** Every settled order writes an evidence bundle of kind 6 (`treasury`). The bundle holds:
   - the asset, the units, the price and the path;
   - who approved it, the key, the approval, and the sha256 of the approved text;
   - for a sweep, the draft and the rule's cushion.

   History shows a gold "Treasury" row for each order. Balance shows the orders that drew on, or landed in, the Payments account.

Held units:

- Units subscribed straight from Ondo are held 40 days.
- Held units can't be redeemed, and they don't count in "Sweep, back".
- Redemptions use the oldest units that are out of their hold.

## Sweep

- The owner turns sweep on or off and sets the cushion (US$5,000 by default). Sweep is off for every new company.
- Each change is recorded with who and when (`treasuryRules.audit`).
- `lib/treasury/sweep.ts` makes at most one draft a day:
  - It redeems first when the accounts are short of the floor, using only units out of their hold.
  - Otherwise it subscribes the cash above the floor and the cushion.
  - It never drafts under US$500.
  - An unapproved draft is replaced the next day, not stacked.
- The draft is made by the daily job, or by the first Treasury read of the day.
- The job never approves, signs or moves anything. A person reviews the draft on the page ("Review") and approves it on a device.

**Scheduler.** The host must call `GET /api/cron/treasury-sweep` daily with `Authorization: Bearer $CRON_SECRET`. On Vercel, that is `{"path":"/api/cron/treasury-sweep","schedule":"0 23 * * *"}`, which is 07:00 in Kuala Lumpur. The repo has no scheduler config, the same as `pii-shred`.

## Reference data (`lib/treasury/reference.ts`)

- **Dated and sourced.** Every rate and past return carries the day it was true and its source page.
- **Out of date after 35 days.**
  - A figure older than 35 days shows "Rate out of date" instead of the number.
  - `tests/treasury.test.mjs` fails on any figure older than 35 days, so the figures have to be refreshed.
  - Refresh all six on one date before any external demo.
- **Test prices.** Prices and market depths are test values, not live quotes.

## Not verified yet

- **The 40-day hold.**
  - Ondo's USDY page (https://docs.ondo.finance/general-access-products/usdy/basics, checked 14 Oct 2026) doesn't state a holding period after a subscription.
  - The 40 days come from Business Module v15.1 and are kept as the cautious assumption (`TBILLS.holdDays.confirmed: false`).
  - The page's "Technical details" says so.
- **The stock token addresses.**
  - Ondo's address list links a CSV for the stock tokens, and none of their addresses is checked.
  - None is used anywhere.
  - Only the USDY address on Solana is taken from Ondo's own list (https://docs.ondo.finance/addresses).
- **The adapters are mocks.**
  - `usdy-sim` and `ondo-stocks-sim` simulate the market and Ondo.
  - No live adapter exists: one would build the vault #2 transaction instead of an off-chain order.
  - Ondo's own mint and redeem for stocks needs the company onboarded with Ondo. Until then, a stock order is capped at what the market allows.
- **One approver.**
  - An order needs one approval in test mode.
  - A company whose accounts need more than one approver is refused with a clear reason.
  - Multi-approver orders need the same proposal flow payments use.
- **Live market depth.** The 0.30% limit uses test depths. Live depth on Solana is thin; see prompt 10 §7.1.
- **Legal.** Investments are subject to legal sign-off in Malaysia. The eligibility confirmation is a product control, not a legal opinion.
