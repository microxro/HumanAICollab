/* ==========================================================================
   tests/authwall.mjs — every endpoint, attacked

   The claim "the endpoints are open" deserves an answer that is checkable
   rather than argued. So this walks the *entire* route table of both
   functions and, for each route, tries to reach it:

     • with no Authorization header at all
     • with a garbage bearer token
     • with a well-formed token signed by a different SCHOLAR_SECRET
     • with a correctly-signed token that has expired
     • with a correctly-signed token whose payload was edited to name
       somebody else's account (the classic "just change the sub" attack)
     • with a token minted before a password reset (revocation)

   Every one of those must fail closed. A route that answers anything other
   than 401/403 to all six is a hole, and the list of routes is derived from
   the router source rather than typed from memory, so a route added later
   without auth shows up here as a failure instead of going unnoticed.

   Then the same again for *authorization*: a signed-in account is a stranger
   to every other account's data, and each cross-account read and write is
   attempted explicitly.

   Run: node --import ./tests/stub/register.mjs tests/authwall.mjs
   ========================================================================== */

import { readFileSync } from "node:fs";

process.env.SCHOLAR_SECRET = "test-secret-value-at-least-16-chars-long";
process.env.SITE_URL = "https://studyhold.example";
process.env.GEMINI_API_KEY = "test-key-for-routing-only";

const api = (await import("../netlify/functions/api.js")).default;
const assistant = (await import("../netlify/functions/assistant.js")).default;
const stub = await import("./stub/blobs-stub.mjs");
const auth = await import("../netlify/functions/_lib/auth.js");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

async function hit(fn, base, path, { method = "GET", body, token, origin } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  if (origin) headers.Origin = origin;
  const res = await fn(new Request(base + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  }));
  let data = null;
  try { data = await res.clone().json(); } catch (e) { data = null; }
  return { status: res.status, data, res };
}
const API = "https://studyhold.example/api/";
const AI = "https://studyhold.example/assistant/";
const callApi = (p, o) => hit(api, API, p, o);
const callAi = (p, o) => hit(assistant, AI, p, o);

/* ================================================== the route inventory == */
/*
   Derived from the router, not remembered. Anything reachable that isn't
   listed here is caught by the completeness check at the bottom, so a new
   route cannot be added without either appearing in this table or failing
   the suite.
*/
const PUBLIC = [
  ["GET", "health"],                  // capability flags only, pre-sign-in
  ["POST", "auth/signup"],
  ["POST", "auth/login"],
  ["POST", "auth/forgot"],            // F098, necessarily unauthenticated
  ["POST", "auth/reset"],
  ["GET", "ics-feed/SOMETOKEN"]       // F046, gated by an unguessable token
];

