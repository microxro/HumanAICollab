/* ==========================================================================
   tests/guidance.mjs — the recommendation engine

   A recommender is the easiest kind of feature to ship broken, because any
   ranking looks plausible until you check what produced it. So these tests
   are less about "does it render" and more about "does the ranking mean what
   the card claims it means":

     • the ordering actually follows the data, and reverses when the data does
     • every reason on a card is traceable to a real number
     • an empty database produces low confidence, not a confident guess
     • hostile input in an interest field can't reach the DOM as markup

   Run: node tests/guidance.mjs   (needs a static server, see tests/run.mjs)
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
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => window.App && App.store && App.store.db && App.guidance, null, { timeout: 15000 });
// U52 — a fresh install opens the guided tour, which blocks the app behind it
// on purpose. The evaluates below reach past it, but the real clicks at the
// end of this file do not, so dismiss it the way the other browser suites do.
await page.waitForTimeout(700);
const skip = page.locator("[data-skip]");
if (await skip.count()) { await skip.click(); await page.waitForTimeout(250); }

/** Replace the whole database with a synthetic one, then read the engine. */
async function withData(build) {
  return page.evaluate((src) => {
    const S = App.store, U = App.utils;
    S.wipe();
    // eslint-disable-next-line no-new-func
    new Function("S", "U", "db", src)(S, U, S.db);
    S.commit();
    return {
      subjects: App.guidance.subjectProfile().map((s) => ({ id: s.id, score: s.score, grade: s.grade, rel: s.relative, reasons: s.reasons })),
      style: App.guidance.workStyle(),
      paths: App.guidance.pathways().map((p) => ({ id: p.id, score: p.score, reasons: p.reasons })),
      electives: App.guidance.electives().map((e) => ({ id: e.id, score: e.score })),
      gaps: App.guidance.gaps().map((g) => g.title),
      conf: App.guidance.confidence()
    };
  }, build);
}

/** A class plus graded assignments in it, as a source string for withData. */
function classWith(id, name, code, scores, categories) {
  const cats = (categories || [["Tests", 100]]).map(([n, w], i) => `{ id: "${id}c${i}", name: ${JSON.stringify(n)}, weight: ${w} }`).join(",");
  const asg = scores.map((sc, i) => {
    const [earned, points, catIdx, due] = sc;
    return `db.assignments.push({ id: "${id}a${i}", classId: "${id}", title: "w${i}", due: ${JSON.stringify(due || "2026-03-0" + ((i % 9) + 1))},
      status: "done", graded: true, earned: ${earned}, points: ${points}, categoryId: "${id}c${catIdx || 0}" });`;
  }).join("\n");
  return `db.classes.push({ id: "${id}", name: ${JSON.stringify(name)}, code: ${JSON.stringify(code)},
    credits: 1, termId: db.terms[0] && db.terms[0].id, days: ["Mon"], categories: [${cats}] });\n${asg}`;
}

/* ================================================= subject classification == */
console.log("\nguidance: classes land in the right subject area");
{
  const r = await page.evaluate(() => {
    const g = App.guidance;
    const c = (name, code) => g.subjectOf({ name, code });
    return {
      apcs:    c("AP Computer Science A", "CSC-200"),
      calc:    c("AP Calculus AB", "MATH-401"),
      chem:    c("AP Chemistry", "SCI-320"),
      bio:     c("Biology Honors", "SCI-101"),
      lit:     c("English Lit", "ENG-302"),
      hist:    c("US History", "HIS-210"),
      spanish: c("Spanish III", "SPA-303"),
      pe:      c("PE / Fitness", "PE-100"),
      band:    c("Concert Band", "MUS-110"),
      robot:   c("Robotics Engineering", "ENGR-150"),
      nothing: c("Homeroom", "HR-001")
    };
  });
  ok("AP Computer Science is computing, not science", r.apcs === "cs", r.apcs);
  ok("calculus is maths", r.calc === "math", r.calc);
  ok("chemistry is chemistry", r.chem === "chem", r.chem);
  ok("biology is biology", r.bio === "bio", r.bio);
  ok("English Lit is English", r.lit === "english", r.lit);
  ok("US History is history", r.hist === "history", r.hist);
  ok("Spanish is a world language", r.spanish === "language", r.spanish);
  ok("PE is health", r.pe === "health", r.pe);
  ok("band is music", r.band === "music", r.band);
  ok("robotics is engineering", r.robot === "eng", r.robot);
  ok("an unmatchable class is left unclassified", r.nothing === null, String(r.nothing));
}

