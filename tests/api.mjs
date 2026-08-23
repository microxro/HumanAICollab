/* ==========================================================================
   tests/api.mjs — F100: personal API tokens, the /v1 surface, and webhooks

   Drives the real api.js with storage stubbed. The webhook tests intercept
   global fetch, so delivery is exercised without a live endpoint — what
   cannot be verified from here is a real round-trip to an external URL, and
   that is stated rather than implied.

   Run: node --import ./tests/stub/register.mjs tests/api.mjs
   ========================================================================== */

process.env.SCHOLAR_SECRET = "test-secret-value-at-least-16-chars-long";
process.env.SITE_URL = "https://studyhold.example";

const api = (await import("../netlify/functions/api.js")).default;
const stub = await import("./stub/blobs-stub.mjs");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const BASE = "https://studyhold.example/api/";
async function call(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await api(new Request(BASE + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  }));
  let data = null;
  try { data = await res.clone().json(); } catch (e) { data = null; }
  return { status: res.status, data, res };
}

async function makeUser(email) {
  const r = await call("auth/signup", {
    method: "POST", body: { email, password: "password123", name: "Test", role: "student" }
  });
  return r.data;
}

/* ------------------------------------------------------------- minting -- */
console.log("\napi: tokens are minted server-side and shown once");
let owner, ownerToken, apiKey;
{
  stub.__reset();
  owner = await makeUser("dev@x.com");
  ownerToken = owner.token;

  const empty = await call("tokens", { token: ownerToken });
  ok("starts with no tokens", empty.status === 200 && empty.data.tokens.length === 0);

  const mint = await call("tokens", { method: "POST", token: ownerToken, body: { label: "My script" } });
  ok("mint succeeds", mint.status === 200, JSON.stringify(mint.data));
  apiKey = mint.data.token;
  ok("the token is prefixed sk_", typeof apiKey === "string" && apiKey.startsWith("sk_"), apiKey);
  ok("it is long enough to be unguessable", apiKey.length > 30, `${apiKey.length} chars`);

  const list = await call("tokens", { token: ownerToken });
  ok("it appears in the list", list.data.tokens.length === 1);
  ok("the list shows only a hint, never the token",
     !JSON.stringify(list.data).includes(apiKey), "the full token leaked into the listing");
  ok("the hint is recognisable", /^sk_.{1,8}…$/.test(list.data.tokens[0].hint), list.data.tokens[0].hint);
}

/* ----------------------------------------------------------- redeeming -- */
console.log("\napi: a minted token authenticates the read surface");
{
  const me = await call("v1/me", { token: apiKey });
  ok("GET /v1/me works with the token", me.status === 200, JSON.stringify(me.data));
  ok("and returns the right account", me.data.email === "dev@x.com", JSON.stringify(me.data));

  const bogus = await call("v1/me", { token: "sk_" + "a".repeat(40) });
  ok("an invented token is rejected", bogus.status === 401, `${bogus.status}`);

  const sessionStillWorks = await call("me", { token: ownerToken });
  ok("session tokens are unaffected", sessionStillWorks.status === 200);
}

/* ------------------------------------------------------------ isolation -- */
console.log("\napi: one account's token cannot read another's data");
{
  const other = await makeUser("other@x.com");
  await call("sync", { method: "PUT", token: other.token, body: { state: { secret: "theirs" }, baseVersion: 0 } });
  await call("sync", { method: "PUT", token: ownerToken, body: { state: { classes: [{ id: "c1", name: "Mine" }] }, baseVersion: 0 } });

  const mine = await call("v1/classes", { token: apiKey });
  ok("the token reads its own classes", mine.status === 200 && mine.data.classes.length === 1,
     JSON.stringify(mine.data));
  ok("and nothing of the other account's",
     !JSON.stringify(mine.data).includes("theirs"), JSON.stringify(mine.data));

  const meOther = await call("v1/me", { token: apiKey });
  ok("identity stays the token owner's", meOther.data.email === "dev@x.com");
}

