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
     • and every record an adult touched says so, in the views and in one
       change log, so nothing appears in a student's account anonymously

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

/* ------------------------------------------------ rendering the shell --- */
/*
 * A subject's dataset is built fresh, so it starts without anything v3 added.
 * migrate() only knows v1/v2 fields, so the backfill has to run on the way in
 * — this caught a real crash in effectivePinnedNav that took the whole shell
 * down the first time the nav painted for a child's account.
 */
console.log("\nacting: the app actually renders in a student's account");

const rendered = await page.evaluate(async () => {
  const S = App.store;
  S.actAs({ id: "kid-3", name: "Maya" });
  App.router.refresh();
  await new Promise((r) => setTimeout(r, 120));
  const bar = document.getElementById("actingBar");
  const out = {
    navPainted: (document.getElementById("navScroll") || {}).children.length > 0,
    viewPainted: !!document.querySelector("#page .view-root"),
    barShown: bar && !bar.hidden,
    barNames: bar ? bar.textContent.indexOf("Maya") !== -1 : false
  };
  S.actAs(null);
  App.router.refresh();
  await new Promise((r) => setTimeout(r, 120));
  out.barHiddenAfter = bar ? bar.hidden : false;
  return out;
});

ok("the nav still paints for a student's account", rendered.navPainted);
ok("and so does the view", rendered.viewPainted);
ok("the acting-as bar is shown", rendered.barShown);
ok("and it names whose account you're in", rendered.barNames);
ok("it goes away when you leave", rendered.barHiddenAfter);

/* --------------------------------------------------- who changed what --- */
/*
 * A parent now writes into records the student is looking at. A class that
 * appears on the timetable without the student adding it is confusing at best
 * and alarming at worst, so every record an adult touched has to say so — and
 * there has to be one place that answers "what changed?" without hunting
 * through five views.
 *
 * The stamps come from the server (netlify/functions/api.js stamps addedBy on
 * create and editedBy on a change). Here they are written directly, because
 * what is under test is the rendering, not the route.
 */
console.log("\nattribution: a record somebody else touched says who");

await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => window.App && App.store && App.store.db, null, { timeout: 15000 });
await page.waitForTimeout(400);
const w2 = await page.$(".modal [data-close]");
if (w2) { await w2.click(); await page.waitForTimeout(250); }

await page.evaluate(() => {
  const S = App.store;
  if (S.loadDemo) S.loadDemo();
  S.db.settings.onboarded = true;
  S.commit((db) => {
    db.classes[0].addedBy = "Mum";  db.classes[0].addedAt = Date.now() - 3600e3;
    db.periods[0].addedBy = "Mum";  db.periods[0].addedAt = Date.now() - 7200e3;
    // Two assignments, not all of them. Stamping the whole demo set pushed
    // the class and the period past changesByOthers()' limit and made this
    // read as a missing feature rather than a full page of results.
    db.assignments[1].addedBy = "Mum"; db.assignments[1].addedAt = Date.now();
    db.assignments[0].addedBy = "";
    db.assignments[0].editedBy = "Dad";
    db.assignments[0].editedAt = Date.now();
  });
});
await page.waitForTimeout(250);

const log = await page.evaluate(() => App.store.changesByOthers(20).map((c) => `${c.by}|${c.action}|${c.kind}`));
ok("the change log finds an added class", log.includes("Mum|added|class"), JSON.stringify(log.slice(0, 4)));
ok("and a period", log.includes("Mum|added|period"));
ok("and tells an edit apart from an add", log.includes("Dad|edited|assignment"));

const ownOnly = await page.evaluate(() => {
  App.store.commit((db) => {
    db.classes.forEach((c) => { c.addedBy = ""; c.editedBy = ""; });
    db.periods.forEach((p) => { p.addedBy = ""; p.editedBy = ""; });
    db.assignments.forEach((a) => { a.addedBy = ""; a.editedBy = ""; });
    db.events.forEach((e) => { e.addedBy = ""; e.editedBy = ""; });
  });
  return App.store.changesByOthers(20).length;
});
ok("a student who did everything themselves has an empty log", ownOnly === 0, String(ownOnly));

await page.evaluate(() => {
  App.store.commit((db) => {
    db.classes[0].addedBy = "Mum";
    db.periods[0].addedBy = "Mum";
    db.assignments.forEach((a) => { a.addedBy = "Mum"; a.addedAt = Date.now(); });
  });
});

const badged = await page.evaluate(async () => {
  const seen = {};
  const by = (sel) => [...document.querySelectorAll(sel)]
    .map((b) => b.textContent.trim()).filter((t) => /^(Added|Edited) by /.test(t));

  App.router.go("homework");
  await new Promise((r) => setTimeout(r, 500));
  seen.homework = by(".hw-sub .badge").length;

  App.router.go("classes");
  await new Promise((r) => setTimeout(r, 500));
  seen.classes = by("[data-class] .badge").length;

  App.views.classes.periodsEditor();
  await new Promise((r) => setTimeout(r, 350));
  seen.periods = by(".modal [data-period] .badge").length;

  // Saving the bell schedule used to rebuild every period from the three
  // inputs in its row, dropping the stamps entirely. Opening this editor and
  // pressing Save was enough to erase who set the schedule up.
  [...document.querySelectorAll(".modal button")].find((b) => /Save schedule/.test(b.textContent)).click();
  await new Promise((r) => setTimeout(r, 350));
  seen.periodStampsSurviveSave = App.store.db.periods.filter((p) => p.addedBy).length;

  return seen;
});

ok("assignment rows carry the badge", badged.homework > 0, String(badged.homework));
ok("class cards carry it", badged.classes > 0, String(badged.classes));
ok("bell-schedule rows carry it", badged.periods > 0, String(badged.periods));
ok("and saving the bell schedule doesn't erase the stamps",
   badged.periodStampsSurviveSave > 0, String(badged.periodStampsSurviveSave));

const shared = await page.evaluate(async () => {
  App.router.go("sharing");
  await new Promise((r) => setTimeout(r, 600));
  return {
    card: [...document.querySelectorAll(".card-head h3")].map((h) => h.textContent.trim())
      .includes("Changes by your parents"),
    rows: document.querySelectorAll("[data-go].list-item").length
  };
});
ok("the Sharing view shows the change log", shared.card);
ok("with a row per change", shared.rows > 0, String(shared.rows));

/* The badge is escaped: a guardian's display name is somebody else's input. */
const escaped = await page.evaluate(() => {
  const html = App.ui.byBadge({ addedBy: '<img src=x onerror=alert(1)>' });
  return { hasRaw: html.indexOf("<img") !== -1, hasEscaped: html.indexOf("&lt;img") !== -1 };
});
ok("a guardian's name is escaped in the badge", !escaped.hasRaw && escaped.hasEscaped, JSON.stringify(escaped));
ok("a record nobody else touched renders no badge",
   await page.evaluate(() => App.ui.byBadge({ addedBy: "", editedBy: "" }) === ""));

ok("no uncaught page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
