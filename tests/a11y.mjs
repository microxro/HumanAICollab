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
  "planner", "focus", "flashcards", "notes", "reading", "shop", "activities",
  "goals", "college", "guidance", "contacts", "analytics", "sharing", "groups",
  "parent", "settings", "assistant"
];

let pass = 0, fail = 0;
const all = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "\n       " + extra : ""}`); }
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
// Audited with reduced motion, which is not a way of dodging the problem —
// it is a setting real users have, and the app already honours it by cutting
// every transition to 0.01ms. Without it, axe can sample an element mid-fade
// under load: a half-transparent node computes a failing contrast ratio and
// the suite reports a violation for a state nobody ever reads. That produced
// exactly one intermittent "planner: color-contrast (2 nodes)" that vanished
// on re-run, and a suite that flakes trains you to re-run instead of look.
const ctx = await browser.newContext({ reducedMotion: "reduce" });
const page = await ctx.newPage();

await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(600);
const skip = page.locator("[data-skip]");
if (await skip.count()) { await skip.click(); await page.waitForTimeout(250); }

/**
 * Suppress toasts for the whole audit.
 *
 * A toast is fixed-position and floats over the page. axe's colour-contrast
 * check has to resolve the background behind each run of text and cannot when
 * something overlaps it, so it reports the *covered* element as a serious
 * violation. That is what produced an intermittent failure naming a different
 * dashboard element every run — not a colour problem at all, just whichever
 * text the "Synced" toast happened to be sitting on when axe sampled.
 *
 * Clearing the host per view wasn't enough: background sync fires its own
 * toast, so the clear raced the next one. Suppressing at the source removes
 * the race rather than narrowing it. The toast's own colours are covered by
 * the contrast maths in utils and by the components audit.
 */
await page.evaluate(() => {
  const style = document.createElement("style");
  style.textContent = "#toastHost { display: none !important; }";
  document.head.appendChild(style);
  if (window.App && App.ui) App.ui.toast = () => {};
});

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

  /**
   * Wait until the browser has actually recalculated styles for this theme.
   *
   * Setting data-theme and auditing immediately is a race the audit loses:
   * the attribute is on the element but computed values are still the old
   * theme's, so axe measured #10141f — the *light* foreground — against
   * #141926, the dark surface, and reported eight serious violations at
   * 1.04:1 for text that renders perfectly. It looked like a flake because
   * axe's own layout reads force the recalc partway through, so whether a
   * given element was sampled before or after the flush varied with load.
   *
   * Two animation frames were an improvement and still not a guarantee. This
   * *verifies* instead: it waits until a real element's computed colour
   * matches the --text token on :root. Both come from the same recalc, so
   * agreement means the recalc has landed rather than merely being likely to
   * have done.
   */
  await page.waitForFunction(() => {
    const root = document.documentElement;
    const el = document.querySelector("#page h1, #page h3, #page .card, #page p");
    if (!el) return false;
    const want = getComputedStyle(root).getPropertyValue("--text").trim();
    if (!want) return false;
    const toRgb = (c) => {
      const m = String(c).match(/^#?([0-9a-f]{6})$/i);
      if (m) {
        const n = parseInt(m[1], 16);
        return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
      }
      const r = String(c).match(/(\d+)\s*,?\s*(\d+)\s*,?\s*(\d+)/);
      return r ? `${r[1]},${r[2]},${r[3]}` : String(c);
    };
    // Some elements legitimately use --text-2/--text-3, so agreement on any
    // one element is enough; walk a few and accept the first that matches.
    const wantRgb = toRgb(want);
    return [...document.querySelectorAll("#page h1, #page h3, #page .card h3, #page .title")]
      .slice(0, 12)
      .some((n) => toRgb(getComputedStyle(n).color) === wantRgb);
  }, null, { timeout: 8000 });

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
               sample: (v.nodes[0] && v.nodes[0].html || "").slice(0, 110),
               // The reason, not just the element. A contrast failure without
               // its measured ratio and colours can't be acted on.
               why: v.nodes.slice(0, 8).map((n) => {
                 const d = (n.any && n.any[0] && n.any[0].data) || {};
                 return d.contrastRatio
                   ? `${d.contrastRatio}:1 ${d.fgColor} on ${d.bgColor} @${d.fontSize} — ${(n.html || "").slice(0, 50)}`
                   : ((n.any && n.any[0] && n.any[0].message) || "").slice(0, 90);
               }) });
  }
  return serious;
}

/* --------------------------------------------- avatar contrast, directly - */
// Pinned here as well as via axe, because the palette is data: a colour a
// user picks, or one added to PALETTE later, is not covered by auditing the
// handful of avatars that happen to be on screen. The default profile colour
// measured 4.41:1 against white and shipped that way.
console.log("\na11y: white initials clear AA on every avatar colour");
{
  const bad = await page.evaluate(() => {
    const U = App.utils, UI = App.ui;
    const swatches = [...(App.store.PALETTE || []), ...(App.store.PALETTE_DARK || []),
                      "#64748b", "#2a78d6", "#0ea5e9", "#22c55e", "#f59e0b", "#e11d48"];
    const out = [];
    for (const c of swatches) {
      // Read the colour the component actually renders, not the input.
      const html = UI.avatar("Alex Kim", c);
      const m = html.match(/background:([^"';]+)/);
      const rendered = m ? m[1].trim() : c;
      const ratio = U.contrastRatio("#ffffff", rendered);
      if (ratio < 4.5) out.push({ input: c, rendered, ratio: Math.round(ratio * 100) / 100 });
    }
    return out;
  });
  ok(`every avatar colour reaches 4.5:1 (${bad.length} failing)`, bad.length === 0,
     JSON.stringify(bad.slice(0, 5)));
}

console.log("\na11y: no critical or serious violations, light theme");
for (const v of VIEWS) {
  const bad = await auditView(v, "light");
  ok(`${v}`, bad.length === 0,
     bad.map((x) => `${x.id} (${x.impact}, ${x.nodes.length} nodes)\n       ${(x.nodes[0] && x.nodes[0].html || "").slice(0, 140)}`).join("; "));
}

console.log("\na11y: no critical or serious violations, dark theme");
for (const v of VIEWS) {
  const bad = await auditView(v, "dark");
  ok(`${v}`, bad.length === 0,
     bad.map((x) => `${x.id} (${x.impact}, ${x.nodes.length} nodes)\n       ${(x.nodes[0] && x.nodes[0].html || "").slice(0, 140)}`).join("; "));
}

if (all.length) {
  console.log("\n--- distinct violations ---");
  const byId = new Map();
  for (const a of all) {
    if (!byId.has(a.id)) byId.set(a.id, { impact: a.impact, views: new Set(), nodes: 0, sample: a.sample, why: a.why });
    const e = byId.get(a.id);
    e.views.add(a.view);
    e.nodes += a.n;
  }
  for (const [id, e] of [...byId].sort((x, y) => y[1].nodes - x[1].nodes)) {
    console.log(`  ${id} [${e.impact}] — ${e.nodes} nodes across ${e.views.size} views`);
    console.log(`    e.g. ${e.sample}`);
    for (const w of (e.why || [])) console.log(`      · ${w}`);
  }
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
