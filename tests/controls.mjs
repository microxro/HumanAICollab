/* ==========================================================================
   tests/controls.mjs — no dead controls

   The defect a tester reports as "this feature doesn't work" is usually a
   button that renders and does nothing: a handler that was never bound, a
   selector that silently returns nothing, a view whose mount() bailed early.

   This clicks every interactive control in every view and asserts that
   *something* observably happened — the route changed, a dialog opened, a
   toast appeared, the store advanced, or the DOM changed. It cannot judge
   whether the right thing happened; it can prove the control is alive.
   ========================================================================== */

import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.BASE || "http://localhost:8899";
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "\n       " + extra : ""}`); }
};

const VIEWS = ["dashboard", "calendar", "schedule", "homework", "classes", "grades",
  "planner", "focus", "flashcards", "notes", "reading", "shop", "activities", "goals",
  "college", "guidance", "contacts", "analytics", "sharing", "groups", "parent", "classroom", "settings", "assistant"];

/**
 * Controls skipped by the sweep, as valid CSS selectors.
 *
 * Two kinds: destructive actions (deleting things the later views need) and
 * actions whose only effect is outside the page — a file download, a print
 * dialog, a sign-out. Neither can be judged by "did the DOM change", so they
 * are excluded rather than reported as false positives.
 */
const SKIP = [
  '[data-leave]', '[data-reset]', '[data-wipe]', '[data-signout]', '[data-demo]',
  '[data-print]', '[data-export]', '[data-purge]', '[data-apply-retention]',
  '[data-mint-token]', '[data-add-hook]',
  '[data-del]', '[data-remove]', '[data-revoke]', '[data-clear]',
  '[data-name^="del"]',
  '[class*="btn-danger"]',
  // Attribute-prefix forms, since these are per-record ids.
  '[data-del-att]', '[data-del-ss]', '[data-note-del]', '[data-tutor-del]',
  '[data-remove-hook]', '[data-revoke-token]', '[data-delete]',
  // Downloads and exports, judged by their side effect outside the DOM.
  '[data-csv]', '[data-download]', '[data-export-csv]', '[data-ics]',
  '[data-export-effort]', '[data-export-grades]', '[data-backup]'
];

/**
 * A control that is already in its selected state — the active tab of a
 * segmented control, the current filter chip — correctly does nothing when
 * clicked again. Reporting those as dead would train us to ignore the output.
 */
const ALREADY_ACTIVE = '.active, [aria-pressed="true"], [aria-selected="true"], [aria-current]';

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

/* Populate enough data that every view has something to operate on. */
await page.evaluate(() => {
  const S = App.store, U = App.utils;
  S.commit((db) => {
    const tid = (db.terms[0] || {}).id;
    db.periods.push({ id: "p1", name: "1st", start: "08:00", end: "08:50" });
    db.periods.push({ id: "p2", name: "2nd", start: "09:00", end: "09:50" });
    const t1 = U.uid("t");
    db.teachers.push({ id: t1, name: "Ms Vale", email: "vale@school.edu", subject: "Biology" });
    const c1 = U.uid("c");
    db.classes.push({ id: c1, name: "AP Biology", color: "#4f46e5", credits: 1,
      days: ["Mon", "Wed"], patternDays: ["A"], periodId: "p1", teacherId: t1,
      rules: { dropLowest: {}, curve: 0 },
      categories: [{ id: "hw", name: "Homework", weight: 40 }, { id: "ex", name: "Exams", weight: 60 }],
      termId: tid, room: "204" });
    const c2 = U.uid("c");
    db.classes.push({ id: c2, name: "US History", color: "#16a34a", credits: 1,
      days: ["Tue", "Thu"], patternDays: ["B"], periodId: "p2",
      rules: { dropLowest: {}, curve: 0 }, categories: [], termId: tid });
    for (let i = 0; i < 6; i++) {
      db.assignments.push({ id: U.uid("a"), classId: i % 2 ? c2 : c1,
        title: "Assignment " + i, due: U.dateKey(U.addDays(new Date(), i - 2)),
        status: i % 3 === 0 ? "done" : "todo", points: 100,
        earned: i % 3 === 0 ? 88 : null, graded: i % 3 === 0,
        categoryId: "hw", termId: tid, type: "homework", estMinutes: 45 });
    }
    db.events.push({ id: U.uid("ev"), title: "Field trip", date: U.today(), start: "09:00", end: "14:00" });
    db.notes.push({ id: U.uid("n"), title: "Osmosis", body: "# Water\nMoves across membranes.",
      classId: c1, at: Date.now(), tags: ["bio"] });
    db.decks.push({ id: U.uid("d"), name: "Bio terms", classId: c1,
      cards: [{ id: U.uid("cd"), front: "Osmosis", back: "Water movement", box: 1 }] });
    db.goals.push({ id: U.uid("g"), title: "Read 20 books", target: 20, current: 5 });
    db.habits.push({ id: U.uid("h"), name: "Review notes", days: {} });
    db.studySessions.push({ id: U.uid("ss"), classId: c1, date: U.today(), minutes: 45, kind: "focus" });
    db.activities.push({ id: U.uid("act"), name: "Robotics", days: ["Mon"], start: "15:30", end: "17:00" });
    db.attendance.push({ id: U.uid("at"), date: U.today(), status: "present" });
    db.reading.push({ id: U.uid("r"), title: "Of Mice and Men", pages: 107, page: 30 });
    db.collegeApps.push({ id: U.uid("ap"), school: "State University", deadline: U.dateKey(U.addDays(new Date(), 60)),
      status: "planning", recs: [], essays: [] });
  });
});

/* ------------------------------------------------------------- the sweep -- */

async function sweepView(view) {
  await page.evaluate((v) => App.router.go(v), view);
  await page.waitForFunction((v) => {
    const r = document.querySelector("#page .view-root");
    return !!r && r.children.length > 0 && location.hash.includes(v);
  }, view, { timeout: 10000 });

  // Enumerate with one shared predicate, used identically every time the
  // view is re-rendered. An earlier version tagged elements with an index and
  // re-tagged after each click without re-applying the filter, so the indices
  // drifted and later clicks landed on the wrong element — which reported
  // working controls as inert. The list is rebuilt from scratch per click.
  const enumerate = (skipSel) => {
    const root = document.querySelector("#page .view-root");
    if (!root) return [];
    return [...root.querySelectorAll("button, [data-activatable], [role='button']")]
      .filter((el) => !el.disabled)
      .filter((el) => el.getClientRects().length > 0)
      .filter((el) => !skipSel.some((sel) => { try { return el.matches(sel); } catch (e) { return false; } }));
  };

  const controls = await page.evaluate((args) => {
    const [skipSel, src] = args;
    const fn = new Function("skipSel", "return (" + src + ")(skipSel)");
    return fn(skipSel).map((el, i) => ({
      i,
      label: (el.textContent || "").trim().slice(0, 30) || String(el.className).slice(0, 30),
      active: el.matches(args[2])
    }));
  }, [SKIP, enumerate.toString(), ALREADY_ACTIVE]);

  const dead = [];
  const unverified = [];
  for (const c of controls) {
    // Compare the whole markup, not its length: a toggled class or a swapped
    // label is often exactly the same number of characters.
    const snapshot = () => ({
      hash: location.hash,
      rev: App.store.rev(),
      modal: document.querySelectorAll(".modal-root").length,
      toasts: document.querySelectorAll(".toast").length,
      html: (document.querySelector("#page") || {}).innerHTML || "",
      shell: (document.getElementById("navScroll") || {}).innerHTML || "",
      focused: document.activeElement ? document.activeElement.className : ""
    });

    const before = await page.evaluate(snapshot);

    // Confirm the element at this index is still the one that was
    // enumerated before clicking it. Some controls change the view wholesale
    // (entering study mode, opening a detail pane), and the reset doesn't
    // always restore module-local state — so index i can resolve to a
    // different control, whose correct no-op would be blamed on the original.
    const clicked = await page.evaluate((args) => {
      const [skipSel, src, i, expected] = args;
      const fn = new Function("skipSel", "return (" + src + ")(skipSel)");
      const el = fn(skipSel)[i];
      if (!el) return "gone";
      const label = (el.textContent || "").trim().slice(0, 30) || String(el.className).slice(0, 30);
      if (label !== expected) return "moved";
      el.click();
      return "clicked";
    }, [SKIP, enumerate.toString(), c.i, c.label]);

    if (clicked !== "clicked") { unverified.push(`${c.label} (${clicked})`); continue; }

    await page.waitForTimeout(160);
    const after = await page.evaluate(snapshot);

    const changed = after.hash !== before.hash || after.rev !== before.rev ||
      after.modal !== before.modal || after.toasts !== before.toasts ||
      after.html !== before.html || after.shell !== before.shell ||
      after.focused !== before.focused;

    // An already-selected toggle doing nothing is the correct behaviour.
    if (!changed && !c.active) dead.push(c.label);

    // Reset. closeModal() unwinds one dialog, and some flows chain them
    // (edit -> confirm), so keep going until none are left — otherwise the
    // next iteration starts with a modal already open and its own modal
    // count looks unchanged, reporting a working control as dead.
    await page.evaluate(() => {
      for (let i = 0; i < 5 && document.querySelector(".modal-root"); i++) {
        if (App.ui.closeModal) App.ui.closeModal(); else break;
      }
    });
    await page.evaluate((v) => App.router.go(v), view);
    await page.waitForTimeout(100);
  }

  return { count: controls.length, dead, unverified };
}

console.log("\ncontrols: every clickable control does something");
const summary = [];
for (const v of VIEWS) {
  const r = await sweepView(v);
  summary.push({ view: v, ...r });
  ok(`${v} — ${r.count} controls, ${r.dead.length} inert` +
     (r.unverified.length ? `, ${r.unverified.length} skipped` : ""),
     r.dead.length === 0, r.dead.join(" | "));
  if (r.unverified.length) {
    // Not a failure: these moved or disappeared because a previous control
    // changed the view. Printed so the number is visible rather than hidden.
    console.log(`       skipped (view changed): ${r.unverified.join(", ")}`);
  }
}

console.log("\ncontrols: coverage");
const total = summary.reduce((n, s) => n + s.count, 0);
const deadTotal = summary.reduce((n, s) => n + s.dead.length, 0);
console.log(`  ${total} controls exercised across ${VIEWS.length} views, ${deadTotal} inert`);
ok("every view exposed at least one control", summary.every((s) => s.count > 0),
   summary.filter((s) => !s.count).map((s) => s.view).join(", "));

ok("no uncaught page errors during the sweep", errors.length === 0,
   [...new Set(errors)].slice(0, 4).join(" | "));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