const GUARDED = [
  ["GET", "email-health"],
  ["GET", "v1/me"], ["GET", "v1/classes"], ["GET", "v1/assignments"],
  ["GET", "v1/schedule"], ["GET", "v1/grades"],
  ["GET", "tokens"], ["POST", "tokens"], ["DELETE", "tokens/abc"],
  ["GET", "webhooks"], ["POST", "webhooks"], ["DELETE", "webhooks/abc"],
  ["GET", "me"], ["POST", "me"],
  ["GET", "sync"], ["PUT", "sync"], ["POST", "sync"],
  ["POST", "subject-ops"],
  ["POST", "link/code"], ["POST", "link/redeem"],
  ["GET", "link/children"], ["GET", "link/parents"], ["DELETE", "link/abc"],
  ["POST", "location"], ["GET", "location/abc"],
  ["POST", "peers/request"], ["POST", "peers/respond"], ["GET", "peers"], ["DELETE", "peers/abc"],
  ["POST", "checkin/request"], ["POST", "checkin/respond"], ["GET", "checkin"],
  ["POST", "ics-feed"],
  ["POST", "focus-windows/propose"], ["POST", "focus-windows/respond"],
  ["POST", "focus-windows/end"], ["GET", "focus-windows"],
  ["GET", "guardian-notes"], ["POST", "guardian-notes"],
  ["GET", "activity-suggestions"], ["POST", "activity-suggestions"],
  ["POST", "activity-suggestions/respond"],
  ["GET", "groups"], ["POST", "groups"], ["POST", "groups/join"], ["POST", "groups/broadcast"],
  ["GET", "groups/g1"], ["POST", "groups/g1/deck"], ["GET", "groups/g1/deck/d1"],
  ["POST", "groups/g1/feed"], ["POST", "groups/g1/feed/f1/comment"],
  ["POST", "groups/g1/feed/f1/rate"], ["POST", "groups/g1/feed/f1"],
  ["POST", "groups/g1/leave"],
  ["POST", "groups/g1/tasks"], ["POST", "groups/g1/tasks/t1"], ["DELETE", "groups/g1/tasks/t1"],
  ["POST", "groups/g1/availability"],
  ["POST", "groups/g1/partners"], ["POST", "groups/g1/partners/p1"], ["DELETE", "groups/g1/partners/p1"],
  ["POST", "groups/g1/tutoring"], ["POST", "groups/g1/tutoring/t1"], ["DELETE", "groups/g1/tutoring/t1"],
  ["POST", "groups/g1/notes"], ["GET", "groups/g1/notes/n1"],
  ["POST", "groups/g1/notes/n1/thanks"], ["DELETE", "groups/g1/notes/n1"],
  ["POST", "groups/g1/challenges"], ["POST", "groups/g1/challenges/c1/join"],
  ["POST", "groups/g1/challenges/c1/contribute"], ["DELETE", "groups/g1/challenges/c1"]
];

const AI_GUARDED = [
  ["POST", "parse-text"], ["POST", "parse-image"], ["POST", "parse-note-image"],
  ["POST", "from-url"], ["POST", "estimate"], ["POST", "act"], ["POST", "ask"]
];

/* ============================================== forged and absent tokens == */

/** A token signed with a *different* secret — the attacker's own HMAC key. */
async function foreignToken(sub) {
  const real = process.env.SCHOLAR_SECRET;
  process.env.SCHOLAR_SECRET = "a-completely-different-secret-value-x";
  const t = await auth.signToken({ sub, epoch: 0 });
  process.env.SCHOLAR_SECRET = real;
  return t;
}

/** A correctly-signed token whose payload has been edited, signature kept. */
function tamperedToken(token, mutate) {
  const [payload, sig] = token.split(".");
  const json = JSON.parse(new TextDecoder().decode(auth.fromB64Url(payload)));
  mutate(json);
  const edited = auth.toB64Url(new TextEncoder().encode(JSON.stringify(json)));
  return `${edited}.${sig}`;
}

stub.__reset();
const victim = (await callApi("auth/signup", {
  method: "POST", body: { email: "victim@x.com", password: "password123", name: "Victim", role: "student" }
})).data;
const attacker = (await callApi("auth/signup", {
  method: "POST", body: { email: "attacker@x.com", password: "password123", name: "Mal", role: "student" }
})).data;

const expired = await (async () => {
  const t = await auth.signToken({ sub: victim.user.id, epoch: 0 });
  return tamperedToken(t, (p) => { p.exp = Date.now() - 1000; });
})();

const CREDENTIALS = [
  ["no token", undefined],
  ["garbage token", "not-a-token-at-all"],
  ["empty bearer", " "],
  ["token signed with another secret", await foreignToken(victim.user.id)],
  ["expired token", expired],
  ["token with the subject swapped", tamperedToken(attacker.token, (p) => { p.sub = victim.user.id; })],
  ["token with the expiry pushed out", tamperedToken(attacker.token, (p) => { p.exp = Date.now() + 9e11; })],
  ["an sk_ prefix that was never minted", "sk_" + "A".repeat(43)]
];

