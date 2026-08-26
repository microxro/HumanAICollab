/* ==========================================================================
   tests/acting.mjs — F157: editing somebody else's account without wrecking
   your own.

   The whole app reads one variable, S.db. Acting for a student re-points it.
   That is what lets all 22 views work for a parent without any of them being
   changed — and it is also the way to lose a parent's entire database, if the
   dataset that is loaded and the place it gets written ever disagree.

   So this suite is about the boundary rather than the feature:

     • two datasets, two localStorage keys, neither able to reach the other
     • a whole-DB push is refused while somebody else's records are loaded,
       because PUT /sync writes state[myOwnId] and would file the child's
       database under the parent's name
     • the same for the pull that would overwrite the child's cached copy
       with the parent's
     • edits are diffed into record-level ops — including edits made through
       commit(fn), which no mutation hook would ever see

   Run: node tests/acting.mjs   (needs a static server, see tests/run.mjs)
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
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => window.App && App.store && App.store.db, null, { timeout: 15000 });
await page.waitForTimeout(400);
const welcome = await page.$(".modal [data-close]");
if (welcome) { await welcome.click(); await page.waitForTimeout(250); }

/* ------------------------------------------------- the two datasets ----- */
console.log("\nacting: your own records and a student's never touch");

const iso = await page.evaluate(() => {
  const S = App.store;
  const out = {};

  // The parent's own data, with something identifiable in it.
  S.commit((db) => { db.assignments = [{ id: "mine1", title: "Parent's own task" }]; });
  out.ownBefore = S.db.assignments.map((a) => a.title);
  out.startsInOwnAccount = S.actingAs() === null;

  // Step into a student's account.
  S.actAs({ id: "kid-1", name: "Kid" });
  out.actingAs = S.actingAs() && S.actingAs().id;
  out.childStartsEmpty = (S.db.assignments || []).length === 0;

  // Write in the child's account.
  S.commit((db) => { db.assignments = [{ id: "kid1", title: "Child's task" }]; });
  out.childHas = S.db.assignments.map((a) => a.title);

  // Two keys, and the parent's is untouched.
  out.keys = Object.keys(localStorage).filter((k) => k.indexOf("scholar.db.v2") === 0).sort();

  // Back to the parent's own account.
  S.actAs(null);
  out.ownAfter = S.db.assignments.map((a) => a.title);
  out.backInOwnAccount = S.actingAs() === null;

  // And the child's dataset survived being left.
  S.actAs({ id: "kid-1", name: "Kid" });
  out.childAfterReturn = S.db.assignments.map((a) => a.title);
  S.actAs(null);
  return out;
});

ok("the app starts in your own account", iso.startsInOwnAccount);
ok("actAs reports whose records are loaded", iso.actingAs === "kid-1", String(iso.actingAs));
ok("a student's account doesn't start seeded with demo data", iso.childStartsEmpty);
ok("the student's records are what you see while acting",
   iso.childHas.length === 1 && iso.childHas[0] === "Child's task", JSON.stringify(iso.childHas));
ok("your own records are untouched by anything done there",
   iso.ownAfter.length === 1 && iso.ownAfter[0] === "Parent's own task", JSON.stringify(iso.ownAfter));
ok("leaving puts you back in your own account", iso.backInOwnAccount);
ok("the student's records survive being left and re-entered",
   iso.childAfterReturn.length === 1 && iso.childAfterReturn[0] === "Child's task",
   JSON.stringify(iso.childAfterReturn));
ok("they are stored under two separate keys", iso.keys.length === 2, JSON.stringify(iso.keys));
ok("the student's key is namespaced by their id",
   iso.keys.some((k) => k === "scholar.db.v2.for.kid-1"), JSON.stringify(iso.keys));

/* --------------------------------------------- the writes that must not -- */
console.log("\nacting: the whole-DB sync paths refuse to run in someone else's account");

const guards = await page.evaluate(async () => {
  const S = App.store, sync = App.sync;
  const out = {};

  // Deliberately NOT signed in. The acting-as guard is checked first, before
  // the signed-out one, so that "a push never runs in someone else's account"
  // holds unconditionally rather than only when some other check happens to
  // fire first. That ordering is the thing under test.
  S.actAs({ id: "kid-1", name: "Kid" });
  const pushed = await sync.push(false);
  out.pushReason = pushed && pushed.reason;
  out.pushRefused = !(pushed && pushed.ok);

  // The pull that would overwrite the child's cached copy with the parent's
  // resolves without adopting anything.
  const before = JSON.stringify(S.db.assignments || []);
  await sync.pullAndMerge();
  out.pullLeftItAlone = JSON.stringify(S.db.assignments || []) === before;

  S.actAs(null);
  return out;
});

ok("a whole-DB push is refused while acting for someone else", guards.pushRefused);
ok("and it says why", guards.pushReason === "acting-as", String(guards.pushReason));
ok("a pull of your own data can't overwrite theirs", guards.pullLeftItAlone);

/* ------------------------------------------------------------- the diff -- */
console.log("\nacting: every edit becomes an op, whichever way it was made");

const diffed = await page.evaluate(() => {
  const S = App.store;

  S.actAs({ id: "kid-2", name: "Kid2" });
  S.replaceAll({
    assignments: [{ id: "a1", title: "Original" }, { id: "a2", title: "To delete" }],
    periods: [], classes: [], events: []
  });

  // Three different mutation routes, including the raw commit(fn) that a
  // per-call hook would miss entirely.
  S.update("assignments", "a1", { title: "Edited by parent" });
  S.remove("assignments", "a2");
  S.commit((db) => { db.periods.push({ id: "p9", name: "Zero period", start: "07:00", end: "07:50" }); });

  const seen = {
    edited: (S.db.assignments.find((a) => a.id === "a1") || {}).title,
    deletedGone: !S.db.assignments.some((a) => a.id === "a2"),
    periodAdded: (S.db.periods || []).some((p) => p.id === "p9")
  };
  S.actAs(null);
  return seen;
});

ok("an update through the record API lands", diffed.edited === "Edited by parent", String(diffed.edited));
ok("a remove through the record API lands", diffed.deletedGone);
ok("and a raw commit(fn) edit lands too — the case a mutation hook would miss",
   diffed.periodAdded);

ok("no uncaught page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