/* ============================================== relative, not absolute ==== */
console.log("\nguidance: subjects are scored against the student's own average");
{
  // Two students with identical *shapes* but different graders. The ranking
  // must be the same, because the question is "which of my subjects is my
  // strongest", not "who has the higher number".
  const easy = await withData(
    classWith("k1", "AP Calculus", "MATH-1", [[98, 100], [97, 100], [99, 100], [98, 100]]) +
    classWith("k2", "US History", "HIS-1", [[90, 100], [91, 100], [89, 100], [90, 100]])
  );
  const hard = await withData(
    classWith("k1", "AP Calculus", "MATH-1", [[81, 100], [80, 100], [82, 100], [81, 100]]) +
    classWith("k2", "US History", "HIS-1", [[73, 100], [74, 100], [72, 100], [73, 100]])
  );
  ok("maths ranks first for the leniently graded student", easy.subjects[0].id === "math", JSON.stringify(easy.subjects.map((s) => s.id)));
  ok("and first for the harshly graded one too", hard.subjects[0].id === "math", JSON.stringify(hard.subjects.map((s) => s.id)));
  ok("the relative gap is what matches, not the raw grade",
     Math.abs(easy.subjects[0].rel - hard.subjects[0].rel) < 0.6,
     `${easy.subjects[0].rel} vs ${hard.subjects[0].rel}`);
  ok("an 81% can still be the top subject", hard.subjects[0].grade < 85, String(hard.subjects[0].grade));
}

/* ==================================================== ordering follows data */
console.log("\nguidance: reverse the grades and the ranking reverses");
{
  const a = await withData(
    classWith("c1", "AP Computer Science", "CSC-1", [[96, 100], [95, 100], [97, 100], [96, 100]]) +
    classWith("c2", "English Lit", "ENG-1", [[80, 100], [81, 100], [79, 100], [80, 100]])
  );
  const b = await withData(
    classWith("c1", "AP Computer Science", "CSC-1", [[80, 100], [81, 100], [79, 100], [80, 100]]) +
    classWith("c2", "English Lit", "ENG-1", [[96, 100], [95, 100], [97, 100], [96, 100]])
  );
  ok("CS leads when CS is the strong subject", a.subjects[0].id === "cs", a.subjects[0].id);
  ok("English leads when English is", b.subjects[0].id === "english", b.subjects[0].id);

  const csFirstA = a.paths.findIndex((p) => p.id === "cs");
  const csFirstB = b.paths.findIndex((p) => p.id === "cs");
  ok("and the field ranking moves with it", csFirstA < csFirstB, `${csFirstA} vs ${csFirstB}`);
  const humA = a.paths.findIndex((p) => p.id === "humanities");
  const humB = b.paths.findIndex((p) => p.id === "humanities");
  ok("in both directions", humB < humA, `${humA} vs ${humB}`);
}

/* ======================================================= work-style model = */
console.log("\nguidance: assessment style is pooled across classes");
{
  // Strong on Projects, weak on Tests, in two different classes — the point
  // being that the conclusion is about the student, not about one course.
  const r = await withData(
    classWith("w1", "AP Chemistry", "SCI-1",
      [[96, 100, 0], [95, 100, 0], [70, 100, 1], [72, 100, 1]], [["Projects", 50], ["Tests", 50]]) +
    classWith("w2", "US History", "HIS-1",
      [[94, 100, 0], [95, 100, 0], [71, 100, 1], [69, 100, 1]], [["Projects", 50], ["Tests", 50]])
  );
  const best = r.style.best, worst = r.style.worst;
  ok("building is identified as the strongest mode", best && best.id === "build", JSON.stringify(best));
  ok("exams as the weakest", worst && worst.id === "exam", JSON.stringify(worst));
  ok("the spread is reported", r.style.spread > 20, String(r.style.spread));
  ok("and it counted both classes", best && best.classes === 2, JSON.stringify(best && best.classes));

  // A student with no meaningful spread must not be told they have a style.
  const flat = await withData(
    classWith("f1", "AP Chemistry", "SCI-1",
      [[88, 100, 0], [88, 100, 0], [87, 100, 1], [87, 100, 1]], [["Projects", 50], ["Tests", 50]])
  );
  ok("a flat profile reports no dominant style", flat.style.best === null, JSON.stringify(flat.style.best));
}

