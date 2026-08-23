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
ok("VERSION moved past v2.0.0", !/const VERSION = "studyhold-v2\.0\.0"/.test(sw),
   "bump VERSION in sw.js on every deploy or returning users keep the old shell");

console.log("\nassets: the shell is not served stale-first");
ok("shell strategy is network-first", !/App shell: stale-while-revalidate/.test(sw),
   "a cached-first shell pairs new HTML with old JS");

/* ------------------------------------------------ deploy freshness ------ */
// This class of bug is invisible locally — a dev server sends no max-age, so
// everything looks correct right up until a release reaches a real browser
// and a fraction of users keep running last hour's code. It is checked here
// because there is nowhere else it *can* be checked.
console.log("\nassets: a release can actually reach a returning browser");
{
  const toml = readFileSync("netlify.toml", "utf8");

  // Pull the Cache-Control for each header block, keyed by its `for` glob.
  const blocks = {};
  let currentFor = null;
  for (const line of toml.split("\n")) {
    const f = line.match(/^\s*for\s*=\s*"([^"]+)"/);
    if (f) { currentFor = f[1]; continue; }
    const cc = line.match(/^\s*Cache-Control\s*=\s*"([^"]+)"/);
    if (cc && currentFor) blocks[currentFor] = cc[1];
  }

  // These filenames carry no content hash, so any max-age above zero is a
  // window during which a deploy cannot reach a browser that has the file.
  for (const glob of ["/js/*", "/css/*"]) {
    const cc = blocks[glob] || "";
    ok(`${glob} has a Cache-Control`, !!cc, JSON.stringify(blocks));
    const age = Number((cc.match(/max-age=(\d+)/) || [])[1] ?? -1);
    ok(`${glob} does not cache un-hashed files past a revalidation`,
       age === 0 && /must-revalidate|no-cache/.test(cc),
       `${glob} → "${cc}" — filenames aren't content-hashed, so a positive max-age serves stale code for that long`);
  }

  const swCc = blocks["/sw.js"] || "";
  ok("/sw.js is never cached", /no-cache|no-store|max-age=0/.test(swCc), `"${swCc}"`);

  // ...and the worker must not let the HTTP cache answer its own fetch, or
  // "network-first" quietly becomes "whatever the browser already had".
  ok("the shell fetch bypasses the HTTP cache", /cache:\s*"reload"/.test(sw),
     'sw.js should fetch shell files with { cache: "reload" }');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
