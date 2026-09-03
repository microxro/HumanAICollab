# StudyHold — a complete school tracker

A full student platform built with **plain HTML, CSS, and JavaScript** — no framework, no build step, no bundler — plus a small **Netlify Functions** backend for the things that genuinely need a server.

Twenty-three screens covering classes, homework, grades, scheduling, study tools, extracurriculars in and out of school, college applications, analytics, and a real parent portal with live GPS.

---

## Running it

### Static only (no accounts)

```bash
git clone https://github.com/microxro/HumanAI.git
cd HumanAI
python3 -m http.server 8000     # → http://localhost:8000
```

Everything except sync, the parent portal, and study groups works exactly like this — including GPS, notifications, and offline mode. Opening `index.html` straight off disk works too (the scripts are classic `<script>` tags, not ES modules, on purpose).

The app opens on a sign-in screen. Without a backend there is nothing to sign in *to*, so use **Continue without saving** — the whole app runs, in memory, for as long as the tab is open. Nothing is written to the browser without an account; see [Signed out, nothing is stored](#signed-out-nothing-is-stored).

### Full stack on Netlify

```bash
npm install
npx netlify dev                 # local, with functions
```

To deploy, connect the repo to Netlify and **set two required environment variables**:

| Variable | Value |
|---|---|
| `SCHOLAR_SECRET` | A long random string (≥16 chars). Used to sign session tokens, derive email lookup keys and hash API tokens at rest. |
| `SITE_URL` | This deploy's own origin, e.g. `https://yoursite.netlify.app`. Password-reset links are built from it, and it is the only origin allowed to call the API cross-site. |

```bash
# generate one
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Netlify Blobs needs no setup — it's provisioned automatically. The API refuses to issue tokens if `SCHOLAR_SECRET` is missing rather than falling back to a guessable default.

**Optional — email** (password reset, and the weekly parent digest). Without these set, both features log a skip instead of erroring — the rest of the app works exactly the same either way.

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | From [resend.com](https://resend.com) → API Keys. |
| `EMAIL_FROM` | An address on a domain you've **verified** in Resend (Domains → Add Domain). Falls back to `onboarding@resend.dev`, which is fine for testing but gets flagged by real inboxes — don't ship with it. |

The weekly digest (`netlify/functions/weekly-digest.js`) runs on Netlify's scheduler — no extra setup, but you can change the cron expression at the bottom of that file if Monday 13:00 UTC isn't the right time for your users.

**Add from a link.** Paste the URL of a page — your school's bell schedule,
its calendar, an athletics or exam timetable, the course catalogue — and the
server reads it and turns it into schedule periods, calendar events or a
course list, with an **Add all** button and a per-row review before anything
is saved. The fetch happens server-side because a school website sends no CORS
headers to this origin, and because a pasted URL is screened against private
and link-local addresses before anything requests it (`_lib/urlguard.js`).
Needs `GEMINI_API_KEY`; pages behind a school login can't be read.

**Guidance.** A view that reads your grades, study time, assessment-category
performance, activities and stated interests, and ranks electives and fields
of study against them. It runs entirely in the browser — no API key, nothing
sent anywhere — and every recommendation shows the numbers behind it. It needs
no setup; it gets more useful as there is more in the app to read.

**Optional — operator diagnostics.**

| Variable | Value |
|---|---|
| `ADMIN_EMAIL` | The address of the account that runs this deploy. |

`/api/email-health` and `/assistant/health` report configuration — the sending
address, the key's length and shape, the model in use, and the provider's own
rejection text. That is useful to whoever runs the deploy and is free
reconnaissance for anyone else, and once the app is public "has an account" is
not a meaningful privilege. With `ADMIN_EMAIL` set, that account sees the full
report; every other signed-in account sees only whether the feature is on. With
it unset, nobody sees the detail — including you, so set it before you need to
debug email or the assistant.

**Optional — AI features** ("Add with AI" on the Activities page, and the private Assistant chat). Without a key set, both show a plain "AI assistant isn't set up yet" message instead of erroring — manual entry works exactly the same either way, and nothing about this is required to use the rest of the app.

| Variable | Value |
|---|---|
| `GEMINI_API_KEY` | Free from [Google AI Studio](https://aistudio.google.com/apikey) — sign in with any Google account, no card required. Stays inside Google's free quota for personal/family use. |
| `GEMINI_MODEL` | Optional. Defaults to `gemini-3.7-flash`. Override if Google renames or retires that model. |

**If the AI features aren't working**, don't guess — open **Settings → Data → AI service**. It reports whether the key is actually visible to the deployed function, how long it is, whether it has stray whitespace, and which model is in use. **Test connection** makes a real round-trip and shows Google's own error message (invalid key, unknown model, quota) rather than a generic failure. The single most common cause is setting the variable in Netlify but not redeploying afterwards — environment variables are baked in at deploy time.

These features (`netlify/functions/assistant.js`, `netlify/functions/_lib/gemini.js`) are stateless and anonymous — no login required, nothing is written to Blobs, and each request only ever contains what that one call needs: the text or photo being parsed, or (for the Assistant) a full digest of *your own* account — classes, grades, assignments, activities, goals, habits, reading, attendance, bell schedule, 14 days of schedule and precomputed free-time blocks — built fresh on your device for that one question. Nothing about any other student is ever in scope, and nothing lingers between questions beyond the on-device chat log (Settings has no separate control for it yet — "Clear conversation" on the Assistant page clears it). The Assistant's system prompt keeps it on-topic — schedule/app questions only, short answers only — and the server also hard-caps how long a reply can be, so it can't be talked into writing something else even if the prompt alone were ignored. It respects the existing "hide GPA" wellbeing setting: grade fields go to the model as `null`, not the real number, when that's turned on.

The photo path (a schedule screenshot or a photo of the school's bell-times page) is resized to at most 1600px client-side before it's sent, to keep it well under Gemini's free-tier limits. Every AI result — from text or from a photo — lands in an editable review list before anything is saved; nothing is written to your data without you clicking "Add".

---

## What's in it

### Overview
- **Assistant** *(needs `GEMINI_API_KEY`)* — a private chat grounded in your full account: every class, grade, assignment, activity, goal, habit, book, and the bell schedule, all rebuilt fresh for each question. Scoped on purpose: it only answers questions about that data or about how to use StudyHold itself — it declines anything else (essays, homework, general chit-chat) in a sentence rather than attempting it — and every answer is capped short, a few sentences at most, never an essay of its own. Free-time gaps are precomputed from your real schedule rather than left for the model to guess at.
- **Dashboard** — live "what class am I in right now" with a countdown and progress bar, proactive overload warnings, today's schedule, due-soon queue, GPA / study / attendance tiles, grade trend, study heatmap.
- **Calendar** — month, **week time-grid**, and agenda views. Classes, activities, events, due dates, and planned study blocks in one place. Drag a study block to another day. Export to `.ics`.
- **Schedule** — weekly timetable, or a **rotating A/B (or A/B/C/D) cycle** with holiday overrides and per-day exceptions.
- **Planner** — an **earliest-deadline-first auto-scheduler** that reads your real free time (after classes and practice), splits work into sessions, and tells you what *won't* fit before its deadline.

### Academics
- **Homework** — **natural-language quick add** (`calc pset due friday high 45m 50pts` parses into a structured assignment, showing you what it understood first), list *and* drag-and-drop kanban, checklists, priorities, filters, search.
- **Classes** — CRUD with weighted grading categories, **file attachments** (syllabi, rubrics, photos) in IndexedDB, and per-class colors used consistently everywhere. A class does **not** have to sit in the bell schedule: an extracurricular that assigns homework — a robotics team, a Saturday academy, a dual-enrollment course — carries its own start and end times instead of a period, keeps a full grade book, and appears on the timetable in its own row and in the day-by-day agenda.
- **Grades** — weighted grade book with **drop-lowest / curve / extra-credit rules**, weighted & unweighted GPA, **cumulative GPA across terms**, trend charts with **least-squares end-of-term projection**, a per-assignment what-if calculator, a **"what do I need on everything that's left"** target planner, and a **missing-work tracker** that shows how many points each zero costs and drafts the email to your teacher.

### Study
- **Focus timer** — Pomodoro with configurable rounds, a Custom length, progress ring, and auto-logging to a class. The alarm is a real alarm: a repeated multi-note pattern through one audio session that's opened on a user gesture (browsers start an AudioContext suspended otherwise, which is exactly how a timer ends up ringing silently), with vibration alongside, eight selectable voices, a volume control, and a choice about whether quiet hours mute it or just turn it down.
- **Flashcards** — Leitner spaced repetition, plus **multiple-choice and type-the-answer quiz modes** with forgiving answer matching.
- **Notes** — **Markdown** editor with live preview, and **one-click note → flashcard deck** extraction from "term — definition" lines.
- **Reading** — books and chapter assignments with pages-per-day pacing and behind/ahead detection.
- **Study shop** — earn **study tokens** exactly one way: by **answering a quiz on a topic you choose**. You name what you studied, pick a difficulty, the model writes five questions about it, and the score decides the payout. Nothing else pays — not a finished assignment, not a streak day, not the focus timer. Spend them across four tiers — **Common, Rare, Ultra and Elite**, the top of which runs to 1000 tokens — on accent colours, surface skins, an avatar ring, a nameplate under your name, the focus timer's alarm voice, streak freezes and timed earning multipliers. Only the topic ever leaves the device, the economy is built so the obvious shortcuts don't pay (see below), nothing costs money, and no feature that was free moved behind it.

### Life
- **Activities** — practices, clubs, and volunteering with hour logging. Optionally date-bounded (a season that starts and ends on real dates, not just "Fall"). **"Add with AI"** *(needs `GEMINI_API_KEY`)* turns a plain-English description ("swimming 6-6:45pm weekdays, Sept 5 to Oct 25") or a photo of a schedule or bell-times page into editable drafts — nothing saves until you review and confirm each one.
- **Outside school** — the half of the week a school tracker usually ignores: music lessons, a club team, a language school, tutoring, a dojo, a weekend coding class. Each carries who runs it, the instructor and how to reach them, an address, and what it costs (per session / week / month / term / year, or one-off), rolled up into a monthly figure. They are not bound to the school calendar, so a Saturday squad session and a lesson in the holidays both show up on the schedule where a school club correctly doesn't. **A parent can add one from the parent portal** — it arrives as a suggestion the student adds or dismisses, so the portal stays read-only.
- **Goals & habits** — goals that auto-track from live data (GPA, service hours, study minutes), habit streaks, attendance.
- **Applications** — college and scholarship tracker with deadlines, essay status, recommendation-letter tracking, and a **pre-written recommendation request email**.
- **Contacts** — teacher directory with office hours and one-tap pre-filled email.

### Connect *(needs an account — and none of it is required)*

A student account stands on its own. Classes, homework, grades, schedule, extracurriculars, focus timer **and focus windows**, notes to yourself, flashcards, goals, applications and the token shop are all fully create/read/write with no linked parent and no linked teacher. Linking only adds what someone *else* can see.

(Every one of those features also runs with no account at all — but only for the life of the tab. Keeping anything between visits is what an account is for; see below.)

- **Sharing** — privacy toggles, a live preview of exactly what a parent sees, focus windows you set for yourself (or agree to when a guardian proposes one), and notes you leave yourself.
- **Study groups** — shared flashcard decks and a **crowdsourced "what was the homework?" feed** with confirmations, one tap to add a post to your own homework list.
- **Parent portal** — link with a single-use code, then see live status, screen time, attendance, upcoming work, outside-school activities and what they cost, and (if shared) grades. Parents can also **suggest an outside-school activity**, which the student confirms in their own app.

### Everywhere
- **Guided tour on first open** — the app walks itself, one screen per step, spotlighting the real control it is talking about. Skippable from every step with a button, the ✕ or Escape; one dismissal is permanent, and Settings → Getting started (or the command palette) replays it. A first-run setup wizard for adding your first class, bell schedule and assignment is offered at the end of it.
- **Command palette** (`⌘K`) over every screen, assignment, class, note, and contact.
- **Browser reminders** — before class, before deadlines, an overdue nudge, and a morning digest, with quiet hours.
- **PWA** — installable, works fully offline via a service worker.
- **Import** from Canvas / Google Classroom / Infinite Campus (`.ics` and `.csv`), with a preview-and-pick step.
- **Undo on every delete**, plus a trash bin in Settings.
- Dark mode, keyboard shortcuts, responsive to phone width, print stylesheet.

---

## Study tokens, and what stops them being free

Tokens arrive exactly one way: **name the topic you studied, pick a
difficulty, and answer five questions about it**. Spend them on accents,
skins, avatar rings, nameplates, alarm voices, streak freezes and earning
multipliers, across four tiers.

An assignment marked done, a streak day, a deck reviewed, pages read, a habit
ticked, a goal reached and a focus block finished all used to pay as well.
None of them do now. Each was defensible alone, and together they were most of
the economy — earned by pressing buttons in an app rather than by knowing
anything. One route means one rate card, one thing to be good at, and a
balance that means the same thing however you got there.

**The streak pays in chests instead.** Every seventh day drops a gem chest
with a rarity — Common, Rare, Ultra or Elite, the same bands the shop is
priced in — holding one item of that rarity. Never tokens: a chest that paid
currency would be a second way to mint one. The odds improve the longer the
streak runs (a first week is 70/25/5/0 and cannot be Elite; past two months
it is 25/35/28/12), every eighth chest is at least Ultra, and **the odds are
printed on the card before you open it**. A week can only ever pay once,
however many times the app is reloaded.

The interesting part is that **nothing here can prove a student studied** —
answering five questions is evidence you know the material, not evidence of an
evening's work, and the wallet lives in the browser where anyone determined
enough can edit it. Pretending otherwise would be the dishonest version of this
feature.

So the guarantee is narrower and actually true: the obvious ways to farm the
number don't work, and the app says why out loud when it refuses one.

| What someone tries | What happens |
|---|---|
| Naming a topic that isn't school material | Refused. The model decides whether a topic is quizzable before it writes anything, and the refusal says why. |
| Naming a topic without studying it | Pays nothing. The questions are written after the topic is named and are about the substance of it — the dates, terms, steps and numbers — so a topic you never read is a topic you can't answer about. |
| Reading the answers out of the network tab | Not there. The key is held server-side behind a signed ticket, and the marking happens there too. |
| Answering wrong, seeing which ones were wrong, and trying again | Refused. A ticket is marked exactly once. A retake from the shop buys a *fresh* set of questions, not a second go at the same ones. |
| Grinding the one topic you know best | Pays less each time: full the first time that day, half the second, nothing after that. A different topic always pays full. |
| Picking "easy" every time | Pays 0.75×, where hard pays 1.25×. Easy is a choice with a price. |
| Deleting the quiz log to reset the repeat rule | Refused. The day's per-topic tally and the first-of-the-day flag live on the wallet, not in the log a student can delete. |
| A stack of quizzes in one sitting | Refused after the first. There is a 10-minute cooldown between quizzes. |
| Claiming nine hours for one quiz | There is nothing to claim. The only minutes recorded are the wall time between the questions appearing and the answers going back. |
| Grinding all day | Capped at 250 tokens a day *from quizzes*. Past the cap a quiz still saves — it just doesn't pay. |
| Marking an assignment done, reopening it, marking it done again | Pays nothing either way. Finishing work is tracked; it is not currency. |
| Starting a focus block and walking away | Pays nothing at all. A running timer is not studying, and paying by the minute for one rewarded exactly that. |
| Finding another route — a streak day, a reviewed deck, a ticked habit | There isn't one. The shop no longer hands any other module a way to pay: tokens are minted in one function, for a quiz the server marked. |
| Reloading on day 7 for a second chest | Refused. The highest streak week already granted is recorded on the wallet, so seven days pay one chest however many times the app is opened — and a chest holds an item, never tokens. |

Full marks pays 100, most of them 50, half 25; under half pays nothing. That is
at medium difficulty — easy is ×0.75 and hard ×1.25 — plus 25 for the first
quiz of the day. When the AI can't be reached — offline, signed out, no API key
— there is no quiz and therefore no payout, because an unverified route to
tokens is the hole this closes.

A quiz that took real minutes to answer also writes a study session, so the
time shows up in the study heatmap, the weekly total and any study goal,
exactly like a completed focus block does.

A bought **boost** is the one thing that moves those numbers: it multiplies
what a quiz pays *and* raises the day's ceiling with it, because a multiplier
under a fixed cap doesn't double a day's earnings — it just reaches the same
ceiling sooner, which is not what the item says on the card.

Three of the Common-tier items exist for the quiz rather than for looks, and
they wait in the wallet until you choose to spend one: a **50/50** takes two
options off a question you're stuck on, a **cooldown skip** starts the next
quiz straight away, and a **retake** buys a fresh set of questions on a topic
you just failed. None of them raise the daily cap.

The four tiers are **Common** (150–200), **Rare** (300–450), **Ultra**
(500–750) and **Elite** (800–1000). Prices and earn rates were multiplied by 25
together when the tiers were introduced, which changes no ratio and no
attainability — and any wallet written before that is redenominated by the same
factor, once, so nobody's balance lost value overnight.

**And what the guards can't do**, said plainly rather than left to be
discovered: they can't tell whether the person answering is the person who
studied, whether a friend is reading the answers over their shoulder, or
whether the topic was revised today or last term. The device clock belongs to
whoever holds the device. This is a habit tracker a student keeps honest for
their own benefit — a number to beat, not a grade, and not something to hand a
teacher as evidence. The one thing worth noting: the wallet syncs with the rest
of the account, so a topic already paid for on a phone is already paid for on
the laptop.

The only thing that leaves the device is the topic you type, and only so
questions can be written about it. The rest of the economy (`js/shop.js`) runs
in the browser; no score is shared with anyone. Study photos from the older
route stay in IndexedDB until the retention window drops them, and nothing new
is written there.

**The cosmetics keep the app readable.** Every purchasable accent's text colour
clears 4.5:1 on all four surfaces in both themes. Every skin is a *re-tint at
matched luminance*: each surface colour was mixed toward a hue and then scaled
back to the relative luminance of the colour it replaces, so every contrast
ratio in the app is arithmetically what it was before — a skin changes the
temperature of the screen, not its legibility. `tests/shop.mjs` asserts both
against `css/theme.css`, so a future hand-picked hex can't quietly undo it.

---

## How the GPS actually works

This was the hardest thing to get honest, so it's worth being explicit.

- **Presence** comes from a **campus geofence**: you stand at school once and tap "set campus to my location." The app stores that point and a radius, and uses `watchPosition` + a haversine distance check to decide on-campus vs off-campus. GPS error is added as slack, but capped — a 2 km-accurate fix can't "arrive" everywhere.
- **Identity** — *which* class you're in — comes from your **timetable**, not GPS. A consumer GPS fix is 5–20 m at best; Room 204 and Room 206 are three metres apart. Anyone claiming to detect the room from GPS is guessing.
- **Named places** (gym, library, main entrance) are optional finer-grained fences for a more specific answer than on/off campus.
- **The parent sees the resolved status**, pushed on a throttled interval (default 60 s), with the accuracy and the age of the fix shown. If the student's app is closed, the parent portal says so instead of showing a stale position as current.
- **This is a web app, not a background tracker.** Location only updates while a tab is open. That's a real limitation and the UI states it plainly rather than implying continuous surveillance.
- Every part of it is behind a toggle the student controls.

---

## Architecture

```
index.html              App shell
manifest.webmanifest    PWA manifest
sw.js                   Service worker (offline shell; never caches /api)
netlify.toml            Build + headers config

css/
  theme.css             Tokens, dark mode, reset
  layout.css            Shell, sidebar, responsive grids
  components.css        Buttons, cards, forms, modals, toasts, tables
  views.css             Timetable, calendar, week grid, kanban, charts, markdown

js/
  utils.js              Dates, times, formatting, DOM, grade math
  store.js              Data model, migration, persistence, all selectors
  ui.js                 Modals, toasts, confirms, undo, shared fragments
  charts.js             Dependency-free SVG charts
  md.js                 Markdown renderer + note→flashcard extraction
  nlp.js                Natural-language assignment parser
  ics.js                iCalendar export, ICS/CSV import
  idb.js                IndexedDB attachment storage
  notify.js             Reminder scheduler
  geo.js                Geolocation, geofencing, live status
  sound.js              The focus alarm: one gesture-unlocked audio session
  shop.js               Token economy, the four-tier catalogue, topic quizzes
  sync.js               Account, cloud sync, groups, parent link client
  planner.js            Auto-scheduler, estimate calibration, overload detection
  app.js                Router, nav, command palette, shortcuts, boot
  views/                One module per screen (23)

netlify/functions/
  api.js                Whole backend, one function, path-routed
  assistant.js           AI: schedule parsing (text/photo), private assistant Q&A
  weekly-digest.js        Scheduled function — F066 parent email digest
  _lib/auth.js          PBKDF2 hashing, HMAC session tokens
  _lib/blobs.js         Netlify Blobs helpers
  _lib/email.js          Resend wrapper
  _lib/gemini.js          Gemini API wrapper (text + vision)
```

Each view exposes `render()` → HTML string and `mount(root)` → wire events. The store publishes changes; the router repaints into a **fresh container** each time (a persistent node would accumulate one set of delegated listeners per render, and stale handlers from other views would swallow clicks).

### Security notes

- Passwords: PBKDF2-SHA256, 210k iterations, 16-byte per-user salt.
- Sessions: HMAC-SHA256 signed tokens with a 30-day expiry, verified on every request.
- Login is rate-limited per account (8 failures → 15-minute lockout) and returns an identical response for unknown emails and wrong passwords, so it can't be used to enumerate accounts.
- Every cross-user read (a parent reading a child's location, a member reading a group) checks an explicit link or membership first.
- Sync uses optimistic concurrency — a stale write gets a 409 with the server copy, and the user chooses, rather than silently clobbering another device.

### Charts and color

The categorical palette is **validated for colorblind separation and contrast in both themes** — eight hues in a fixed order, with dark-mode steps chosen for the dark surface rather than auto-flipped. Class colors double as chart colors, and every per-class breakdown is direct-labeled so identity never rests on color alone. Magnitude encodings use a single blue ramp.

---

## Testing

Verified end-to-end in Chromium via Playwright: all 23 views render with zero console errors, and the feature suite covers natural-language parsing, plan generation and application, the week grid, quiz mode, markdown and card extraction, the grade target planner and rules editor, reading progress, college app details, **live GPS with a simulated position and geofence**, rotating-schedule switching, undo/restore, and `.ics` export. `tests/shop.mjs` covers the four newest
pieces specifically: a student working with no linked parent or teacher, classes that meet outside the
bell schedule, the timer's Custom segment and its alarm (including that the audio session is actually
running when it fires), and the token shop's tiers, prices and purchase effects.

## Browser support

Any modern browser. Uses localStorage, IndexedDB, Geolocation, Notifications, Service Workers, Page Visibility, CSS grid, and custom properties — all degrading gracefully when unavailable.

## Signed out, nothing is stored

The sign-in screen (`js/authgate.js`) is the first thing that loads, and it is
not a formality: until there is a session, `js/store.js` will not write to
this browser at all.

- **A first visit** gets the login screen over a blank shell. Neither the
  guided tour nor the setup wizard runs behind it — both wait until there is
  an app to walk through — and nothing is written.
- **Data found with no session** — a previous student's records on a shared
  laptop, or a payload somebody planted — is erased on load rather than
  displayed or migrated. localStorage is swept by prefix; attachments in
  IndexedDB go too.
- **Continue without saving** runs the entire app in memory, with a standing
  banner saying so. A refresh returns to the login screen with nothing kept.
- **Signing in** is what turns device storage on, and the guided tour starts
  on the far side of it. From there the app behaves as it always did:
  local-first writes, debounced background sync, usable offline.
- **Signing out** pushes anything still queued to the account, then clears the
  device — localStorage, IndexedDB and the in-memory copy. Your work is in
  your account, not on the machine you borrowed.
- **A token the server has retired** takes the same path automatically: the
  next request gets a 401, the device is cleared, and the login screen comes
  back saying why.

`tests/gate.mjs` drives every one of those in a real browser, including the
two cases worth being paranoid about — data on disk with no session, and a
session the server no longer honours.
