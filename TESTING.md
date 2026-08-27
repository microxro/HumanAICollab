# Testing

`npm test` runs everything. Twenty-three suites, roughly four minutes.

Individual suites: `npm run test:node`, `test:security`, `test:api`,
`test:teacher`, `test:browser`, `test:a11y`, `test:abuse`, `test:controls`,
`test:inventory`, `test:concurrency`, `test:hardening`, `test:guidance`,
`test:urlguard`, `test:authwall`, `test:activities`, `test:portal`.

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
| `a11y` | axe (wcag2a/2aa/21a/21aa) across all 23 views in both themes. Zero critical or serious violations. |
| `keyboard` | What axe can't see: whether Enter actually opens a thing, whether a success toast is true, whether a delete can be undone. |
| `abuse` | Oversized/RTL/emoji/injection text, NaN and Infinity scores, dates from 1900 to 9999, 500 assignments, an empty database, a prototype-pollution import, and all eight theme combinations. |
| `controls` | Clicks all ~214 interactive controls in all 23 views and asserts each observably does something. Catches the "renders but does nothing" defect. |
| `inventory` | Every one of the 150 roadmap items is either marked in source or documented as blocked. Prints the built/blocked/unaccounted table. |
| `concurrency` | Two people writing the same blob in the same instant. Every case fires both requests with `Promise.all` and asserts **both** edits survived — group notes, tasks, comments, joins, challenge totals, guardian notes, check-ins and friend requests. This is the failure mode that returns 200 twice and silently loses one of them. |
| `authwall` | Every endpoint, attacked. Walks the whole route table of both functions and tries each one with no token, garbage, a token signed with a different secret, an expired token, a token whose subject was swapped to someone else's, and an `sk_` that was never minted — 68 API routes and 7 AI routes against 8 credentials each. Then cross-account authorization, CORS, revocation, malformed path segments, the write ceiling, the scheduled digest's invocation guard, and the deployed security headers. A route added later without auth fails the completeness check rather than going unnoticed. |
| `urlguard` | Screening and fetching a URL somebody else chose — the defence behind "paste a link and I'll read it". Tested at the three places this kind of check usually fails: the **redirect** (a permitted host that 302s to 169.254.169.254), the **IPv4-mapped IPv6 form** that `new URL()` silently rewrites to hex, and **over-blocking** (a guard that rejects `fda.gov` is a bug report too). Also covers HTML→text: script/style dropped, entities decoded, table rows kept on separate lines. |
| `guidance` | The recommendation engine. Less "does it render" than "does the ranking mean what the card claims": subject classification, ranking that reverses when the underlying grades do, relative-not-absolute scoring across a lenient and a harsh grader, pooled work style, a typed interest outweighing an incidental keyword, leadership over membership, an empty database admitting low confidence instead of guessing, and hostile input in an interest field never reaching the DOM as markup. |
| `activities` | F156 — outside-school activities. The store math (what a per-session, per-term and one-off fee each add up to per month, and that a school club's stale fee is never counted), the backfill of a record written before the feature existed, the scheduling rule that stopped hiding a Saturday lesson on an A/B timetable, and the guardian-suggestion endpoints: authorization, the field whitelist a cross-account object has to survive, answering once and only once, and two guardians suggesting in the same instant. |
| `shop` | Study tokens — an economy is only worth a number if it can't be farmed, so most of this suite is refusals: the same photo twice (fingerprint match), a photo of a flat colour (no detail to hash), a second photo inside the cooldown, a photo the model says isn't schoolwork, and the day's cap (which saves the photo and pays nothing rather than failing). Since F158 it also drives the whole two-stage earning flow with `App.assistant` scripted: each grade pays its own rate, a failed quiz saves the session and pays nothing, a retake buys a fresh quiz and is spent doing so, a 50/50 both hides *and disables* two options, a cooldown skip is only ever spent deliberately, and the no-AI path logs the time while paying zero. One assertion there is the regression that matters most — `quote(9999)` pays nothing, because claimed time is no longer a rate. Also that deleting a proof keeps the tokens *and* keeps the photo spent, that buying deducts and equips, and that a cosmetic named in a restored backup but never bought is taken off rather than painted. It generates its own PNGs — a seeded blocky pattern per fingerprint, and a flat one — so the browser decodes real images. Statically, it re-derives every purchasable accent's contrast from `css/theme.css` and asserts each skin's surfaces sit at the same relative luminance as the ones they replace. |
| `proof` | The AI gate on study tokens (F158), driving the real `assistant.js` routes with the model scripted (`tests/stub/gemini-stub.mjs`). Almost all of it is the boundary rather than the happy path: a photo the model calls "not schoolwork" yields no ticket; the classify response is searched *whole* for the answer key, not just checked field by field; a ticket cannot be tampered with, expired past, moved to another account, or substituted with the session token this same server signed; the minutes come off the signed ticket so the request body can't inflate them; and a ticket is marked exactly once — the suite plays the two-call brute force (grade wrong, read `wrong`, correct them, grade again) and asserts the second call is refused. |
| `portal` | The screens that render nothing until you're signed in, which every other browser suite therefore sees empty: the card offering a guardian-suggested activity (adding it, declining it, and a failed answer that must leave it pending rather than half-done), and the parent portal's own view of the outside-school half — in the student's currency, not the parent's — plus the form that sends one. |
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
  For F158 that gap has a specific shape worth naming: `proof` proves the
  routes handle whatever the model returns — including a malformed quiz, a
  duplicated option and an out-of-range answer index — but **not that the
  model reliably tells schoolwork from a screenshot, or writes questions
  that a page-reader can answer and a photographer cannot.** That judgement
  is the feature, and only a real key exercises it.
- **A real Resend send.** The provider error paths are covered with a
  mocked `fetch`. Deployed, `GET /api/email-health?probe=1` sends a real
  test message and reports Resend's verbatim answer.
- **A webhook round-trip to an external URL**, and an API token used from
  an outside client. Both need the deployed site.
- **A real signed-in session in the browser.** `portal` drives Sharing's
  guardian cards and the whole parent portal with `App.sync`'s network calls
  replaced by in-memory ones, so the views, handlers and store are real and
  the transport is not. The transport those stubs stand in for is tested
  against the real `api.js` in `activities`. What neither covers is the two
  meeting over a live network.
  `shop`'s earning flow is the same trade the other way round: it scripts
  `App.assistant` in the page, so the dialogs, the consumables and what gets
  written to the store are real while the transport is not — the routes those
  stubs stand in for are tested against the real `assistant.js` in `proof`.
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