console.log("\nauthwall: no guarded api route answers to a bad credential");
for (const [label, token] of CREDENTIALS) {
  let leaked = [];
  for (const [method, path] of GUARDED) {
    const r = await callApi(path, { method, token, body: method === "GET" || method === "DELETE" ? undefined : {} });
    // 401 is the expected answer. 403 is acceptable where a route rejects the
    // *kind* of credential before the identity check. Anything else means the
    // handler ran.
    if (r.status !== 401 && r.status !== 403) leaked.push(`${method} /${path} → ${r.status}`);
  }
  ok(`${GUARDED.length} routes reject: ${label}`, leaked.length === 0, leaked.slice(0, 6).join(", "));
}

console.log("\nauthwall: no AI route answers to a bad credential");
for (const [label, token] of CREDENTIALS) {
  let leaked = [];
  for (const [method, path] of AI_GUARDED) {
    const r = await callAi(path, { method, token, body: {} });
    if (r.status !== 401 && r.status !== 403) leaked.push(`${method} /${path} → ${r.status}`);
  }
  ok(`${AI_GUARDED.length} AI routes reject: ${label}`, leaked.length === 0, leaked.slice(0, 6).join(", "));
}

console.log("\nauthwall: the public routes are the ones we meant, and only those");
{
  // Each of these must NOT 401 — they are deliberately reachable. If one
  // starts requiring auth that is also worth knowing, hence asserting both
  // directions rather than only the dangerous one.
  const unexpected = [];
  for (const [method, path] of PUBLIC) {
    const r = await callApi(path, { method, body: method === "GET" ? undefined : {} });
    if (r.status === 401) unexpected.push(`${method} /${path} → 401`);
  }
  ok(`${PUBLIC.length} intentionally-public routes still reachable`, unexpected.length === 0, unexpected.join(", "));

  // The anonymous health probe must not describe the deployment.
  const h = await callApi("health");
  const keys = Object.keys(h.data || {});
  ok("public health exposes no configuration",
     !JSON.stringify(h.data).match(/key|secret|from|model|url/i) || keys.every((k) => ["ok", "time", "email"].includes(k)),
     JSON.stringify(h.data));

  // The anonymous assistant health says on/off and nothing else.
  const ah = await callAi("health", { method: "GET" });
  ok("anonymous assistant health exposes only a boolean",
     Object.keys(ah.data || {}).join(",") === "configured", JSON.stringify(ah.data));

  // An unguessable-token route must not accept a guess.
  const ics = await callApi("ics-feed/nope-not-real");
  ok("a wrong ICS token gets nothing", ics.status === 404, `${ics.status}`);
}

/* ===================================================== revocation ======== */
console.log("\nauthwall: a password reset retires tokens minted before it");
{
  stub.__reset();
  const u = (await callApi("auth/signup", {
    method: "POST", body: { email: "reset@x.com", password: "password123", name: "R", role: "student" }
  })).data;
  const before = u.token;
  ok("the token works to begin with", (await callApi("me", { token: before })).status === 200);

  // Bump the epoch the way a completed reset does.
  const prof = await stub.readJSON("profiles", u.user.id);
  await stub.writeJSON("profiles", u.user.id, { ...prof, tokenEpoch: Date.now() });

  ok("and stops working after the epoch moves",
     (await callApi("me", { token: before })).status === 401);
  ok("on the AI routes too",
     (await callAi("ask", { method: "POST", token: before, body: { question: "hi" } })).status === 401);
}

