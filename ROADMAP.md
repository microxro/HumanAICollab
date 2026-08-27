# StudyHold — proposed updates

150 proposed changes: **100 functionality** and **50 interface**. None duplicate the twenty
screens or twenty-five features already built — everything here is additive.

Each item is sized **S** (hours), **M** (a day), or **L** (several days). Items marked **server**
need the Netlify backend; the remaining 121 work entirely offline in the browser.

| | |
|---|---|
| Functionality | 100 |
| Interface | 50 |
| Small — ship fast | 53 |
| Need the backend | 29 |

A filterable version of this list is published as an artifact.

---

## Delivery status

Every item below was built for real in the app — no mockups, no placeholder
UI — and exercised in a real browser (Playwright) with a clean console
before being committed. A handful of bugs were caught this way and fixed
before shipping (see commit history for specifics), rather than only
checked for syntax.

**Functionality — 95 of 100 shipped.** F001–F045 and F048–F052 (grading,
assignments, study tools, scheduling), F053, F064, F065, F067, F068, F071,
F072 (friend requests, invite links, grade-drop alerts, check-ins, guardian
notes, emergency contacts), F073–F092 (wellbeing and insight, all of it),
F096, F099 (home-screen shortcuts, localization), and — added in a later
pass — F046 (live calendar feed: the device pushes the same .ics it already
builds for one-time export to a server-hosted subscribe URL), F058 (feed
post comments), F060 (anonymous class-wide difficulty ratings, with the
who-voted list stripped before the feed ever reaches a client), F069
(arrival/departure alerts, computed by diffing each location push against
the last one server-side rather than a continuous feed), F070 (agreed
focus windows, mirroring the existing guardian check-in request/respond
pattern), F098 (password reset — a Resend-backed email with a one-time,
30-minute token), and F066 (a weekly digest email, sent by a Netlify
scheduled function, built entirely from the same privacy-filtered summary
each student's device already pushes for the parent portal — so it can't
leak anything a student didn't already agree to share).

**Not built — 5 items**, each genuinely blocked on a credential or a service
the deploy owner has to supply: **F097** (Sign in with Google/Apple — OAuth
client credentials), **F047** (two-way Google Calendar sync — Google OAuth),
**F093** (Google Classroom — Google OAuth), **F094** (Canvas — a Canvas
access token), **F095** (inbound email capture — an inbound mail provider and
DNS records; the outbound provider used by F066/F098 doesn't receive mail).

This list previously read "6 items" and included F059 and F100, describing
both as blocked on "credentials or third-party infrastructure this
environment doesn't have". That was wrong: neither needs anything external.
Both are now built — see below. The same list also omitted F097 entirely,
which is why its own totals came to 99 of 100.

**A student on their own.** Focus windows, check-ins and notes were all built
as things a *linked guardian* does to a student: only a parent account could
propose a quiet period, only a parent could leave a note, and the cards that
displayed them rendered nothing at all when nobody was linked. That is the
wrong default — most students have no parent account, and a feature nobody can
reach until a second person signs up is not a feature they have.

All three are now self-served as well as guardian-served, entirely locally:
`startSelfFocusWindow`, `addSelfNote` and `addSelfCheckIn` need no account, no
link code and no server, and the same cards render both kinds side by side
(`by: "self"` is the only difference in the record). The Parent portal, opened
by a student, now says plainly that they do not need a parent account and
lists what is already theirs, instead of showing them a sign-in prompt for an
account type they will never have. The signup hint and the Parent-access card
in Settings say the same thing. One real bug fell out of this: the collection
holds two record shapes — recurring windows keyed on weekday, one-off windows
keyed on timestamps — and `activeFocusWindow()` read `w.days.includes(...)`
unguarded, so a one-off window threw.

**Classes outside the bell schedule.** A class used to be defined by the
period it occupies, and `classesOnDate()` dropped any class whose `periodId`
resolved to nothing — so an extracurricular that assigns homework (a robotics
team, a Saturday academy, a dual-enrollment course) could not be entered at
all without inventing a fake period for it. Classes now carry either a period
or their own `start`/`end`, resolved through one selector, `S.classPeriod()`,
that every reader goes through: the agenda, the ICS feed, contact cards, the
week's class-minute total. Off-schedule classes match on the weekday in both
weekly and rotating modes — a Tuesday club is on Tuesday whether the school
calls it a Day A or a Day B — and they occupy no period, so peer free-period
matching skips them rather than colliding on a phantom slot.

**The focus alarm actually rings.** The old `ping()` built a fresh
`AudioContext` at the moment the timer hit zero. Every current browser starts
one suspended unless it is created or resumed inside a user gesture, and "the
timer ran out" is not a gesture — so the oscillator played into a suspended
graph and nothing came out. `js/sound.js` holds one context for the whole app,
opened on the first real pointer or key event (and again on the timer's own
Start button), resumed before every play, with an `<audio>` WAV fallback,
`navigator.vibrate` alongside, and a repeated multi-note pattern rather than a
single 0.6-second sine nobody hears from across a room. Quiet hours now lower
the volume instead of removing the sound, because silence at 22:00 is
indistinguishable from a broken timer; a setting restores the old behaviour.
The fourth segment reads **Custom** rather than "Custom 25m" — the length
moved to its tooltip.

**Tiers on the study shop.** This branch arrived with a second, parallel token
shop — built against a base that predated F155, and therefore unaware that one
already existed. Merging the two was the interesting part of the work, and the
resolution is that F155's shop is the one that survives: it has the photo
proofs, the fingerprint ledger, the contrast-validated skins and the settings-
backed equipping, and none of that was worth rebuilding. What the second shop
actually contributed — the thing that was asked for — is folded into it:

  - **Four tiers.** Common (150–200), Rare (300–450), Ultra (500–750), Elite
    (800–1000), with every item carrying its tier and the suite asserting that
    each price sits inside its own band. The Shop tab groups by tier rather
    than by kind, because the tier is what a price *means* to a student.
  - **A second earning route.** Tokens now also come from work the app already
    measured: focus minutes (3 each, +20 for finishing the block), a completed
    assignment (45, +25 if it wasn't late), a streak day (50, +150 every
    seventh), flashcards, reading, habits, goals. These carry no photo, no
    cooldown and no daily cap, because there is no claim to check — the guards
    that matter for them are narrower and sit at the point of payment: an
    assignment pays once ever however often it is reopened, and a focus block
    pays for the minutes actually spent.
  - **Inflated denomination.** Prices and rates were multiplied by 25 together,
    which changes no ratio and no attainability but puts the top tier at a
    number worth showing. A wallet written before the change is redenominated
    by the same factor exactly once, flagged on the wallet, so no balance
    silently lost 96% of its purchasing power.
  - **More to buy.** Six alarm voices (the timer's, so a purchase changes what
    a finished block sounds like), four consumables (streak freezes and 2×/3×
    earning boosts), a Valedictorian nameplate and a prismatic Elite ring —
    the last built in the same masked-band idiom as F155's aurora ring, so it
    can't cover the initials the avatar sized for 4.5:1.

One behaviour changed on the way through: the daily streak used to pay on the
touch that *creates* a streak, which fires on first open — an economy paying
for launching the app. It now pays only when a streak continues, and a fresh
install starts at zero.

**Feedback (F154).** A Feedback tab in Settings: pick what it's about, write
the message, and send it to humanai736@gmail.com. It composes a `mailto:` and
hands it to whatever mail app the device already has rather than posting to
the backend, which is a deliberate choice — server mail only works when
`RESEND_API_KEY` and `EMAIL_FROM` are both set, so a form wired to it would
fail silently on a deploy that hasn't configured them, and it would need the
student signed in, which reporting a bug should never require. The `mailto:`
route works offline, needs no key, and leaves the sender reading the message
before it goes.

An optional **app details** block attaches the browser, screen size, settings
and *counts* of records — never their contents. No class name, note body or
signed-in address is included, and the full text is shown on screen before
sending, because a feedback form is the last place that should quietly
exfiltrate someone's schoolwork. Long messages are put on the clipboard
instead of into the URL: mail clients disagree on how long a `mailto:` may be
and the ones that dislike a long one drop the body without saying so.

**Study tokens and the shop (F155).** A student photographs the work they
did, the photo earns tokens, and the tokens buy how StudyHold looks — accent
colours, surface skins, an avatar ring, a nameplate in the sidebar.

The honest part first: **nothing here proves anyone studied.** A photo is
evidence a person chose to show, on their own device, and the wallet lives in
localStorage where devtools can set it to any number at all. What the design
can honestly promise is narrower — the obvious ways to farm the number don't
work, and each refusal names its reason:

- every photo is fingerprinted (64-bit average hash) before it counts, so the
  same page re-cropped or re-compressed still collides;
- the fingerprint ledger outlives the photo, so deleting a proof frees storage,
  not the payout;
- an image with almost no detail (a wall, a blank screen) has nothing to
  fingerprint and is refused as such;
- 10 minutes between submissions, and 250 tokens a day. Past the cap a photo
  still saves and still logs as study time — it just stops paying.

**A photo has to answer for itself now (F158).** The list above was the whole
defence, and it was not enough. None of it looked at what the photo showed, and
the payout came from a number the student typed into a box — so a screenshot of
a games library plus a claim of four hours was worth exactly as much as an
evening of real work, every ten minutes, forever.

So the photo is read before it is paid. `POST /assistant/study-proof` asks
whether the image is schoolwork at all and, if it is, writes four
multiple-choice questions **about that specific page** — the actual numbers,
terms and steps visible in it. `POST /assistant/study-quiz` marks the answers.
Full marks pays 100, most of them 50, half 25; under half pays nothing and
still logs the time.

The quiz is the part that does the work, and it is a much harder thing to fake
than a number in a form field: a random screenshot yields no quiz, and a page
you photographed but never read yields questions you cannot answer.

Three details the design turns on:

- **The answer key never reaches the browser.** It rides in a ticket signed
  with the same HMAC-SHA256 that signs session tokens, so the client holds an
  opaque string it can neither read out of the network tab nor forge. Grading
  happens on the server, and the tokens credited are the server's number.
- **A ticket is marked exactly once.** Without that it is a signed oracle:
  grade it, read which answers were wrong, correct those, grade again — full
  marks in two calls without reading the page. Tickets carry a nonce and are
  consumed against it, which is what lets the response keep saying *which*
  questions were wrong, the only feedback a student gets.
- **The free checks run before the paid one.** A duplicate, a blank frame or an
  unexpired cooldown are refusals the device can make on its own; none of them
  should cost an API call or make somebody answer four questions before being
  told no.
- **A photo gets one quiz, and it is marked when the questions appear.** The
  fingerprint ledger means "this photo has been paid for", which is not the
  same as "this photo has had its chance" — and the gap between those two was
  a hole: fail, close the dialog without saving, photograph the same page
  again, and the model writes a fresh set of questions with nothing spent. So
  there is a second ledger for photos that have been *given* a quiz, kept
  separate from the first because they answer different questions. Spending a
  retake is the sanctioned way past it.

Self-reported minutes are gone from the payout entirely. The study session
still needs a duration, so it takes the model's own estimate of the visible
content — carried on the signed ticket rather than the request body, so it
cannot be inflated either. When the AI is unreachable (offline, signed out, no
`GEMINI_API_KEY`) there is no quiz and therefore no payout: the photo saves as
study time and earns nothing, and a minutes field reappears on that path alone,
because self-reported time is harmless as a *record* and was only dangerous as
a *price*.

Three consumables came with it, the kind that wait in the wallet rather than
firing when bought — a **50/50** that removes two options from a question you
are stuck on, a **cooldown skip**, and a **retake** that buys a fresh set of
questions about the same photo. `spendHeld()` reads the count and writes the
result in one commit, so a double-click cannot spend two, and spending is
always something the student chooses: a consumable that spends itself the
moment it would be useful is one you lose without deciding to.

Every proof also writes a real study session, so time proved this way lands in
the heatmap, the weekly total and any study goal, exactly like a finished focus
block. Photos live in IndexedDB beside class attachments — local, never
uploaded.

The cosmetics were the part with a trap in it: a shop full of colours is a shop
full of ways to make the app unreadable. So every purchasable accent's text
colour clears 4.5:1 on all four surfaces in both themes, and every skin is a
re-tint at *matched luminance* — each surface was mixed toward a hue and scaled
back to the relative luminance of the colour it replaces, so every contrast
ratio in the app is arithmetically unchanged. `tests/shop.mjs` re-derives both
from `css/theme.css`, and `App.shop.sanitize()` takes off any cosmetic a
restored backup names but this wallet never bought.

**Outside-school activities (F156).** The Activities screen assumed every
extracurricular belonged to the school: its adult was picked from the staff
list, its location was a room number, and the timetable drew it only on a day
the school was open. That is not what most of a family's week outside class
actually looks like — music lessons, a club team, a language school, tutoring,
a weekend class. Those are run by somebody else, meet somewhere with an
address, cost money, and very often fall on a Saturday.

An activity now says which of the two it is, and the outside-school side
carries the fields the school side has no use for: who runs it, the instructor
and how to reach them, an address and website, and a fee with its billing
period, rolled up into what the family pays per month (one-off fees are
reported separately rather than folded into a monthly figure they are not part
of). Fees are formatted with `Intl` from a currency setting, so this is not a
US-only feature.

The scheduling rule changed with it. v2 drew an activity only when
`isSchoolDay(iso) || mode === "weekly"`; weekly is the default, so most
installs never saw the gap, but a school on an A/B cycle sets rotating mode
and there the condition collapses to "only when the school is open" — the
Saturday squad session and the lesson in the holidays disappeared. Outside-school
activities are no longer bound to the school calendar; school clubs still are,
because a club really doesn't meet when the school is shut.

**Parents can add one.** The parent portal is read-only by design, and that is
why it is safe to hand a parent, so this is not a write into the student's
data. A guardian fills in the activity from their portal; it lands as a
suggestion in the student's Sharing screen, where they add it (their own
device does the insert, and the record is marked with who suggested it) or
dismiss it. The server whitelists the posted fields rather than trimming them,
because the object crosses accounts: no `id` that could collide with one of
the student's own records, no `javascript:` website, no unknown field at all.
Whether the student added it is reported back to the parent who sent it.
Outside-school activities also appear in the parent summary, behind their own
privacy toggle — school clubs never do, since which clubs someone joined is
theirs to tell.

**Add from a link (F152).** Most of what a student retypes into a school
tracker is already published on a web page. Paste the link instead: the server
fetches the page, strips it to text, and extracts bell-schedule periods, a
calendar of events, or a course catalogue, each into the same review-then-add
list the photo importer already used. An **Add all** button handles the case
that motivated it — a bell schedule is eight rows, and clicking Add eight
times was the chore.

The fetch is server-side of necessity: a school website sends no CORS headers
to a Netlify origin, so the browser is not permitted to read it. That makes it
a server-side request forgery surface, so screening lives in
`_lib/urlguard.js` and is shared with webhook delivery rather than duplicated
— every redirect hop is re-screened, because a permitted host that 302s to
169.254.169.254 defeats a check that only ran on the URL the user typed.

**Guidance now knows your school (F153).** The school name comes from the
profile, and a course-catalogue link makes the elective recommendations name
real courses with their real codes instead of a general catalogue. Works for
middle school, high school and college. Without a catalogue link it falls back
to the built-in list and says so.

**Guidance (F151).** Added after the 150, at the owner's request, and the
first item here that isn't on the original list. A new view that answers the
two questions a student actually has to decide — *which electives do I pick*
and *what field is this pointing at* — from the record StudyHold already holds.

The engine (`js/guidance.js`) is deterministic and entirely local: no API key,
no network, no provider. That is a deliberate constraint rather than a
limitation to apologise for. A recommendation about someone's education should
be auditable line by line, and every card in the view lists the actual grades,
hours and category averages that moved it up the ranking, so a student can
disagree with a suggestion for a specific reason.

What it reads: per-class grades and their trajectory; each subject scored
**relative to the student's own average**, which is the only way to compare a
91 from a hard grader with a 96 from an easy one; study minutes per class, so
a cheap A and an expensive A are told apart; category performance pooled
across every class, which is what identifies whether someone is a builder, a
writer or a test-taker; voluntary depth (notes, decks, books nobody assigned);
activities with hours and leadership roles; and stated interests, weighted
above everything inferred, because someone telling you what they want is
better evidence than a gradebook guess.

It refuses to overclaim. A confidence score derived from how many of six
signals are actually present sits at the top of the page, and with a thin
profile it says so instead of inventing a destiny from two grades. The
"What it used" tab lists every input and, just as importantly, what it cannot
see: the school's real course list, test scores, cost and aid, and the student
themselves.

**F059 — teacher accounts.** A `teacher` role at signup, carried onto group
membership records. A teacher's post to a class feed is flagged
`authoritative`, badged "From your teacher", and skips the crowdsourced
confirm affordance — corroboration is exactly what an authoritative post
replaces. A teacher can post one assignment to every class group at once,
with per-group success reported rather than rolled back. And a teacher
leaving a class group transfers ownership to the longest-standing member
instead of deleting the group, which previously took everyone's notes,
tasks and feed with it.

**F100 — public API and webhooks.** Server-minted `sk_`-prefixed tokens
stored in Blobs and redeemable without a session, generalising the pattern
the ICS feed already uses; the full value is shown once at mint time because
the store holds it as a key. A read-only `GET /api/v1/{me,classes,
assignments,schedule,grades}` surface — read-only deliberately, since writes
would have to reconcile with the optimistic-concurrency versioning that keeps
two devices from clobbering each other. Webhooks require https, reject
loopback/private/link-local/CGNAT/metadata addresses, and are signed with
HMAC-SHA256 so a receiver can verify provenance.

One correction to what this document used to promise: **there are no delivery
retries.** Netlify Functions are request-scoped, so there is no queue and no
worker — delivery is a single attempt with a 4-second timeout, fired inline
during the sync that caused the change, with the outcome recorded on the hook
for the owner to see. Retries would need infrastructure this deploy doesn't
have, and claiming them would have been a lie in the docs rather than a
feature in the code.

A later pass cleared the seven group-collaboration items that had been
listed here as blocked: F054–F057 and F061–F063 (shared project calendar,
task assignment, accountability partners, common free period, peer tutoring,
attributed shared notes, cooperative challenges). All seven hang off the
existing group blob, so membership stays the single access check. The
availability feature shares only *busy* blocks, never schedules, so a group
can find an overlap without anyone's class names or grades becoming visible
to classmates.

**Interface — 50 of 50 shipped**, all with zero visual redesign — every new
token or component layers onto the existing design system rather than
replacing it. The first pass shipped U01–U03, U07, U09–U11, U13, U26, U29,
U32, U38, U42, U45, U46, U48. A later pass added the rest: U04–U06, U08
(modal-history back button, deep links to records, a mobile bottom tab bar,
a floating quick-add); U12, U40 (a high-contrast theme layered like
true-black already was; workload heat on the calendar month view); U17–U19,
U27, U28 (skeleton loading, considered micro-motion, swipe actions,
pull-to-refresh, long-press quick actions); U20–U25, U31, U33 (range
select, context menus, inline due-date editing, draggable checklist steps,
keyboard list navigation, a global undo stack, configurable table columns,
incrementally-rendered lists); U34–U36, U43 (a real hover crosshair and
drag-to-zoom on the grade trend chart, print layouts per view, a
screen-reader data table behind every chart); U37, U41, U44, U47 (a
compact "what's next" strip in the topbar, `role=dialog`/`aria-live` on
every modal and several live regions, a reduced-motion gap closed on
`scroll-behavior`, intensity-as-size on the heatmap so it doesn't rest on
color alone); U49, U50 (a first-run wizard chaining the real class/bell
schedule/assignment forms, and a small contextual-help popover wired up at
the app's three invented-vocabulary terms), and U15 (subject icons — a
curated set of plain Unicode glyphs, the same convention the sidebar nav
already uses, guessed from a class's name via whole-word keyword matching
with a manual override in the class form; shown on class cards and in the
schedule timetable, next to the color that used to be the only signal), and
U16 (drawn empty states — a matching set of hand-built line icons, one per
empty-state kind, sharing the app's chart aesthetic and rendering as
inline SVG so they pick up the accent color and both themes for free; a
settings toggle lets each person choose between the drawn set and the
original emoji, defaulting to drawn for new and existing users alike).

**All 50 interface items are now shipped.** The last three landed in a
later pass: U14 (class cover images, stored in IndexedDB alongside
attachments rather than the synced JSON, so a photo can't blow past the
sync payload limit — a missing blob falls back to the colour bar), U30
(the drag payload moved onto `dataTransfer`, so a drag can start in one
component and finish in another; month cells are drop targets too, not just
the week grid), and U39 (a Gantt-style timeline mode on Homework, with
checkpoints nested under their parent project — the case a flat list
flattens worst).

**Beyond the backlog — 3 AI features**, none of the 150 items above: natural-
language schedule add, photo/schedule-image extraction, and a private data
assistant. "I have swimming 6-6:45pm every weekday, Sept 5 to Oct 25" or a
photo of a class schedule or a school's bell-times page turns into editable
drafts on the Activities page ("Add with AI", next to the existing manual
form — both stay available) — nothing saves until each draft is reviewed
and confirmed. A new pinned **Assistant** view answers questions grounded
only in that student's own data ("what classes do I have today", "do I have
time to hang out with friends today"); free-time gaps are computed from the
real schedule before the question ever reaches the model, rather than left
for it to get arithmetic wrong. All three run through Google's Gemini API
(`GEMINI_API_KEY`, a free key from AI Studio) via one small serverless
wrapper — no login, nothing written to Blobs, nothing kept beyond the
on-device chat log. Activities also picked up an optional real start/end
date (a season that's bounded in time, not just labeled "Fall"), which the
AI path uses and the manual form now exposes too.

---

## Functionality

### Grading & assessment

| ID | Update | Why | Size | |
|---|---|---|---|---|
| `F001` | **Standards-based grading mode** | Score against proficiency scales (1–4) instead of percentages — how a growing share of schools actually grade. | L |  |
| `F002` | **Rubric builder** | Attach a rubric to an assignment and score per criterion; the total flows into the grade book automatically. | M |  |
| `F003` | **Grade change history** | An audit trail per assignment, so a score that quietly changed is visible instead of mysterious. | S |  |
| `F004` | **Semester exam weighting** | Let a final count as a fixed share of the semester grade, separate from category weights. | M |  |
| `F005` | **Pass/fail and audit courses** | Exclude them from GPA while still tracking their work — currently every class is assumed graded. | S |  |
| `F006` | **Class percentile estimate** | Enter the class average a teacher announces and see roughly where you sit. | S |  |
| `F007` | **Nested grading periods** | Q1 and Q2 rolling into S1, each with its own weight, rather than one flat term. | L |  |
| `F008` | **Regrade request tracker** | Log a disputed score, what you asked for, and the outcome, with a reminder to follow up. | S |  |
| `F009` | **Category floors and caps** | Model syllabus rules like “homework cannot lower your grade more than 5 points.” | M |  |
| `F010` | **Transcript export** | A clean printable transcript across all archived terms — useful for applications and counselors. | M |  |
| `F011` | **AP/IB exam tracker** | Predicted and actual exam scores alongside course grades, with score-release countdowns. | S |  |
| `F012` | **Graduation requirement checklist** | Track credits by subject area against what your school requires to graduate. | M |  |

### Assignments & workflow

| ID | Update | Why | Size | |
|---|---|---|---|---|
| `F013` | **Subtask templates** | An essay always creates thesis → outline → draft → revise. Stop retyping the same checklist. | S |  |
| `F014` | **Assignment dependencies** | Mark that the draft blocks the final, so the planner never schedules them out of order. | M |  |
| `F015` | **Batch edit** | Select several assignments and change class, due date, or priority in one action. | M |  |
| `F016` | **Start-now button** | One tap from an assignment into a focus block already bound to it. | S |  |
| `F017` | **Start/stop time tracking** | Track real minutes per assignment directly, instead of inferring them from focus blocks. | M |  |
| `F018` | **Split a large project** | Break a project into linked parts that keep a shared parent and progress roll-up. | M |  |
| `F019` | **Snooze with a reason** | Defer something and record why — the reasons become a pattern worth seeing. | S |  |
| `F020` | **Submission checklist** | Track where each thing was turned in (Canvas, paper, email) so nothing is done-but-not-submitted. | S |  |
| `F021` | **Late penalty calculator** | Show exactly what turning something in a day late costs, before you decide to sleep. | M |  |
| `F022` | **Auto-archive finished work** | Move completed assignments out of the active list after a set period, keeping history searchable. | S |  |
| `F023` | **Link notes to assignments** | Attach a note directly to the work it belongs to, rather than filing it by class only. | S |  |
| `F024` | **Duplicate an assignment** | “Same as last week” in one click for anything recurring but not on a fixed schedule. | S |  |
| `F025` | **Effort vs. points view** | Sort by points per estimated minute to find the cheapest wins on a heavy week. | M |  |
| `F026` | **Group project sub-assignments** | Track which parts are yours versus a teammate's inside one project. | M |  |

### Study & learning

| ID | Update | Why | Size | |
|---|---|---|---|---|
| `F027` | **Cloze-deletion cards** | Fill-in-the-blank cards generated from a sentence — far better for definitions than front/back. | M |  |
| `F028` | **Image occlusion** | Hide labels on a diagram and reveal them one at a time. Essential for biology and anatomy. | L |  |
| `F029` | **Text-to-speech cards** | Hear pronunciation on language decks using the browser's speech synthesis. | S |  |
| `F030` | **Deck files** | Export and import decks as files, so decks move between people without an account. | S |  |
| `F031` | **Practice test mode** | A timed mixed-deck test with a score report, rather than untimed self-grading. | M |  |
| `F032` | **Interleaved practice** | Deliberately mix subjects in one session — it tests worse and learns better. | M |  |
| `F033` | **Session quality ratings** | Rate focus after each block; correlate it with time of day and location later. | S |  |
| `F034` | **Blurting mode** | Write everything you remember on a topic, then diff it against your notes. | M |  |
| `F035` | **Explain-it-simply prompts** | Prompt yourself to explain a concept plainly and flag where the explanation broke down. | S |  |
| `F036` | **Spaced repetition for notes** | Resurface notes on a schedule, not just flashcards — review beats rereading. | M |  |
| `F037` | **Formula sheet builder** | A per-class sheet of formulas that prints on one page for an open-note exam. | M |  |
| `F038` | **Vocabulary lists** | A lighter structure than decks for language classes, with an auto-generated quiz. | M |  |
| `F039` | **Concept maps** | Sketch relationships between ideas — some subjects are structural, not list-shaped. | L |  |
| `F040` | **Streak freezes** | Bank rest days so one sick weekend doesn't erase a two-month streak. | S |  |

### Time & scheduling

| ID | Update | Why | Size | |
|---|---|---|---|---|
| `F041` | **Bell schedule variants** | Assembly, early release, and exam-week schedules selectable per day instead of one fixed set. | M |  |
| `F042` | **Half-day and delayed-start handling** | Compress period times rather than treating an odd day as a normal one. | M |  |
| `F043` | **Passing time between buildings** | Factor walking time so back-to-back classes across campus aren't shown as adjacent. | S |  |
| `F044` | **Conflict resolution assistant** | When two things collide, propose what to move and what it costs. | M |  |
| `F045` | **Energy-aware scheduling** | Schedule hard work when session ratings say you're sharpest, not just when you're free. | L |  |
| `F046` | **Live calendar feed** | A subscribable URL that stays in sync, instead of a one-time .ics download. | M | server |
| `F047` | **Two-way Google Calendar sync** | Changes flow both directions, so the school calendar isn't a second place to check. | L | server |
| `F048` | **Recurring events** | Weekly club meetings and standing appointments, not just recurring assignments. | M |  |
| `F049` | **Countdowns to key dates** | Finals, AP exams, application deadlines — pinned and visible without opening a view. | S |  |
| `F050` | **Sleep logging** | Track bedtime and wake time; correlate with grades and focus quality. | M |  |
| `F051` | **Commute and bus times** | Know the last bus that still gets you to practice on time. | S |  |
| `F052` | **Time zones for online classes** | Correct times for a remote or dual-enrollment course in another zone. | M |  |

### Collaboration

| ID | Update | Why | Size | |
|---|---|---|---|---|
| `F053` | **Real friend requests** | Accept and decline, replacing locally-stored classmates that the other person never agreed to. | M | server |
| `F054` | **Shared project calendar** | One calendar for a group project with everyone's availability overlaid. | M | server |
| `F055` | **Group task assignment** | Assign project parts to members and see status without asking in a chat. | M | server |
| `F056` | **Accountability partners** | Opt in with one person who sees when you're falling behind — and vice versa. | M | server |
| `F057` | **Find a common free period** | Intersect group members' schedules to propose when everyone can actually meet. | M | server |
| `F058` | **Comments on feed posts** | Discuss a crowdsourced assignment inline instead of a separate group chat. | M | server |
| `F059` | **Teacher accounts** | Let a teacher post the authoritative assignment list, so the feed stops being guesswork. | L | server |
| `F060` | **Anonymous difficulty ratings** | Class-wide “how long did this actually take?” to calibrate everyone's estimates. | M | server |
| `F061` | **Peer tutoring board** | Offer and request help within a group, with subjects and availability. | M | server |
| `F062` | **Shared notes with attribution** | Contribute notes to a group set and keep credit for what you wrote. | M | server |
| `F063` | **Opt-in group challenges** | Collective study-hour goals — cooperative rather than a ranked leaderboard. | M | server |
| `F064` | **Group invite links** | Join by link as well as code, so sharing works over any messaging app. | S | server |

### Parent & guardian

| ID | Update | Why | Size | |
|---|---|---|---|---|
| `F065` | **Grade-drop alerts** | Notify a guardian only when something meaningful changes, instead of constant monitoring. | M | server |
| `F066` | **Weekly summary email** | A digest so a parent doesn't need to open the app to stay informed. | M | server |
| `F067` | **Multiple guardians** | Two parents, a stepparent, a counselor — each linked separately and revocable individually. | S | server |
| `F068` | **Check-in requests** | A parent asks, the student taps once to confirm they're okay. Less invasive than tracking. | M | server |
| `F069` | **Arrival and departure alerts** | Fire on geofence crossings rather than continuous position reporting. | M | server |
| `F070` | **Agreed focus windows** | A shared quiet period both sides agree to, with the student able to see and end it. | M | server |
| `F071` | **Notes from a guardian** | Leave a reminder the student sees in-app instead of a text they'll lose. | S | server |
| `F072` | **Emergency contact card** | Reachable offline, on the lock screen of the installed app. | S |  |

### Wellbeing

| ID | Update | Why | Size | |
|---|---|---|---|---|
| `F073` | **Mood and energy check-ins** | Thirty seconds a day; the value is the correlation with workload months later. | S |  |
| `F074` | **Burnout risk signal** | Combine workload, sleep, and study hours into an early warning, not a guilt trip. | M |  |
| `F075` | **Break reminders** | Nudge a stretch after long stretches of focus, respecting quiet hours. | S |  |
| `F076` | **Workload relief suggestions** | When a week is genuinely impossible, name what could be dropped or moved. | M |  |
| `F077` | **Screen time by section** | Show where app time actually goes — planning versus studying versus scrolling grades. | S |  |
| `F078` | **Reflection journal** | A short weekly written check-in, kept private and never shared with a parent. | S |  |
| `F079` | **Support resources card** | School counselor and crisis-line contacts, available offline and never behind a login. | S |  |
| `F080` | **Grade anxiety guardrails** | Optionally hide running GPA and show only per-assignment progress. | S |  |

### Insight & data

| ID | Update | Why | Size | |
|---|---|---|---|---|
| `F081` | **Search across everything** | One search over assignments, notes, events, contacts, and cards — the palette only covers titles. | M |  |
| `F082` | **Saved smart lists** | Save a filter combination as a named list you can return to. | S |  |
| `F083` | **Custom dashboard layout** | Choose and reorder the widgets on the home screen. | M |  |
| `F084` | **Guided weekly review** | A short Friday retrospective: what slipped, what's next, what to change. | M |  |
| `F085` | **Per-category forecasting** | Project each grading category separately — tests and homework rarely trend together. | M |  |
| `F086` | **Change detection** | Flag a real drop (“chemistry fell 8 points in two weeks”) rather than waiting for you to notice. | M |  |
| `F087` | **Best study time discovery** | Surface when your sessions actually go well, from your own logged data. | M |  |
| `F088` | **Term-over-term comparison** | Compare this term against your own past terms, not against other students. | M |  |
| `F089` | **CSV export for any table** | Every table exportable, so the data is never trapped in the app. | S |  |
| `F090` | **Retention controls** | Choose how long logs are kept and auto-purge the rest. | S |  |
| `F091` | **Pending-changes viewer** | See exactly what hasn't synced yet while offline, instead of trusting a status dot. | M | server |
| `F092` | **Device and session management** | See where you're signed in and revoke a device you no longer have. | M | server |

### Platform & integrations

| ID | Update | Why | Size | |
|---|---|---|---|---|
| `F093` | **Google Classroom sync** | Live OAuth sync rather than a manual file export each week. | L | server |
| `F094` | **Canvas API integration** | Pull assignments and grades directly with a personal access token. | L | server |
| `F095` | **Email capture** | Forward an assignment email to a personal address and have it parsed into a task. | L | server |
| `F096` | **Home screen widgets** | Next class and due-today counts on the phone home screen via the installed app. | M |  |
| `F097` | **Sign in with Google or Apple** | Fewer passwords, and a faster path onto a second device. | M | server |
| `F098` | **Account recovery** | Password reset by email — currently a forgotten password means a lost account. | M | server |
| `F099` | **Localization** | Translate the interface; date and number formatting already follow the locale. | L |  |
| `F100` | **Public API and webhooks** | Let a student who codes build on top of their own data. | L | server |

## Interface

### Navigation & structure

| ID | Update | Why | Size | |
|---|---|---|---|---|
| `U01` | **Collapsible sidebar** | Icon-only mode for narrow laptops, remembering the choice between sessions. | S |  |
| `U02` | **Pin and reorder nav items** | Put the four screens you actually use at the top. Twenty items is a lot to scan. | M |  |
| `U03` | **Recently visited** | A short list of where you just were, for hopping between two screens repeatedly. | S |  |
| `U04` | **Modal history** | Back button closes a dialog instead of leaving the app — the top mobile complaint about SPAs. | M |  |
| `U05` | **Mobile bottom bar** | Reach the five core screens with a thumb, instead of opening a drawer first. | M |  |
| `U06` | **Floating quick-add** | A persistent add button on mobile so capture is always one tap away. | S |  |
| `U07` | **Remembered section state** | Collapse nav groups you never use and have them stay collapsed. | S |  |
| `U08` | **Deep links to records** | Link straight to one assignment or class, so a shared link opens the right thing. | M |  |

### Visual system

| ID | Update | Why | Size | |
|---|---|---|---|---|
| `U09` | **Accent colour choice** | Let the interface accent be something other than indigo, independent of class colours. | S |  |
| `U10` | **Density setting** | Compact mode fits far more rows per screen for people who want the whole week visible. | M |  |
| `U11` | **Type size and dyslexia-friendly face** | A real accessibility need in a school product, not a preference toggle. | S |  |
| `U12` | **High-contrast theme** | Beyond dark mode — for low vision and for bright outdoor screens. | M |  |
| `U13` | **True-black theme** | Saves meaningful battery on OLED phones, which is most of them. | S |  |
| `U14` | **Class cover images** | Let a class card carry a picture, not just a colour bar. | M |  |
| `U15` | **Subject icons** | A second visual channel alongside colour, which matters for colour-blind users. | M |  |
| `U16` | **Drawn empty states** | Replace the emoji placeholders with real illustrations that set a tone. | M |  |
| `U17` | **Skeleton loading** | Show the shape of what's coming instead of the word “Loading”. | S |  |
| `U18` | **Considered micro-motion** | A checkbox that confirms, a bar that eases — restrained, and off under reduced-motion. | S |  |

### Interaction

| ID | Update | Why | Size | |
|---|---|---|---|---|
| `U19` | **Swipe actions** | Swipe to complete or snooze on mobile, the gesture every task app has trained people to expect. | M |  |
| `U20` | **Range selection** | Shift-click to select a run of rows, then act on all of them. | M |  |
| `U21` | **Context menus** | Right-click a row for its actions instead of opening it first. | M |  |
| `U22` | **Inline editing** | Click a due date in the list and change it there — no dialog for a one-field edit. | M |  |
| `U23` | **Reorderable subtasks** | Drag steps into the order you'll actually do them. | S |  |
| `U24` | **Keyboard list navigation** | j/k to move, Enter to open, x to select — for people who live on the keyboard. | M |  |
| `U25` | **Global undo** | Ctrl+Z across the app, not only the undo button on the delete toast. | L |  |
| `U26` | **Notification history** | A panel holding recent toasts, so a message you missed isn't gone forever. | S |  |
| `U27` | **Pull to refresh** | The expected gesture for re-syncing on a phone. | S |  |
| `U28` | **Long-press actions** | Quick actions on mobile without a visible menu button on every row. | M |  |
| `U29` | **Type-to-confirm deletes** | For genuinely destructive actions like clearing all data, make the confirmation deliberate. | S |  |
| `U30` | **Drag between views** | Drag an assignment onto a calendar day from anywhere, not only inside the week grid. | L |  |

### Information display

| ID | Update | Why | Size | |
|---|---|---|---|---|
| `U31` | **Configurable table columns** | Choose which columns show and sort by any of them. | M |  |
| `U32` | **Sticky table headers** | Keep headings visible while scrolling a long grade book. | S |  |
| `U33` | **Virtualised lists** | Keep scrolling smooth after a full year of assignments has piled up. | M |  |
| `U34` | **Chart crosshair tooltips** | Replace native title tooltips with a real hover layer showing the exact value. | M |  |
| `U35` | **Chart range brushing** | Drag to zoom into a stretch of the grade trend. | M |  |
| `U36` | **Print layouts per view** | A schedule you can actually pin to a wall, and a grade report a parent can read. | M |  |
| `U37` | **Compact today strip** | Next class and time remaining in the top bar, visible from every screen. | S |  |
| `U38` | **Progress rings on class cards** | See how much of a class's work is done without opening it. | S |  |
| `U39` | **Project timeline view** | A Gantt-style track for multi-week projects, which a list flattens badly. | L |  |
| `U40` | **Workload heat on the calendar** | Shade each day by how much is due, so a crunch week is visible at a glance. | M |  |

### Accessibility & onboarding

| ID | Update | Why | Size | |
|---|---|---|---|---|
| `U41` | **Full ARIA and live regions** | Announce toasts and state changes to screen readers instead of showing them silently. | M |  |
| `U42` | **Rigorous modal focus traps** | Tab must not escape a dialog, and focus must return where it started on close. | S |  |
| `U43` | **Chart text alternatives** | A screen-reader summary and a table view behind every chart. | M |  |
| `U44` | **Reduced-motion audit** | Honour the preference in every animation, including the timer ring and card flip. | S |  |
| `U45` | **Shortcut cheat sheet** | Press ? for an overlay, rather than hiding the shortcut list in settings. | S |  |
| `U46` | **Colour-blind preview** | Simulate the three common types in settings so a class colour choice can be checked. | M |  |
| `U47` | **Never colour alone** | Audit every status that currently reads as a colour and give it a shape or label too. | M |  |
| `U48` | **Larger mobile targets** | Hold every interactive element to 44px, which several icon buttons currently miss. | S |  |
| `U49` | **First-run setup** | Walk a new student through classes, bell schedule, and one assignment instead of a wall of demo data. | M |  |
| `U50` | **Contextual help** | Explain what a weighted category or a Leitner box is, at the moment it first appears. | M |  |
| `U51` | **Three clicks to anything** | Make a view's sections addressable, so a tabbed screen stops costing four taps on a phone. Measured by `tests/depth.mjs`. | S | ✅ |

