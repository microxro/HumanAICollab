# Scholar — proposed updates

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

**Functionality — 86 of 100 shipped.** F001–F045 and F048–F052 (grading,
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

**Not attempted — 14 items**, still genuinely blocked on infrastructure
this sandbox doesn't have or deprioritized as large, narrow-value backend
surface: F047 (two-way calendar sync — needs a deployed backend to verify
against), F054–F056, F057, F059, F061–F063 (deeper group features — task
assignment, common free period, peer tutoring, attributed notes,
challenges — each needs new cross-member data sharing beyond what groups
currently sync), F095 (inbound email parsing needs a different provider
than the outbound one F066/F098 use — deprioritized on its own), F093,
F094, F097 (real OAuth credentials for Google/Canvas — none exist in this
environment), F100 (a public API + webhooks is its own project: token
issuance, a documented read surface, delivery retries — sized **L** for a
reason).

**Interface — 47 of 50 shipped**, all with zero visual redesign — every new
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

**Not attempted — 3 items**: U14 (class cover images — real asset work,
deliberately left for a design decision rather than guessed at), and U30,
U39 (drag assignments onto any calendar view from anywhere, and a
Gantt-style project timeline — both sized **L**, each closer to its own
feature than an afternoon's addition).

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