/* ------------------------------------------------------------- surface -- */
console.log("\napi: every /v1 route returns that user's real records");
{
  await call("sync", {
    method: "PUT", token: ownerToken,
    body: {
      baseVersion: 1,
      state: {
        classes: [{ id: "c1", name: "AP Biology", credits: 1, color: "#333", days: ["Mon"] }],
        assignments: [
          { id: "a1", classId: "c1", title: "Cell lab", due: "2026-09-01", status: "todo", points: 100 },
          { id: "a2", classId: "c1", title: "Quiz", due: "2026-08-20", status: "done", points: 100, earned: 90, graded: true }
        ],
        periods: [{ id: "p1", name: "1st", start: "08:00", end: "08:50" }],
        terms: [{ id: "t1", name: "Fall", start: "2026-08-01", end: "2026-12-20", current: true }]
      }
    }
  });

  const classes = await call("v1/classes", { token: apiKey });
  ok("classes", classes.status === 200 && classes.data.classes[0].name === "AP Biology", JSON.stringify(classes.data));

  const asg = await call("v1/assignments", { token: apiKey });
  ok("assignments", asg.status === 200 && asg.data.assignments.length === 2);

  const todo = await call("v1/assignments?status=todo", { token: apiKey });
  ok("assignments filter by status", todo.data.assignments.length === 1 && todo.data.assignments[0].id === "a1",
     JSON.stringify(todo.data.assignments.map((a) => a.id)));

  const sched = await call("v1/schedule", { token: apiKey });
  ok("schedule", sched.data.periods.length === 1 && sched.data.terms.length === 1);

  const grades = await call("v1/grades", { token: apiKey });
  ok("grades computes a percentage", grades.data.grades[0].percent === 90, JSON.stringify(grades.data));

  const unknown = await call("v1/nonsense", { token: apiKey });
  ok("an unknown resource is a 404", unknown.status === 404);
}

console.log("\napi: the surface is read-only and self-limiting");
{
  const write = await call("v1/classes", { method: "POST", token: apiKey, body: { name: "Injected" } });
  ok("POST to /v1 is refused", write.status === 405, `${write.status}`);

  const mintWithApiToken = await call("tokens", { method: "POST", token: apiKey, body: { label: "escalate" } });
  ok("an API token cannot mint more tokens", mintWithApiToken.status === 403, `${mintWithApiToken.status}`);

  const hooksWithApiToken = await call("webhooks", { token: apiKey });
  ok("an API token cannot manage webhooks", hooksWithApiToken.status === 403, `${hooksWithApiToken.status}`);
}

/* ----------------------------------------------------------- revocation -- */
console.log("\napi: revocation is immediate");
{
  const list = await call("tokens", { token: ownerToken });
  const id = list.data.tokens[0].id;
  const rev = await call(`tokens/${id}`, { method: "DELETE", token: ownerToken });
  ok("revoke succeeds", rev.status === 200, JSON.stringify(rev.data));

  const after = await call("v1/me", { token: apiKey });
  ok("the revoked token stops working", after.status === 401, `${after.status}`);

  const listAfter = await call("tokens", { token: ownerToken });
  ok("and it's gone from the list", listAfter.data.tokens.length === 0);
}

console.log("\napi: a password reset also retires API tokens");
{
  stub.__reset();
  const u = await makeUser("reset2@x.com");
  const m = await call("tokens", { method: "POST", token: u.token, body: { label: "t" } });
  const key = m.data.token;
  ok("token works before", (await call("v1/me", { token: key })).status === 200);

  const keys = await stub.listKeys("users");
  const rec = await stub.readJSON("users", keys[0]);
  await stub.writeJSON("passwordResets", "tok9", { userKey: keys[0], userId: rec.id, expiresAt: Date.now() + 60000 });
  await call("auth/reset", { method: "POST", body: { token: "tok9", password: "brandnew123" } });

  const after = await call("v1/me", { token: key });
  ok("a stolen API token dies with the password", after.status === 401, `${after.status}`);
}

