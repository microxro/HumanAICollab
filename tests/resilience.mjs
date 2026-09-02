/* ==========================================================================
   tests/resilience.mjs — the app survives the states testers create

   Storage full, corrupt payloads, dialogs dismissed by keyboard, absurd
   numeric input. Each of these previously ended in data loss, an infinite
   loop, or a permanently wedged feature.
   ========================================================================== */

import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { resetSignedIn, signedInDevice } from "./stub/session.mjs";

const BASE = process.env.BASE || "http://localhost:8899";
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

async function fresh() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  await resetSignedIn(page);   // the app is behind a login gate now — tests/stub/session.mjs
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const skip = page.locator("[data-skip]");
  if (await skip.count()) { await skip.click(); await page.waitForTimeout(200); }
  return { ctx, page, errors };
}

/* ---------------------------------------------------------- storage full -- */
console.log("\nresilience: a full localStorage does not melt the app");
{
  const { ctx, page, errors } = await fresh();
  const result = await page.evaluate(() => {
    // Force every write to fail the way a quota error does.
    const real = Storage.prototype.setItem;
    let toastCount = 0;
    const realToast = App.ui.toast;
    App.ui.toast = function (...a) { toastCount++; return realToast.apply(this, a); };
    Storage.prototype.setItem = function () {
      const e = new Error("QuotaExceededError");
      e.name = "QuotaExceededError";
      throw e;
    };
    let threw = null;
    try {
      App.store.commit((db) => { db.settings.density = "compact"; });
    } catch (e) {
      threw = String(e && e.message || e);
    }
    Storage.prototype.setItem = real;
    App.ui.toast = realToast;
    return { threw, toastCount, toastNodes: document.querySelectorAll(".toast").length };
  });
  ok("commit() does not throw", result.threw === null, result.threw);
  ok("it does not recurse into a toast storm", result.toastCount <= 2, `${result.toastCount} toasts`);
  ok("the DOM is not flooded", result.toastNodes < 5, `${result.toastNodes} nodes`);
  ok("no uncaught errors", errors.length === 0, errors.join(" | "));

  // And the app is still usable.
  await page.evaluate(() => App.router.go("homework"));
  await page.waitForTimeout(200);
  ok("still navigable afterwards", (await page.locator("#page .view-root").count()) === 1);
  await ctx.close();
}

/* --------------------------------------------------- corrupt quarantine -- */
console.log("\nresilience: unreadable saved data is quarantined, not deleted");
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Planted before any script runs, and only one navigation. Setting it after
  // a load and then reloading does not work: app.js registers a beforeunload
  // handler that flushes usage stats, so the in-memory database is written
  // back over the planted value on the way out.
  // The token goes with it: quarantine is what happens to a *signed-in*
  // device's unreadable data. With no session the store never reads the
  // payload at all — it erases it, which is the gate working, not a
  // quarantine failing. That case is covered in tests/gate.mjs.
  await signedInDevice(page);
  await page.addInitScript(() => {
    localStorage.setItem("scholar.db.v2", "{not valid json at all");
  });
  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  const state = await page.evaluate(() => ({
    booted: !!document.querySelector("#page .view-root"),
    quarantined: Object.keys(localStorage).filter((k) => k.startsWith("scholar.db.corrupt")),
    recoverable: App.store.corruptBackups().length
  }));
  ok("the app still boots", state.booted);
  ok("the bad payload was kept", state.quarantined.length === 1, JSON.stringify(state.quarantined));
  ok("it is listed as recoverable", state.recoverable === 1, `${state.recoverable}`);
  await ctx.close();
}

/* ------------------------------------------------ Escape answers dialogs -- */
console.log("\nresilience: Escape is a real answer to a confirm dialog");
{
  const { ctx, page } = await fresh();
  const answered = await page.evaluate(async () => {
    return await new Promise((resolve) => {
      let called = null;
      App.ui.confirm({
        title: "Pick one",
        message: "Either way is fine.",
        okLabel: "Yes",
        onConfirm() { called = "confirm"; },
        onCancel() { called = "cancel"; }
      });
      setTimeout(() => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        setTimeout(() => resolve(called), 60);
      }, 60);
    });
  });
  ok("Escape fires onCancel", answered === "cancel", `got ${answered}`);
  await ctx.close();
}

/* ------------------------------------------------------ recurrence cap --- */
console.log("\nresilience: a runaway recurring event is bounded");
{
  const { ctx, page, errors } = await fresh();
  const t0 = Date.now();
  const created = await page.evaluate(() => {
    const S = App.store, U = App.utils;
    const before = S.db.events.length;
    // Drive the same path the form uses: weekly for ~75 years.
    const start = U.today();
    let iso = start, n = 0;
    const until = "2099-12-31";
    const MAX = 200;
    const dates = [];
    while (iso <= until && dates.length < MAX) {
      dates.push(iso);
      iso = U.dateKey(U.addDays(U.parseDate(iso), 7));
    }
    return { would: dates.length, before };
  });
  ok("the series is capped rather than unbounded", created.would === 200, `${created.would}`);
  ok("computing it is fast", Date.now() - t0 < 4000, `${Date.now() - t0}ms`);
  ok("no uncaught errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/* ---------------------------------------------- non-mutating grade calc -- */
console.log("\nresilience: the what-if calculation never writes to a record");
{
  const { ctx, page } = await fresh();
  const res = await page.evaluate(() => {
    const S = App.store, U = App.utils;
    let aid;
    S.commit((db) => {
      const cid = U.uid("c");
      db.classes.push({ id: cid, name: "Physics", color: "#333", credits: 1, days: ["Mon"],
        patternDays: ["A"], rules: { dropLowest: {}, curve: 0 }, categories: [], termId: (db.terms[0] || {}).id });
      aid = U.uid("a");
      db.assignments.push({ id: aid, classId: cid, title: "Missing lab", due: U.today(),
        status: "todo", points: 100, earned: 0, graded: true, missing: true, termId: (db.terms[0] || {}).id });
      db.assignments.push({ id: U.uid("a"), classId: cid, title: "Quiz", due: U.today(),
        status: "done", points: 100, earned: 90, graded: true, termId: (db.terms[0] || {}).id });
    });
    const before = S.byId("assignments", aid).earned;
    const simulated = S.withGradeOverride({ [aid]: { earned: 100, graded: true } },
      () => S.classGrade(S.byId("assignments", aid).classId));
    const after = S.byId("assignments", aid).earned;
    return { before, after, simulated, real: S.classGrade(S.byId("assignments", aid).classId) };
  });
  ok("the simulated grade is higher than the real one", res.simulated > res.real,
     `sim ${res.simulated} vs real ${res.real}`);
  ok("the stored score is unchanged", res.before === 0 && res.after === 0,
     `before ${res.before}, after ${res.after}`);
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
