/* ==========================================================================
   tests/boot.mjs — the app boots and stays interactive, in a real browser

   Reproduces the state that took the deployed site down: a stored dataset
   carrying schemaV3:true from an older build, missing every field added
   since. Then checks the things that were actually broken — buttons that
   do nothing, and a first-run overlay that never stops reappearing.

   U52 moved the first run from the setup wizard to the guided tour, so the
   permanence check runs over both: the tour is what a fresh install meets,
   the wizard is what a dataset that has seen the tour but was never set up
   meets, and each one has to stay gone once it has been answered.
   ========================================================================== */

import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.BASE || "http://localhost:8899";
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

// Exactly the shape that broke production.
const STALE_V3 = {
  schema: 2, schemaV3: true,
  settings: { theme: "dark", accent: "indigo", onboarded: true },
  classes: [], assignments: [],
  terms: [{ id: "t1", name: "Fall", start: "2026-08-01", end: "2026-12-20", current: true }],
  periods: [], events: [], notes: [], activities: [], attendance: [],
  streak: { count: 3, last: "2026-08-20" }, account: {}, ui: { view: "dashboard" }
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

async function freshPage(seed) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((s) => {
    if (s) localStorage.setItem("scholar.db.v2", JSON.stringify(s));
    else localStorage.clear();
  }, seed);
  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  return { ctx, page, errors };
}

/* ------------------------------------------- the production crash state -- */
console.log("\nboot: stale schemaV3 dataset (the live crash)");
{
  const { ctx, page, errors } = await freshPage(STALE_V3);
  ok("no uncaught page errors", errors.length === 0, errors.join(" | "));

  const navCount = await page.locator("#navScroll [data-view]").count();
  ok("nav rendered", navCount > 5, `found ${navCount}`);

  const viewHtml = await page.locator("#page .view-root").count();
  ok("a view painted", viewHtml === 1);

  ok("no fatal screen", !(await page.locator("#fatalReset").count()));

  // The actual symptom: buttons that do nothing. Click a nav item and see
  // whether the route changes.
  await page.locator('#navScroll [data-view="homework"]').first().click();
  await page.waitForTimeout(300);
  const hash = await page.evaluate(() => location.hash);
  ok("nav click actually navigates", hash.includes("homework"), `hash=${hash}`);

  const title = await page.title();
  ok("document title updated", /Homework|StudyHold/.test(title), title);

  // The field whose absence caused the throw.
  const retention = await page.evaluate(() => JSON.stringify(App.store.settings.retention));
  ok("retention backfilled at runtime", retention && retention !== "undefined", retention);

  await ctx.close();
}

/* ------------------------------------------------------- fresh install -- */
console.log("\nboot: fresh install");
{
  const { ctx, page, errors } = await freshPage(null);
  ok("no uncaught page errors", errors.length === 0, errors.join(" | "));
  await page.waitForTimeout(700); // the first-run overlay fires on a 400ms timer
  ok("guided tour shown once", (await page.locator(".tour-root").count()) === 1);
  // One welcome at a time: the wizard is offered by the tour's last step,
  // not stacked underneath it.
  ok("no wizard competing with it", (await page.locator(".modal-root").count()) === 0);
  ok("it is skippable from the first step", (await page.locator("[data-tour-skip]").count()) > 0);
  await ctx.close();
}

/* ------------------------------ neither welcome may come back forever -- */
console.log("\nboot: the first run is dismissed permanently");
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Deliberately NOT addInitScript: that re-runs on every navigation, so the
  // reload below would wipe storage and manufacture a fresh install — the
  // test would "fail" on correct behaviour.
  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  await page.locator("[data-tour-skip]").first().click();
  await page.waitForTimeout(250);
  const flags = await page.evaluate(() => ({
    tour: App.store.settings.tourSeen, onboarded: App.store.settings.onboarded
  }));
  ok("skipping the tour is recorded", flags.tour === true, JSON.stringify(flags));
  ok("and answers the wizard with it", flags.onboarded === true, JSON.stringify(flags));

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  ok("tour does not reappear on reload", (await page.locator(".tour-root").count()) === 0);
  ok("nor does the wizard behind it", (await page.locator(".modal-root").count()) === 0);

  // U49's own regression, on the dataset that still reaches it: the tour has
  // been answered but the classes were never set up, so boot opens the
  // wizard. Abandoning the class form at step 1 used to leave onboarded
  // false forever, which meant a welcome on every single load.
  await page.evaluate(() => App.store.commit((db) => { db.settings.onboarded = false; }));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  ok("a tour-seen but unset-up dataset gets the wizard",
     (await page.locator(".modal-root").count()) === 1);

  await page.locator("[data-next]").click();
  await page.waitForTimeout(300);
  const closeBtn = page.locator(".modal-root [data-close]").first();
  if (await closeBtn.count()) await closeBtn.click();
  await page.waitForTimeout(200);

  const flag = await page.evaluate(() => App.store.settings.onboarded);
  ok("onboarded recorded after abandoning step 1", flag === true, `onboarded=${flag}`);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const again = await page.locator(".modal-root").count();
  ok("wizard does not reappear on reload", again === 0, `${again} modal(s)`);
  ok("no uncaught page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/* ------------------------------------------------- the error boundary --- */
console.log("\nboot: a throwing view shows an error panel, not a dead page");
{
  const { ctx, page } = await freshPage(STALE_V3);
  await page.evaluate(() => {
    App.views.analytics.render = () => { throw new Error("synthetic view failure"); };
  });
  await page.evaluate(() => App.router.go("analytics"));
  await page.waitForTimeout(300);

  ok("error panel rendered", (await page.locator("[data-err-reload]").count()) === 1);
  ok("message surfaced", /synthetic view failure/.test(await page.locator("#page").innerText()));

  const navStillWorks = await page.locator("#navScroll [data-view]").count();
  ok("nav still painted after a view crash", navStillWorks > 5);

  await page.locator('#navScroll [data-view="dashboard"]').first().click();
  await page.waitForTimeout(300);
  ok("can navigate away from the broken view",
     (await page.locator("[data-err-reload]").count()) === 0);

  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