/* ------------------------------------------------------------- webhooks -- */
console.log("\napi: webhook registration rejects anything not publicly reachable");
{
  stub.__reset();
  const u = await makeUser("hook@x.com");
  const t = u.token;

  const bad = [
    ["http://example.com/hook", "plain http"],
    ["https://localhost/hook", "localhost"],
    ["https://127.0.0.1/hook", "loopback"],
    ["https://10.0.0.5/hook", "private 10/8"],
    ["https://192.168.1.10/hook", "private 192.168/16"],
    ["https://172.16.4.4/hook", "private 172.16/12"],
    ["https://169.254.169.254/latest/meta-data/", "cloud metadata"],
    ["https://[::1]/hook", "IPv6 loopback"],
    ["https://user:pass@example.com/hook", "embedded credentials"],
    ["not-a-url", "malformed"]
  ];
  for (const [url, why] of bad) {
    const r = await call("webhooks", { method: "POST", token: t, body: { url, events: ["state.updated"] } });
    ok(`rejected: ${why}`, r.status === 400, `${r.status} for ${url}`);
  }

  const good = await call("webhooks", {
    method: "POST", token: t, body: { url: "https://example.com/studyhold", events: ["state.updated"] }
  });
  ok("a public https URL is accepted", good.status === 200, JSON.stringify(good.data));
  ok("a signing secret is issued", !!(good.data.webhook && good.data.webhook.secret));

  const noEvents = await call("webhooks", {
    method: "POST", token: t, body: { url: "https://example.com/x", events: [] }
  });
  ok("at least one event is required", noEvents.status === 400);
}

console.log("\napi: a delivery fires on change and is signed");
{
  stub.__reset();
  const u = await makeUser("deliver@x.com");
  const t = u.token;
  const reg = await call("webhooks", {
    method: "POST", token: t, body: { url: "https://example.com/studyhold", events: ["state.updated"] }
  });
  const secret = reg.data.webhook.secret;

  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    seen.push({ url: String(url), opts });
    return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
  };

  await call("sync", { method: "PUT", token: t, body: { state: { a: 1 }, baseVersion: 0 } });
  globalThis.fetch = realFetch;

  ok("exactly one delivery was attempted", seen.length === 1, `${seen.length}`);
  const d = seen[0];
  ok("to the registered URL", d && d.url === "https://example.com/studyhold", d && d.url);
  ok("as a POST", d && d.opts.method === "POST");
  ok("carrying the event name", d && d.opts.headers["X-StudyHold-Event"] === "state.updated");

  // Verify the signature the way a receiver would.
  const sigHeader = d.opts.headers["X-StudyHold-Signature"] || "";
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw",
    enc.encode(process.env.SCHOLAR_SECRET + ":" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(d.opts.body));
  const expected = "sha256=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  ok("the signature verifies against the hook secret", sigHeader === expected,
     `${sigHeader.slice(0, 24)}… vs ${expected.slice(0, 24)}…`);

  const payload = JSON.parse(d.opts.body);
  ok("the payload names the event", payload.event === "state.updated");
  ok("and does not include the whole database",
     !JSON.stringify(payload).includes('"a":1'), JSON.stringify(payload).slice(0, 120));

  const hooks = await call("webhooks", { token: t });
  ok("the outcome is recorded on the hook", hooks.data.webhooks[0].lastStatus === 200,
     JSON.stringify(hooks.data.webhooks[0]));
}

console.log("\napi: a failing endpoint is recorded, not retried forever");
{
  stub.__reset();
  const u = await makeUser("failhook@x.com");
  const t = u.token;
  await call("webhooks", { method: "POST", token: t, body: { url: "https://example.com/dead", events: ["state.updated"] } });

  let attempts = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { attempts++; return { ok: false, status: 500, text: async () => "", json: async () => ({}) }; };
  await call("sync", { method: "PUT", token: t, body: { state: { a: 1 }, baseVersion: 0 } });
  globalThis.fetch = realFetch;

  ok("exactly one attempt is made", attempts === 1, `${attempts} attempts`);
  const hooks = await call("webhooks", { token: t });
  ok("the failure is visible to the owner", /500/.test(hooks.data.webhooks[0].lastError || ""),
     JSON.stringify(hooks.data.webhooks[0]));

  // And a failing hook must not break the sync that triggered it.
  const sync = await call("sync", { token: t });
  ok("sync itself still succeeded", sync.status === 200);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
