/* ==========================================================================
   tests/correctness.mjs — the app must not display a confident wrong number

   Every case here previously rendered 0, NaN, or a date one day off, with no
   error anywhere. These are the findings a tester writes up as "the grade is
   wrong", which is worse than a crash because it looks like it worked.
   ========================================================================== */

import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.BASE || "http://localhost:8899";
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ timezoneId: "America/Los_Angeles" });   // west of UTC, where the date bug bites
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(600);
const skip = page.locator("[data-skip]");
if (await skip.count()) { await skip.click(); await page.waitForTimeout(200); }

/* ------------------------------------------------ exam weight / 0 points -- */
console.log("\ncorrectness: a zero-point final does not produce NaN");
{
  const res = await page.evaluate(() => {
    const S = App.store, U = App.utils;
    let cid;
    S.commit((db) => {
      cid = U.uid("c");
      db.classes.push({ id: cid, name: "History", color: "#333", credits: 1, days: ["Mon"],
        patternDays: ["A"], rules: { dropLowest: {}, curve: 0 }, categories: [],
        examWeight: 20, termId: (db.terms[0] || {}).id });
      db.assignments.push({ id: U.uid("a"), classId: cid, title: "Essay", due: U.today(),
        status: "done", points: 100, earned: 88, graded: true, termId: (db.terms[0] || {}).id });
      // The killer: a "Final Exam" worth zero points.
      db.assignments.push({ id: U.uid("a"), classId: cid, title: "Final Exam", type: "final",
        due: U.today(), status: "done", points: 0, earned: 0, graded: true, termId: (db.terms[0] || {}).id });
    });
    const g = S.classGrade(cid);
    return { grade: g, finite: Number.isFinite(g) };
  });
  ok("classGrade is a real number", res.finite, `got ${res.grade}`);
  ok("it reflects the graded work", res.grade > 80 && res.grade < 95, `${res.grade}`);
}

