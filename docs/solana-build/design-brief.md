# Design brief: Splash pay flow, policy and Zeke screens (v15.1, 11 Oct 2026)

**For:** Sebastian and whoever builds the UI. **Canon:** Business Module v15.1 §4.5, §4.8, §14. **Brand source:** repo `styles/tokens.css` and `docs/ISOMETRIC-SYSTEM.md`.
**Skills note (AGENTS.md):** written with the `frontend-design` skill. `ui-ux-pro-max` and `design-taste-frontend` are not available in this session; run the build through them in the repo.

---

## 1. The job of these screens

A finance manager in Petaling Jaya pays a supplier in Manila. She needs to know three things before she signs: **what the supplier receives, what it costs, and when it lands**. After she signs she needs one thing: **proof**. Every screen serves one of those four answers.

AEON taught us the visual grammar (one idea per card, task-scoped agents, rules as sentences, route cards with time and fee). Splash keeps its own rules: nothing pays without a person's signature, and Zeke never touches the signing screen.

## 2. Tokens (Splash brand, unchanged)

| Role | Token | Use |
|---|---|---|
| Ground | `--bg #F6F0ED` | Page background |
| Card | `--surface #FFFFFF`, border `--line #E5DCD6` | All cards |
| Text | `--ink #1F4452`, secondary `--slate #326273` | All text |
| Accent (non-text) | `--teal #5C9EAD` | Route lines, selected outline, progress |
| Numbers that matter | `--teal-text #387F96` | Large numbers only (≥ 24px) |
| **Approval** | `--coral #E39774` | **Only** the approval card frame and the "You approve" step. Nowhere else |
| Done | `--ok #2E7D6B` | Settled, verified ticks |
| Caution | `--warn #B4690E` / text `#8A4F08` | Planned, pending, above target |

- **Type:** Geist for everything. Geist Mono only for values a user may copy or check (amounts in the ledger, transaction digests, invoice numbers), never for labels.
- **Labels:** sentence case. No all-caps eyebrows, no "WORD · WORD" meta strings.
- **Radius:** 12px for cards, 8px for chips, 999px for pills. The approval card gets 16px so it reads as a different object.
- **Motion:** one moment only, the progress line drawing from "Approved" to "Paid". Everything else is instant. Respect `prefers-reduced-motion`.

## 3. The one memorable thing: the signing card

Everything is quiet except the approval card. It is the only coral object in the product, it is rendered **only from deterministic fields** (no Zeke text inside it), and it leads with the supplier's number, not ours.

```
┌─ coral 2px frame, radius 16 ───────────────────────────────┐
│ Manila Freight Services Inc.                               │
│ BDO •••• 4471  ·  verified 2 Oct by call-back              │
│                                                            │
│   ₱560,000.00                                              │  ← 40px, --teal-text
│   Supplier receives                                        │
│                                                            │
│ You pay        US$9,744.10 from Solana balance             │
│ All-in cost    0.29%  (route 0.01 · partner 0.20 · Splash 0.08) │
│ Arrives        Same banking day, PESONet                   │
│ Invoice        INV-0412 · MyInvois 7F3K…  matched          │
│ Quote expires  in 0:42                                     │
│                                                            │
│ [ Approve with passkey ]          Cancel                   │
└────────────────────────────────────────────────────────────┘
```

All amounts in this brief are example values, not quotes.

Rules:
- Fields come from the engine and policy code, never from the model.
- The supplier name and account are the **verified** ones from the supplier directory, with the verification date.
- If any field is missing or the quote has expired, the button is disabled and says why ("Quote expired, refresh").
- Two-signature mode: the button reads "Approve and send to [approver name]"; the approver sees the same card.

## 4. Pay flow, screen by screen

This is a sequence, so it is numbered.

**1. Start.** Three ways in, one screen: "Upload invoice", "Forward to pay@…", "Ask Zeke". Empty state: "No bills yet. Upload your first supplier invoice."

**2. Check the invoice.** Left: the invoice image. Right: the extracted fields, each editable, each with a tick when confirmed. A changed or new bank detail shows a warning row: "New bank details. Verify by phone before paying." with a "Mark verified" action that records who and how.

**3. Choose a route.** One card per option (at most three: Cheapest, Fastest, Safest). Each card:
```
┌──────────────────────────────────────────┐
│ Cheapest                         ○ select │
│ Supplier receives ₱560,000               │
│ Same banking day · all-in 0.29%          │
│ From Solana balance · direct             │
└──────────────────────────────────────────┘
```
Under the cards: "Zeke suggests Cheapest. You choose." Never "auto-selected". If the home-lane rule applies: "Sui route chosen: +US$0.84 vs cheapest. Switch".

