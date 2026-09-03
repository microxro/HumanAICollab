/* ==========================================================================
   tests/abuse.mjs — what a professional tester actually does

   Not "does the happy path work" but "what happens when I do the stupid,
   the hostile, and the enormous". Every input the app accepts, pushed to
   its limits, in a real browser.
   ========================================================================== */

import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { resetSignedIn } from "./stub/session.mjs";

const BASE = process.env.BASE || "http://localhost:8899";
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
await resetSignedIn(page);   // the app is behind a login gate now — tests/stub/session.mjs
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(600);
const skip = page.locator("[data-skip]");
if (await skip.count()) { await skip.click(); await page.waitForTimeout(250); }

const VIEWS = ["dashboard", "calendar", "schedule", "homework", "classes", "grades",
  "planner", "focus", "flashcards", "notes", "reading", "activities", "goals",
  "college", "guidance", "contacts", "analytics", "sharing", "groups", "parent", "settings", "assistant"];

async function visitAll(labelPrefix) {
  const broken = [];
  for (const v of VIEWS) {
    const before = errors.length;
    await page.evaluate((x) => App.router.go(x), v);
    await page.waitForTimeout(120);
    const painted = await page.evaluate(() => !!document.querySelector("#page .view-root"));
    const errPanel = await page.evaluate(() => !!document.querySelector("[data-err-reload]"));
    if (!painted || errPanel || errors.length > before) broken.push(v);
  }
  ok(`${labelPrefix}: every view still renders`, broken.length === 0, broken.join(", "));
}

/* ------------------------------------------------------- hostile strings -- */
console.log("\nabuse: absurd and hostile text in every field");
{
  await page.evaluate(() => {
    const S = App.store, U = App.utils;
    const LONG = "A".repeat(5000);
    const RTL = "مرحبا بالعالم";
    const EMOJI = "📚🎓✨🧪🔬";
    const SQL = "'; DROP TABLE classes; --";
    const BLANKS = "   ";
    const NEWLINES = "\n\n\n";
    S.commit((db) => {
      [LONG, RTL, EMOJI, SQL, BLANKS, NEWLINES].forEach((txt, i) => {
        const cid = U.uid("c");
        db.classes.push({ id: cid, name: txt, color: "#4f46e5", credits: 1, days: ["Mon"],
          patternDays: ["A"], rules: { dropLowest: {}, curve: 0 }, categories: [],
          room: txt, code: txt, termId: (db.terms[0] || {}).id });
        db.assignments.push({ id: U.uid("a"), classId: cid, title: txt, notes: txt,
          due: U.today(), status: "todo", points: 100, termId: (db.terms[0] || {}).id });
        db.notes.push({ id: U.uid("n"), title: txt, body: txt, classId: cid, at: Date.now(), tags: [txt] });
        db.teachers.push({ id: U.uid("t"), name: txt, email: txt, subject: txt });
        db.goals.push({ id: U.uid("g"), title: txt, target: 10, current: i });
      });
    });
  });
  await visitAll("hostile text");
}

/* ------------------------------------------------------- absurd numbers -- */
console.log("\nabuse: NaN, Infinity, negatives and enormous numbers");
{
  await page.evaluate(() => {
    const S = App.store, U = App.utils;
    S.commit((db) => {
      const cid = U.uid("c");
      db.classes.push({ id: cid, name: "Edge numbers", color: "#4f46e5",
        credits: -3, days: ["Mon"], patternDays: ["A"],
        rules: { dropLowest: { x: 99 }, curve: 9999 },
        categories: [{ id: "k", name: "Everything", weight: 100000 }],
        examWeight: 500, termId: (db.terms[0] || {}).id });
      const cases = [
        { points: 0, earned: 0 },
        { points: -100, earned: -50 },
        { points: 1e9, earned: 1e9 },
        { points: 100, earned: 1e9 },
        { points: NaN, earned: NaN },
        { points: Infinity, earned: Infinity },
        { points: null, earned: null },
        { points: "abc", earned: "xyz" }
      ];
      cases.forEach((c, i) => {
        db.assignments.push({ id: U.uid("a"), classId: cid, title: "Case " + i,
          due: U.today(), status: "done", graded: true, categoryId: "k",
          points: c.points, earned: c.earned, termId: (db.terms[0] || {}).id });
      });
    });
  });
  await visitAll("absurd numbers");

  const shown = await page.evaluate(async () => {
    App.router.go("grades");
    await new Promise((r) => setTimeout(r, 300));
    return document.querySelector("#page").innerText;
  });
  ok("no NaN reaches the screen", !/NaN/.test(shown), (shown.match(/.{0,40}NaN.{0,40}/) || [""])[0]);
  ok("no Infinity reaches the screen", !/Infinity/.test(shown));
  ok("no 'undefined' reaches the screen", !/\bundefined\b/.test(shown),
     (shown.match(/.{0,40}undefined.{0,40}/) || [""])[0]);
}

