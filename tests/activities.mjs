/* ==========================================================================
   tests/activities.mjs — outside-school activities, end to end

   The feature spans three places that can disagree with each other:

     · the store — what an activity record is, and what a fee adds up to
     · the schedule — v2 drew activities only on days the school is open,
       which is wrong for the exact commitments this feature is about
     · the API — a guardian suggesting one, and the student answering

   So this suite drives the real store modules in a VM (no browser needed for
   the arithmetic) and the real api.js with storage stubbed.

   Run: node --import ./tests/stub/register.mjs tests/activities.mjs
   ========================================================================== */

import { readFileSync } from "node:fs";
import vm from "node:vm";

process.env.SCHOLAR_SECRET = "test-secret-value-at-least-16-chars-long";
process.env.SITE_URL = "https://scholar.example";

const api = (await import("../netlify/functions/api.js")).default;
const stub = await import("./stub/blobs-stub.mjs");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

/* ------------------------------------------------------- the store, in a VM */

function bootStore(stored) {
  const store = new Map();
  if (stored !== undefined) store.set("scholar.db.v2", JSON.stringify(stored));
  const ctx = {
    console,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    crypto: { randomUUID: () => "id-" + Math.random().toString(36).slice(2) },
    Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Intl, Set, Map,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0,
    document: { addEventListener() {}, documentElement: { style: { setProperty() {} }, setAttribute() {}, getAttribute: () => "light" } },
    window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
    navigator: { language: "en-US" },
    location: { href: "http://localhost/", hash: "", search: "" }
  };
  ctx.window.localStorage = ctx.localStorage;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext("var App = { };", ctx);
  for (const f of ["js/utils.js", "js/store.js", "js/store2.js"]) {
    vm.runInContext(readFileSync(f, "utf8"), ctx, { filename: f });
  }
  return ctx;
}

const run = (ctx, expr) => vm.runInContext(expr, ctx);

/* ------------------------------------------------------------- backfill --- */
console.log("\nactivities: a record written before the feature existed still works");
{
  // Exactly what an older build stored: no external flag, no provider, and —
  // the one that used to throw — no days array at all.
  const ctx = bootStore({
    schema: 2, schemaV3: true,
    settings: { onboarded: true },
    terms: [{ id: "t1", name: "Fall", start: "2026-08-01", end: "2026-12-20", current: true }],
    classes: [], assignments: [], periods: [], events: [], notes: [], attendance: [],
    activities: [
      { id: "a1", name: "Chess club", type: "Club", start: "15:30", end: "16:30", color: "#2a78d6" },
      { id: "a2", name: 12345, days: null, hours: "nope" }
    ],
    account: {}, ui: {}
  });

  const shape = run(ctx, `(() => {
    const a = App.store.byId("activities", "a1"), b = App.store.byId("activities", "a2");
    return {
      external: a.external, provider: a.provider, cost: a.cost, costPer: a.costPer,
      days: Array.isArray(a.days), addedBy: a.addedBy,
      badName: typeof b.name, badDays: Array.isArray(b.days), badHours: Array.isArray(b.hours)
    };
  })()`);
  ok("external defaults to false, not undefined", shape.external === false, String(shape.external));
  ok("the outside-school fields are filled in",
     shape.provider === "" && shape.cost === null && shape.costPer === "month" && shape.addedBy === "");
  ok("a missing days array is repaired", shape.days === true);
  ok("a non-string name is coerced", shape.badName === "string", shape.badName);
  ok("a null days and a string hours are both repaired", shape.badDays === true && shape.badHours === true);

  // The view calls a.days.join() and sums a.hours unguarded; both used to throw.
  const renders = run(ctx, `(() => {
    try {
      App.store.db.activities.forEach((a) => { a.days.join(", "); App.utils.sum(a.hours, (h) => h.hours); });
      return true;
    } catch (e) { return e.message; }
  })()`);
  ok("the Activities view's own dereferences survive it", renders === true, String(renders));
}

