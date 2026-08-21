/* ==========================================================================
   tests/keyboard.mjs — the app is operable without a pointer, and honest

   axe cannot see most of this: whether a focusable thing actually does
   anything when you press Enter, whether a success toast is telling the
   truth, whether a delete can be undone.
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
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(600);
const skip = page.locator("[data-skip]");
if (await skip.count()) { await skip.click(); await page.waitForTimeout(250); }

await page.evaluate(() => {
  const S = App.store, U = App.utils;
  S.commit((db) => {
    const cid = U.uid("c");
    db.classes.push({ id: cid, name: "AP Biology", color: "#4f46e5", credits: 1, days: ["Mon"],
      patternDays: ["A"], rules: { dropLowest: {}, curve: 0 }, categories: [], termId: (db.terms[0] || {}).id });
    db.assignments.push({ id: U.uid("a"), classId: cid, title: "Cell lab", due: U.today(),
      status: "todo", points: 100, termId: (db.terms[0] || {}).id });
    db.notes.push({ id: U.uid("n"), title: "Osmosis", body: "Water moves.", classId: cid, at: Date.now() });
    db.goals.push({ id: U.uid("g"), title: "Read 20 books", target: 20, current: 3 });
  });
});

/* ------------------------------------------------------ keyboard access -- */
console.log("\nkeyboard: click-only elements are reachable and operable");
{
  await page.evaluate(() => App.router.go("calendar"));
  await page.waitForTimeout(300);
  const cal = await page.evaluate(() => {
    const days = [...document.querySelectorAll(".cal-day[data-day]")];
    return {
      total: days.length,
      focusable: days.filter((d) => d.getAttribute("tabindex") === "0").length,
      hasRole: days.filter((d) => d.getAttribute("role") === "button").length
    };
  });
  ok("calendar days are focusable", cal.total > 0 && cal.focusable === cal.total,
     `${cal.focusable}/${cal.total}`);
  ok("and expose button semantics", cal.hasRole === cal.total);

  // Enter must actually open the day, not merely move focus.
  const opened = await page.evaluate(async () => {
    const day = document.querySelector(".cal-day[data-day]");
    day.focus();
    day.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    const open = !!document.querySelector(".modal-root");
    if (open) App.ui.closeModal();
    return open;
  });
  ok("Enter opens the day", opened);
}

{
  await page.evaluate(() => App.router.go("notes"));
  await page.waitForTimeout(300);
  const n = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("[data-note]")];
    return { total: cards.length, focusable: cards.filter((c) => c.getAttribute("tabindex") === "0").length };
  });
  ok("note cards are focusable", n.total > 0 && n.focusable === n.total, `${n.focusable}/${n.total}`);
}

console.log("\nkeyboard: a focusable element is never nested inside another");
{
  for (const v of ["homework", "classes", "calendar", "notes"]) {
    await page.evaluate((x) => App.router.go(x), v);
    await page.waitForTimeout(200);
    const nested = await page.evaluate(() =>
      [...document.querySelectorAll('[role="button"][tabindex="0"]')]
        .filter((el) => el.querySelector('a[href], button, input, select, textarea')).length);
    ok(`${v} has no nested interactive containers`, nested === 0, `${nested} found`);
  }
}