/* --------------------------------------------------------- absurd dates -- */
console.log("\nabuse: dates in 1900 and 2200, and end-before-start");
{
  await page.evaluate(() => {
    const S = App.store, U = App.utils;
    S.commit((db) => {
      const cid = db.classes[0].id;
      ["1900-01-01", "2200-12-31", "0001-01-01", "9999-12-31", "not-a-date", "", null]
        .forEach((d, i) => {
          db.assignments.push({ id: U.uid("a"), classId: cid, title: "Date " + i,
            due: d, status: "todo", points: 10, termId: (db.terms[0] || {}).id });
          db.events.push({ id: U.uid("ev"), title: "Ev " + i, date: d, start: "09:00", end: "08:00" });
        });
      db.terms.push({ id: U.uid("t"), name: "Backwards", start: "2026-12-01", end: "2026-01-01" });
    });
  });
  await visitAll("absurd dates");
}

/* -------------------------------------------------------------- volume -- */
console.log("\nabuse: 500 assignments in one class");
{
  const ms = await page.evaluate(async () => {
    const S = App.store, U = App.utils;
    const cid = S.db.classes[0].id;
    S.commit((db) => {
      for (let i = 0; i < 500; i++) {
        db.assignments.push({ id: U.uid("a"), classId: cid, title: "Bulk " + i,
          due: U.dateKey(U.addDays(new Date(), i % 60)), status: i % 3 ? "todo" : "done",
          points: 100, earned: i % 3 ? null : 80, graded: i % 3 === 0,
          termId: (db.terms[0] || {}).id });
      }
    });
    const t0 = performance.now();
    App.router.go("homework");
    await new Promise((r) => setTimeout(r, 400));
    return performance.now() - t0;
  });
  ok("the homework list still renders", await page.evaluate(() => !!document.querySelector("#page .view-root")));
  ok("and within a reasonable time", ms < 4000, `${Math.round(ms)}ms`);

  const typeMs = await page.evaluate(async () => {
    const box = document.querySelector("#hwSearch");
    if (!box) return 0;
    const t0 = performance.now();
    for (const ch of "essay") {
      box.value += ch;
      box.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
    }
    await new Promise((r) => setTimeout(r, 400));
    return performance.now() - t0;
  });
  ok("searching stays responsive with 500 rows", typeMs < 3000, `${Math.round(typeMs)}ms`);
  await visitAll("500 assignments");
}

/* -------------------------------------------------------- empty extremes -- */
console.log("\nabuse: zero classes, zero terms, nothing at all");
{
  await page.evaluate(() => { App.store.commit((db) => { db.terms = []; }); });
  await visitAll("no terms");

  await page.evaluate(() => {
    App.store.commit((db) => {
      db.classes = []; db.assignments = []; db.notes = []; db.events = [];
      db.goals = []; db.habits = []; db.studySessions = []; db.teachers = [];
      db.activities = []; db.attendance = []; db.decks = []; db.periods = [];
    });
  });
  await visitAll("completely empty");
}

/* ------------------------------------------------------- hostile import -- */
console.log("\nabuse: a hostile backup file");
{
  const res = await page.evaluate(() => {
    const raw = '{"schema":2,"schemaV3":true,' +
      '"__proto__":{"polluted":true},' +
      '"constructor":{"prototype":{"polluted":true}},' +
      '"settings":{"theme":"dark"},' +
      '"classes":[null,42,"string",{"id":"ok","name":"Real"}],' +
      '"assignments":[{}],"terms":null,' +
      '"notes":[{"id":"n","title":{"nested":"object"},"body":["array"]}],"ui":{}}';
    let threw = null;
    try {
      App.store.replaceAll(JSON.parse(raw));
    } catch (e) { threw = String(e && e.message || e); }
    return {
      threw,
      polluted: ({}).polluted === true,
      classes: App.store.db.classes.length,
      hasReal: App.store.db.classes.some((c) => c && c.name === "Real")
    };
  });
  ok("the import does not throw", res.threw === null, res.threw);
  ok("Object.prototype is not polluted", res.polluted === false);
  ok("junk rows are dropped", res.classes === 1, `${res.classes} classes`);
  ok("the real row survives", res.hasReal);
  await visitAll("after hostile import");
}

/* ----------------------------------------------------------- rapid input -- */
console.log("\nabuse: rapid navigation");
{
  const res = await page.evaluate(async () => {
    for (let i = 0; i < 60; i++) {
      App.router.go(["dashboard", "homework", "grades", "calendar", "notes"][i % 5]);
    }
    await new Promise((r) => setTimeout(r, 400));
    return { painted: !!document.querySelector("#page .view-root") };
  });
  ok("rapid navigation leaves a painted view", res.painted);
}

/* ----------------------------------------------------------- theme sweep -- */
console.log("\nabuse: every theme, density and contrast combination");
{
  const combos = [];
  for (const theme of ["light", "dark"]) {
    for (const density of ["comfortable", "compact"]) {
      for (const contrast of [false, true]) combos.push({ theme, density, contrast });
    }
  }
  let broke = null;
  for (const c of combos) {
    await page.evaluate((cfg) => {
      App.store.commit((db) => {
        db.settings.theme = cfg.theme;
        db.settings.density = cfg.density;
        db.settings.highContrast = cfg.contrast;
      });
      App.applyTheme(); App.applyShellPrefs();
    }, c);
    await page.evaluate(() => App.router.go("dashboard"));
    await page.waitForTimeout(80);
    const okPaint = await page.evaluate(() => !!document.querySelector("#page .view-root"));
    if (!okPaint) { broke = JSON.stringify(c); break; }
  }
  ok("all 8 combinations render", broke === null, broke);
}

ok("no uncaught page errors across the whole run", errors.length === 0,
   [...new Set(errors)].slice(0, 3).join(" | "));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
