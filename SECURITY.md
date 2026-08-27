# Security

## The boundary

StudyHold is a static front end plus three Netlify Functions. **Everything the
browser runs is public**, and that is not a defect to be fixed — it is how the
web works. Anyone can open developer tools, read `js/store.js`, edit it, and
run the modified version. So can any visitor to any website ever built. What
matters is what that buys them: **nothing beyond their own browser and their
own data.** No security decision is made in the browser.

The boundary is the server. Every rule that matters is enforced in
`netlify/functions/`, and `tests/authwall.mjs` proves it by attacking every
route rather than asserting it in prose.

## What guards what

| Surface | Control |
|---|---|
| Session tokens | HMAC-SHA256 over a JSON payload, 30-day expiry, signed with `SCHOLAR_SECRET`. A tampered payload fails verification; a token signed with any other key fails. |
| Passwords | PBKDF2-SHA256, 210,000 iterations, 16-byte per-user salt. Compared in constant time. |
| Revocation | `tokenEpoch` on the profile. A password reset bumps it and every token minted earlier stops working immediately — on the API and the AI routes. |
| Brute force | Atomic failure counter, 8 attempts then a 15-minute lockout, reported with the same 401 as a wrong password so it isn't an account oracle. |
| Account enumeration | Login, signup and friend requests answer identically whether or not the address exists, with matched timing on the login path. |
| API tokens | Server-minted, 256 bits, stored under a SHA-256 of the token so the store never holds the secret. Cannot manage other tokens or webhooks. |
| Cross-account access | Every read of another person's data checks an explicit link or group membership first. |
| Cross-origin | The API returns no `Access-Control-Allow-Origin` to any origin but `SITE_URL`. Preflight refuses the rest. |
| Outbound fetches | `_lib/urlguard.js` screens every user-supplied URL against loopback, private, link-local, CGNAT and IPv6 equivalents, and re-screens after every redirect. |
| Rate limits | Per-account ceilings on writes, group creation, join-code and link-code guessing, friend requests, `/v1`, email probes, and AI calls. |
| Scheduled digest | Refuses any invocation that isn't from the scheduler. |
| Headers | CSP with no `unsafe-inline`/`unsafe-eval` for scripts, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `connect-src 'self'`, HSTS, nosniff, `X-Frame-Options: DENY`. |

## What is deliberately public

Five routes, and only these:

- `GET /api/health` — whether email is configured. No deployment detail.
- `POST /api/auth/{signup,login,forgot,reset}` — necessarily pre-authentication.
- `GET /api/ics-feed/:token` — a calendar client cannot send a bearer token, so
  this one route is gated by a 256-bit unguessable token instead.

`tests/authwall.mjs` asserts this list is exactly right in both directions:
the public ones stay reachable, and every other route rejects eight kinds of
forged credential.

## Known limits, stated plainly

- **The session token lives in `localStorage`.** Script injected into the page
  could read it. The CSP is the mitigation — `script-src 'self'` with no
  inline or eval — and the XSS suite covers the input paths. Moving to an
  httpOnly cookie would remove the class entirely and is the single largest
  remaining hardening step; it needs a CSRF design to go with it.
- **The study-token wallet is client-side, and that is a design limit, not a
  bug to be found later.** Balances, purchases and the day's per-topic tally
  live in `localStorage`; anyone willing to open devtools can set the balance
  to any number. The AI gate on earning (F158, and the topic quiz that replaced
  the photo in F160) raises the floor rather than the ceiling: it stops the
  earning route being farmed, which is what a student would actually do, and it
  does so with the answer key held server-side behind an HMAC-signed ticket
  that is marked exactly once. It does not, and cannot, make the number
  authoritative. Nothing outside the device reads it — no
  leaderboard, no parent view, nothing purchasable with money — so a forged
  balance costs its owner the point of the feature and nobody else anything.
- **No server-side account recovery beyond email.** If `EMAIL_FROM` is unset,
  password reset degrades to an honest error rather than a silent failure.
- **Netlify Blobs is the trust store.** Anyone with the site's Netlify
  credentials can read everything. Protect that account with 2FA.
- **A student's own data is not encrypted at rest beyond what Blobs provides.**
  Location history in particular is sensitive; retention is capped and the
  parent portal only ever sees the privacy-filtered summary the student's own
  device pushes.

## Reporting

Open an issue, or email the address in `ADMIN_EMAIL`.
