/* ==========================================================================
   tests/depth.mjs — every common function within three clicks

   The rule this enforces: a function must be *reachable* in at most two
   clicks, so the click that performs it is the third. "Reachable" is not
   "present in the DOM" — the control has to be laid out, visible, and the
   topmost thing at its own centre point, or a phone user cannot press it.

   Measured on a phone viewport, because that is the tight case. Only four
   screens sit in the mobile tab bar; the other eighteen cost two taps (the
   drawer, then the screen), which leaves exactly one for the control. That
   budget is what made the tabbed screens fail: Settings put 34 controls
   behind a tab, so More → Settings → tab → control was four taps before
   anything happened, and Guidance did the same with ten.

   Each target below is tried by every route the app offers and scored by the
   shortest one that works:

     • the mobile tab bar, for the four screens on it        (1 click)
     • the drawer, then the screen                           (2 clicks)
     • the command palette, then a row                       (2 clicks)

   The palette route is click-only on purpose: nothing here types. A function
   you can only reach by knowing its name is not reachable, so the palette has
   to show its commands with an empty query for that route to count.

   Run: node tests/depth.mjs   (needs a static server, see tests/run.mjs)
   ========================================================================== */

import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.BASE || "http://localhost:8899";
const BUDGET = 3;              // total clicks, the last one being the action
const REACH = BUDGET - 1;      // so the control must be on screen within two

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

/**
 * The functions a student actually uses, each named by the control that
 * performs it. `view` is where it lives; `section` is the palette row that
 * jumps straight to it, for the ones that sit behind a tab.
 */
const FUNCTIONS = [
  // --- capture ---------------------------------------------------------
  { label: "Add anything (quick-add)",     control: "#fabAdd" },
  { label: "New assignment (toolbar)",     control: "#addBtn" },
  { label: "Sync now",                     control: "#syncBtn" },
  { label: "Notifications",                control: "#notifBtn" },
  { label: "Toggle theme",                 control: "#themeBtn" },

  // --- day to day ------------------------------------------------------
  { label: "Homework list",                view: "homework",   control: "#page [data-mode='list']" },
  { label: "Homework board",               view: "homework",   control: "#page [data-mode='board']" },
  { label: "Tick an assignment off",       view: "homework",   control: "#page [data-toggle]" },
  { label: "Calendar month",               view: "calendar",   control: "#page [data-mode='month']" },
  { label: "Calendar agenda",              view: "calendar",   control: "#page [data-mode='agenda']" },
  { label: "Open a grade column",          view: "grades",     control: "#page [data-score], #page [data-col]" },
  { label: "Bell schedule",                view: "schedule",   control: "#page [data-class], #page [data-activity]" },
  { label: "Study planner",                view: "planner",    control: "#page [data-add-block], #page [data-h]" },

  // --- study -----------------------------------------------------------
  { label: "Start a focus block",          view: "focus",      control: "#page [data-phase]" },
  { label: "Review a deck",                view: "flashcards", control: "#page [data-study]" },
  { label: "Write a note",                 view: "notes",      control: "#page [data-new]" },
  { label: "Log reading progress",         view: "reading",    control: "#page [data-log]" },

  // --- life ------------------------------------------------------------
  { label: "Log an activity",              view: "activities", control: "#page [data-log], #page [data-act]" },
  { label: "Check off a habit",            view: "goals",      control: "#page [data-habit], #page [data-goal]" },
  // The check-in trigger, not the mood buttons — those live in the dialog it
  // opens, which is the third click doing its job.
  { label: "Log mood",                     view: "goals",      control: "#page [data-mood-checkin]" },
  { label: "College applications",         view: "college",    control: "#page [data-app], #page [data-add]" },
  { label: "Contacts",                     view: "contacts",   control: "#page [data-teacher], #page [data-add]" },
  { label: "Analytics range",              view: "analytics",  control: "#page [data-range]" },

  // --- the tabbed screens, the ones that used to cost four -------------
  { label: "Export backup",         view: "settings", section: "Settings → Data",             control: "#page [data-export]" },
  { label: "Import backup",         view: "settings", section: "Settings → Data",             control: "#page [data-import]" },
  { label: "Import from Canvas",    view: "settings", section: "Settings → Data",             control: "#page [data-import-school]" },
  { label: "Export calendar (.ics)",view: "settings", section: "Settings → Data",             control: "#page [data-export-ics]" },
  { label: "Print",                 view: "settings", section: "Settings → Data",             control: "#page [data-print]" },
  { label: "Density",               view: "settings", section: "Settings → Preferences",      control: "#page [data-density-opt]" },
  { label: "Accent colour",         view: "settings", section: "Settings → Preferences",      control: "#page [data-accent-opt]" },
  // The lead-time selects rather than the enable switch: that switch is
  // disabled outright when the browser has refused notification permission,
  // and a control you cannot press is not a function you can reach.
  { label: "Notification settings", view: "settings", section: "Settings → Preferences",      control: "#page [data-notif-num], #page [data-notif-time]" },
  { label: "Add a term",            view: "settings", section: "Settings → Schedule & terms", control: "#page [data-add-term]" },
  { label: "Schedule pattern",      view: "settings", section: "Settings → Schedule & terms", control: "#page [data-sched-mode]" },
  { label: "Account",               view: "settings", section: "Settings → Account",          control: "#page [data-auth], #page [data-signout], #page [data-signin]" },
  { label: "Send feedback",         view: "settings", section: "Settings → Feedback",         control: "#page [data-feedback-send]" },
  // Guidance's other two sections are read-only panels with no controls of
  // their own, so reaching the section *is* the function: the tab button is
  // what gets pressed, and it has to be on screen inside two clicks.
  { label: "Guidance advice",       view: "guidance", section: "Guidance → Advice",           control: "#page [data-tab='advice']" },
  { label: "Guidance profile",      view: "guidance", section: "Guidance → Your profile",     control: "#page [data-tab='strengths']" },
  { label: "What guidance used",    view: "guidance", section: "Guidance → What it used",     control: "#page [data-tab='evidence']" },
  { label: "Set guidance stage",    view: "guidance", section: "Guidance → Advice",           control: "#page [data-stage]" }
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => window.App && App.store && App.store.db, null, { timeout: 15000 });
await page.waitForTimeout(400);
const welcome = await page.$(".modal [data-close]");
if (welcome) { await welcome.click(); await page.waitForTimeout(250); }
await page.evaluate(() => {
  if (App.store.loadDemo) App.store.loadDemo();
  App.store.db.settings.onboarded = true;
  App.store.commit();
});
await page.waitForTimeout(300);