/* ------------------------------------------------------------ cost maths --- */
console.log("\nactivities: a fee adds up to what the family actually pays");
{
  const ctx = bootStore(undefined);
  const res = run(ctx, `(() => {
    const S = App.store;
    S.db.activities = [
      // $32 a lesson, one lesson a week → 32 × (52/12) a month
      { id: "x1", name: "Piano", external: true, days: ["Wed"], start: "17:30", end: "18:15", cost: 32, costPer: "session", hours: [] },
      { id: "x2", name: "Swim",  external: true, days: ["Sat", "Sun"], start: "08:00", end: "09:30", cost: 68, costPer: "month", hours: [] },
      { id: "x3", name: "Kit",   external: true, days: [], start: "08:00", end: "09:00", cost: 240, costPer: "total", hours: [] },
      { id: "x4", name: "Term",  external: true, days: ["Mon"], start: "16:00", end: "17:00", cost: 300, costPer: "term", hours: [] },
      // A school club never has a fee, even if a stale one is on the record.
      { id: "x5", name: "Robotics", external: false, days: ["Wed"], start: "15:30", end: "17:00", cost: 999, costPer: "month", hours: [] },
      { id: "x6", name: "Free", external: true, days: ["Fri"], start: "16:00", end: "17:00", cost: 0, costPer: "month", hours: [] },
      { id: "x7", name: "Unknown", external: true, days: ["Fri"], start: "16:00", end: "17:00", cost: null, costPer: "month", hours: [] }
    ];
    return {
      perSession: App.utils.round(S.activityCostMonthly(S.byId("activities", "x1")), 2),
      perMonth: S.activityCostMonthly(S.byId("activities", "x2")),
      oneOffMonthly: S.activityCostMonthly(S.byId("activities", "x3")),
      perTerm: S.activityCostMonthly(S.byId("activities", "x4")),
      schoolClub: S.activityCostMonthly(S.byId("activities", "x5")),
      free: S.activityCostMonthly(S.byId("activities", "x6")),
      unknown: S.activityCostMonthly(S.byId("activities", "x7")),
      total: App.utils.round(S.monthlyActivityCost(), 2),
      oneOff: S.oneOffActivityCost(),
      external: S.externalActivities().length,
      school: S.schoolActivities().length,
      money: S.money(68),
      moneyOdd: S.money(32.5)
    };
  })()`);

  ok("per-session is priced at the weekly meeting count", res.perSession === 138.67, String(res.perSession));
  ok("per-month passes through", res.perMonth === 68, String(res.perMonth));
  ok("a per-term fee is a quarter of it", res.perTerm === 75, String(res.perTerm));
  ok("a one-off is not counted as monthly", res.oneOffMonthly === 0, String(res.oneOffMonthly));
  ok("but it is reported separately", res.oneOff === 240, String(res.oneOff));
  ok("a school club's stale fee is ignored", res.schoolClub === 0, String(res.schoolClub));
  ok("free is zero, not an error", res.free === 0, String(res.free));
  ok("an unknown fee is zero, not NaN", res.unknown === 0, String(res.unknown));
  ok("the monthly total is the sum of the recurring ones", res.total === 281.67, String(res.total));
  ok("the two sides are counted apart", res.external === 6 && res.school === 1, `${res.external}/${res.school}`);
  ok("money is formatted as currency", /68/.test(res.money) && /\$|USD/.test(res.money), res.money);
  ok("and keeps the cents when there are any", /32\.50/.test(res.moneyOdd), res.moneyOdd);
}

/* ------------------------------------------------- the weekend, at last --- */
console.log("\nactivities: an outside-school activity shows on a day school is closed");
{
  const ctx = bootStore(undefined);
  const res = run(ctx, `(() => {
    const S = App.store, U = App.utils;
    S.db.activities = [
      { id: "w1", name: "Club swim", external: true, days: ["Sat"], start: "08:00", end: "09:30", color: "#2a78d6", location: "Pool", provider: "Riverside", hours: [] },
      { id: "w2", name: "Chess club", external: false, days: ["Sat"], start: "10:00", end: "11:00", color: "#eb6834", location: "Rm 12", hours: [] }
    ];
    // The Saturday of this week, whatever today is.
    let iso = U.today();
    for (let i = 0; i < 8; i++) { const d = U.addDays(new Date(), i); if (d.getDay() === 6) { iso = U.dateKey(d); break; } }

    // Weekly mode draws every activity on a matching weekday regardless, so
    // it is rotating mode — what an A/B-cycle school sets — that hid them.
    const weekly = S.scheduleFor(iso).map((x) => x.title);
    S.db.settings.schedule.mode = "rotating";
    const rotating = S.scheduleFor(iso).map((x) => x.title);
    const live = S.liveStatus();
    return {
      schoolOpen: S.isSchoolDay(iso),
      weekly, rotating,
      liveIsObject: !!live && typeof live === "object" && Number.isFinite(live.progress)
    };
  })()`);

  ok("the day genuinely is not a school day", res.schoolOpen === false);
  ok("weekly mode is unchanged — both still show",
     res.weekly.includes("Club swim") && res.weekly.includes("Chess club"), JSON.stringify(res.weekly));
  ok("in rotating mode the outside-school one is on the schedule",
     res.rotating.includes("Club swim"), JSON.stringify(res.rotating));
  ok("and the school club is correctly absent — the school is shut",
     !res.rotating.includes("Chess club"), JSON.stringify(res.rotating));
  ok("liveStatus still returns a usable shape", res.liveIsObject === true);
}