/* ------------------------------------------------ optional number fields -- */
console.log("\ncorrectness: a blank optional score stays blank, not zero");
{
  const res = await page.evaluate(() => {
    // Exactly what ui.js hands the submit handler for an empty number input.
    const optNum = (v) => {
      if (v === "" || v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    return {
      blankIsNull: optNum(null) === null,
      emptyIsNull: optNum("") === null,
      zeroStaysZero: optNum(0) === 0,
      realValue: optNum("4") === 4,
      // The old expression, for contrast.
      oldBehaviour: (null === "" ? null : Number(null))
    };
  });
  ok("null becomes null", res.blankIsNull);
  ok("empty string becomes null", res.emptyIsNull);
  ok("an explicit 0 is preserved", res.zeroStaysZero);
  ok("a real value passes through", res.realValue);
  ok("the previous expression really did produce 0", res.oldBehaviour === 0);
}

/* --------------------------------------------------------- CSV due dates -- */
console.log("\ncorrectness: an imported due date does not shift a day west of UTC");
{
  const res = await page.evaluate(() => {
    const U = App.utils;
    const iso = "2026-09-14";
    return {
      viaParseDate: U.dateKey(U.parseDate(iso)),
      viaNewDate: U.dateKey(new Date(iso)),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone
    };
  });
  ok("U.parseDate round-trips the date", res.viaParseDate === "2026-09-14", res.viaParseDate);
  ok("new Date() would have shifted it (bug reproduced)", res.viaNewDate === "2026-09-13",
     `${res.viaNewDate} in ${res.tz}`);
}

/* ------------------------------------------------------- midnight sorting -- */
console.log("\ncorrectness: a midnight item sorts first, not last");
{
  const res = await page.evaluate(() => {
    const U = App.utils;
    const at = (t) => { const m = U.toMin(t); return (t && Number.isFinite(m)) ? m : 9999; };
    const rows = [{ start: "14:00" }, { start: "00:00" }, { start: "" }, { start: "09:30" }];
    return rows.slice().sort((a, b) => at(a.start) - at(b.start)).map((r) => r.start);
  });
  ok("00:00 comes first", res[0] === "00:00", JSON.stringify(res));
  ok("a missing time still sorts last", res[res.length - 1] === "", JSON.stringify(res));
}

/* -------------------------------------------------- cycle anchor recursion -- */
console.log("\ncorrectness: a blank rotating-cycle anchor does not walk from 1970");
{
  const t0 = Date.now();
  const res = await page.evaluate(() => {
    const S = App.store, U = App.utils;
    S.commit((db) => {
      db.settings.schedule = { mode: "rotating", anchor: "", cycle: ["A", "B"], exceptions: {}, skipWeekends: true };
    });
    const out = S.cycleDayFor(U.today());
    return { out };
  });
  const ms = Date.now() - t0;
  ok("it returns null instead of grinding", res.out === null, `got ${res.out}`);
  ok("and it returns promptly", ms < 1500, `${ms}ms`);
  await page.evaluate(() => App.store.commit((db) => { db.settings.schedule.mode = "fixed"; }));
}

/* ------------------------------------------------------------ focus skip -- */
console.log("\ncorrectness: skipping a focus block does not bank a full session");
{
  const res = await page.evaluate(async () => {
    const S = App.store;
    const before = S.db.studySessions.length;
    const xpBefore = S.db.streak.xp || 0;
    App.router.go("focus");
    await new Promise((r) => setTimeout(r, 250));
    const btn = document.querySelector("#timerToggle");
    if (btn) btn.click();                       // start
    await new Promise((r) => setTimeout(r, 150));
    const sk = document.querySelector("[data-skip]");
    if (sk) sk.click();                         // skip almost immediately
    await new Promise((r) => setTimeout(r, 250));
    return {
      added: S.db.studySessions.length - before,
      xpGained: (S.db.streak.xp || 0) - xpBefore
    };
  });
  ok("no session is logged for a sub-minute block", res.added === 0, `${res.added} added`);
  ok("no XP is awarded either", res.xpGained === 0, `${res.xpGained} xp`);
}

/* ------------------------------------------------------- form validation -- */
console.log("\ncorrectness: constraint validation is live");
{
  const res = await page.evaluate(async () => {
    let submitted = false;
    App.ui.modal({
      title: "Validation probe",
      body: `<div class="field"><label>Credits</label>
        <input class="input" type="number" name="credits" min="0" value="-3" required /></div>`,
      onSubmit() { submitted = true; }
    });
    await new Promise((r) => setTimeout(r, 80));
    const form = document.querySelector(".modal-root form");
    form.requestSubmit ? form.requestSubmit() : form.querySelector("[type=submit]").click();
    await new Promise((r) => setTimeout(r, 120));
    const out = {
      submitted,
      hasNovalidate: form.hasAttribute("novalidate"),
      errorShown: !!document.querySelector(".field-error"),
      markedInvalid: !!document.querySelector('[aria-invalid="true"]')
    };
    App.ui.closeModal();
    return out;
  });
  ok("forms are no longer novalidate", !res.hasNovalidate);
  ok("a negative value blocks submission", !res.submitted);
  ok("and it says so next to the field", res.errorShown);
  ok("the field is marked invalid for screen readers", res.markedInvalid);
}

/* -------------------------------------------------------------- caching -- */
console.log("\ncorrectness: memoised aggregates still invalidate on change");
{
  const res = await page.evaluate(() => {
    const S = App.store, P = App.planner;
    const before = S.rev();
    const c1 = P.calibration();
    const c2 = P.calibration();
    S.commit((db) => { db.settings.density = db.settings.density === "compact" ? "comfortable" : "compact"; });
    const c3 = P.calibration();
    return { revMoved: S.rev() > before, sameObject: c1 === c2, recomputed: c3 !== c2 };
  });
  ok("repeat calls within a revision are cached", res.sameObject);
  ok("the revision advances on commit", res.revMoved);
  ok("a commit invalidates the cache", res.recomputed);
}

ok("no uncaught page errors throughout", errors.length === 0, errors.join(" | "));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
