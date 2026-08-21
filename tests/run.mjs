/* ==========================================================================
   tests/run.mjs — run every suite, report once, exit non-zero on any failure

   Browser suites need a static server; this starts one if nothing is already
   listening on the port, and tears it down afterwards.
   ========================================================================== */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";

const PORT = Number(process.env.PORT || 8899);
const BASE = `http://localhost:${PORT}`;

const NODE_SUITES = ["tests/migration.mjs", "tests/assets.mjs", "tests/email.mjs"];
// These drive the real Netlify functions with only the storage layer stubbed,
// so they need the loader that redirects _lib/blobs.js.
const STUBBED_SUITES = ["tests/security.mjs"];
const BROWSER_SUITES = ["tests/boot.mjs", "tests/xss.mjs", "tests/resilience.mjs", "tests/correctness.mjs", "tests/a11y.mjs", "tests/keyboard.mjs"];

function portOpen(port) {
  return new Promise((res) => {
    const s = net.connect(port, "127.0.0.1");
    s.on("connect", () => { s.destroy(); res(true); });
    s.on("error", () => res(false));
  });
}

async function waitForPort(port, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await portOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

const results = [];
function run(file, env, args) {
  if (!existsSync(file)) { console.log(`\n(skipped, missing: ${file})`); return; }
  console.log(`\n${"=".repeat(64)}\n${file}\n${"=".repeat(64)}`);
  const r = spawnSync(process.execPath, [...(args || []), file], { stdio: "inherit", env: { ...process.env, ...env } });
  results.push({ file, code: r.status });
}

for (const f of NODE_SUITES) run(f);
for (const f of STUBBED_SUITES) run(f, null, ["--import", "./tests/stub/register.mjs"]);

let server = null;
if (BROWSER_SUITES.length) {
  const already = await portOpen(PORT);
  if (!already) {
    server = spawn("python3", ["-m", "http.server", String(PORT)], { stdio: "ignore", detached: true });
    if (!(await waitForPort(PORT))) {
      console.error(`\nCould not start a static server on ${PORT}; skipping browser suites.`);
      server && process.kill(-server.pid);
      server = null;
    }
  }
  if (await portOpen(PORT)) for (const f of BROWSER_SUITES) run(f, { BASE });
}
if (server) { try { process.kill(-server.pid); } catch (e) {} }

console.log(`\n${"=".repeat(64)}\nSUMMARY\n${"=".repeat(64)}`);
let bad = 0;
for (const r of results) {
  const state = r.code === 0 ? "PASS" : "FAIL";
  if (r.code !== 0) bad++;
  console.log(`  ${state}  ${r.file}`);
}
console.log(bad ? `\n${bad} suite(s) failed\n` : `\nAll ${results.length} suites passed\n`);
process.exit(bad ? 1 : 0);