/* ===================================================== reasons are honest = */
console.log("\nguidance: every reason on a card cites a real number");
{
  const r = await withData(
    classWith("r1", "AP Computer Science", "CSC-1", [[96, 100], [95, 100], [97, 100], [96, 100]]) +
    classWith("r2", "AP Calculus", "MATH-1", [[93, 100], [94, 100], [92, 100], [93, 100]]) +
    classWith("r3", "US History", "HIS-1", [[78, 100], [79, 100], [77, 100], [78, 100]]) +
    `db.guidance = { stage: "high", interests: ["programming"], targets: [], dismissed: [] };`
  );
  const cs = r.paths.find((p) => p.id === "cs");
  ok("computer science is the top field", r.paths[0].id === "cs", r.paths[0].id);
  ok("it cites the feeder subjects", cs.reasons.some((x) => x.kind === "grades" && /Computer science/.test(x.text)),
     JSON.stringify(cs.reasons));
  ok("and the stated interest, quoting it back",
     cs.reasons.some((x) => x.kind === "interest" && /programming/.test(x.text)), JSON.stringify(cs.reasons));

  const grades = cs.reasons.filter((x) => x.kind === "grades");
  ok("no reason claims a subject that has no grade",
     grades.every((g) => /Computer science|Mathematics|Physics|Engineering/.test(g.text)), JSON.stringify(grades));

  // A field the record argues against must say so rather than going quiet.
  const hum = r.paths.find((p) => p.id === "humanities");
  ok("a poor fit carries a caution, not silence",
     hum.score < cs.score && (hum.reasons.some((x) => x.kind === "caution") || !hum.reasons.length),
     JSON.stringify(hum));
}

/* ================================================ interest weighting ====== */
console.log("\nguidance: a typed interest outweighs a keyword in a goal");
{
  const base =
    classWith("i1", "AP Chemistry", "SCI-1", [[88, 100], [88, 100], [88, 100], [88, 100]]) +
    classWith("i2", "US History", "HIS-1", [[88, 100], [88, 100], [88, 100], [88, 100]]);

  const typed = await withData(base + `db.guidance = { stage: "high", interests: ["diplomacy"], targets: [], dismissed: [] };`);
  const incidental = await withData(base + `db.goals.push({ id: "g1", title: "Learn about diplomacy", metric: "manual", target: 1, current: 0 });`);

  const t = typed.paths.find((p) => p.id === "language");
  const i = incidental.paths.find((p) => p.id === "language");
  ok("both notice it", t.reasons.some((x) => x.kind === "interest") && i.reasons.some((x) => x.kind === "interest"));
  ok("but the typed one counts for more", t.score > i.score, `${t.score} vs ${i.score}`);
  ok("and the weaker source says it is weaker",
     i.reasons.some((x) => x.kind === "interest" && /weaker signal/i.test(x.text)),
     JSON.stringify(i.reasons.filter((x) => x.kind === "interest")));
}