/* ================================================== the API: suggestions == */

const BASE = "https://scholar.example/api/";
async function call(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await api(new Request(BASE + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  }));
  let data = null;
  try { data = await res.clone().json(); } catch (e) { data = null; }
  return { status: res.status, data };
}
const signup = (email, role, name) =>
  call("auth/signup", { method: "POST", body: { email, password: "password123", name, role } });

console.log("\nactivities: a parent suggests one, the student decides");
let kid, mum, stranger;
{
  stub.__reset();
  kid = (await signup("kid@school.edu", "student", "Kit")).data;
  mum = (await signup("mum@home.com", "parent", "Mum")).data;
  stranger = (await signup("nosy@home.com", "parent", "Nosy")).data;

  const code = (await call("link/code", { method: "POST", token: kid.token })).data.code;
  const linked = await call("link/redeem", { method: "POST", token: mum.token, body: { code } });
  ok("the parent is linked", linked.status === 200, JSON.stringify(linked.data));

  const sent = await call("activity-suggestions", {
    method: "POST", token: mum.token,
    body: { studentId: kid.user.id, activity: {
      name: "Piano lessons", type: "Music", provider: "Northside Music",
      contactName: "Ms. Halvorsen", contactPhone: "555-0128", address: "412 Beaumont Ave",
      days: ["Wed"], start: "17:30", end: "18:15", cost: 32, costPer: "session",
      notes: "Bring the theory book." } }
  });
  ok("it is accepted", sent.status === 200, JSON.stringify(sent.data));

  const mine = await call("activity-suggestions", { token: kid.token });
  ok("the student sees exactly one", mine.data.suggestions.length === 1, JSON.stringify(mine.data));
  const item = mine.data.suggestions[0];
  ok("with the parent's name on it", item.fromName === "Mum", item.fromName);
  ok("and the details intact", item.activity.provider === "Northside Music" && item.activity.cost === 32,
     JSON.stringify(item.activity));
  ok("it starts pending", item.status === "pending", item.status);

  // Reading the list must not answer it — a suggestion is answered on purpose.
  const again = await call("activity-suggestions", { token: kid.token });
  ok("reading the list does not silently answer it",
     again.data.suggestions[0].status === "pending", again.data.suggestions[0].status);

  const answered = await call("activity-suggestions/respond", {
    method: "POST", token: kid.token, body: { id: item.id, action: "add" } });
  ok("the student can add it", answered.status === 200 && answered.data.status === "added", JSON.stringify(answered.data));

  const twice = await call("activity-suggestions/respond", {
    method: "POST", token: kid.token, body: { id: item.id, action: "dismiss" } });
  ok("answering twice is a 404, not a silent overwrite", twice.status === 404, `${twice.status}`);

  const seen = await call("link/children", { token: mum.token });
  const mySent = seen.data.children[0].sentActivities;
  ok("the parent can see what became of it", mySent.length === 1 && mySent[0].status === "added",
     JSON.stringify(mySent));
  ok("and it names the activity", mySent[0].name === "Piano lessons", JSON.stringify(mySent[0]));
}