**4. Approve.** The signing card (§3).

**5. Progress.** A single line with four stops: Approved → Sent → Partner received → Paid to bank. The line draws as each stop completes (the one motion moment). Each stop shows its time and, once done, a "View" link to the transaction or partner reference.

**6. Done.** "Paid. Manila Freight received ₱560,000." Below: the evidence card with "Download evidence pack" and "Share with auditor". If the anchor is pending: "Recorded, anchor pending" (never "anchored" early).

**7. Problems.** Each error says what happened and what to do:
- "The partner returned the payment. Money is back in your Solana balance. Retry or pay another way."
- "Quote expired before you approved. Refresh to get a new quote."
- "Screening flagged this supplier's wallet. Payment blocked. Contact support with reference SC-1182."
- Uncertain state: "Checking whether this payment went through. Don't retry yet." (no retry until the Matcher reaches a final state)

## 5. Balance header

```
US$24,310.55
Sui 12,000.00 · Solana 9,310.55 · Arbitrum 3,000.00
```
- The total **must equal** the sum of the parts, or show "includes US$X pending".
- Treasury assets (if ever turned on) sit on a separate line and never in the payable total.
- Header also holds the identity bar (from the Sera teardown): sign-in icon, company name, short address, Copy, "Walk-away kit".

## 6. Policy screen (who can change it: the Company Authority)

Rules read as sentences with real values, each tagged with where it is enforced:

| Rule as shown | Tag |
|---|---|
| Every supplier payment needs your passkey. | Locked · always on |
| Per payment up to US$20,000. | Enforced by Splash |
| Up to US$100,000 per day. | Enforced by Splash |
| Only verified suppliers. View list (14) | Enforced by Splash |
| Two people approve payments above US$10,000. | Enforced on Sui |
| Zeke may pay for data services up to US$50 a month (Weather API only). | Enforced on Sui · mandate · PLANNED |

- No toggle hides a list: every allowlist shows its count and opens it.
- Editing a rule that loosens control shows: "This takes effect in 24 hours and notifies everyone on your team." Tightening applies at once.
- Only the Company Authority sees Edit. Others see the rules read-only.

## 7. Zeke roster

One row per agent, short task, what it can never do, and a revoke for any mandate:

```
Reader     Reads invoices. No tools.                    Can never: sign, pay, hold a key
Router     Explains routes.                              Can never: change amounts or suppliers
Checker    Checks limits and screening.                  Can never: override a rule
Planner    Shows what's due and what's short.            Can never: move money
Matcher    Matches payouts to invoices.                  Can never: close a mismatch
Auditor    Builds evidence packs.                        Can never: give anyone access
Data spend Pays for listed APIs within US$50/month.      Expires 30 Nov · Revoke      (PLANNED)
```

## 8. "Talk to your business" (Zeke chat)

- The chat answers questions and makes drafts. Every draft opens as a card with the same approval card at the end; nothing is sent from chat.
- Draft cards say "Draft" in the title and show who will approve.
- Example prompts shown on the empty state: "Pay everything due this week", "Invoice Manila Freight US$4,200 for September", "What do we owe in pesos this month?", "Give me September's evidence pack".

## 9. x402 spend ledger (PLANNED with the mandate)

```
Weather API · 12 calls      US$0.24
Customs data · 1 lookup     US$1.00
Total this month            US$1.24 of US$50.00   ▓░░░░░░░░░
```

## 10. Accessibility and quality floor
- All text ≥ 4.5:1 contrast; large numbers ≥ 3:1. `--teal #5C9EAD` is never text.
- Keyboard: every step reachable, visible focus ring in `--teal`.
- Marketing carousels (if any) have a pause control (WCAG 2.2.2).
- Screen readers: the signing card reads the supplier amount first.

## 11. What not to copy from AEON
- "Approval above $1,000" or any auto-pay threshold.
- "Auto-selected, no manual decisions" route copy.
- Toggles that hide the list they control.
- Balances that don't add up; synthetic dollars (USDe) shown as spendable.
- Gift-card or retail examples in a B2B product.
- "Safe and compliant" with no licence behind it.

Sources: Splash competitor and partner teardown (`splash/competitor-partner-teardown_2026-10-11.md`), AEON site carousel (Sky's recording, 10 Oct), [AP2 specification](https://ap2-protocol.org/ap2/specification/), [W3C WCAG 2.2.2](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)
