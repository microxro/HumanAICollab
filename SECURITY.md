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
- **No server-side account recovery beyond email.** If `EMAIL_FROM` is unset,
  password reset degrades to an honest error rather than a silent failure.
- **Netlify Blobs is the trust store.** Anyone with the site's Netlify
  credentials can read everything. Protect that account with 2FA.
- **A student's own data is not encrypted at rest beyond what Blobs provides.**
  Location history in particular is sensitive, and retention is capped.
- **A linked adult sees and edits everything in the student's account.** This
  document used to promise the opposite — that the parent portal only ever saw
  a privacy-filtered summary — and that is no longer true, so it is corrected
  here rather than left standing. The per-field sharing toggles are gone
  (F157). A parent who redeems a link code can open the student's account and
  work in it: assignments, classes, bell schedule, scores, notes, everything.
  There is nothing the student can withhold from a linked parent short of
  removing the link, which they can do at any time.

  Two things bound it, and both are deliberate:

  - **The student starts every link.** Codes are minted only by a student
    account, are single-use, expire in 24 hours, and redemption is rate-limited
    to ten attempts an hour. Nobody attaches themselves to an account without
    the student generating a code and handing it over.
  - **Every change is attributed.** The server stamps `addedBy`/`editedBy` with
    the name of whoever made the change, the views show it on the record, and
    the Sharing screen lists every change made by somebody else. Deletions are
    the gap: the record they happened to is gone and nothing local remembers
    it, so they do not appear in that log.

- **A teacher link is not a guardian link.** A teacher redeeming a code gets
  `role: "pupil"` and academic write access only. Live location, check-in
  requests, guardian notes, focus windows and activity suggestions each check
  `role === "child"` at their own call site and refuse a teacher — asserted in
  `tests/teacher.mjs`. Which authority a link grants is derived from the
  redeeming account's role, never from the code and never from the request
  body, so renaming your own account type buys no reach into anyone else's
  records (`tests/authwall.mjs`).

## Reporting

Open an issue, or email the address in `ADMIN_EMAIL`.
