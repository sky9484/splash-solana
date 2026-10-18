# Prompt 12 Phase 3 evidence: sign-in pages, loader, 404, error

Taken on 19 Oct 2026 from `sol/b0-p12-3-auth`, on `next dev` (port 3300, its own Postgres on 5435). Each name has a
`-1440` and a `-390` file, full page. Compare with `docs/design/p12/before/04`–`13`.

| File | What it shows |
|---|---|
| `login` | Sign in: the night desk on its own deep-night panel (decision 5), the form on cream, "Keep me signed in for 30 days", "Forgot password?" |
| `signup` | Sign up: the new desk on dark cyan, company and market, the password policy bar, the terms box, "What happens next" |
| `forgot-password` | Forgot password: the mailbox, the reset link form, the help note |
| `reset-password` | Reset password from a link (`?token=sample`): the mailbox again (D3), choose a password |
| `reset-password-expired` | Reset password without a token: "That link has expired" |
| `verify-email` | Verify email without a token: "Need a new link?" |
| `verify-email-link` | Verify email from a link (`?token=sample`): the new desk again (D3), choose a password |
| `loader` | `app/loading.tsx`: the one loader (Sky, 19 Oct), on Paper, one line "Opening your desk" |
| `loader-signin` | The loader after sign-in (`LoginForm`), on Pale: "Session secured" ticked, then "Opening your desk" |
| `not-found` | `/nope` signed out: "This page isn’t here", "Go to Splash", "Contact support" (the support address) |
| `not-found-signed-in` | `/nope` as the demo owner: "Go to your desk", "Contact support" (the support page) |
| `error` | `app/error.tsx` with its digest in mono, "Try again" and "Back to the desk" |

- The loader and the error page show only while a route loads or after a thrown error, so they were rendered
  through temporary routes (`app/p12-loader-probe`, `app/p12-loader-signin-probe`, `app/p12-error-probe`), deleted
  straight after the shots. Nothing from them is committed. The loader waits 300 ms before it shows; the shots are
  taken after it has.
- On `error`, Next's dev badge reads "1 Issue": that is Next reporting the error the probe threw, not a second fault.
- With an empty form the main button is disabled, which is why it reads paler in these shots; the walkthrough signs
  in through this page.
