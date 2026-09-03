/* ==========================================================================
   tests/migration.mjs — boot a stored payload from every historical shape

   This is the suite the app did not have, and its absence is why a stale
   dataset took the whole app down. Each case builds a localStorage payload
   the way some earlier build would have written it, boots the real store
   modules against it, and asserts the app reaches a usable state.
   ========================================================================== */

import { readFileSync } from "node:fs";
import vm from "node:vm";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

/** Minimal browser surface the store modules touch. */
function makeEnv(stored, key = "scholar.db.v2", opts = {}) {
  const store = new Map();
  if (stored !== undefined) store.set(key, JSON.stringify(stored));
  // A stored dataset is, by definition, one a signed-in device was allowed
  // to write: js/store.js reads nothing off a device with no session token.
  // So every historical payload below is planted alongside the token that
  // made storing it legal in the first place. Pass { signedOut: true } to
  // test the other half — that a payload without one is erased rather than
  // migrated.
  if (!opts.signedOut) store.set("scholar.token.v1", "test-session-token");
  const ctx = {
    console,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      // js/store.js sweeps by prefix when a session ends, which needs the
      // index side of the API as well as the map side.
      key: (i) => { const all = [...store.keys()]; return i < all.length ? all[i] : null; },
      get length() { return store.size; }
    },
    crypto: { randomUUID: () => "id-" + Math.random().toString(36).slice(2) },
    Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0,
    document: { addEventListener() {}, documentElement: { style: { setProperty() {} }, setAttribute() {} } },
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

/* -------------------------------------------------------- the payloads -- */

// The exact shape that broke the live deploy: an early-v3 dataset that got
// `schemaV3: true` stamped on it before `settings.retention` was ever added.
const staleV3 = {
  schema: 2,
  schemaV3: true,
  settings: { theme: "dark", accent: "indigo", onboarded: true },
  classes: [], assignments: [], terms: [{ id: "t1", name: "Fall", start: "2026-08-01", end: "2026-12-20", current: true }],
  periods: [], events: [], notes: [], activities: [], attendance: [],
  streak: { count: 3, last: "2026-08-20" }, account: {}, ui: { view: "dashboard" }
};

// A v1 backup: no schemaV3, no v2 fields at all.
const v1 = {
  settings: { theme: "light" },
  classes: [{ id: "c1", name: "AP Calculus", credits: 1 }],
  assignments: [{ id: "a1", title: "Problem set", classId: "c1", due: "2026-09-01", status: "todo" }],
  ui: {}
};

// Hostile import: nulls and wrong types where collections belong.
const hostile = {
  schemaV3: true,
  settings: null,
  classes: [null, { id: "c9", name: "Bio" }],
  assignments: null,
  notifications: null,
  terms: "not-an-array",
  streak: null,
  account: null,
  ui: {}
};

/* ------------------------------------------------------------- the run -- */

console.log("\nmigration: stale v3 (the live crash)");
{
  const ctx = makeEnv(staleV3);
  const S = ctx.App.store;
  ok("settings.retention backfilled", S.settings.retention != null,
     "got " + JSON.stringify(S.settings.retention));
  ok("autoArchiveDays readable", S.settings.retention && typeof S.settings.retention.autoArchiveDays === "number");
  ok("autoArchive() does not throw", (() => { try { S.autoArchive(); return true; } catch (e) { return "" + e; } })() === true);
  ok("wellbeing backfilled", S.settings.wellbeing != null);
  ok("gpaScale backfilled", S.settings.gpaScale != null);
  ok("existing data preserved", S.db.streak.count === 3);
}

console.log("\nmigration: v1 backup");
{
  const ctx = makeEnv(v1, "scholar.db.v1");
  const S = ctx.App.store;
  ok("class survived", S.db.classes.length === 1 && S.db.classes[0].name === "AP Calculus");
  ok("retention present", S.settings.retention != null);
  ok("autoArchive() does not throw", (() => { try { S.autoArchive(); return true; } catch (e) { return "" + e; } })() === true);
}

console.log("\nmigration: hostile import (nulls / wrong types)");
{
  const ctx = makeEnv(hostile);
  const S = ctx.App.store;
  ok("null settings replaced", S.settings != null && S.settings.retention != null);
  ok("null notifications became an array", Array.isArray(S.db.notifications));
  ok("null assignments became an array", Array.isArray(S.db.assignments));
  ok("string terms became an array", Array.isArray(S.db.terms));
  ok("null streak replaced", S.db.streak != null && typeof S.db.streak.freezes === "number");
  // The null row is dropped and the real one survives — the whole point is
  // that a junk record costs you that record, not the account.
  ok("null class row dropped, real one kept",
     S.db.classes.length === 1 && S.db.classes[0].name === "Bio",
     JSON.stringify(S.db.classes));
  ok("no silent reseed happened", S.db.ui != null);
  ok("autoArchive() does not throw", (() => { try { S.autoArchive(); return true; } catch (e) { return "" + e; } })() === true);
}

console.log("\nmigration: fresh install");
{
  const ctx = makeEnv(undefined);
  const S = ctx.App.store;
  ok("onboarded is explicitly false", S.settings.onboarded === false);
  ok("retention present", S.settings.retention != null);
  ok("no demo data", S.db.classes.length === 0 && S.db.assignments.length === 0);
}

/* ------------------------------------------------- no session, no reading -- */
console.log("\nmigration: a payload with no session is erased, not migrated");
{
  // The counterpart to every case above. Same stored data, no token — which
  // is what a shared machine looks like after somebody closes the tab
  // without signing out, or what an attacker sees having planted a payload.
  const ctx = makeEnv(v1, "scholar.db.v2", { signedOut: true });
  const state = vm.runInContext(`({
    classes: App.store.db.classes.length,
    onboarded: App.store.settings.onboarded,
    persisting: App.store.isPersistent(),
    leftover: Object.keys({}).length + (typeof localStorage.length === "number" ? localStorage.length : -1)
  })`, ctx);
  ok("the stored classes were not loaded", state.classes === 0, String(state.classes));
  ok("it is a fresh install instead", state.onboarded === false, String(state.onboarded));
  ok("the store refuses to write", state.persisting === false);
  ok("and the payload was cleared out", state.leftover === 0, String(state.leftover));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
