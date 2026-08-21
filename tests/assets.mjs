/* ==========================================================================
   tests/assets.mjs — the app shell and the service worker must agree

   A module that index.html loads but sw.js doesn't precache is invisible in
   development and fatal in production: the page loads from cache, that one
   file 404s offline, and half the app never initialises. This drifted five
   files deep before anyone noticed, so it gets a test.
   ========================================================================== */

import { readFileSync, existsSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const html = readFileSync("index.html", "utf8");
const sw = readFileSync("sw.js", "utf8");

const htmlAssets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)]
  .map((m) => m[1])
  .filter((p) => !/^https?:/.test(p));

const shell = [...sw.matchAll(/"\.\/([^"]+)"/g)].map((m) => m[1]);

console.log("\nassets: every module index.html loads is precached");
for (const a of htmlAssets) {
  ok(`precached: ${a}`, shell.includes(a));
}

console.log("\nassets: every precached path exists on disk");
for (const p of shell) {
  if (!p || p.endsWith("/")) continue;
  ok(`exists: ${p}`, existsSync(p));
}

console.log("\nassets: the cache version is not the stale default");
ok("VERSION moved past v2.0.0", !/const VERSION = "scholar-v2\.0\.0"/.test(sw),
   "bump VERSION in sw.js on every deploy or returning users keep the old shell");

console.log("\nassets: the shell is not served stale-first");
ok("shell strategy is network-first", !/App shell: stale-while-revalidate/.test(sw),
   "a cached-first shell pairs new HTML with old JS");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