/* ================================================ cross-account access === */
console.log("\nauthwall: a signed-in account is a stranger to every other account");
{
  stub.__reset();
  const a = (await callApi("auth/signup", { method: "POST", body: { email: "a@x.com", password: "password123", name: "A", role: "student" } })).data;
  const b = (await callApi("auth/signup", { method: "POST", body: { email: "b@x.com", password: "password123", name: "B", role: "student" } })).data;
  const parent = (await callApi("auth/signup", { method: "POST", body: { email: "p@x.com", password: "password123", name: "P", role: "parent" } })).data;

  // A stores something private.
  await callApi("sync", { method: "PUT", token: a.token, body: { state: { secret: "A's homework" }, baseVersion: 0 } });
  await callApi("location", { method: "POST", token: a.token, body: { status: { label: "At home" }, summary: { name: "A" } } });

  const attacks = [
    ["read A's synced state", () => callApi("v1/me", { token: b.token }), (r) => !JSON.stringify(r.data).includes("A's homework")],
    ["read A's live location", () => callApi(`location/${a.user.id}`, { token: b.token }), (r) => r.status === 403],
    ["unlink A from someone", () => callApi(`link/${a.user.id}`, { method: "DELETE", token: b.token }), (r) => r.status === 404],
    ["remove A as a peer", () => callApi(`peers/${a.user.id}`, { method: "DELETE", token: b.token }), (r) => r.status === 404],
    ["send A's guardian a note", () => callApi("guardian-notes", { method: "POST", token: b.token, body: { studentId: a.user.id, text: "x" } }), (r) => r.status === 403],
    ["demand a check-in from A", () => callApi("checkin/request", { method: "POST", token: b.token, body: { studentId: a.user.id } }), (r) => r.status === 403],
    ["impose a focus window on A", () => callApi("focus-windows/propose", { method: "POST", token: b.token, body: { studentId: a.user.id, startAt: Date.now(), endAt: Date.now() + 1000 } }), (r) => r.status === 403],
    ["put an activity in A's app", () => callApi("activity-suggestions", { method: "POST", token: b.token, body: { studentId: a.user.id, activity: { name: "Judo" } } }), (r) => r.status === 403],
    // F157 — the record-level write. An unlinked account must not reach it,
    // and must not learn from the reply whether A exists or has ever synced.
    ["edit A's records", () => callApi("subject-ops", { method: "POST", token: b.token, body: { subjectId: a.user.id, ops: [{ op: "upsert", collection: "assignments", record: { title: "Ha" } }] } }), (r) => r.status === 403],
    ["delete one of A's records", () => callApi("subject-ops", { method: "POST", token: b.token, body: { subjectId: a.user.id, ops: [{ op: "delete", collection: "assignments", id: "as1" }] } }), (r) => r.status === 403],
    ["read a group A is in", () => callApi("groups/anything", { token: b.token }), (r) => r.status === 404 || r.status === 403],
    ["broadcast as a teacher", () => callApi("groups/broadcast", { method: "POST", token: b.token, body: { title: "x" } }), (r) => r.status === 403],
    ["mint a link code as a parent", () => callApi("link/code", { method: "POST", token: parent.token }), (r) => r.status !== 200 || !r.data.code]
  ];
  for (const [label, run, expect] of attacks) {
    const r = await run();
    ok(`B cannot: ${label}`, expect(r), `${r.status} ${JSON.stringify(r.data).slice(0, 90)}`);
  }

  // A's own data is still reachable by A — a wall that blocks everyone is
  // not a wall, it is an outage.
  ok("...but A can still read A's own data",
     (await callApi("v1/me", { token: a.token })).status === 200);
}

/* =============================================== cross-origin =========== */
console.log("\nauthwall: another website can't drive the API from a visitor's browser");
{
  const evil = await callApi("me", { token: victim.token, origin: "https://evil.example" });
  const acao = evil.res.headers.get("access-control-allow-origin");
  ok("no ACAO is returned to a foreign origin", !acao, String(acao));

  const pre = await api(new Request(API + "me", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }));
  ok("preflight refuses a foreign origin", !pre.headers.get("access-control-allow-origin"),
     String(pre.headers.get("access-control-allow-origin")));

  const own = await api(new Request(API + "me", { method: "OPTIONS", headers: { Origin: "https://studyhold.example" } }));
  ok("but allows this site's own origin",
     own.headers.get("access-control-allow-origin") === "https://studyhold.example",
     String(own.headers.get("access-control-allow-origin")));

  const aiEvil = await assistant(new Request(AI + "ask", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }));
  ok("the AI routes refuse a foreign origin too", !aiEvil.headers.get("access-control-allow-origin"));
}

