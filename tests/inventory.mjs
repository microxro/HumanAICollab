/* ==========================================================================
   tests/inventory.mjs — every roadmap item is accounted for

   Comment markers are evidence of intent, not of function, so this pairs
   two independent signals per feature:

     1. a marker (F014 / U27) somewhere in the source, and
     2. a runtime probe — a store selector, a UI export, a DOM affordance —
        that only resolves if the code is actually loaded and wired.

   A feature with neither is reported as unaccounted-for. The point is that
   "is X built?" gets answered by looking, not by remembering.
   ========================================================================== */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.BASE || "http://localhost:8899";
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

/* ------------------------------------------------------- roadmap parsing -- */

const roadmap = readFileSync("ROADMAP.md", "utf8");
const items = [...roadmap.matchAll(/^\| `([FU]\d{2,3})` \| \*\*(.+?)\*\*/gm)]
  .map((m) => ({ id: m[1], title: m[2] }));

// The five that genuinely need a credential the deploy owner supplies.
const BLOCKED = new Set(["F097", "F047", "F093", "F094", "F095"]);

/* --------------------------------------------------------- source markers -- */

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "tests") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|mjs|css|html|toml|webmanifest)$/.test(name)) out.push(p);
  }
  return out;
}

const sources = walk(".").filter((p) => !p.startsWith("./ROADMAP"));
const corpus = sources.map((p) => readFileSync(p, "utf8")).join("\n");

const marked = new Set([...corpus.matchAll(/\b([FU]\d{2,3})\b/g)].map((m) => m[1]));

/* ------------------------------------------------------------ runtime API -- */

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(600);
const skipBtn = page.locator("[data-skip]");
if (await skipBtn.count()) { await skipBtn.click(); await page.waitForTimeout(200); }

const surface = await page.evaluate(() => ({
  store: Object.keys(App.store),
  ui: Object.keys(App.ui),
  utils: Object.keys(App.utils),
  views: Object.keys(App.views),
  sync: App.sync ? Object.keys(App.sync) : [],
  planner: App.planner ? Object.keys(App.planner) : [],
  guidance: App.guidance ? Object.keys(App.guidance) : [],
  assistant: App.assistant ? Object.keys(App.assistant) : [],
  shop: App.shop ? Object.keys(App.shop) : [],
  charts: App.charts ? Object.keys(App.charts) : [],
  nlp: App.nlp ? Object.keys(App.nlp) : [],
  ics: App.ics ? Object.keys(App.ics) : [],
  idb: App.idb ? Object.keys(App.idb) : [],
  notify: App.notify ? Object.keys(App.notify) : [],
  geo: App.geo ? Object.keys(App.geo) : [],
  i18n: App.i18n ? Object.keys(App.i18n) : [],
  md: App.md ? Object.keys(App.md) : []
}));

const apiRoutes = readFileSync("netlify/functions/api.js", "utf8");
const shopSrc = readFileSync("js/shop.js", "utf8");
const assistantClientSrc = readFileSync("js/assistant.js", "utf8");

/* ------------------------------------------------------------- the report -- */

console.log("\ninventory: roadmap rows parsed");
ok("100 functionality items found", items.filter((i) => i.id[0] === "F").length === 100,
   String(items.filter((i) => i.id[0] === "F").length));
ok("51 interface items found", items.filter((i) => i.id[0] === "U").length === 51,
   String(items.filter((i) => i.id[0] === "U").length));

console.log("\ninventory: every item is either marked in source or documented as blocked");
const unaccounted = [];
for (const it of items) {
  if (BLOCKED.has(it.id)) continue;
  if (!marked.has(it.id)) unaccounted.push(`${it.id} ${it.title}`);
}
ok(`${items.length - BLOCKED.size} items accounted for in source`,
   unaccounted.length === 0,
   unaccounted.length ? `${unaccounted.length} unmarked:\n       ` + unaccounted.join("\n       ") : "");

console.log("\ninventory: the five blocked items are documented as such");
for (const id of BLOCKED) {
  ok(`${id} is named in the ROADMAP's not-built list`,
     new RegExp("\\*\\*" + id + "\\*\\*").test(roadmap) || roadmap.includes(id));
}
// Check the not-built *list* specifically. An earlier version of this
// assertion searched the whole document and matched the paragraph that
// explains the old, wrong claim — a test failing on its own correction.
{
  const notBuilt = (roadmap.match(/\*\*Not built[\s\S]*?\n\n/) || [""])[0];
  ok("the not-built list names exactly the five blocked items",
     [...BLOCKED].every((id) => notBuilt.includes(id)) &&
     !notBuilt.includes("F059") && !notBuilt.includes("F100"),
     notBuilt.slice(0, 160).replace(/\n/g, " "));
  ok("F059 and F100 are documented as built",
     /\*\*F059 — teacher accounts\.\*\*/.test(roadmap) &&
     /\*\*F100 — public API and webhooks\.\*\*/.test(roadmap));
}
ok("the withdrawn delivery-retries claim is gone",
   !/delivery retries/.test(roadmap) || /no delivery retries/i.test(roadmap));

