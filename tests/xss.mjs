/* ==========================================================================
   tests/xss.mjs — hostile input must never execute

   Saves the payloads a tester would type into the fields that reach an href
   or an HTML attribute, then loads the views that render them and asserts
   nothing ran. A payload that fires sets window.__XSS__.
   ========================================================================== */

import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.BASE || "http://localhost:8899";
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const XSS = `"><img src=x onerror="window.__XSS__=1">`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(600);

// Dismiss the first-run wizard so it doesn't cover the views.
const skip = page.locator("[data-skip]");
if (await skip.count()) { await skip.click(); await page.waitForTimeout(200); }

/* -------------------------------------------- plant the hostile records -- */
await page.evaluate((payload) => {
  const S = App.store, U = App.utils;
  S.commit((db) => {
    db.teachers.push({ id: "t-evil", name: "Evil Teacher", email: "a@b.c" + payload, subject: "Chem" });
    const cid = U.uid("c");
    db.classes.push({
      id: cid, name: "Chem " + payload, teacherId: "t-evil", color: "#4f46e5",
      credits: 1, days: ["Mon"], patternDays: ["A"], rules: { dropLowest: {}, curve: 0 },
      categories: [], termId: (db.terms[0] || {}).id
    });
    db.assignments.push({
      id: U.uid("a"), classId: cid, title: "Lab report " + payload,
      due: U.today(), status: "todo", points: 100, earned: 0, graded: true,
      missing: true, termId: (db.terms[0] || {}).id
    });
    db.collegeApps = db.collegeApps || [];
    db.collegeApps.push({
      id: U.uid("ap"), school: "Evil U " + payload, deadline: U.today(),
      portal: "javascript:window.__XSS__=1", status: "planning", recs: []
    });
    db.activities.push({
      id: U.uid("act"), name: "Robotics " + payload, advisorId: null,
      advisor: { name: "Adv", email: "adv@x.co" + payload }, days: ["Mon"], start: "15:00", end: "16:00"
    });
  });
}, XSS);

/* ------------------------------------------------- visit every renderer -- */
const views = ["contacts", "classes", "grades", "college", "activities", "dashboard", "homework", "analytics"];
for (const v of views) {
  await page.evaluate((name) => App.router.go(name), v);
  await page.waitForTimeout(250);
  const fired = await page.evaluate(() => !!window.__XSS__);
  ok(`no script executed on ${v}`, !fired);
}

/* ------------------------------------------ the specific vectors, named -- */
console.log("\nxss: hrefs are neutralised, not merely escaped");
await page.evaluate(() => App.router.go("contacts"));
await page.waitForTimeout(300);
{
  const hrefs = await page.evaluate(() =>
    [...document.querySelectorAll('a[href^="mailto"], a[href="#"]')].map((a) => a.getAttribute("href")));
  ok("a hostile email yields no usable mailto",
     !hrefs.some((h) => /onerror|<img/i.test(h)), JSON.stringify(hrefs).slice(0, 200));
}

await page.evaluate(() => App.router.go("college"));
await page.waitForTimeout(300);
{
  const portal = await page.evaluate(() =>
    [...document.querySelectorAll("a")].map((a) => a.getAttribute("href")).filter((h) => h && h.startsWith("javascript:")));
  ok("javascript: portal link is rejected", portal.length === 0, JSON.stringify(portal));
}

console.log("\nxss: a hostile title does not break the grade chart");
{
  await page.evaluate(() => App.router.go("grades"));
  await page.waitForTimeout(400);
  const sortable = await page.evaluate(() => !!document.querySelector("[data-sort], [data-cols], .chart-capture"));
  ok("grades view still mounted its handlers", sortable);
  ok("no uncaught page errors across every view", errors.length === 0, errors.join(" | "));
}

/* --------------------------------------------------- final safety check -- */
const finallyFired = await page.evaluate(() => !!window.__XSS__);
ok("nothing executed at any point", !finallyFired);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