/* ============================================ route-table completeness == */
console.log("\nauthwall: the route table above covers the router");
{
  const src = readFileSync("netlify/functions/api.js", "utf8");
  const router = src.slice(src.indexOf("export default async (req)"));

  // Every top-level resource the router branches on must be accounted for as
  // either public or guarded. A new one added without a test shows up here.
  const seen = new Set([...router.matchAll(/parts\[0\] === "([a-z0-9-]+)"/g)].map((m) => m[1]));
  const covered = new Set([...PUBLIC, ...GUARDED].map(([, p]) => p.split("/")[0]));
  const missing = [...seen].filter((r) => !covered.has(r));
  ok("every top-level api resource is exercised", missing.length === 0, missing.join(", "));

  const aiSrc = readFileSync("netlify/functions/assistant.js", "utf8");
  const aiRouter = aiSrc.slice(aiSrc.indexOf("export default async (req)"));
  const aiSeen = new Set([...aiRouter.matchAll(/path === "([a-z0-9-]+)"/g)].map((m) => m[1]));
  const aiCovered = new Set([...AI_GUARDED.map(([, p]) => p), "health"]);
  const aiMissing = [...aiSeen].filter((r) => !aiCovered.has(r));
  ok("every assistant route is exercised", aiMissing.length === 0, aiMissing.join(", "));

  // requireUser must be reached before any handler that isn't on the public
  // list — check structurally, so reordering the router can't quietly move a
  // route above the auth gate.
  const gate = router.indexOf("const user = await requireUser(req);");
  ok("the auth gate exists in the router", gate > 0);
  const abovePublic = router.slice(0, gate);
  const strayHandlers = [...abovePublic.matchAll(/return await (\w+)\(/g)]
    .map((m) => m[1])
    .filter((n) => !["signup", "login", "forgotPassword", "resetPassword", "getIcsFeed"].includes(n));
  ok("nothing but the public handlers sits above the auth gate",
     strayHandlers.length === 0, strayHandlers.join(", "));
}

/* ============================================ malformed path segments === */
console.log("\nauthwall: a malformed id is a 400, never a server error");
{
  stub.__reset();
  const u = (await callApi("auth/signup", { method: "POST", body: { email: "f@x.com", password: "password123", name: "F", role: "student" } })).data;
  const nasty = ["%2Fetc%2Fpasswd", "..", "%2e%2e", " ", "\u0000", "x".repeat(400), "%00"];
  const bad = [];
  for (const seg of nasty) {
    for (const path of [`groups/${seg}`, `location/${seg}`, `link/${seg}`, `peers/${seg}`, `tokens/${seg}`]) {
      const r = await callApi(path, { token: u.token, method: path.startsWith("tokens") ? "DELETE" : "GET" });
      // 400/403/404 are all fine answers. A 500 means the segment reached
      // storage and blew up, which is the fuzzing result worth avoiding.
      if (r.status >= 500) bad.push(`/${path} → ${r.status}`);
    }
  }
  ok("no malformed segment produces a 5xx", bad.length === 0, bad.slice(0, 5).join(", "));
}

/* ================================================= write ceiling ======== */
console.log("\nauthwall: one account can't hammer the write routes forever");
{
  stub.__reset();
  const u = (await callApi("auth/signup", { method: "POST", body: { email: "loop@x.com", password: "password123", name: "L", role: "student" } })).data;
  let last = null, hit = 0;
  for (let i = 0; i < 950; i++) {
    last = await callApi("me", { method: "POST", token: u.token, body: { name: "N" + i } });
    if (last.status === 429) { hit = i; break; }
  }
  ok("the write ceiling engages", last && last.status === 429, `${last && last.status} after ${hit}`);
  ok("and only after a generous number of writes", hit > 500, String(hit));
  // Reads must keep working — a limit that locks someone out of their own
  // data is an outage wearing a security badge.
  ok("reads still work while writes are paused", (await callApi("me", { token: u.token })).status === 200);
}

console.log("\nauthwall: creating groups is capped tighter than general writes");
{
  stub.__reset();
  const u = (await callApi("auth/signup", { method: "POST", body: { email: "g@x.com", password: "password123", name: "G", role: "student" } })).data;
  let last = null;
  for (let i = 0; i < 25; i++) {
    last = await callApi("groups", { method: "POST", token: u.token, body: { name: "G" + i } });
    if (last.status === 429) break;
  }
  ok("group creation is capped", last && last.status === 429, `${last && last.status}`);
}

/* ============================================= the scheduled digest ===== */
console.log("\nauthwall: the weekly digest refuses a direct HTTP call");
{
  const digest = (await import("../netlify/functions/weekly-digest.js")).default;
  const direct = await digest(new Request("https://studyhold.example/.netlify/functions/weekly-digest", { method: "POST" }));
  ok("an ordinary POST is refused", direct.status === 403, String(direct.status));

  const scheduled = await digest(new Request("https://studyhold.example/.netlify/functions/weekly-digest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ next_run: new Date(Date.now() + 6e8).toISOString() })
  }));
  ok("but the scheduler's own invocation runs", scheduled.status === 200, String(scheduled.status));
}

