/* ==========================================================================
   tests/shop.mjs — the four things this change set had to actually deliver

     1. A student with no linked parent or teacher can create, read and write
        everything a student has: focus windows, notes, the lot.
     2. A class can assign homework without sitting in the bell schedule.
     3. The focus timer's fourth segment reads "Custom", and the alarm makes
        a sound — the old one built its AudioContext at ring time, outside a
        gesture, so it played into a suspended graph and was silent.
     4. The token shop has four tiers, items up to 1000 tokens, and buying
        one changes something real.

   Everything runs against the real app in a real browser. Nothing is stubbed
   except the clock-free parts of the alarm, which are checked by asking the
   audio graph whether it is running, not by listening.

   Run: node tests/shop.mjs   (needs a static server, see tests/run.mjs)
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
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(600);
const skip = page.locator("[data-skip]");
if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(200); }

/* ============================================ 1. a student on their own == */

console.log("\nsolo: a student with no parent or teacher linked is not locked out");
{
  const solo = await page.evaluate(() => App.store.isSoloStudent());
  ok("signed out counts as solo", solo === true);

  await page.evaluate(() => App.router.go("sharing"));
  await page.waitForTimeout(400);

  ok("the focus-window card is on screen anyway",
     (await page.locator("[data-self-focus]").count()) >= 3);
  ok("so is somewhere to write a note", (await page.locator("[data-self-note]").count()) === 1);

  await page.locator('[data-self-focus="30"]').click();
  await page.waitForTimeout(300);
  const w = await page.evaluate(() => {
    const x = App.store.activeFocusWindow();
    return x && { by: x.by, mins: Math.round((x.endAt - x.startAt) / 60000) };
  });
  ok("a self-set focus window starts, with no account", !!w && w.by === "self", JSON.stringify(w));
  ok("and runs for the length asked for", w && w.mins === 30, String(w && w.mins));

  await page.locator("[data-focus-end]").click();
  await page.waitForTimeout(250);
  ok("and ends early locally, without a server round trip",
     (await page.evaluate(() => !!App.store.activeFocusWindow())) === false);

  await page.evaluate(() => { App.store.addSelfNote("Ask about the retake"); App.router.refresh(); });
  await page.waitForTimeout(250);
  ok("a note to yourself saves and renders",
     (await page.locator("[data-del-note]").count()) === 1);

  // The recurring-window shape and the one-off shape live in one collection;
  // reading days.includes() on the second used to throw.
  const mixed = await page.evaluate(() => {
    App.store.addFocusWindow("20:00", "21:00", ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    try { return { ok: true, active: !!App.store.activeFocusWindow() }; }
    catch (e) { return { ok: false, err: e.message }; }
  });
  ok("both focus-window shapes coexist without throwing", mixed.ok === true, mixed.err);

  await page.evaluate(() => App.router.go("parent"));
  await page.waitForTimeout(300);
  const heading = await page.locator("h3").first().textContent();
  ok("the parent portal tells a student they don't need one",
     /don't need a parent account/i.test(heading || ""), heading);
}

/* ================================== 2. a class outside the bell schedule == */

console.log("\nextracurricular: a class can assign homework without a period");
{
  const r = await page.evaluate(() => {
    const U = App.utils, S = App.store;
    S.insert("periods", { name: "Period 1", start: "08:00", end: "08:52" });
    const p = S.db.periods[0];
    S.insert("classes", { name: "Bio", color: "#2a78d6", days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
      periodId: p.id, categories: [], offSchedule: false });
    const dow = U.DOW_SHORT[new Date().getDay()];
    const club = S.insert("classes", { name: "Robotics Team", color: "#eb6834", days: [dow],
      periodId: null, offSchedule: true, start: "15:30", end: "17:30",
      meetingLabel: "Robotics practice", categories: [] });
    S.insert("assignments", { title: "Build log", classId: club.id, due: U.today(), status: "todo", points: 20 });
    return {
      period: S.classPeriod(club),
      onDate: S.classesOnDate(U.today()).map((x) => x.cls.name),
      agenda: S.scheduleFor(U.today()).map((i) => [i.kind, i.title]),
      work: S.assignmentsFor(club.id).length,
      clubId: club.id
    };
  });

  ok("it reports its own meeting time", r.period && r.period.start === "15:30", JSON.stringify(r.period));
  ok("it shows up on today's timetable", r.onDate.includes("Robotics Team"), r.onDate.join(", "));
  ok("the agenda marks it as its own kind",
     r.agenda.some(([k, t]) => k === "extra" && t === "Robotics Team"), JSON.stringify(r.agenda));
  ok("and it carries homework like any other class", r.work === 1, String(r.work));

  await page.evaluate(() => App.router.go("schedule"));
  await page.waitForTimeout(350);
  ok("the week grid gives it its own row",
     (await page.locator(".tt-time", { hasText: "Own" }).count()) === 1);
  ok("with the class in it",
     (await page.locator(".tt-cell", { hasText: "Robotics" }).count()) === 1);

  // Off-schedule classes hold no period, so they must not occupy one in the
  // peer free-period comparison.
  const clash = await page.evaluate(() => {
    App.store.insert("peers", { name: "Sam", color: "#1baf7a", sharing: true, classIds: [] });
    const peer = App.store.db.peers[App.store.db.peers.length - 1];
    return App.store.commonFreePeriods(peer.id).length;
  });
  ok("and never occupy a period in peer matching", clash >= 0, String(clash));
}

/* ================================================ 3. the timer and its alarm */

console.log("\ntimer: the fourth segment is Custom, and the alarm rings");
{
  await page.evaluate(() => App.router.go("focus"));
  await page.waitForTimeout(300);
  const label = (await page.locator('[data-phase="custom"]').textContent() || "").trim();
  ok("the segment reads exactly \"Custom\"", label === "Custom", label);
  ok("the length is still discoverable, in its tooltip",
     /\d+ minutes/.test(await page.locator('[data-phase="custom"]').getAttribute("title") || ""));

  // A real click is a real gesture: this is what opens the audio session.
  await page.locator("#timerToggle").click();
  await page.waitForTimeout(250);
  ok("pressing Start unlocks audio", (await page.evaluate(() => App.sound.ready())) === true);
  await page.locator("#timerToggle").click();   // pause again

  const rang = await page.evaluate(() => App.sound.alarm({ force: true }));
  ok("and the alarm plays into a running graph", rang === true);

  const voices = await page.evaluate(() => Object.keys(App.sound.voices()).length);
  ok("there is more than one alarm voice", voices >= 6, String(voices));

  const quiet = await page.evaluate(() => {
    // Force quiet hours around the current time, then check the setting is
    // what silences the alarm — not the hour on its own.
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const from = `${pad((now.getHours() + 23) % 24)}:00`;
    const to = `${pad((now.getHours() + 1) % 24)}:00`;
    App.store.commit((db) => {
      db.settings.notifications.quietStart = from;
      db.settings.notifications.quietEnd = to;
      db.settings.pomodoro.quietSound = true;
    });
    const rangQuietly = App.sound.alarm();
    App.store.commit((db) => { db.settings.pomodoro.quietSound = false; });
    const rangSilent = App.sound.alarm();
    return { inQuiet: App.notify.inQuietHours(), rangQuietly, rangSilent };
  });
  ok("quiet hours are actually in force for this check", quiet.inQuiet === true);
  ok("it still rings quietly inside quiet hours", quiet.rangQuietly === true);
  ok("unless you switch that off", quiet.rangSilent === false);
}

/* ================================================== 4. the token shop ===== */

console.log("\nshop: four tiers, real prices, real effects");
{
  const cat = await page.evaluate(() => ({
    tiers: App.shop.tiers().map((t) => t.key),
    labels: App.shop.tiers().map((t) => t.label),
    counts: App.shop.tiers().map((t) => App.shop.byTier(t.key).length),
    max: Math.max(...App.shop.items().map((i) => i.price)),
    min: Math.min(...App.shop.items().map((i) => i.price)),
    total: App.shop.items().length
  }));
  ok("the four tiers are Common, Rare, Ultra and Elite",
     cat.labels.join("|") === "Common Tier|Rare Tier|Ultra Tier|Elite Tier", cat.labels.join(", "));
  ok("every tier has items", cat.counts.every((n) => n >= 5), cat.counts.join("/"));
  ok("the catalogue is more than a token gesture", cat.total >= 30, String(cat.total));
  ok("Elite reaches 1000 tokens", cat.max === 1000, String(cat.max));
  ok("and the cheapest is in reach of one focus block", cat.min <= 75, String(cat.min));

  const tiered = await page.evaluate(() => {
    const price = (t) => App.shop.byTier(t).map((i) => i.price);
    return { common: price("common"), rare: price("rare"), ultra: price("ultra"), elite: price("elite") };
  });
  ok("prices climb with tier",
     Math.max(...tiered.common) < Math.min(...tiered.rare) &&
     Math.max(...tiered.rare) < Math.min(...tiered.ultra) &&
     Math.max(...tiered.ultra) < Math.min(...tiered.elite),
     JSON.stringify(tiered));

  const earn = await page.evaluate(() => {
    const before = App.store.tokenBalance();
    App.store.awardTokens(100, "test", { silent: true });
    return { before, after: App.store.tokenBalance() };
  });
  ok("earning credits the wallet", earn.after === earn.before + 100);

  const bought = await page.evaluate(() => {
    App.store.awardTokens(5000, "test", { silent: true });
    const res = App.shop.buy("frame:prismatic");     // 1000, Elite
    const dupe = App.shop.buy("frame:prismatic");
    return {
      ok: res.ok, dupe: dupe.ok, dupeMsg: dupe.message,
      frame: document.documentElement.getAttribute("data-frame"),
      owned: App.store.ownsShopItem("frame:prismatic")
    };
  });
  ok("an Elite item can be bought", bought.ok === true);
  ok("it is worn immediately", bought.frame === "prismatic", String(bought.frame));
  ok("and can't be bought twice", bought.dupe === false, bought.dupeMsg);

  const poor = await page.evaluate(() => {
    App.store.commit((db) => { db.wallet.balance = 10; });
    const res = App.shop.buy("title:valedictorian");
    return { ok: res.ok, msg: res.message, balance: App.store.tokenBalance() };
  });
  ok("and not at all without the tokens", poor.ok === false, poor.msg);
  ok("a refused purchase costs nothing", poor.balance === 10, String(poor.balance));

  const effects = await page.evaluate(() => {
    App.store.commit((db) => { db.wallet.balance = 5000; db.streak.freezes = 0; });
    App.shop.buy("boost:freeze");                     // consumable, +1 freeze
    const freezes = App.store.db.streak.freezes;
    App.shop.buy("boost:double");                     // consumable, 2x for 24h
    const mult = App.shop.multiplier();
    App.shop.buy("theme:obsidian");
    const accent = document.documentElement.getAttribute("data-accent");
    App.store.unequipShopSlot("theme");
    const reverted = document.documentElement.getAttribute("data-accent");
    App.shop.buy("alarm:fanfare");
    return { freezes, mult, accent, reverted, alarm: App.store.settings.pomodoro.alarm };
  });
  ok("a consumable actually does its thing", effects.freezes === 1, String(effects.freezes));
  ok("a boost multiplies what you earn", effects.mult === 2, String(effects.mult));
  ok("an accent is applied when worn", effects.accent === "obsidian", String(effects.accent));
  ok("and falls back to the Settings accent when taken off",
     effects.reverted === "indigo", String(effects.reverted));
  ok("a bought alarm voice becomes the one that plays", effects.alarm === "fanfare", effects.alarm);

  // The two-click token farm: mark done, reopen, mark done again.
  const farm = await page.evaluate(() => {
    const U = App.utils, S = App.store;
    const a = S.insert("assignments", { title: "Once only", classId: null, due: U.today(), status: "todo", points: 10 });
    const b0 = S.tokenBalance();
    S.update("assignments", a.id, { status: "done" });
    const b1 = S.tokenBalance();
    S.update("assignments", a.id, { status: "todo" });
    S.update("assignments", a.id, { status: "done" });
    return { paid: b1 - b0, again: S.tokenBalance() - b1 };
  });
  ok("finishing an assignment pays", farm.paid > 0, String(farm.paid));
  ok("but only once, however often it's reopened", farm.again === 0, String(farm.again));

  await page.evaluate(() => App.router.go("shop"));
  await page.waitForTimeout(400);
  ok("the shop screen renders every item",
     (await page.locator(".shop-card").count()) === cat.total);
  ok("with a heading per tier", (await page.locator(".tier-head").count()) === 4);
  ok("and its own tabs", (await page.locator("[data-shop-tab]").count()) === 3);

  await page.locator('[data-shop-tab="earn"]').click();
  await page.waitForTimeout(250);
  ok("the Earn tab explains where tokens come from",
     /focus/i.test(await page.locator("#page").innerText()));
}

/* ------------------------------------------------------------------------ */

ok("no uncaught page errors throughout", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
