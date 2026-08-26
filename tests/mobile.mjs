/* ==========================================================================
   tests/mobile.mjs — every view at phone size, with a real touch pointer

   The desktop layout was checked by eye for a long time and the phone one
   was not, so this measures rather than trusts. Three properties, each of
   which was actually broken when this was written:

     • nothing scrolls sideways — a page wider than the viewport is the one
       layout bug a user cannot work around
     • controls meet a real touch size. The `@media (pointer: coarse)` rules
       lived in layout.css, which loads second of four, so every component
       size in components.css and views.css overrode them on cascade order
       alone. `.habit-day` asked for 36px and rendered 27px. Nothing caught
       it because nothing measured a laid-out page at coarse pointer.
     • page toolbars keep a primary action. Six buttons of equal weight
       wrapping into three ragged rows is not a hierarchy, and that is what
       Notes and Flashcards shipped.

   Deliberate exceptions, not oversights: checkboxes stay 24px (exactly the
   WCAG 2.2 AA minimum, SC 2.5.8 — a 44px painted box wrecks a dense list),
   chips and habit dots stay 36px because a 28-day grid of 44px targets does
   not fit a phone at all, and the U50 help-hint stays 16px because it is
   inline decoration on a heading — a 44px circle after three words of card
   title would dwarf the title. It first fires this check from a card header
   in Activities that renders unconditionally; the other five call sites
   (classes, flashcards, parent, schedule, sharing) sit behind a state the
   default demo data doesn't reach, which is exactly the kind of thing a
   census like this should not depend on.

   Run: node tests/mobile.mjs   (needs a static server, see tests/run.mjs)
   ========================================================================== */

import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.BASE || "http://localhost:8899";
const W = 375, H = 667;

const VIEWS = [
  "dashboard", "calendar", "schedule", "homework", "classes", "grades",
  "planner", "focus", "flashcards", "notes", "reading", "activities",
  "goals", "college", "guidance", "contacts", "analytics", "sharing", "groups",
  "parent", "settings", "assistant"
];

// Selectors allowed below the 40px bar — see the header for why each one is.
const EXEMPT = "(^|\\.)(check|chip|habit-day|due-inline|tab-item|cal-pill|dot|swatch|help-hint)(\\.|$)";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({
  viewport: { width: W, height: H },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => window.App && App.store && App.store.db, null, { timeout: 15000 });
await page.waitForTimeout(500);

// Real content, and past the welcome wizard — an empty app lays out fine and
// would hide every problem this suite exists to catch.
const closeBtn = await page.$(".modal [aria-label='Close'], .modal .icon-btn, .modal [data-close]");
if (closeBtn) { await closeBtn.click(); await page.waitForTimeout(300); }
await page.evaluate(() => {
  if (App.store.loadDemo) App.store.loadDemo();
  App.store.db.settings.onboarded = true;
  App.store.commit();
});
await page.waitForTimeout(300);

const results = [];
for (const v of VIEWS) {
  await page.evaluate((view) => App.router.go(view), v);
  await page.waitForTimeout(280);
  results.push(await page.evaluate((cfg) => {
    const exempt = new RegExp(cfg.exemptSrc);
    const sel = (el) => el.tagName.toLowerCase() + "." +
      String(el.className || "").trim().replace(/\s+/g, ".").slice(0, 40);

    const overflow = Math.max(0, document.documentElement.scrollWidth - cfg.vw);

    const small = [];
    document.querySelectorAll("#page button, #page input, #page select, #page textarea")
      .forEach((el) => {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) return;
        const s = sel(el);
        if (exempt.test(s)) return;
        if (b.height < 40) small.push(`${s} ${Math.round(b.width)}x${Math.round(b.height)}`);
      });

    // A toolbar with several actions must still name one primary.
    const bars = [];
    document.querySelectorAll("#page .page-actions").forEach((el) => {
      const vis = [...el.querySelectorAll(".btn")].filter((b) => b.getBoundingClientRect().height > 0);
      if (vis.length >= 3) bars.push(!!el.querySelector(".btn-primary"));
    });
    return { overflow, small: [...new Set(small)].slice(0, 6), barsWithoutPrimary: bars.filter((x) => !x).length };
  }, { vw: W, exemptSrc: EXEMPT }));
}

console.log(`\nmobile: no view scrolls sideways at ${W}px`);
results.forEach((r, i) => ok(VIEWS[i], r.overflow <= 1, `+${r.overflow}px`));

console.log("\nmobile: buttons, inputs and selects meet a touch size");
results.forEach((r, i) => ok(VIEWS[i], !r.small.length, r.small.join(", ")));

console.log("\nmobile: a crowded toolbar still names one primary action");
results.forEach((r, i) => ok(VIEWS[i], !r.barsWithoutPrimary,
  `${r.barsWithoutPrimary} toolbar(s) with 3+ buttons and no primary`));

ok("no uncaught page errors while walking every view", !errors.length, errors.slice(0, 3).join(" | "));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