/** Laid out, visible, enabled, and the topmost thing at its own centre. */
const PROBE = (s) => {
  for (const el of document.querySelectorAll(s)) {
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) continue;
    if (el.disabled) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (hit && (hit === el || el.contains(hit) || hit.contains(el))) return true;
  }
  return false;
};

/**
 * Can a thumb press this without spending another click?
 *
 * Below the fold still counts, so a failed probe is retried after scrolling
 * the control into view — otherwise every long screen fails for a reason
 * that has nothing to do with how deep the function is buried. The scroll is
 * forced to `instant`: `.page` sets `scroll-behavior: smooth`, so a default
 * scrollIntoView had not moved anything by the time the rect was measured,
 * and every control past the first screenful looked unreachable.
 */
async function reachable(sel) {
  if (await page.evaluate(PROBE, sel)) return true;
  await page.evaluate((s) => {
    for (const el of document.querySelectorAll(s)) {
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      el.scrollIntoView({ block: "center", behavior: "instant" });
      return;
    }
  }, sel);
  await page.waitForTimeout(140);
  return page.evaluate(PROBE, sel);
}

/**
 * Back to a cold dashboard with no drawer, palette or modal left open.
 *
 * A tabbed view keeps its tab in module state, so without the reset below a
 * later target inherits whichever tab an earlier one selected and the drawer
 * route scores two clicks for something that really costs three. Put every
 * tabbed screen back on its first tab so each measurement starts cold.
 */
async function home() {
  await page.evaluate(() => {
    document.querySelectorAll(".palette-root, .modal-root").forEach((n) => n.remove());
    const sb = document.querySelector(".sidebar"); if (sb) sb.classList.remove("open");
    const sc = document.querySelector(".scrim"); if (sc) sc.classList.remove("show");
    Object.values(App.views).forEach((v) => {
      if (v && typeof v.openSub === "function" && typeof v.tabs === "function") {
        const first = v.tabs()[0];
        if (first) v.openSub(first.id);
      }
    });
    App.router.go("dashboard");
  });
  await page.waitForTimeout(240);
}

const TABBAR = "#mobileTabbar [data-view='%s']";

/** Route A — the mobile tab bar, for the screens that are on it. */
async function viaTabBar(f) {
  if (!f.view) return null;
  await home();
  const sel = TABBAR.replace("%s", f.view);
  if (!(await reachable(sel))) return null;
  await page.click(sel);
  await page.waitForTimeout(300);
  return (await reachable(f.control)) ? 1 : null;
}