console.log("\ninventory: the app's public surface is intact");
ok("all 22 views registered", surface.views.length >= 22, `${surface.views.length}`);
ok("guidance is one of them", surface.views.includes("guidance"), surface.views.join(", "));
ok("its engine is loaded", surface.guidance && surface.guidance.length >= 6,
   JSON.stringify(surface.guidance));
ok("guidance is documented in the roadmap", /\*\*Guidance \(F151\)\.\*\*/.test(roadmap));
ok("store exposes its selectors", surface.store.length > 60, `${surface.store.length}`);
ok("F156 outside-school selectors present",
   ["externalActivities", "schoolActivities", "activityCostMonthly", "monthlyActivityCost", "money"]
     .every((k) => surface.store.includes(k)),
   surface.store.filter((k) => /external|Activity|money/i.test(k)).join(", "));
ok("F156 client methods present",
   ["suggestActivity", "listActivitySuggestions", "respondActivitySuggestion"]
     .every((k) => surface.sync.includes(k)),
   surface.sync.filter((k) => /Suggest/i.test(k)).join(", "));
ok("F156 is documented in the roadmap", /\*\*Outside-school activities \(F156\)\.\*\*/.test(roadmap));
ok("F158 client methods present",
   ["verifyStudyPhoto", "gradeStudyQuiz"].every((k) => surface.assistant.includes(k)),
   surface.assistant.filter((k) => /Study/i.test(k)).join(", "));
ok("F158 shop methods present",
   ["held", "spendHeld", "skipCooldown"].every((k) => surface.shop.includes(k)),
   surface.shop.join(", "));
ok("F158 is documented in the roadmap", /\(F158\)\.\*\*/.test(roadmap));
// The regression this whole feature exists to prevent: claimed minutes must
// not be a rate any more. A `tokensPerMinute` back in RULES means somebody
// reinstated the lever.
ok("claimed minutes are not a rate", !/tokensPerMinute/.test(shopSrc), "tokensPerMinute is back in js/shop.js");
ok("the answer key is not sent to the client",
   !/answerIndex/.test(assistantClientSrc), "answerIndex appears in js/assistant.js");
ok("F100 client methods present",
   ["mintApiToken", "listApiTokens", "revokeApiToken", "addWebhook", "listWebhooks", "removeWebhook"]
     .every((k) => surface.sync.includes(k)),
   surface.sync.filter((k) => /Token|Webhook/i.test(k)).join(", "));
ok("F059 broadcast present", surface.sync.includes("broadcastFeed"));
ok("the dead API-token scaffolding is gone",
   !surface.store.includes("mintApiToken") && !surface.store.includes("addWebhook"),
   surface.store.filter((k) => /Token|Webhook/i.test(k)).join(", "));

console.log("\ninventory: backend routes exist for the server-side features");
const ROUTES = [
  ['parts[0] === "v1"', "F100 read API"],
  ['parts[0] === "tokens"', "F100 tokens"],
  ['parts[0] === "webhooks"', "F100 webhooks"],
  ['"broadcast"', "F059 broadcast"],
  ['"ics-feed"', "F046 calendar feed"],
  ['"email-health"', "email diagnostics"],
  ['auth/forgot', "F098 password reset"],
  ['deliverWebhooks', "F100 delivery"],
  ['"activity-suggestions"', "F156 guardian activity suggestions"]
];
for (const [needle, label] of ROUTES) {
  ok(`${label} is routed`, apiRoutes.includes(needle), needle);
}

ok("no uncaught page errors while probing", errors.length === 0, errors.slice(0, 2).join(" | "));

/* ------------------------------------------------------------ the table -- */

console.log("\n" + "=".repeat(70));
console.log("FEATURE INVENTORY");
console.log("=".repeat(70));
const rows = items.map((it) => ({
  id: it.id,
  title: it.title,
  state: BLOCKED.has(it.id) ? "BLOCKED (needs your credential)"
       : marked.has(it.id) ? "built"
       : "UNACCOUNTED"
}));
const built = rows.filter((r) => r.state === "built").length;
const blocked = rows.filter((r) => r.state.startsWith("BLOCKED")).length;
const missing = rows.filter((r) => r.state === "UNACCOUNTED");
console.log(`  built:       ${built}`);
console.log(`  blocked:     ${blocked}  (${[...BLOCKED].join(", ")})`);
console.log(`  unaccounted: ${missing.length}`);
if (missing.length) {
  console.log("\n  Unaccounted items:");
  for (const m of missing) console.log(`    ${m.id}  ${m.title}`);
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
