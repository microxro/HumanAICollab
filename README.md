# Scholar — a complete school tracker

A full student dashboard built with **plain HTML, CSS, and JavaScript**. No frameworks, no build step, no dependencies, no backend — clone it and open `index.html`.

Fifteen screens covering classes, homework, grades, schedule, calendar, extracurriculars, study tools, analytics, and parent/peer sharing.

---

## Running it

**Easiest:** enable GitHub Pages on this repo (Settings → Pages → deploy from this branch) and open the URL.

**Locally:**

```bash
git clone https://github.com/microxro/HumanAI.git
cd HumanAI
python3 -m http.server 8000     # then open http://localhost:8000
```

Opening `index.html` directly from the filesystem works too — the scripts are plain `<script>` tags, not ES modules, specifically so `file://` doesn't break.

The app seeds itself with a realistic sample school year on first load, so every screen has data immediately. Wipe it any time from **Settings → Restore demo data / Clear everything**.

---

## What's in it

### Overview
- **Dashboard** — a live "what class am I in right now" hero with a countdown and progress bar, today's full schedule, due-soon queue with inline checkboxes, GPA / study / attendance stat tiles, grade trend, and a 4-week study heatmap.
- **Calendar** — month grid and agenda views. Classes, events, practices, and assignment due dates merge into one calendar; click any day to see and edit everything on it.
- **Schedule** — weekly timetable built from an editable bell schedule, with the current period highlighted, plus a day-by-day breakdown.

### Academics
- **Homework** — list *and* drag-and-drop kanban board (To do / In progress / Review / Done). Per-assignment checklists with progress bars, priorities, time estimates, type, points, notes. Filter by class, status, overdue, or due-this-week; sort by due date, priority, class, or points; full-text search.
- **Classes** — CRUD for classes with teacher, room, period, meeting days, credits, and color. Each class has editable **weighted grading categories** (Tests 40%, Homework 30%, …) and a detail view with a category breakdown and full assignment history.
- **Grades** — a real grade book. Weighted category math, letter grades, **weighted and unweighted GPA**, cumulative trend charts per class or overall, a "waiting on a score" queue, and a **what-if calculator** that binary-searches the exact score you need on an upcoming assignment to hit a target class grade.

### Study
- **Focus timer** — a working Pomodoro with configurable focus/break lengths and rounds, a progress ring, an audio chime (WebAudio, no asset files), and automatic logging of completed blocks to the class you picked. Keeps running while you browse other tabs.
- **Flashcards** — decks with a **Leitner box spaced-repetition system** (5 boxes, intervals 0/1/3/7/16 days). Study mode with 3D card flip, keyboard grading, "cram all" mode, bulk card import, and per-deck mastery tracking.
- **Notes** — a searchable notebook with per-class assignment, tags, and pinning.

### Life
- **Activities** — extracurriculars with practice days/times, advisor, role, and season, plus an **hour log** (useful for college applications and service-hour requirements).
- **Goals & habits** — goals that *auto-track* from live data (GPA, total activity hours, weekly study minutes) or manually; a habit grid with streak counting; and attendance tracking with a rate ring and per-class absence breakdown.
- **Contacts** — teacher directory with office hours, rooms, phone, notes, and one-tap email that pre-fills a subject line and signature.

### More
- **Analytics** — completion rate, study-time trends, a **14-day workload forecast** (which day is about to crush you, from your own time estimates), effort-vs-outcome by class, assignment type mix, and consistency stats.
- **Sharing** — privacy toggles and a live preview of exactly what a parent or classmate would see (see the honesty note below).
- **Settings** — profile, preferences, dark mode, JSON export/import, print view, and data reset.

### Throughout
- **Command palette** (`⌘K` / `Ctrl+K`) — fuzzy jump to any screen, assignment, class, note, or contact, plus quick actions.
- **Keyboard shortcuts** — `G`+`D/H/C/G/S/F/N/A`, `N` for new assignment, `T` for theme, `Space` to flip a flashcard, `Esc` to close.
- **Dark mode**, responsive down to phone width with an off-canvas drawer, and a print stylesheet.

---

## Honest note on location sharing

The original ask included parents seeing a student's live location and app usage from their own device. **That genuinely requires a server, accounts, and a database** — a static site can't push data between two people's phones, and no amount of client-side code changes that.

Rather than fake it, this build does the honest version:

- The **Sharing** screen previews exactly what a parent *would* see under your current toggles — live class status, app usage chart, upcoming work, attendance summary.
- **Location** uses the real browser Geolocation API (with permission) as a confirmation check, but the "which class am I in" status is derived from your timetable and the current time — which is how it should work anyway, since GPS can't tell Room 204 from Room 206.
- **App usage** is genuinely measured, via the Page Visibility API, for the current browser.
- **Peer matching** stores classmates locally so you can see how shared-class detection works.

Everything lives in `localStorage`. Nothing is transmitted anywhere. A production version would keep this exact front end and swap `js/store.js` for API calls.

---

## Project structure

```
index.html            App shell — sidebar, topbar, script tags

css/
  theme.css           Design tokens, dark mode, reset, utilities
  layout.css          App shell, sidebar, topbar, responsive grids
  components.css      Buttons, cards, forms, modals, toasts, tables, tabs
  views.css           Timetable, calendar, kanban, charts, flashcards, habits

js/
  utils.js            Dates, times, formatting, DOM helpers, grade math
  store.js            Data model, localStorage persistence, seed data, selectors
  ui.js               Modals, toasts, confirms, shared render fragments
  charts.js           Dependency-free SVG charts (line, bar, heatmap, ring)
  app.js              Router, navigation, command palette, shortcuts, boot

  views/              One module per screen (15 of them)
    dashboard.js  calendar.js   schedule.js   homework.js   classes.js
    grades.js     focus.js      flashcards.js notes.js      activities.js
    goals.js      contacts.js   analytics.js  sharing.js    settings.js
```

Each view module exposes `render()` (returns an HTML string) and `mount(root)` (wires events). The store publishes changes; the router repaints. That's the whole architecture.

### Charts and color

The chart palette is **validated for colorblind separation and contrast in both light and dark themes** — eight categorical hues in a fixed order, with dark-mode steps chosen for the dark surface rather than auto-flipped. Class colors double as chart colors, and every per-class breakdown is direct-labeled so identity never depends on color alone. Magnitude encodings (the study heatmap) use a single blue ramp, light → dark.

---

## Testing

Verified end-to-end in a real browser (Playwright, Chromium): all 15 views render with zero console errors; assignment creation, completion toggling, kanban rendering, the what-if calculator, flashcard study and grading, the countdown timer, habit toggling, calendar navigation and day modals, theme switching, reload persistence, and JSON export all pass; no horizontal overflow at 390px and the mobile drawer opens correctly.

## Browser support

Any modern browser (Chrome, Edge, Firefox, Safari). Uses `localStorage`, the Geolocation and Page Visibility APIs, CSS grid, and custom properties.
