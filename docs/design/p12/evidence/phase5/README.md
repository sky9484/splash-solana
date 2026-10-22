# Prompt 12 Phase 5 evidence: receipt number, Step 5, the auditor sheet, the A4 receipt, the statement

Taken on 19 Oct 2026 from `sol/b0-p12-5-receipts`, on `next dev` (port 3300, its own Postgres on 5435), with the data
the walkthrough left: the seeded demo company (Acme Manufacturing, Kuala Lumpur, Malaysia), signed in as its demo
owner, or signed out for the auditor's page. Share tokens and receipt ids in these pictures belong to that throwaway
local database; none of them opens anything elsewhere.

| File | What it shows |
|---|---|
| `step5-1440`, `-390` | Step 5 after a transfer to Cebu Logistics: the six stations, then the receipt card with the number, the company and the MYT time, the three amounts, the two columns of references (one column on a phone, label above value), the payment id with its copy button, and the action row Verify receipt, Share with auditor, Download PDF, Full receipt |
| `sheet-my-1440`, `-390` | Share this receipt, opened from Step 5: the country defaults to MY (the company's profile); the MyInvois option selected, "Planned", what it would need, the disabled button |
| `sheet-ph-1440`, `sheet-id-1440` | The same with PH (BIR EIS) and ID (Coretax) picked |
| `sheet-other-1440`, `-390` | Other: no portal option, the note, the link option selected with "Copy a read-only link", "Email it" and "Expires in 90 days" (no link yet) |
| `sheet-link-1440`, `-390` | After a link exists: "Expires 17 Jan 2027", the link itself, and "Stop sharing" (enabled for the owner) |
| `receipt-company-1440`, `-390` | `/dashboard/receipts/[id]`: the A4 receipt after Verify receipt passed (the seal "Verified"), with the QR because a link exists; below it, on screen only, the Solscan trace and the five checks |
| `receipt-shared-1440`, `-390` | `/receipt/shr_…`, signed out: "Read-only receipt", the tags Verify live, Read-only, Expires 17 Jan 2027, the same A4 page verified in the auditor's browser |
| `receipt-link-stopped-1440`, `-390` | The same link after Stop sharing: the not-valid page in the 404's style ("This receipt link isn't valid") |
| `history-statement-1440`, `-390` | History's Monthly statement: the month (October 2026, the company's only month) and the account |
| `statement-payments-1440`, `-390`, `statement-treasury-1440`, `statement-all-1440` | October 2026 for each account: the summary, every line with its receipt number and the balance after it. The Payments closing balance, US$4,509.238688, is what the Payments account held at that moment (checked against `/api/solana/balance`). The Treasury book closes within US$0.000165 of the live valuation of the Reserve and Investments: that is the T-bill price drift a book at cost plus booked interest doesn't follow |
| `receipt-print.pdf`, `statement-print.pdf` | The browser's own print to PDF (Chrome's Page.printToPDF, the same engine as its print dialog), from the final walkthrough's server: only the A4 page, A4 with 14 mm margins, "Page 1 of 2" from the page's margin box, colours kept, the shell gone. The receipt was verified first (the seal) and has a live link (the QR); the statement repeats its column headings on each page |

- Amounts on the statement are shown as the records hold them, to the millionth of a US dollar (USDC has six
  decimals), so every line and total adds up exactly; receipts and the rest of the app round the same figures to cents.
- The black "N" circle at the bottom left is Next's dev badge, not part of the page.