/* ==================================================== response headers == */
console.log("\nauthwall: the deployed headers are the ones we think they are");
{
  const toml = readFileSync("netlify.toml", "utf8");
  const need = [
    ["nosniff", /X-Content-Type-Options\s*=\s*"nosniff"/],
    ["clickjacking denied outright", /X-Frame-Options\s*=\s*"DENY"/],
    ["HSTS for a year", /Strict-Transport-Security\s*=\s*"max-age=31536000/],
    ["referrer trimmed cross-origin", /Referrer-Policy\s*=\s*"strict-origin/],
    ["a CSP exists", /Content-Security-Policy/],
    ["camera and mic are not granted to third parties", /Permissions-Policy/]
  ];
  for (const [label, re] of need) ok(label, re.test(toml));

  const csp = (toml.match(/Content-Security-Policy\s*=\s*"([^"]+)"/) || [])[1] || "";
  const directive = (name) => (csp.match(new RegExp(name + "\\s+([^;]+)")) || [])[1] || "";
  // The half of a CSP that actually stops injected script from executing.
  ok("script-src forbids inline script", !/unsafe-inline/.test(directive("script-src")), directive("script-src"));
  ok("script-src forbids eval", !/unsafe-eval/.test(directive("script-src")), directive("script-src"));
  ok("script-src is same-origin only", directive("script-src").trim() === "'self'", directive("script-src"));
  ok("plugins are blocked", /object-src\s+'none'/.test(csp), csp);
  ok("nothing may frame this app", /frame-ancestors\s+'none'/.test(csp), csp);
  ok("<base> can't be hijacked", /base-uri\s+'self'/.test(csp), csp);
  ok("forms can't post off-site", /form-action\s+'self'/.test(csp), csp);
  ok("the browser talks to no third party", /connect-src\s+'self'/.test(csp), csp);
}

/* ============================================== secrets stay server-side = */
console.log("\nauthwall: no secret is reachable from the browser bundle");
{
  const clientFiles = ["js/sync.js", "js/assistant.js", "js/store.js", "js/app.js", "index.html"];
  const leaks = [];
  for (const f of clientFiles) {
    const src = readFileSync(f, "utf8");
    for (const name of ["SCHOLAR_SECRET", "RESEND_API_KEY", "GEMINI_API_KEY", "ADMIN_EMAIL", "EMAIL_FROM"]) {
      if (src.includes(name)) leaks.push(`${f} mentions ${name}`);
    }
    if (/re_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}/.test(src)) leaks.push(`${f} contains a key-shaped literal`);
  }
  ok("no server env var is named in client code", leaks.length === 0, leaks.join(", "));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
