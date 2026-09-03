/* ==========================================================================
   tests/tour.mjs — U52, the guided tour a first-time visitor gets on open

   A tutorial is the one screen where "it renders" is worth almost nothing.
   The failures that matter are: it points at an element that no longer
   exists, it claims a feature the app doesn't have, it can't be left, or it
   comes back after being left. So this suite drives the real tour in a real
   browser and asserts each of those.

   The coverage check is the load-bearing one: every registered view must be
   either walked to by a step or named in a step, or the tour has quietly
   stopped being a tour of this app.
   ========================================================================== */

import { readFileSync } from "node:fs";
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import { resetSignedIn, signedInDevice } from "./stub/session.mjs";
const { chromium } = pw;

const BASE = process.env.BASE || "http://localhost:8899";
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

/** A page on a genuinely fresh install, with the tour already up. */
async function freshPage(opts) {
  const ctx = await browser.newContext(opts || {});
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  // A fresh install *on a signed-in device*: the tour is what a new student
  // meets after the login screen, not instead of it. Signed out there is no
  // app to tour — see tests/gate.mjs and tests/stub/session.mjs.
  await resetSignedIn(page);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);   // the first-run overlay fires on a 400ms timer
  return { ctx, page, errors };
}

/* ------------------------------------------------- it opens by itself -- */
console.log("\ntour: a fresh install is met by the tour");
{
  const { ctx, page, errors } = await freshPage();
  ok("the tour opened without being asked", (await page.locator(".tour-root").count()) === 1);
  ok("it is on step 1", /step 1 of/i.test(await page.locator(".tour-count").innerText()));
  ok("the progress bar has started", await page.evaluate(() =>
    parseFloat(document.querySelector(".tour-bar-fill").style.width) > 0));
  ok("no uncaught page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/* ------------------------------------------------ what it actually shows -- */
console.log("\ntour: it covers the app, not a corner of it");
{
  const { ctx, page, errors } = await freshPage();

  const info = await page.evaluate(async () => {
    const seenViews = [], missingTarget = [], centred = [], text = [];
    const total = App.tour.steps().length;
    for (let i = 0; i < total; i++) {
      const title = document.querySelector(".tour-title").textContent;
      const body = document.querySelector(".tour-text").textContent;
      text.push(title + " " + body);
      seenViews.push(App.router.current);
      const spot = document.querySelector(".tour-spot");
      const r = spot.getBoundingClientRect();
      if (spot.hidden) centred.push(title);
      else if (r.width < 8 || r.height < 8) missingTarget.push(title);
      if (i < total - 1) {
        document.querySelector("[data-tour-next]").click();
        await new Promise((res) => setTimeout(res, 120));
      }
    }
    return { total, seenViews, missingTarget, centred, text,
             views: Object.keys(App.views).map((id) => ({ id, title: App.views[id].title })) };
  });

  ok(`${info.total} steps, enough to be a tour`, info.total >= 15, String(info.total));
  ok("every step either spotlights a real element or is deliberately centred",
     info.missingTarget.length === 0, info.missingTarget.join(" | "));
  // The welcome and the sign-off speak about the app as a whole; anything
  // else with no spotlight is a step pointing at nothing.
  ok("only the opening and closing steps are centred", info.centred.length <= 2,
     info.centred.join(" | "));

  const visited = new Set(info.seenViews);
  const blob = info.text.join(" ").toLowerCase();
  const unmentioned = info.views.filter((v) =>
    !visited.has(v.id) && !blob.includes((v.title || v.id).toLowerCase()));
  ok(`all ${info.views.length} views are shown or named`, unmentioned.length === 0,
     unmentioned.map((v) => v.id).join(", "));
  ok("and most of them are actually walked to", visited.size >= 14, `${visited.size} visited`);

  // A step that names a view the app doesn't register is a tour of an app
  // that no longer exists.
  const src = readFileSync("js/tour.js", "utf8");
  const named = [...src.matchAll(/^\s*view: "([a-z]+)",/gm)].map((m) => m[1]);
  const ids = new Set(info.views.map((v) => v.id));
  ok("every step's view is a registered view", named.every((v) => ids.has(v)),
     named.filter((v) => !ids.has(v)).join(", "));

  ok("no uncaught page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/* ------------------------------------------------------- it is skippable -- */
console.log("\ntour: it can be left, from anywhere, permanently");
{
  const { ctx, page, errors } = await freshPage();

  // Skip is offered on every step but the last, where there is nothing left
  // to skip and the button reads Done instead.
  const missingSkip = await page.evaluate(async () => {
    const gone = [];
    const total = App.tour.steps().length;
    for (let i = 0; i < total - 1; i++) {
      const btn = document.querySelector(".tour-foot [data-tour-skip]");
      if (!btn || btn.hidden || !btn.getClientRects().length) {
        gone.push(document.querySelector(".tour-title").textContent);
      }
      document.querySelector("[data-tour-next]").click();
      await new Promise((res) => setTimeout(res, 80));
    }
    return gone;
  });
  ok("every step offers Skip", missingSkip.length === 0, missingSkip.join(" | "));
  await ctx.close();
}
{
  const { ctx, page, errors } = await freshPage();
  await page.evaluate(() => { for (let i = 0; i < 5; i++) document.querySelector("[data-tour-next]").click(); });
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  ok("Escape leaves it mid-tour", (await page.locator(".tour-root").count()) === 0);

  const flags = await page.evaluate(() => ({
    tour: App.store.settings.tourSeen, onboarded: App.store.settings.onboarded
  }));
  ok("leaving is recorded", flags.tour === true, JSON.stringify(flags));
  ok("and the wizard behind it is answered too", flags.onboarded === true, JSON.stringify(flags));

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  ok("it does not come back on the next load", (await page.locator(".tour-root").count()) === 0);
  ok("and neither does the setup wizard", (await page.locator(".modal-root").count()) === 0);
  ok("no uncaught page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/* ------------------------------------------------- and can be asked back -- */
console.log("\ntour: it is replayable once it has been dismissed");
{
  const { ctx, page, errors } = await freshPage();
  await page.locator(".tour-foot [data-tour-skip]").click();
  await page.waitForTimeout(250);

  await page.evaluate(() => App.router.go("settings"));
  await page.waitForTimeout(250);
  // Settings → About is where both first-run flows live.
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll("[data-tab]")].find((t) => /about|help|getting/i.test(t.textContent + t.dataset.tab));
    if (tab) tab.click();
  });
  await page.waitForTimeout(250);
  const btn = page.locator("[data-run-tour]");
  ok("Settings offers the tour", (await btn.count()) === 1);
  await btn.click();
  await page.waitForTimeout(400);
  ok("and starting it from there works", (await page.locator(".tour-root").count()) === 1);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  const inPalette = await page.evaluate(() => {
    App.ui.closeModal();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    const rows = [...document.querySelectorAll(".palette-list")].map((n) => n.textContent).join(" ");
    return /guided tour/i.test(rows);
  });
  ok("the command palette lists it too", inPalette);
  ok("no uncaught page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/* --------------------------------------------- a returning user is spared -- */
console.log("\ntour: an existing install is not walked through it unannounced");
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // A stored dataset from before the tour existed: no tourSeen anywhere in it.
  // With the token that makes it readable — data on a device with no session
  // is erased rather than migrated.
  await signedInDevice(page);
  await page.addInitScript(() => {
    localStorage.setItem("scholar.db.v2", JSON.stringify({
      schema: 2, settings: { theme: "light", onboarded: true },
      classes: [], assignments: [], terms: [], periods: [], events: [], notes: [],
      activities: [], attendance: [], streak: { count: 2, last: null }, account: {},
      ui: { view: "dashboard" }
    }));
  });
  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  ok("no tour for a dataset that predates it", (await page.locator(".tour-root").count()) === 0);
  ok("the flag was backfilled as seen", await page.evaluate(() => App.store.settings.tourSeen === true));
  ok("no uncaught page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/* ------------------------------------------- the app behind it is inert -- */
console.log("\ntour: the app is read-only while the tour is driving");
{
  const { ctx, page, errors } = await freshPage();
  const before = await page.evaluate(() => App.router.current);

  const navClick = await page.evaluate(() => {
    const el = document.querySelector('#navScroll [data-view="grades"]');
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { covered: !!top.closest(".tour-root") };
  });
  ok("a nav row cannot be clicked through the overlay", navClick.covered);

  await page.keyboard.press("n");   // the app's "new assignment" shortcut
  await page.waitForTimeout(250);
  ok("app shortcuts don't fire underneath it", (await page.locator(".modal-root").count()) === 0);
  ok("and the tour is still on its own step", (await page.evaluate(() => App.router.current)) === before);

  // Focus belongs to the card, and Tab must not walk out of it into an app
  // that cannot be operated.
  const focus = await page.evaluate(() => {
    const a = document.activeElement;
    return { inCard: !!(a && a.closest(".tour-card")), tag: a && a.tagName };
  });
  ok("focus starts inside the card", focus.inCard, JSON.stringify(focus));
  for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
  ok("Tab stays inside the card", await page.evaluate(() =>
    !!(document.activeElement && document.activeElement.closest(".tour-card"))));
  ok("no uncaught page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/* --------------------------------------- it borrows the router, not the data */
console.log("\ntour: walking the app is not the student's own navigation");
{
  const { ctx, page, errors } = await freshPage();
  const before = await page.evaluate(() => JSON.stringify({
    visits: App.store.db.navVisits, recent: App.store.db.recentViews
  }));

  await page.evaluate(async () => {
    const total = App.tour.steps().length;
    for (let i = 0; i < total; i++) {
      document.querySelector("[data-tour-next]").click();
      await new Promise((res) => setTimeout(res, 60));
    }
  });
  await page.waitForTimeout(400);

  ok("the tour finished", (await page.locator(".tour-root").count()) === 0);
  const after = await page.evaluate(() => JSON.stringify({
    visits: App.store.db.navVisits, recent: App.store.db.recentViews
  }));
  // U02 auto-pins the three most-visited screens. A tour that counted its own
  // twenty-odd visits would hand a brand-new student a Pinned group of
  // whatever it happened to walk past last.
  ok("nav-visit counts are untouched by the tour", before === after, `${before} -> ${after}`);
  ok("and it hands the screen back", (await page.evaluate(() => App.router.current)) === "dashboard");
  ok("no uncaught page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/* ------------------------------------------------------------- on a phone -- */
console.log("\ntour: on a phone it points at the phone's own controls");
{
  const { ctx, page, errors } = await freshPage({
    viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true
  });
  const ids = await page.evaluate(() => App.tour.steps());
  ok("the tab-bar step replaces the sidebar step",
     ids.includes("tabbar") && !ids.includes("nav"), ids.join(","));

  await page.locator("[data-tour-next]").click();
  await page.waitForTimeout(400);
  const geo = await page.evaluate(() => {
    const c = document.querySelector(".tour-card").getBoundingClientRect();
    const s = document.querySelector(".tour-spot").getBoundingClientRect();
    return { c: [c.top, c.bottom], s: [s.top, s.bottom],
             overlap: !(c.bottom <= s.top || c.top >= s.bottom),
             wide: c.width > 300 };
  });
  ok("the sheet is full width", geo.wide, JSON.stringify(geo));
  ok("and does not cover the control it is describing", !geo.overlap, JSON.stringify(geo));
  ok("no uncaught page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/* ------------------------------------------------------------------ axe -- */
console.log("\ntour: the overlay itself is accessible");
{
  const { ctx, page } = await freshPage({ reducedMotion: "reduce" });
  const axe = readFileSync("node_modules/axe-core/axe.min.js", "utf8");
  for (const step of [0, 2]) {
    if (step) {
      await page.evaluate((n) => {
        for (let i = 0; i < n; i++) document.querySelector("[data-tour-next]").click();
      }, step);
      await page.waitForTimeout(400);
    }
    await page.evaluate(axe);
    const res = await page.evaluate(async () => {
      const r = await window.axe.run(document.querySelector(".tour-root"),
        { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
      return r.violations
        .filter((v) => v.impact === "critical" || v.impact === "serious")
        .map((v) => `${v.id} (${v.nodes.length})`);
    });
    ok(`step ${step + 1}: no critical or serious violations`, res.length === 0, res.join(", "));
  }
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