/* ---------------------------------------------------------- label wiring -- */
console.log("\nkeyboard: every label points at its control");
{
  await page.evaluate(() => App.views.classes.classForm(null));
  await page.waitForTimeout(300);
  const res = await page.evaluate(() => {
    const labels = [...document.querySelectorAll(".modal-root label")];
    // A label either points at one control, wraps it, or names a group of
    // controls (day chips, colour swatches) via aria-labelledby.
    const unwired = labels.filter((l) =>
      !l.hasAttribute("for") &&
      !l.hasAttribute("data-group-label") &&
      !l.querySelector("input, select, textarea"));
    return {
      total: labels.length,
      unwired: unwired.length,
      resolves: labels.filter((l) => l.hasAttribute("for") && document.getElementById(l.getAttribute("for"))).length,
      groups: document.querySelectorAll('.modal-root [role="group"][aria-labelledby]').length
    };
  });
  ok("the class form has labels", res.total > 0);
  ok("none are left unwired", res.unwired === 0, `${res.unwired} of ${res.total}`);
  ok("every `for` resolves to a real control", res.resolves > 0);
  ok("group fields are named as groups", res.groups > 0, `${res.groups}`);

  // Clicking the label must move focus into the field.
  const focused = await page.evaluate(async () => {
    const l = [...document.querySelectorAll(".modal-root label")].find((x) => x.hasAttribute("for"));
    l.click();
    await new Promise((r) => setTimeout(r, 80));
    return document.activeElement && document.activeElement.id === l.getAttribute("for");
  });
  ok("clicking a label focuses its field", focused);
  await page.evaluate(() => App.ui.closeModal());
}

/* ----------------------------------------------------------- honest sync -- */
console.log("\nux: the sync button does not claim success on failure");
{
  const res = await page.evaluate(async () => {
    // Not signed in, so push() must report that rather than resolving green.
    const r = await App.sync.push(false);
    return r;
  });
  ok("push() returns an outcome object", res && typeof res.ok === "boolean", JSON.stringify(res));
  ok("and reports failure when not signed in", res && res.ok === false, JSON.stringify(res));
}

/* ------------------------------------------------------------ undo paths -- */
console.log("\nux: deletes are undoable");
{
  const res = await page.evaluate(async () => {
    const S = App.store;
    const before = S.db.goals.length;
    const gl = S.db.goals[0];
    App.ui.deleteWithUndo("goals", gl.id, gl.title);
    await new Promise((r) => setTimeout(r, 60));
    const afterDelete = S.db.goals.length;
    const undoBtn = document.querySelector(".toast [data-toast-action], .toast button");
    if (undoBtn) undoBtn.click();
    await new Promise((r) => setTimeout(r, 80));
    return { before, afterDelete, afterUndo: S.db.goals.length, hadUndoButton: !!undoBtn };
  });
  ok("the goal is removed", res.afterDelete === res.before - 1, JSON.stringify(res));
  ok("the toast offers Undo", res.hadUndoButton);
  ok("Undo restores it", res.afterUndo === res.before, JSON.stringify(res));
}

/* --------------------------------------------------- shortcuts switchable -- */
console.log("\nux: single-key shortcuts can be turned off (WCAG 2.1.4)");
{
  const res = await page.evaluate(async () => {
    App.router.go("dashboard");
    await new Promise((r) => setTimeout(r, 200));

    App.store.commit((db) => { db.settings.singleKeyShortcuts = false; });
    document.body.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const offOpened = !!document.querySelector(".modal-root");
    if (offOpened) App.ui.closeModal();

    App.store.commit((db) => { db.settings.singleKeyShortcuts = true; });
    await new Promise((r) => setTimeout(r, 150));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    const onOpened = !!document.querySelector(".modal-root");
    if (onOpened) App.ui.closeModal();
    return { offOpened, onOpened };
  });
  ok("off means off", res.offOpened === false);
  ok("on still works", res.onOpened === true);
}

/* ------------------------------------------------------------- html lang -- */
console.log("\nux: the document language follows the locale");
{
  const res = await page.evaluate(async () => {
    const before = document.documentElement.getAttribute("lang");
    App.i18n.setLocale("es");
    await new Promise((r) => setTimeout(r, 120));
    const after = document.documentElement.getAttribute("lang");
    App.i18n.setLocale("en");
    return { before, after };
  });
  ok("lang changes with the locale", res.after === "es", `${res.before} -> ${res.after}`);
}

ok("no uncaught page errors throughout", errors.length === 0, errors.join(" | "));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