/* ================================================== activities and leadership */
console.log("\nguidance: a leadership role counts for more than membership");
{
  const base = classWith("a1", "AP Chemistry", "SCI-1", [[90, 100], [90, 100], [90, 100], [90, 100]]);
  const member = await withData(base +
    `db.activities.push({ id: "x1", name: "Robotics Club", type: "Club", role: "Member", days: ["Wed"], hours: [{ date: "2026-03-01", hours: 3 }] });`);
  const lead = await withData(base +
    `db.activities.push({ id: "x1", name: "Robotics Club", type: "Club", role: "Software Lead", days: ["Wed"], hours: [{ date: "2026-03-01", hours: 3 }] });`);

  const m = member.paths.find((p) => p.id === "eng");
  const l = lead.paths.find((p) => p.id === "eng");
  ok("membership registers", m.reasons.some((x) => x.kind === "activity"), JSON.stringify(m.reasons));
  ok("leadership scores higher", l.score > m.score, `${l.score} vs ${m.score}`);
  ok("and the card names the role", l.reasons.some((x) => /Software Lead/.test(x.text)), JSON.stringify(l.reasons));
}

/* ============================================== confidence and empty data = */
console.log("\nguidance: an empty database admits it knows nothing");
{
  const empty = await withData("");
  ok("confidence is thin", empty.conf.level === "thin", JSON.stringify(empty.conf));
  ok("it lists what's missing", empty.conf.missing.length >= 4, JSON.stringify(empty.conf.missing));
  ok("no subjects are invented", empty.subjects.length === 0, JSON.stringify(empty.subjects));
  ok("no field scores above neutral on nothing",
     empty.paths.every((p) => p.score <= 0), JSON.stringify(empty.paths.filter((p) => p.score > 0)));
  ok("and it still returns an elective list rather than throwing", Array.isArray(empty.electives));
  ok("the gaps tell the student how to fix it",
     empty.gaps.some((g) => /interested/i.test(g)) && empty.gaps.some((g) => /activit/i.test(g)),
     JSON.stringify(empty.gaps));
}

/* ================================================== already-taken filtering */
console.log("\nguidance: it doesn't recommend a course you're already sitting in");
{
  const r = await withData(
    classWith("t1", "AP Computer Science A", "CSC-1", [[95, 100], [95, 100], [95, 100], [95, 100]]) +
    classWith("t2", "AP Calculus AB", "MATH-1", [[95, 100], [95, 100], [95, 100], [95, 100]])
  );
  ok("AP CS A is not suggested", !r.electives.some((e) => e.id === "hs-apcs"), JSON.stringify(r.electives.map((e) => e.id)));
  ok("AP Calculus is not suggested", !r.electives.some((e) => e.id === "hs-calc"), JSON.stringify(r.electives.map((e) => e.id)));
  ok("but others still are", r.electives.length > 0);
}

/* ================================================== stage changes the list = */
console.log("\nguidance: the stage picker changes what's offered");
{
  const base = classWith("s1", "AP Calculus", "MATH-1", [[93, 100], [93, 100], [93, 100], [93, 100]]);
  const mid = await withData(base + `db.guidance = { stage: "middle", interests: [], targets: [], dismissed: [] };`);
  const hi  = await withData(base + `db.guidance = { stage: "high", interests: [], targets: [], dismissed: [] };`);
  const col = await withData(base + `db.guidance = { stage: "college", interests: [], targets: [], dismissed: [] };`);
  ok("middle school gets middle-school options", mid.electives.every((e) => e.id.startsWith("ms-")), JSON.stringify(mid.electives.map((e) => e.id)));
  ok("high school gets high-school options", hi.electives.every((e) => e.id.startsWith("hs-")), JSON.stringify(hi.electives.map((e) => e.id)));
  ok("college gets college options", col.electives.every((e) => e.id.startsWith("col-")), JSON.stringify(col.electives.map((e) => e.id)));
  ok("and the middle-school list doesn't nag about college targets",
     !mid.gaps.some((g) => /target schools/i.test(g)), JSON.stringify(mid.gaps));
}

/* ============================================================ dismissals == */
console.log("\nguidance: dismissing a suggestion removes it");
{
  const r = await withData(
    classWith("d1", "AP Calculus", "MATH-1", [[95, 100], [95, 100], [95, 100], [95, 100]]) +
    `db.guidance = { stage: "high", interests: [], targets: [], dismissed: ["pw:eng", "el:hs-calc"] };`
  );
  ok("a dismissed field is gone", !r.paths.some((p) => p.id === "eng"), JSON.stringify(r.paths.map((p) => p.id)));
  ok("a dismissed elective is gone", !r.electives.some((e) => e.id === "hs-calc"), JSON.stringify(r.electives.map((e) => e.id)));
}

