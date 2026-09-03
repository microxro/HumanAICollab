/* ==========================================================================
   tests/portal.mjs — the screens you only see once you're signed in

   Sharing's guardian cards and the whole parent portal render nothing at all
   for a signed-out account, so `controls` sweeps past them and every other
   browser suite sees an empty shell. That is precisely where the guardian
   half of F154 lives: the card that offers a suggested activity, and the
   parent's form that sends one.

   So this signs the page in the only way a static harness can — by replacing
   App.sync's network calls with ones that answer from memory — and then
   drives the real views, the real handlers and the real store. What it
   proves is the client wiring; the server contract those calls stand in for
   is proved against the real api.js in tests/activities.mjs.

   Run: BASE=http://localhost:8899 node tests/portal.mjs
   ========================================================================== */

import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { resetSignedIn } from "./stub/session.mjs";

const BASE = process.env.BASE || "http://localhost:8899";
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
await resetSignedIn(page);   // the app is behind a login gate now — tests/stub/session.mjs
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(600);
const skip = page.locator("[data-skip]");
if (await skip.count()) { await skip.click(); await page.waitForTimeout(200); }

/**
 * Stand in for the backend. Everything the two views call on mount answers
 * empty except the suggestion list; `window.__portal` records what was sent
 * and lets a test make one call fail.
 */
async function stubSync(suggestions) {
  await page.evaluate((list) => {
    window.__portal = { responded: [], suggested: [], failRespond: false };
    const S = App.sync;
    S.isSignedIn = () => true;
    S.listFriends = async () => [];
    S.listCheckins = async () => [];
    S.listGuardianNotes = async () => [];
    S.listFocusWindows = async () => [];
    S.listActivitySuggestions = async () => JSON.parse(JSON.stringify(list));
    S.respondActivitySuggestion = async (id, accept) => {
      if (window.__portal.failRespond) throw new Error("Offline — working locally.");
      window.__portal.responded.push({ id, accept });
      return { status: accept ? "added" : "dismissed" };
    };
    S.suggestActivity = async (studentId, activity) => {
      window.__portal.suggested.push({ studentId, activity });
      return { sent: true };
    };
    S.children = async () => ([{
      id: "kid1", name: "Kit", since: Date.now(), status: null, updatedAt: Date.now(), events: [],
      summary: {
        name: "Kit", openAssignments: 3, overdue: 0, studyWeek: 120, attendance: 96,
        usageWeek: 60, upcoming: [], gradeAlerts: [], currency: "EUR",
        activities: [{ name: "Piano lessons", type: "Music", provider: "Northside Music",
          days: ["Wed"], start: "17:30", end: "18:15", cost: 32, costPer: "session", monthly: 138.67 }]
      },
      sentActivities: [{ id: "s1", name: "Club swim", at: Date.now(), status: "pending" }]
    }]);
  }, suggestions);
}

const SUGGESTION = [{
  id: "sg1", fromId: "p1", fromName: "Mum", at: Date.now(), status: "pending", respondedAt: null,
  activity: {
    name: "Piano lessons", type: "Music", role: "", provider: "Northside Music",
    contactName: "Ms. Halvorsen", contactEmail: "", contactPhone: "555-0128",
    address: "412 Beaumont Ave", website: "", cost: 32, costPer: "session",
    days: ["Wed"], start: "17:30", end: "18:15", season: "Year-round",
    startDate: "", endDate: "", notes: "Bring the theory book."
  }
}];

const go = async (view) => {
  await page.evaluate((v) => App.router.go(v), view);
  await page.waitForTimeout(500);
};

/* ------------------------------------------------- the student's side --- */
console.log("\nportal: a student sees what a guardian suggested, and decides");
{
  await stubSync(SUGGESTION);
  await go("sharing");

  const card = page.locator("[data-suggest-yes]");
  ok("the suggestion card renders", await card.count() === 1, `${await card.count()} found`);
  const text = await page.locator(".card", { has: page.locator("[data-suggest-yes]") }).innerText();
  ok("it names the activity", /Piano lessons/.test(text), text.slice(0, 120));
  ok("it says who suggested it", /Mum/.test(text), text.slice(0, 120));
  ok("it shows when and what it costs", /Wed/.test(text) && /32/.test(text), text.slice(0, 200));
  ok("nothing is in the store yet",
     await page.evaluate(() => App.store.db.activities.length) === 0);

  await card.click();
  await page.waitForTimeout(500);

  const res = await page.evaluate(() => {
    const a = App.store.db.activities[0];
    return {
      count: App.store.db.activities.length,
      rec: a && { name: a.name, external: a.external, provider: a.provider, cost: a.cost,
                  costPer: a.costPer, days: a.days, addedBy: a.addedBy, location: a.location },
      monthly: App.utils.round(App.store.monthlyActivityCost(), 2),
      responded: window.__portal.responded
    };
  });
  ok("adding it inserts exactly one activity", res.count === 1, String(res.count));
  ok("marked as outside school", res.rec && res.rec.external === true, JSON.stringify(res.rec));
  ok("with the details the guardian sent",
     res.rec.provider === "Northside Music" && res.rec.cost === 32 && res.rec.costPer === "session",
     JSON.stringify(res.rec));
  ok("the address becomes its location", res.rec.location === "412 Beaumont Ave", res.rec.location);
  ok("and it records who suggested it", res.rec.addedBy === "Mum", res.rec.addedBy);
  ok("the fee is counted in the monthly total", res.monthly === 138.67, String(res.monthly));
  ok("the server was told", res.responded.length === 1 && res.responded[0].accept === true,
     JSON.stringify(res.responded));
  ok("the card is gone", await page.locator("[data-suggest-yes]").count() === 0);
}

