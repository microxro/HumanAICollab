/* ==========================================================================
   tests/gate.mjs — the login screen is first, and signed out nothing is kept

   Two promises are made to whoever opens this app on a borrowed laptop, and
   both are the kind that are worth nothing unless they are checked:

     1. The login screen is what loads. Not a dashboard with a sign-in button
        in the corner — the app is not reachable behind it, and it is not
        dismissible by leaning on Escape or clicking beside it.

     2. Signed out, this browser keeps nothing. Not the database, not the
        reminder log, not an attachment, not on a refresh and not after the
        tab is closed. The one exception is deliberate and explicit: the
        visitor chose "continue without saving", and even then nothing is
        written — the session simply ends with the tab.

   The interesting cases are the ones where data already exists: a device
   holding a previous student's records with no session to justify them, and
   a session the server has since retired. Both must end with an empty
   browser, because "we stop writing from now on" would leave the previous
   student's grades sitting there for whoever opens the tab next.

   Run: node tests/gate.mjs   (needs a static server; tests/run.mjs starts one)
   ========================================================================== */

import { readFileSync, existsSync } from "node:fs";
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { TOKEN_KEY, TEST_TOKEN } from "./stub/session.mjs";

const BASE = process.env.BASE || "http://localhost:8899";
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

/** Somebody else's data, sitting in the browser. */
const PRIOR_STUDENT = {
  schema: 2,
  profile: { name: "Priya Patel", school: "Northgate", grade: "11", color: "#2a78d6", parentEmail: "mum@home.example" },
  settings: { onboarded: true },
  terms: [{ id: "t1", name: "Fall", start: "2026-08-01", end: "2026-12-20", current: true }],
  classes: [], assignments: [], account: {}, ui: { view: "dashboard" }
};

/** The API a signed-in session would be talking to, with no server behind it. */
const USER = { id: "u1", email: "sam@school.edu", name: "Sam", role: "student" };
async function stubApi(ctx, state) {
  const box = state || { cloud: null, version: 0 };
  await ctx.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api/, "");
    const json = (s, b) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(b) });
    if (path === "/auth/login" || path === "/auth/signup") {
      const body = JSON.parse(req.postData() || "{}");
      if (body.password === "wrong") return json(401, { error: "Invalid email or password." });
      return json(200, { token: "tok-" + Date.now(), user: USER });
    }
    if (path === "/me") return json(200, { user: USER });
    if (path === "/health") return json(200, { ok: true, email: { deliverable: false } });
    if (path === "/sync" && req.method() === "GET") {
      return json(200, box.cloud ? { state: box.cloud, version: box.version, updatedAt: Date.now() } : { state: null, version: 0 });
    }
    if (path === "/sync" && req.method() === "PUT") {
      box.cloud = JSON.parse(req.postData()).state;
      box.version++;
      return json(200, { version: box.version, updatedAt: Date.now() });
    }
    return json(200, {});
  });
  return box;
}

/** Close whichever first-run overlay is up — the U52 tour or the U49 wizard. */
async function dismissFirstRun(page) {
  const tourSkip = page.locator(".tour-root [data-tour-skip], .tour-root [data-skip]");
  if (await tourSkip.count()) { await tourSkip.first().click(); await page.waitForTimeout(350); }
  const wizardSkip = page.locator("[data-skip]");
  if (await wizardSkip.count()) { await wizardSkip.first().click(); await page.waitForTimeout(300); }
  const close = page.locator(".modal-root [data-close]");
  if (await close.count()) { await close.first().click(); await page.waitForTimeout(250); }
}

const keysIn = (page) => page.evaluate(() => Object.keys(localStorage).sort());
const idbCount = (page) => page.evaluate(() => App.idb.keys().then((k) => k.length).catch(() => -1));

/* ==================================================== the gate is first == */
console.log("\ngate: a first visit lands on the login screen, not the app");
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  ok("the login screen is up", (await page.locator(".gate-root").count()) === 1);
  ok("no uncaught page errors", errors.length === 0, errors.join(" | "));
  ok("the app shell is not visible behind it", await page.locator(".shell").isHidden());
  ok("neither is the mobile tab bar", await page.locator("#mobileTabbar").isHidden());
  ok("nor the floating add button", await page.locator("#fabAdd").isHidden());
  ok("the first field has focus", (await page.evaluate(() => document.activeElement.id)) === "gateEmail");
  ok("it announces itself as a dialog", (await page.locator(".gate-card[role='dialog']").count()) === 1);

  // Neither first-run overlay may be running behind the gate. The U52 tour
  // would be walking somebody through an app they cannot see; the U49 wizard
  // would be collecting a bell schedule and a class into a store that is not
  // keeping them. Both are afterAuth's, not boot's.
  await page.waitForTimeout(600);   // both fire on a 400ms timer
  ok("the guided tour has not started", (await page.locator(".tour-root").count()) === 0);
  ok("the setup wizard has not started", (await page.locator(".modal-root").count()) === 0);

  // A gate that opens when you lean on it is a door.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  ok("Escape does not dismiss it", (await page.locator(".gate-root").count()) === 1);
  await page.mouse.click(5, 5);
  await page.waitForTimeout(200);
  ok("clicking outside the card does not dismiss it", (await page.locator(".gate-root").count()) === 1);

  ok("nothing was written to this browser", (await keysIn(page)).length === 0,
     JSON.stringify(await keysIn(page)));
  await ctx.close();
}