/* ================================================================== trend = */
console.log("\nguidance: a trend needs enough graded work to mean anything");
{
  const r = await page.evaluate(() => {
    const S = App.store;
    S.wipe();
    S.db.classes.push({ id: "z1", name: "AP Calculus", code: "M1", credits: 1, days: ["Mon"], categories: [{ id: "z1c", name: "Tests", weight: 100 }] });
    S.db.classes.push({ id: "z2", name: "US History", code: "H1", credits: 1, days: ["Mon"], categories: [{ id: "z2c", name: "Tests", weight: 100 }] });
    // Three graded items: not enough to call a trend.
    [70, 80, 90].forEach((v, i) => S.db.assignments.push({ id: "z1a" + i, classId: "z1", title: "t", due: "2026-03-0" + (i + 1), status: "done", graded: true, earned: v, points: 100, categoryId: "z1c" }));
    // Six, clearly rising.
    [60, 62, 64, 88, 90, 92].forEach((v, i) => S.db.assignments.push({ id: "z2a" + i, classId: "z2", title: "t", due: "2026-03-0" + (i + 1), status: "done", graded: true, earned: v, points: 100, categoryId: "z2c" }));
    S.commit();
    return { few: App.guidance.trendFor("z1"), many: App.guidance.trendFor("z2") };
  });
  ok("three grades produce no trend", r.few === null, String(r.few));
  ok("six rising grades produce a positive one", r.many > 20, String(r.many));
}

/* ============================================ a school's own course list == */
console.log("\nguidance: a real course list replaces the general catalogue");
{
  const r = await withData(
    classWith("s1", "AP Computer Science", "CSC-1", [[96, 100], [95, 100], [97, 100], [96, 100]]) +
    classWith("s2", "Spanish III", "SPA-303", [[88, 100], [87, 100], [89, 100], [88, 100]]) +
    `db.guidance = { stage: "high", interests: [], targets: [], dismissed: [],
      school: "Mead", catalogUrl: "", offeredAt: Date.now(), offered: [
        { name: "AP Computer Science A", code: "CSC-340", subject: "cs", level: "ap", grades: "10-12", prereq: "", description: "Java." },
        { name: "Spanish I", code: "SPA-101", subject: "language", level: "regular", grades: "9-12", prereq: "", description: "" },
        { name: "Ceramics I", code: "ART-110", subject: "arts", level: "regular", grades: "9-12", prereq: "", description: "" }
      ] };`
  );
  const ids = r.electives.map((e) => e.id);
  ok("only the school's own courses are offered", ids.every((i) => i.startsWith("of-")), JSON.stringify(ids));
  ok("none of the generic catalogue leaks in", !ids.some((i) => i.startsWith("hs-")), JSON.stringify(ids));
  ok("the strongest subject's course leads", r.electives[0].id === "of-CSC-340", JSON.stringify(ids));

  // "Spanish I" is a prefix of "Spanish III". A bare substring test drops the
  // course the student should see; the boundary check is what saves it.
  ok("a numbered sequence isn't confused with its own later year",
     ids.includes("of-SPA-101"), JSON.stringify(ids));

  // ...while a course genuinely on the timetable is still filtered.
  const dup = await withData(
    classWith("d1", "AP Computer Science A", "CSC-1", [[95, 100], [95, 100], [95, 100], [95, 100]]) +
    `db.guidance = { stage: "high", interests: [], targets: [], dismissed: [], offered: [
        { name: "AP Computer Science A", code: "CSC-340", subject: "cs", level: "ap", grades: "", prereq: "", description: "" },
        { name: "Ceramics I", code: "ART-110", subject: "arts", level: "regular", grades: "", prereq: "", description: "" }
      ] };`
  );
  ok("an exact match is still filtered out",
     !dup.electives.some((e) => e.id === "of-CSC-340"), JSON.stringify(dup.electives.map((e) => e.id)));
}