console.log("\nactivities: a suggestion is not a way into someone else's data");
{
  const nope = await call("activity-suggestions", {
    method: "POST", token: stranger.token,
    body: { studentId: kid.user.id, activity: { name: "Judo" } } });
  ok("an unlinked parent is refused", nope.status === 403, `${nope.status}`);

  const empty = await call("activity-suggestions", {
    method: "POST", token: mum.token, body: { studentId: kid.user.id, activity: { name: "   " } } });
  ok("a nameless activity is a 400", empty.status === 400, `${empty.status}`);

  const kidsList = await call("activity-suggestions", { token: stranger.token });
  ok("a stranger's own list is empty, not the student's",
     kidsList.status === 200 && kidsList.data.suggestions.length === 0, JSON.stringify(kidsList.data));

  const ghost = await call("activity-suggestions/respond", {
    method: "POST", token: kid.token, body: { id: "nope1234", action: "add" } });
  ok("answering a suggestion that isn't there is a 404", ghost.status === 404, `${ghost.status}`);
}

console.log("\nactivities: what a guardian posts is reduced to known fields");
{
  const hostile = await call("activity-suggestions", {
    method: "POST", token: mum.token,
    body: { studentId: kid.user.id, activity: {
      name: "x".repeat(500),
      website: "javascript:alert(1)",
      cost: "not a number",
      costPer: "fortnight",
      days: ["Mon", "Funday", "<script>"],
      start: "99:99",
      end: "17:00",
      id: "cl1",                       // would collide with one of their classes
      hours: [{ hours: 9999 }],
      graded: true,
      extra: "x".repeat(10000)
    } } });
  ok("it still succeeds", hostile.status === 200, JSON.stringify(hostile.data));

  const list = await call("activity-suggestions", { token: kid.token });
  const act = list.data.suggestions[0].activity;
  ok("the name is clipped", act.name.length === 80, String(act.name.length));
  ok("a javascript: url is dropped", act.website === "", act.website);
  ok("an unparseable cost becomes null", act.cost === null, String(act.cost));
  ok("an invented billing period falls back to monthly", act.costPer === "month", act.costPer);
  ok("only real weekdays survive", JSON.stringify(act.days) === '["Mon"]', JSON.stringify(act.days));
  ok("an impossible time falls back to a real one", act.start === "16:00", act.start);
  ok("a valid time is kept", act.end === "17:00", act.end);
  ok("no id rides along", act.id === undefined, String(act.id));
  ok("no unknown field rides along",
     act.hours === undefined && act.graded === undefined && act.extra === undefined,
     JSON.stringify(Object.keys(act)));
}

console.log("\nactivities: two guardians suggesting at once both land");
{
  stub.__reset();
  const k = (await signup("k2@school.edu", "student", "Kim")).data;
  const p1 = (await signup("p1@home.com", "parent", "Mum")).data;
  const p2 = (await signup("p2@home.com", "parent", "Dad")).data;
  for (const p of [p1, p2]) {
    const c = (await call("link/code", { method: "POST", token: k.token })).data.code;
    await call("link/redeem", { method: "POST", token: p.token, body: { code: c } });
  }

  const [a, b] = await Promise.all([
    call("activity-suggestions", { method: "POST", token: p1.token,
      body: { studentId: k.user.id, activity: { name: "Piano" } } }),
    call("activity-suggestions", { method: "POST", token: p2.token,
      body: { studentId: k.user.id, activity: { name: "Judo" } } })
  ]);
  ok("both report sent", a.status === 200 && b.status === 200, `${a.status}/${b.status}`);

  const list = (await call("activity-suggestions", { token: k.token })).data.suggestions;
  ok("and both actually arrived", list.length === 2, JSON.stringify(list.map((x) => x.activity.name)));

  // Answering one while the other guardian is still writing.
  const [, second] = await Promise.all([
    call("activity-suggestions/respond", { method: "POST", token: k.token, body: { id: list[0].id, action: "add" } }),
    call("activity-suggestions", { method: "POST", token: p1.token,
      body: { studentId: k.user.id, activity: { name: "Swimming" } } })
  ]);
  ok("a concurrent send still succeeds", second.status === 200, `${second.status}`);
  const after = (await call("activity-suggestions", { token: k.token })).data.suggestions;
  ok("nothing was dropped by the race", after.length === 3, JSON.stringify(after.map((x) => x.activity.name)));
  ok("and the answer stuck", after.filter((x) => x.status === "added").length === 1,
     JSON.stringify(after.map((x) => x.status)));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