/** Route B — open the drawer, then pick the screen. */
async function viaDrawer(f) {
  if (!f.view) return null;
  await home();
  if (!(await reachable("[data-tabbar-more]"))) return null;
  await page.click("[data-tabbar-more]");
  await page.waitForTimeout(300);
  const sel = `#navScroll [data-view='${f.view}']`;
  if (!(await reachable(sel))) return null;
  await page.click(sel);
  await page.waitForTimeout(320);
  return (await reachable(f.control)) ? 2 : null;
}

/** Route C — the palette, clicking a row that is visible without typing. */
async function viaPalette(f, rowText) {
  if (!rowText) return null;
  await home();
  if (!(await reachable("#searchBtn"))) return null;
  await page.click("#searchBtn");
  await page.waitForTimeout(320);
  const i = await page.$$eval(".palette-item", (els, t) =>
    els.findIndex((e) => e.textContent.replace(/\s+/g, " ").includes(t)), rowText);
  if (i < 0) { await home(); return null; }
  const row = `.palette-item[data-i="${i}"]`;
  if (!(await reachable(row))) {
    // Off-screen in a scrolling list still counts as one click to press.
    await page.$eval(row, (e) => e.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(150);
    if (!(await reachable(row))) { await home(); return null; }
  }
  await page.click(row);
  await page.waitForTimeout(420);
  return (await reachable(f.control)) ? 2 : null;
}

console.log("depth: every common function is reachable within two clicks");
console.log(`        (so performing it is the ${BUDGET}rd) — measured at 390x844\n`);

const worst = [];
for (const f of FUNCTIONS) {
  // Chrome controls are on screen from the start; nothing to navigate.
  if (!f.view) {
    const at = (await home(), await reachable(f.control)) ? 0 : null;
    ok(`${f.label} — ${at === 0 ? "already on screen" : "NOT REACHABLE"}`, at === 0, f.control);
    if (at !== null) worst.push({ f, at });
    continue;
  }

  const routes = [];
  const a = await viaTabBar(f); if (a !== null) routes.push(["tab bar", a]);
  const b = await viaDrawer(f); if (b !== null) routes.push(["drawer", b]);
  const c = await viaPalette(f, f.section); if (c !== null) routes.push(["palette", c]);

  if (!routes.length) {
    ok(`${f.label} — no route found`, false, f.control);
    continue;
  }
  routes.sort((x, y) => x[1] - y[1]);
  const [how, at] = routes[0];
  worst.push({ f, at });
  ok(`${f.label} — ${at + 1} click${at ? "s" : ""} via ${how}`, at <= REACH,
    `needed ${at + 1}, budget ${BUDGET}`);
}

// The property the whole suite exists for, stated once.
const over = worst.filter((w) => w.at > REACH);
console.log("");
ok(`no common function costs more than ${BUDGET} clicks`, over.length === 0,
  over.map((w) => `${w.f.label} (${w.at + 1})`).join(", "));

// A section is only two clicks away if the palette lists it before anything
// is typed — the regression that would quietly break every palette route.
await home();
await page.click("#searchBtn");
await page.waitForTimeout(320);
const rows = await page.$$eval(".palette-item", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ")));
const sections = [...new Set(FUNCTIONS.map((f) => f.section).filter(Boolean))];
ok("palette lists every section with an empty query",
  sections.every((s) => rows.some((r) => r.includes(s))),
  sections.filter((s) => !rows.some((r) => r.includes(s))).join(", "));
ok("palette still lists Create and Actions with an empty query",
  rows.some((r) => r.includes("New assignment")) && rows.some((r) => r.includes("Export backup")));
await home();

// Deep links are the mechanism underneath the palette rows; a record id must
// still fall through to the record opener rather than being eaten as a tab.
await page.evaluate(() => App.router.go("settings/data"));
await page.waitForTimeout(420);
ok("#settings/data opens the Data tab", await reachable("#page [data-export]"));
await page.evaluate(() => {
  const a = App.store.openAssignments()[0];
  App.router.go("homework/" + a.id);
});
await page.waitForTimeout(520);
ok("#homework/<id> still opens the record, not a tab",
  await page.evaluate(() => !!document.querySelector(".modal-root")));
await page.evaluate(() => document.querySelectorAll(".modal-root").forEach((n) => n.remove()));

ok("no uncaught page errors", errors.length === 0, errors.join(" | "));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
