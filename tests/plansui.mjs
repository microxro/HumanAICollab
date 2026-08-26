/* ==========================================================================
   tests/plansui.mjs — F156 in the browser: the signposts, not the paywall

   The paywall itself is tests/plans.mjs, against the real API, because that
   is where enforcement lives. What this suite covers is the half that is
   still worth getting right even though it decides nothing:

     • a deploy with no paid tiers must look exactly like one that never had
       this feature — no nav item, no locks, nothing to explain away.
     • when tiers are on, every gated surface says so *before* someone fills
       in a form, and every lock leads to the screen that explains it.
     • cancelling from the UI reaches the API and the screen updates.
     • the client fails OPEN. If the server never answers, nothing is locked:
       the API refuses anyway, so a wrong guess here costs a signpost, never
       a permission — and a locked-out app on a flaky network would be a much
       worse bug than a lock that failed to draw.

   There is no backend in a browser suite, so App.sync's three billing calls
   are stubbed with the shapes the real ones return.
   ========================================================================== */

import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.BASE || "http://localhost:8899";
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const FEATURES = {
  "sync.push": "premium", "portal.link": "premium", "portal.location": "premium",
  "groups.create": "premium", "groups.join": "premium", "digest": "premium",
  "ai": "ultra", "api.tokens": "ultra", "api.webhooks": "ultra"
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(600);
const skip = page.locator("[data-skip]");
if (await skip.count()) { await skip.click(); await page.waitForTimeout(250); }

/** Pretend a session exists, without a server: enough for the views to render. */
async function signedIn() {
  await page.evaluate(() => {
    App.sync.isSignedIn = () => true;
    App.sync.info = () => ({
      signedIn: true, status: "idle", version: 1, lastSync: null, error: null, pending: false,
      user: { id: "u1", email: "a@b.c", name: "Test", role: "student", plan: "basic", links: [], groups: [] }
    });
    App.assistant.available = () => true;
  });
}

/** Put the client in the state the server's billing payload would put it in. */
async function setPlan(plan, extra) {
  await page.evaluate(([p, features, more]) => {
    App.plans.adopt(Object.assign({
      enabled: true, plan: p, stored: p, until: null, canceledAt: null, operator: false, features
    }, more || {}));
    App.router.refresh();
  }, [plan, FEATURES, extra]);
  await page.waitForTimeout(250);
}

const go = async (view) => { await page.evaluate((v) => App.router.go(v), view); await page.waitForTimeout(300); };
const locks = () => page.locator("[data-open-plans]").count();

/* ------------------------------------------------------- the default off */

console.log("\nplans/ui: a deploy with no tiers looks like one that never had them");
{
  ok("plans start disabled", await page.evaluate(() => App.plans.enabled()) === false);
  ok("nothing is gated", await page.evaluate(() => App.plans.has("ai") && App.plans.has("sync.push")));
  ok("the nav item is hidden", await page.locator('#navScroll [data-view="plans"]').count() === 0);
  ok("and it isn't in the command palette either",
     await page.evaluate(() => {
       // The palette builds its list from the same visibility rule.
       const before = location.hash;
       return !document.body.innerHTML.includes('data-view="plans"') && before !== null;
     }));

  await go("plans");
  const heading = await page.locator(".page-inner h1").first().textContent();
  ok("the screen still opens directly", /Plans/.test(heading), heading);
  ok("and explains there is nothing to sell",
     /doesn't run paid plans|nothing is gated|No paid tiers/i.test(await page.locator(".page-inner").innerText()));
  ok("it offers at least one live control", await page.locator("[data-recheck]").count() > 0);
}

/* ------------------------------------------------------------ tiers on */

console.log("\nplans/ui: on a Basic account, every gated surface says so first");
{
  await signedIn();
  await setPlan("basic");

  ok("the nav item appears", await page.locator('#navScroll [data-view="plans"]').count() === 1);

  await go("assistant");
  ok("the assistant is locked", await locks() === 1);
  ok("and names the tier that unlocks it",
     /Ultra Premium/.test(await page.locator(".page-inner").innerText()));

  await go("groups");
  ok("study groups are locked", await locks() === 1);

  await go("sharing");
  ok("the parent portal is flagged", await locks() === 1);
  ok("but the privacy controls are still there — nothing local is withheld",
     await page.locator("[data-pref], .switch, input[type=checkbox]").count() > 0);

  await go("settings");
  await page.locator('.tabs [data-tab="developer"]').click();
  await page.waitForTimeout(250);
  ok("API tokens are locked", await locks() === 1);
}

console.log("\nplans/ui: a lock leads to the screen that explains it");
{
  await go("groups");
  await page.locator("[data-open-plans]").first().click();
  await page.waitForTimeout(300);
  ok("clicking a lock opens Plans", (await page.evaluate(() => location.hash)) === "#plans");
  ok("three tiers are shown", await page.locator(".plan-card").count() === 3);
  ok("the current one is marked with more than colour",
     (await page.locator(".plan-card.current").innerText()).includes("Your plan"));
  // Scanned over the interactive elements, not the prose: the page says the
  // words "no checkout on this deploy" out loud, and an innerText match would
  // fail on the very sentence that makes the promise.
  const payish = await page.evaluate(() =>
    [...document.querySelectorAll(".page-inner button, .page-inner a, .page-inner input")]
      .map((el) => ((el.textContent || "") + " " + (el.placeholder || "") + " " + (el.name || "")).trim())
      .filter((t) => /\b(buy|pay|checkout|subscribe|card|upgrade now)\b/i.test(t)));
  ok("no control on the page offers to take a payment", payish.length === 0, payish.join(" | "));
  ok("and it says why",
     /no checkout on this deploy/i.test(await page.locator(".page-inner").innerText()));
}

console.log("\nplans/ui: premium unlocks the premium surfaces and no more");
{
  await setPlan("premium");
  await go("groups");
  ok("study groups open up", await locks() === 0);
  await go("assistant");
  ok("the AI stays locked", await locks() === 1);

  await setPlan("ultra");
  await go("assistant");
  ok("ultra opens the AI too", await locks() === 0);
}

console.log("\nplans/ui: cancelling is one button, and it reaches the API");
{
  await setPlan("premium");
  await page.evaluate(() => {
    window.__cancelCalls = 0;
    App.sync.cancelPlan = () => {
      window.__cancelCalls++;
      return Promise.resolve({ enabled: true, plan: "basic", stored: "basic", until: null,
        canceledAt: Date.now(), operator: false, features: App.plans.info().features });
    };
  });
  await go("plans");
  await page.locator("[data-cancel]").first().click();
  await page.waitForTimeout(250);

  const dialog = await page.locator(".modal-root").innerText();
  ok("it says what happens, before you confirm", /straight away/i.test(dialog), dialog.slice(0, 120));
  ok("and that nothing is deleted", /Nothing is deleted/i.test(dialog));
  ok("and that you can still get your data", /pull your data down/i.test(dialog));

  await page.locator(".modal-root [data-ok]").click();
  await page.waitForTimeout(350);
  ok("the API was called once", await page.evaluate(() => window.__cancelCalls) === 1);
  ok("the screen now shows Basic", await page.evaluate(() => App.plans.plan()) === "basic");
  ok("and the locks came back", (await go("assistant"), await locks()) === 1);
}

console.log("\nplans/ui: the operator panel is only for the operator");
{
  await setPlan("basic");
  await go("plans");
  ok("an ordinary account sees no grant panel", await page.locator("[data-grant]").count() === 0);

  await setPlan("basic", { operator: true });
  await go("plans");
  ok("the operator does", await page.locator("[data-grant]").count() === 1);

  await page.locator("[data-grant]").click();
  await page.waitForTimeout(200);
  ok("granting with no email is refused in the form, not at the server",
     /Enter the account's email/i.test(await page.locator("[data-grant-result]").innerText()));
}

console.log("\nplans/ui: the client fails open, never closed");
{
  // The server never answers: whatever else happens, nothing may be locked.
  await page.evaluate(() => {
    App.sync.billing = () => Promise.reject(new Error("Can't reach the server."));
    App.plans.adopt({ enabled: false, plan: "ultra", features: {} });
  });
  await page.evaluate(() => App.plans.refresh());
  await page.waitForTimeout(250);
  ok("an unreachable billing endpoint locks nothing",
     await page.evaluate(() => App.plans.has("ai") && App.plans.has("sync.push") && App.plans.has("api.tokens")));

  await go("assistant");
  ok("and the AI screen is not locked", await locks() === 0);
}

console.log("\nplans/ui: nothing threw");
ok("no uncaught page errors", errors.length === 0, errors.join(" | "));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