console.log("\nportal: it shows up in Activities as an outside-school one");
{
  await go("activities");
  const body = await page.locator(".page-inner").innerText();
  ok("the card is on the Activities page", /Piano lessons/.test(body), body.slice(0, 200));
  ok("badged as outside school", /Outside school/.test(body));
  await page.click('[data-filter="external"]');
  await page.waitForTimeout(300);
  ok("and it survives the outside-school filter",
     await page.locator("[data-act]").count() === 1, `${await page.locator("[data-act]").count()}`);
}

console.log("\nportal: declining adds nothing");
{
  await page.evaluate(() => { App.store.commit((db) => { db.activities = []; }); });
  await stubSync(SUGGESTION);
  await go("sharing");
  await page.click("[data-suggest-no]");
  await page.waitForTimeout(400);
  const res = await page.evaluate(() => ({
    count: App.store.db.activities.length,
    responded: window.__portal.responded
  }));
  ok("no activity was created", res.count === 0, String(res.count));
  ok("the server was told it was dismissed",
     res.responded.length === 1 && res.responded[0].accept === false, JSON.stringify(res.responded));
  ok("the card is gone", await page.locator("[data-suggest-yes]").count() === 0);
}

console.log("\nportal: a failed answer leaves the suggestion pending, and adds nothing");
{
  await stubSync(SUGGESTION);
  await go("sharing");
  await page.evaluate(() => {
    window.__portal.failRespond = true;
    // Toasts from earlier sections are still on screen and are read
    // newest-last; clear the host so the assertion below is about this click.
    const host = document.getElementById("toastHost");
    if (host) host.innerHTML = "";
  });
  await page.click("[data-suggest-yes]");
  await page.waitForTimeout(600);

  const res = await page.evaluate(() => ({
    count: App.store.db.activities.length,
    toast: [...document.querySelectorAll(".toast")].map((t) => t.innerText).join(" | ")
  }));
  // The other order — insert locally, tell the server afterwards — would
  // leave the activity in the app and the suggestion pending on the server,
  // and offer to add the same lesson again on the next visit.
  ok("nothing was added", res.count === 0, String(res.count));
  ok("and it says so rather than failing silently", /Couldn't/i.test(res.toast), res.toast);
  ok("the suggestion is still on offer",
     await page.locator("[data-suggest-yes]").count() === 1);

  // Recovering works.
  await page.evaluate(() => { window.__portal.failRespond = false; });
  await page.click("[data-suggest-yes]");
  await page.waitForTimeout(600);
  ok("retrying then adds it", await page.evaluate(() => App.store.db.activities.length) === 1);
}

/* -------------------------------------------------- the parent's side --- */
console.log("\nportal: a parent sees the outside-school half and can add to it");
{
  await stubSync([]);
  await go("parent");

  const body = await page.locator(".page-inner").innerText();
  ok("the linked student's card renders", /Kit/.test(body), body.slice(0, 160));
  ok("their outside-school activities are listed", /Piano lessons/.test(body), body.slice(0, 400));
  ok("in the student's own currency, not this device's",
     /€/.test(body) || /EUR/.test(body), body.slice(0, 500));
  ok("a suggestion still waiting on them is shown", /Waiting on them/.test(body), body.slice(0, 600));

  ok("there is a way to add one", await page.locator("[data-add-activity]").count() === 1);
  await page.click("[data-add-activity]");
  await page.waitForTimeout(400);
  ok("the form opens", await page.locator('.modal-root [name="provider"]').count() === 1);
  ok("and it says the student confirms it",
     /confirms it in their app/.test(await page.locator(".modal-head").innerText()));

  await page.fill('[name="name"]', "Club swim squad");
  await page.fill('[name="provider"]', "Riverside Swim Club");
  await page.fill('[name="contactPhone"]', "555-0164");
  await page.fill('[name="address"]', "9 Mill Lane");
  await page.fill('[name="cost"]', "68");
  await page.selectOption('[name="costPer"]', "month");
  await page.click('.modal-foot .btn-primary');
  await page.waitForTimeout(500);

  const sent = await page.evaluate(() => window.__portal.suggested);
  ok("it was sent to the right student", sent.length === 1 && sent[0].studentId === "kid1",
     JSON.stringify(sent.map((x) => x.studentId)));
  ok("with everything filled in",
     sent[0].activity.name === "Club swim squad" &&
     sent[0].activity.provider === "Riverside Swim Club" &&
     sent[0].activity.cost === 68 && sent[0].activity.costPer === "month" &&
     sent[0].activity.address === "9 Mill Lane",
     JSON.stringify(sent[0].activity));
  ok("and the days the picker was set to", JSON.stringify(sent[0].activity.days) === '["Sat"]',
     JSON.stringify(sent[0].activity.days));

  // The portal must not write to the student's data — it has no access to it.
  ok("the parent's own store gained nothing",
     await page.evaluate(() => App.store.db.activities.length) === 1);
}

console.log("\nportal: a parent whose student shares nothing is told that, not shown a blank");
{
  await page.evaluate(() => {
    App.sync.children = async () => ([{
      id: "kid2", name: "Sam", since: Date.now(), status: null, updatedAt: Date.now(), events: [],
      summary: { name: "Sam", activities: null }, sentActivities: []
    }]);
  });
  await go("parent");
  const body = await page.locator(".page-inner").innerText();
  ok("it says outside-school activities aren't shared",
     /aren't shared/.test(body), body.slice(0, 400));
}

ok("no uncaught page errors anywhere in this run", errors.length === 0, errors.join(" | "));

console.log(`\n${pass} passed, ${fail} failed\n`);
await browser.close();
process.exit(fail ? 1 : 0);
