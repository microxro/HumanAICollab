# Testing

`npm test` runs everything. Nineteen suites, roughly three minutes.

Individual suites: `npm run test:node`, `test:security`, `test:api`,
`test:teacher`, `test:browser`, `test:a11y`, `test:abuse`, `test:controls`,
`test:inventory`, `test:concurrency`, `test:hardening`, `test:guidance`,
`test:urlguard`.

Browser suites need a static server on port 8899; the runner starts one if
nothing is already listening, and stops it afterwards.

## What each suite is for

| Suite | Asserts |
|---|---|
| `migration` | A stored payload from **any** historical build still boots — v1, v2, an early-v3 dataset missing later fields, and a hostile one full of nulls and wrong types. This is the class of bug that took the deployed app down. |
| `assets` | `index.html` and `sw.js` agree: every module the page loads is precached, every precached path exists, the cache version has moved off its default, and the shell isn't served stale-first. |
| `email` | Outbound mail reports what actually happened. Covers the sandbox-sender 403 specifically, since that is what "a valid key that sends nothing" looks like. |
| `security` | The attacks a tester runs: role coercion, account enumeration, parallel brute force, session revocation, malformed blob keys, cross-account writes, guardian escalation, the sync race, and the `force` bypass. |
| `api` | F100 — token minting and redemption, cross-account isolation, every `/v1` route, revocation, and all ten webhook SSRF vectors, with the signature verified the way a receiver would. |
| `teacher` | F059 — role persistence, authoritative posts, broadcast to several class groups, and ownership transfer when a teacher leaves. |
| `boot` | The app starts and stays interactive from a stale-schema payload, the welcome wizard is dismissed permanently, and a throwing view shows a recoverable panel rather than a dead page. |
| `xss` | Hostile input in every field that reaches an href or an attribute, across eight views. A payload that executes sets a flag the test reads. |
| `resilience` | Storage full, corrupt saved data, Escape on a confirm dialog, runaway recurrence, and the non-mutating what-if calculation. |
| `correctness` | The app must not display a confident wrong number: NaN, blank-becomes-zero, timezone-shifted dates, midnight sorting, and a focus timer that banked 25 minutes for a skip. |
| `a11y` | axe (wcag2a/2aa/21a/21aa) across all 21 views in both themes. Zero critical or serious violations. |
| `keyboard` | What axe can't see: whether Enter actually opens a thing, whether a success toast is true, whether a delete can be undone. |
| `abuse` | Oversized/RTL/emoji/injection text, NaN and Infinity scores, dates from 1900 to 9999, 500 assignments, an empty database, a prototype-pollution import, and all eight theme combinations. |
| `controls` | Clicks all ~184 interactive controls in all 21 views and asserts each observably does something. Catches the "renders but does nothing" defect. |
| `inventory` | Every one of the 150 roadmap items is either marked in source or documented as blocked. Prints the built/blocked/unaccounted table. |
| `concurrency` | Two people writing the same blob in the same instant. Every case fires both requests with `Promise.all` and asserts **both** edits survived — group notes, tasks, comments, joins, challenge totals, guardian notes, check-ins and friend requests. This is the failure mode that returns 200 twice and silently loses one of them. |
| `urlguard` | Screening and fetching a URL somebody else chose — the defence behind "paste a link and I'll read it". Tested at the three places this kind of check usually fails: the **redirect** (a permitted host that 302s to 169.254.169.254), the **IPv4-mapped IPv6 form** that `new URL()` silently rewrites to hex, and **over-blocking** (a guard that rejects `fda.gov` is a bug report too). Also covers HTML→text: script/style dropped, entities decoded, table rows kept on separate lines. |
| `guidance` | The recommendation engine. Less "does it render" than "does the ranking mean what the card claims": subject classification, ranking that reverses when the underlying grades do, relative-not-absolute scoring across a lenient and a harsh grader, pooled work style, a typed interest outweighing an incidental keyword, leadership over membership, an empty database admitting low confidence instead of guessing, and hostile input in an interest field never reaching the DOM as markup. |
| `hardening` | One test per finding from the line-by-line read of the backend: the API-token flag that used to be persisted and lock an account out, tokens hashed at rest, webhook screening that must reject `fd00::` without rejecting `fda.gov`, `/v1` answering identically for empty and populated accounts, deployment configuration withheld from non-operator accounts, link-code and friend-request guessing limits, the byte-accurate body cap, and every feed sub-route reaching its own handler. |

## The standard

Every fix in this codebase has a test that **fails against the commit
before it**. That is what makes "we fixed it" checkable rather than
claimed. When you fix something, add the test first and watch it fail.

## What these tests cannot verify

Stated plainly, because a green suite that quietly skips things is worse
than a red one:

- **Netlify Blobs.** The backend suites substitute the storage layer
  (`tests/stub/blobs-stub.mjs`) and run the real `api.js` against it. The
  stub implements real etag semantics, so the concurrency assertions are
  meaningful — but it is not Blobs.
- **A live Gemini call.** No API key in the test environment. The AI
  request/response shaping is covered; the provider round-trip is not.
- **A real Resend send.** The provider error paths are covered with a
  mocked `fetch`. Deployed, `GET /api/email-health?probe=1` sends a real
  test message and reports Resend's verbatim answer.
- **A webhook round-trip to an external URL**, and an API token used from
  an outside client. Both need the deployed site.
- **Real iOS/Android browsers.** Mobile behaviour is tested at mobile
  viewports in Chromium, which catches layout and target sizing but not
  platform quirks.

## Required environment variables

The backend refuses to start without `SCHOLAR_SECRET`, and refuses to send
password-reset links without `SITE_URL` — a reset link built from the
request `Host` header is an account-takeover vector, and there is no safe
fallback for it.

| Variable | Needed for | Consequence if unset |
|---|---|---|
| `SCHOLAR_SECRET` | All accounts and sync | Every API request returns 503 |
| `SITE_URL` | Password reset, CORS | Reset emails refuse to send |
| `RESEND_API_KEY` | Password reset, weekly digest | Those features report "not configured" |
| `EMAIL_FROM` | Reaching anyone but yourself | Mail is sent from Resend's sandbox address, which only delivers to the API key owner |

### Running without a custom domain

Resend — like every reputable transactional provider — will not deliver to
arbitrary recipients until you verify a domain you control, and a
`*.netlify.app` subdomain cannot be verified because you don't hold its DNS.

Without one, `EMAIL_FROM` has nothing valid to point at, so the two
email-dependent features degrade rather than fail:

- **Password reset (F098)** — the sign-in dialog asks `GET /api/health`,
  sees `email.deliverable: false`, and replaces the "Forgot your password?"
  link with a short explanation. A link that leads nowhere is worse than an
  honest absence. `/api/auth/forgot` also refuses with a 503 naming the cause
  rather than reporting a send that never happened.
- **Weekly parent digest (F066)** — the scheduled function runs, finds mail
  unconfigured, and records every recipient as skipped. Nothing in the UI
  advertises it, so nothing is left promising something that can't arrive.

Everything else — sync, study groups, the AI features, the public API,
teacher accounts — is unaffected. A domain (roughly $10-12/year) is the only
thing that turns those two back on.
| `GEMINI_API_KEY` | The AI features | They report "not set up" rather than failing oddly |
