# Scholar — a complete school tracker

A full student platform built with **plain HTML, CSS, and JavaScript** — no framework, no build step, no bundler — plus a small **Netlify Functions** backend for the things that genuinely need a server.

Twenty screens covering classes, homework, grades, scheduling, study tools, extracurriculars, college applications, analytics, and a real parent portal with live GPS.

---

## Running it

### Static only (no accounts)

```bash
git clone https://github.com/microxro/HumanAI.git
cd HumanAI
python3 -m http.server 8000     # → http://localhost:8000
```

Everything except sync, the parent portal, and study groups works exactly like this — including GPS, notifications, and offline mode. Opening `index.html` straight off disk works too (the scripts are classic `<script>` tags, not ES modules, on purpose).

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
- **Assistant** *(needs `GEMINI_API_KEY`)* — a private chat grounded in your full account: every class, grade, assignment, activity, goal, habit, book, and the bell schedule, all rebuilt fresh for each question. Scoped on purpose: it only answers questions about that data or about how to use Scholar itself — it declines anything else (essays, homework, general chit-chat) in a sentence rather than attempting it — and every answer is capped short, a few sentences at most, never an essay of its own. Free-time gaps are precomputed from your real schedule rather than left for the model to guess at.
- **Dashboard** — live "what class am I in right now" with a countdown and progress bar, proactive overload warnings, today's schedule, due-soon queue, GPA / study / attendance tiles, grade trend, study heatmap.
- **Calendar** — month, **week time-grid**, and agenda views. Classes, activities, events, due dates, and planned study blocks in one place. Drag a study block to another day. Export to `.ics`.
- **Schedule** — weekly timetable, or a **rotating A/B (or A/B/C/D) cycle** with holiday overrides and per-day exceptions.
- **Planner** — an **earliest-deadline-first auto-scheduler** that reads your real free time (after classes and practice), splits work into sessions, and tells you what *won't* fit before its deadline.

### Academics
- **Homework** — **natural-language quick add** (`calc pset due friday high 45m 50pts` parses into a structured assignment, showing you what it understood first), list *and* drag-and-drop kanban, checklists, priorities, filters, search.
- **Classes** — CRUD with weighted grading categories, **file attachments** (syllabi, rubrics, photos) in IndexedDB, and per-class colors used consistently everywhere.
- **Grades** — weighted grade book with **drop-lowest / curve / extra-credit rules**, weighted & unweighted GPA, **cumulative GPA across terms**, trend charts with **least-squares end-of-term projection**, a per-assignment what-if calculator, a **"what do I need on everything that's left"** target planner, and a **missing-work tracker** that shows how many points each zero costs and drafts the email to your teacher.

### Study
- **Focus timer** — Pomodoro with configurable rounds, progress ring, WebAudio chime, auto-logging to a class.
- **Flashcards** — Leitner spaced repetition, plus **multiple-choice and type-the-answer quiz modes** with forgiving answer matching.
- **Notes** — **Markdown** editor with live preview, and **one-click note → flashcard deck** extraction from "term — definition" lines.
- **Reading** — books and chapter assignments with pages-per-day pacing and behind/ahead detection.

### Life
- **Activities** — practices, clubs, and volunteering with hour logging. Optionally date-bounded (a season that starts and ends on real dates, not just "Fall"). **"Add with AI"** *(needs `GEMINI_API_KEY`)* turns a plain-English description ("swimming 6-6:45pm weekdays, Sept 5 to Oct 25") or a photo of a schedule or bell-times page into editable drafts — nothing saves until you review and confirm each one.
- **Goals & habits** — goals that auto-track from live data (GPA, service hours, study minutes), habit streaks, attendance.
- **Applications** — college and scholarship tracker with deadlines, essay status, recommendation-letter tracking, and a **pre-written recommendation request email**.
- **Contacts** — teacher directory with office hours and one-tap pre-filled email.

### Connect *(needs an account)*
- **Sharing** — privacy toggles and a live preview of exactly what a parent sees.
- **Study groups** — shared flashcard decks and a **crowdsourced "what was the homework?" feed** with confirmations, one tap to add a post to your own homework list.
- **Parent portal** — link with a single-use code, then see live status, screen time, attendance, upcoming work, and (if shared) grades.

### Everywhere
- **Command palette** (`⌘K`) over every screen, assignment, class, note, and contact.
- **Browser reminders** — before class, before deadlines, an overdue nudge, and a morning digest, with quiet hours.
- **PWA** — installable, works fully offline via a service worker.
- **Import** from Canvas / Google Classroom / Infinite Campus (`.ics` and `.csv`), with a preview-and-pick step.
- **Undo on every delete**, plus a trash bin in Settings.
- Dark mode, keyboard shortcuts, responsive to phone width, print stylesheet.

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
  sync.js               Account, cloud sync, groups, parent link client
  planner.js            Auto-scheduler, estimate calibration, overload detection
  app.js                Router, nav, command palette, shortcuts, boot
  views/                One module per screen (20)

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

Verified end-to-end in Chromium via Playwright: all 20 views render with zero console errors, and the feature suite covers natural-language parsing, plan generation and application, the week grid, quiz mode, markdown and card extraction, the grade target planner and rules editor, reading progress, college app details, **live GPS with a simulated position and geofence**, rotating-schedule switching, undo/restore, and `.ics` export.

## Browser support

Any modern browser. Uses localStorage, IndexedDB, Geolocation, Notifications, Service Workers, Page Visibility, CSS grid, and custom properties — all degrading gracefully when unavailable.