/* ============================================ somebody else's data on disk = */
console.log("\ngate: data left behind without a session is erased, not shown");
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript((s) => localStorage.setItem("scholar.db.v2", JSON.stringify(s)), PRIOR_STUDENT);
  // An attachment, which lives in IndexedDB rather than localStorage and so
  // survives every sweep that only knows about the latter.
  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  await page.evaluate(() => App.idb.put("f1", new Blob(["a private lab report"], { type: "text/plain" })));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  ok("the login screen is up", (await page.locator(".gate-root").count()) === 1);
  ok("the stored database is gone", (await keysIn(page)).length === 0, JSON.stringify(await keysIn(page)));
  ok("the stored files are gone too", (await idbCount(page)) === 0, String(await idbCount(page)));

  const inMemory = await page.evaluate(() => App.store.profile.name);
  ok("and it was never loaded into memory", inMemory === "", JSON.stringify(inMemory));
  await ctx.close();
}

/* ================================================ signed out writes nothing = */
console.log("\ngate: a memory-only session leaves no trace");
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await stubApi(ctx);
  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  await page.locator("[data-skip-auth]").click();
  await page.waitForTimeout(700);

  ok("the app opens", (await page.locator(".gate-root").count()) === 0);
  ok("the shell is visible", await page.locator(".shell").isVisible());
  ok("a banner says nothing is being saved", /nothing is being saved/i.test(
     await page.locator(".gate-banner").innerText()));

  // The tour is what a new student meets on the far side of the gate, so it
  // has to actually arrive — the gate deferring it must not lose it.
  await page.waitForTimeout(500);
  ok("the guided tour runs once the app opens", (await page.locator(".tour-root").count()) === 1);
  await dismissFirstRun(page);

  await page.evaluate(() => {
    const S = App.store, U = App.utils;
    S.commit((db) => {
      db.profile.name = "Ephemeral Student";
      const id = U.uid("cl");
      db.classes.push({ id, name: "AP Chemistry", color: "#2a78d6", days: ["Mon"], patternDays: ["A"],
                        credits: 1, termId: (db.terms[0] || {}).id, categories: [], rules: { dropLowest: {}, curve: 0 } });
      db.assignments.push({ id: U.uid("as"), classId: id, title: "Titration lab", due: U.today(),
                            status: "todo", points: 100, earned: null, graded: false, subtasks: [] });
    });
    App.notify && App.notify.start && App.notify.start();
  });
  await page.waitForTimeout(500);

  ok("the writes worked in memory", (await page.evaluate(() => App.store.db.assignments.length)) === 1);
  ok("but nothing reached localStorage", (await keysIn(page)).length === 0,
     JSON.stringify(await keysIn(page)));
  ok("App.store agrees it is not persisting", (await page.evaluate(() => App.store.isPersistent())) === false);

  // The real test of "not saved": come back.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  ok("a refresh returns to the login screen", (await page.locator(".gate-root").count()) === 1);
  ok("and the work is gone", (await page.evaluate(() => App.store.db.assignments.length)) === 0);
  ok("no uncaught page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/* ================================================== signing in turns it on = */
console.log("\ngate: signing in is what licenses this device to keep anything");
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const box = await stubApi(ctx);
  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  // A wrong password is answered on the gate, and changes nothing.
  await page.fill("#gateEmail", "sam@school.edu");
  await page.fill("#gatePassword", "wrong");
  await page.locator('.gate-form button[type="submit"]').click();
  await page.waitForTimeout(600);
  ok("a rejected sign-in stays on the gate", (await page.locator(".gate-root").count()) === 1);
  ok("and says so on the screen", /don't match|invalid/i.test(await page.locator("[data-error]").innerText()));
  ok("and still writes nothing", (await keysIn(page)).length === 0, JSON.stringify(await keysIn(page)));

  await page.fill("#gatePassword", "password123");
  await page.locator('.gate-form button[type="submit"]').click();
  await page.waitForTimeout(1200);

  ok("a good sign-in opens the app", (await page.locator(".gate-root").count()) === 0);
  ok("the shell is visible", await page.locator(".shell").isVisible());
  ok("there is no memory-only banner", (await page.locator(".gate-banner").count()) === 0);
  ok("the session token was stored", (await keysIn(page)).includes(TOKEN_KEY));
  ok("storage is on", (await page.evaluate(() => App.store.isPersistent())) === true);

  await dismissFirstRun(page);
  await page.evaluate(() => App.store.commit((db) => { db.profile.name = "Sam"; }));
  await page.waitForTimeout(400);
  ok("writes now land on disk",
     (await page.evaluate(() => JSON.parse(localStorage.getItem("scholar.db.v2")).profile.name)) === "Sam");

  // Let the 4s push debounce fire before reloading. Not politeness: a reload
  // pulls from the account and adopts what it finds, so reloading inside the
  // debounce would be testing sync's merge rules rather than persistence.
  await page.waitForTimeout(5000);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  ok("a signed-in device goes straight to the app", (await page.locator(".gate-root").count()) === 0);
  ok("and the work is still there", (await page.evaluate(() => App.store.profile.name)) === "Sam");

  /* -------------------------------------------------- signing out erases -- */
  console.log("\ngate: signing out clears the device, after pushing what's queued");
  await page.evaluate(() => App.store.commit((db) => { db.profile.school = "Northgate High"; }));
  await page.evaluate(() => App.idb.put("f2", new Blob(["homework.pdf"], { type: "text/plain" })));
  await page.waitForTimeout(200);                       // still inside the 4s push debounce
  await page.evaluate(() => App.sync.signOut());
  await page.waitForTimeout(1500);

  ok("the queued change reached the account first",
     !!(box.cloud && box.cloud.profile && box.cloud.profile.school === "Northgate High"),
     JSON.stringify(box.cloud && box.cloud.profile));
  ok("the browser is empty", (await keysIn(page)).length === 0, JSON.stringify(await keysIn(page)));
  ok("the stored files are gone", (await idbCount(page)) === 0, String(await idbCount(page)));
  ok("the login screen is back", (await page.locator(".gate-root").count()) === 1);
  ok("and the account's data is not on screen behind it",
     (await page.evaluate(() => App.store.profile.name)) === "");
  ok("no uncaught page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/* ====================================================== a retired token === */
console.log("\ngate: a token the server no longer honours clears the device too");
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(([k, t, s]) => {
    localStorage.setItem(k, t);
    localStorage.setItem("scholar.db.v2", JSON.stringify(s));
  }, [TOKEN_KEY, TEST_TOKEN, PRIOR_STUDENT]);
  await ctx.route("**/api/**", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "expired" }) }));

  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  ok("the login screen is up", (await page.locator(".gate-root").count()) === 1);
  ok("it explains why", /expired/i.test(await page.locator("[data-error]").innerText()));
  ok("the device was cleared", (await keysIn(page)).length === 0, JSON.stringify(await keysIn(page)));
  ok("including the in-memory copy", (await page.evaluate(() => App.store.profile.name)) === "");
  ok("no uncaught page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/* ============================================= the login screen is usable = */
console.log("\ngate: axe finds nothing serious on the login screen, either theme");
{
  // tests/a11y.mjs audits all 23 views — and signs in to reach them, so it
  // never sees this one. Which would leave the single most-viewed screen in
  // the app as the only unaudited one.
  const AXE_PATH = "node_modules/axe-core/axe.min.js";
  if (!existsSync(AXE_PATH)) {
    console.log("  (skipped: run npm install for axe-core)");
  } else {
    const AXE = readFileSync(AXE_PATH, "utf8");
    const RULES = { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } };
    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({ colorScheme: theme, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
      await page.waitForTimeout(600);
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      // Both tabs, since the sign-up form has fields the sign-in one doesn't.
      for (const mode of ["signin", "signup"]) {
        await page.locator(`[data-mode="${mode}"]`).click();
        await page.waitForTimeout(250);
        await page.addScriptTag({ content: AXE });
        const res = await page.evaluate((r) => window.axe.run(document, r), RULES);
        const serious = res.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
        ok(`${theme} / ${mode}: no critical or serious violations`, serious.length === 0,
           serious.map((v) => `${v.id} (${v.nodes.length})`).join(", "));
      }
      await ctx.close();
    }
  }
}

/* ================================================= the gate ships closed == */
console.log("\ngate: the page cannot render the app before JS decides");
{
  // body.gate-pending is what stops a signed-out visitor seeing a frame of
  // the app shell before the gate lands. If it is ever dropped from
  // index.html the gate still works — but it flashes, which is exactly the
  // kind of regression nobody notices in review.
  const res = await fetch(BASE + "/index.html");
  const html = await res.text();
  ok("index.html ships body.gate-pending", /<body[^>]*class="[^"]*gate-pending/.test(html));
  // Script tags only — the prose above them names both files too.
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  ok("the gate script is loaded, before boot",
     scripts.includes("js/authgate.js")
     && scripts.indexOf("js/authgate.js") < scripts.indexOf("js/app.js"),
     scripts.slice(-3).join(", "));

  const css = await (await fetch(BASE + "/css/components.css")).text();
  ok("gate-pending hides the app shell", /body\.gate-pending \.shell/.test(css));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
await browser.close();
process.exit(fail ? 1 : 0);