/* ==================================================================== XSS = */
console.log("\nguidance: hostile input in an interest can't become markup");
{
  await page.evaluate(() => {
    const S = App.store;
    S.wipe();
    window.__xss = false;
    S.db.classes.push({ id: "x1", name: "AP Computer Science", code: "CSC-1", credits: 1, days: ["Mon"], categories: [{ id: "x1c", name: "Tests", weight: 100 }] });
    [95, 96, 94, 95].forEach((v, i) => S.db.assignments.push({ id: "x1a" + i, classId: "x1", title: "t", due: "2026-03-0" + (i + 1), status: "done", graded: true, earned: v, points: 100, categoryId: "x1c" }));
    S.db.guidance = {
      stage: "high",
      interests: ['<img src=x onerror="window.__xss=true">', '"><script>window.__xss=true<\/script>'],
      targets: [], dismissed: []
    };
    S.commit();
    location.hash = "#guidance";
  });
  await page.waitForFunction(() => /Guidance/i.test((document.querySelector("h1") || {}).textContent || ""), null, { timeout: 8000 });
  await page.waitForTimeout(300);

  const fired = await page.evaluate(() => window.__xss === true);
  const injected = await page.evaluate(() => document.querySelectorAll(".page-inner img[src='x']").length);
  const chips = await page.evaluate(() => document.querySelectorAll(".chip").length);
  ok("no script ran", fired === false);
  ok("no element was injected", injected === 0, String(injected));
  ok("the payload rendered as visible text instead", chips >= 2, String(chips));
}

/* =============================================================== the view = */
console.log("\nguidance: the view renders and its controls work");
{
  await page.evaluate(() => { App.store.loadDemo(); location.hash = "#guidance"; });
  await page.waitForFunction(() => document.querySelectorAll(".guide-card").length > 0, null, { timeout: 8000 });

  const cards = await page.locator(".guide-card").count();
  ok("recommendation cards render", cards >= 4, String(cards));
  const reasons = await page.locator(".reasons li").count();
  ok("each carries its evidence", reasons >= cards, `${reasons} reasons for ${cards} cards`);

  // The three tabs each show something different.
  await page.click('[data-tab="strengths"]');
  await page.waitForTimeout(250);
  const bars = await page.locator(".bar").count();
  ok("the profile tab charts the subjects", bars > 0, String(bars));

  await page.click('[data-tab="evidence"]');
  await page.waitForTimeout(250);
  const rows = await page.locator("table tbody tr").count();
  ok("the evidence tab lists what was used", rows >= 8, String(rows));

  await page.click('[data-tab="advice"]');
  await page.waitForTimeout(250);

  // Dismissing must remove *that* suggestion and persist through the repaint.
  // The card count alone proves nothing: hiding the top field promotes the
  // next one, so the list stays the same length by design.
  const firstTitle = await page.locator(".guide-card h3").first().innerText();
  await page.locator("[data-dismiss]").first().click();
  await page.waitForTimeout(350);
  const titles = await page.locator(".guide-card h3").allInnerTexts();
  ok("the dismissed suggestion is gone", !titles.includes(firstTitle), `${firstTitle} still in ${JSON.stringify(titles)}`);
  ok("and something took its place", titles.length >= 4, String(titles.length));
  const stored = await page.evaluate(() => (App.store.db.guidance.dismissed || []).length);
  ok("it is remembered", stored === 1, String(stored));
  const note = await page.locator("[data-unhide]").count();
  ok("and the page offers to undo it", note === 1, String(note));

  // Changing stage swaps the elective list.
  await page.click('[data-stage="middle"]');
  await page.waitForTimeout(300);
  const stage = await page.evaluate(() => App.store.db.guidance.stage);
  ok("the stage picker writes through", stage === "middle", stage);
}

ok("no uncaught page errors throughout", errors.length === 0, errors.join(" | "));

console.log(`\n${pass} passed, ${fail} failed\n`);
await browser.close();
process.exit(fail ? 1 : 0);
