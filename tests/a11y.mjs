/* ==========================================================================
   tests/a11y.mjs — axe across every view, light and dark

   Accessibility is where a professional tester gets the most findings for
   the least effort: one automated pass names dozens. This runs the same
   engine they will.
   ========================================================================== */

import { readFileSync } from "node:fs";
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.BASE || "http://localhost:8899";
const AXE = readFileSync("node_modules/axe-core/axe.min.js", "utf8");

// Rules we hold the app to. Colour-contrast is included: a tester will run it.
const RULES = {
  runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }
};

const VIEWS = [
  "dashboard", "calendar", "schedule", "homework", "classes", "grades",
  "planner", "focus", "flashcards", "notes", "reading", "activities",
  "goals", "college", "contacts", "analytics", "sharing", "groups",
  "parent", "settings", "assistant"
];

let pass = 0, fail = 0;
const all = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "\n       " + extra : ""}`); }
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext();
const page = await ctx.newPage();

await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(600);
const skip = page.locator("[data-skip]");
if (await skip.count()) { await skip.click(); await page.waitForTimeout(250); }

// Give every view something to render, so empty states aren't the only thing
// audited.
await page.evaluate(() => {
  const S = App.store, U = App.utils;
  S.commit((db) => {
    const cid = U.uid("c");
    db.classes.push({ id: cid, name: "AP Biology", color: "#4f46e5", credits: 1, days: ["Mon", "Wed"],
      patternDays: ["A"], rules: { dropLowest: {}, curve: 0 }, categories: [{ id: "h", name: "Homework", weight: 40 }],
      termId: (db.terms[0] || {}).id, room: "204" });
    db.assignments.push({ id: U.uid("a"), classId: cid, title: "Cell lab", due: U.today(),
      status: "todo", points: 100, earned: 92, graded: true, categoryId: "h", termId: (db.terms[0] || {}).id });
    db.teachers.push({ id: U.uid("t"), name: "Ms Vale", email: "vale@school.edu", subject: "Biology" });
    db.notes.push({ id: U.uid("n"), title: "Osmosis", body: "Water moves.", classId: cid, at: Date.now() });
    db.studySessions.push({ id: U.uid("ss"), classId: cid, date: U.today(), minutes: 45, kind: "focus" });
  });
});

async function auditView(view, theme) {
  await page.evaluate((t) => {
    App.store.commit((db) => { db.settings.theme = t; });
    App.applyTheme();
  }, theme);
  await page.evaluate((v) => App.router.go(v), view);

  // Wait for the view to actually be on screen rather than guessing at a
  // duration. A fixed timeout made this suite fail intermittently under
  // load, and a flaky suite is worse than no suite: it trains you to re-run
  // instead of to look.
  await page.waitForFunction((v) => {
    const root = document.querySelector("#page .view-root");
    return !!root && root.children.length > 0 && location.hash.includes(v);
  }, view, { timeout: 10000 });

  await page.addScriptTag({ content: AXE });
  await page.waitForFunction(() => !!window.axe, null, { timeout: 10000 });
  const res = await page.evaluate((rules) => window.axe.run(document, rules), RULES);
  const serious = res.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  for (const v of serious) {
    all.push({ view, theme, id: v.id, impact: v.impact, n: v.nodes.length,
               sample: (v.nodes[0] && v.nodes[0].html || "").slice(0, 110) });
  }
  return serious;
}

console.log("\na11y: no critical or serious violations, light theme");
for (const v of VIEWS) {
  const bad = await auditView(v, "light");
  ok(`${v}`, bad.length === 0,
     bad.map((x) => `${x.id} (${x.impact}, ${x.nodes.length} nodes)`).join("; "));
}

console.log("\na11y: no critical or serious violations, dark theme");
for (const v of VIEWS) {
  const bad = await auditView(v, "dark");
  ok(`${v}`, bad.length === 0,
     bad.map((x) => `${x.id} (${x.impact}, ${x.nodes.length} nodes)`).join("; "));
}

if (all.length) {
  console.log("\n--- distinct violations ---");
  const byId = new Map();
  for (const a of all) {
    if (!byId.has(a.id)) byId.set(a.id, { impact: a.impact, views: new Set(), nodes: 0, sample: a.sample });
    const e = byId.get(a.id);
    e.views.add(a.view);
    e.nodes += a.n;
  }
  for (const [id, e] of [...byId].sort((x, y) => y[1].nodes - x[1].nodes)) {
    console.log(`  ${id} [${e.impact}] — ${e.nodes} nodes across ${e.views.size} views`);
    console.log(`    e.g. ${e.sample}`);
  }
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
