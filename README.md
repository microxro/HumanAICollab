# ClassPulse — School Tracker

A single-page school tracker built with plain **HTML, CSS, and JavaScript** (no frameworks, no build step, no backend). It's a client-side prototype: three files — `index.html`, `style.css`, `app.js` — plus this README.

Open `index.html` in a browser, or enable **GitHub Pages** on this repo, to try it.

## What it does

Switch between three roles in the top bar to see the same underlying data from different angles:

- **Student** — today's class schedule and weekly calendar (classes + extracurriculars), a live "what class am I in right now" status, a daily check-in streak with XP, toggles to control location sharing and peer schedule visibility, a "study buddies" panel showing opted-in friends' current status and shared free periods, and one-tap email contacts for every teacher.
- **Parent** — a live "currently in: {class}, until {time}" status card for each child (only shown if the child has location sharing on), a weekly screen-time chart, the child's calendar, streak, and teacher contacts.
- **Teacher** — class/activity rosters with parent contacts, and the ability to post a quick note to a class or club that shows up for students and parents.

### What makes it different from ParentSquare / Infinite Campus

- **Gamified streaks & XP** for daily engagement and on-time check-ins, instead of a plain attendance log.
- **Opt-in peer schedule matching** — students can see which friends share a free period today, to plan study time together.
- **Live "in class now" status + screen-time summary** for parents, rather than a static, once-a-day schedule view.
- **Unified calendar with conflict detection** — classes, extracurriculars, and one-off events (tests, games) are merged into one view, and overlapping commitments are flagged automatically.

## How it actually works (important caveats)

This is a **front-end-only demo**, so it simulates things a real product would need a server for:

- All data (schedules, streaks, usage, notes, settings) is seeded on first load and persisted in the browser's `localStorage`. Nothing is sent to a server, and nothing syncs between devices.
- "Location sharing" uses the real browser **Geolocation API** (with your permission) to attach a GPS confirmation tag, but a student's "current class" status is actually derived from their schedule and the time of day — it isn't transmitted to another device. Switching to the Parent role in the *same browser* is how you see what a parent would see.
- "Screen time" is tracked for real within your current browser tab (via the Page Visibility API) and added to a seeded week of sample usage so the parent chart has something to show immediately.

A production version of this idea would need real accounts/auth, a database, and a backend to sync data across a student's and parent's separate devices — this repo focuses on the front-end experience and data model that such a backend would plug into.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure, role switcher, view containers |
| `style.css` | All styling — theme, layout, cards, calendar grid, charts |
| `app.js` | Seed data, state persistence, rendering, and all interactivity |
