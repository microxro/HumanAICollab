/* ==========================================================================
   tests/hardening.mjs — the line-by-line backend review's findings

   One test per defect found by reading every line of the four function files
   and the two libraries. Each asserts the behaviour that was wrong, so a
   regression shows up here rather than in a tester's report.

   Run: node --import ./tests/stub/register.mjs tests/hardening.mjs
   ========================================================================== */

process.env.SCHOLAR_SECRET = "test-secret-value-at-least-16-chars-long";
process.env.SITE_URL = "https://scholar.example";
delete process.env.ADMIN_EMAIL;

const api = (await import("../netlify/functions/api.js")).default;
const stub = await import("./stub/blobs-stub.mjs");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const BASE = "https://scholar.example/api/";
async function call(path, { method = "GET", body, token, raw } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await api(new Request(BASE + path, {
    method, headers,
    body: raw !== undefined ? raw : (body === undefined ? undefined : JSON.stringify(body))
  }));
  let data = null;
  try { data = await res.clone().json(); } catch (e) { data = null; }
  return { status: res.status, data };
}
const signup = (email, role, name) =>
  call("auth/signup", { method: "POST", body: { email, password: "password123", name, role } });

/* ================================================================ F100 == */

console.log("\nhardening: an API token never locks the account out of token management");
{
  stub.__reset();
  const u = (await signup("dev@x.com", "student", "Dev")).data;
  const mint = await call("tokens", { method: "POST", token: u.token, body: { label: "script" } });
  const key = mint.data.token;

  // The route that persists the profile, called with the API token. This is
  // where `_viaApiToken` used to be written to storage.
  const named = await call("me", { method: "POST", token: key, body: { name: "Renamed" } });
  ok("POST /me works with an API token", named.status === 200, JSON.stringify(named.data));

  // ...and afterwards the *session* must still be allowed to manage tokens.
  const list = await call("tokens", { token: u.token });
  ok("the session can still list tokens", list.status === 200, `${list.status} ${JSON.stringify(list.data)}`);
  const again = await call("tokens", { method: "POST", token: u.token, body: { label: "second" } });
  ok("and can still mint one", again.status === 200, `${again.status} ${JSON.stringify(again.data)}`);

  ok("the flag was never written to storage",
     !JSON.stringify(stub.__dump()).includes("_viaApiToken"));

  // The token itself is still refused for token management, which is the
  // behaviour the flag exists for.
  const viaToken = await call("tokens", { method: "POST", token: key, body: { label: "nope" } });
  ok("an API token still can't mint tokens", viaToken.status === 403, `${viaToken.status}`);
}

console.log("\nhardening: the token secret is never stored anywhere");
{
  stub.__reset();
  const u = (await signup("dev2@x.com", "student", "Dev")).data;
  const mint = await call("tokens", { method: "POST", token: u.token, body: { label: "script" } });
  const key = mint.data.token;

  const dump = JSON.stringify(stub.__dump());
  ok("the plaintext token appears in no stored value", !dump.includes(key));
  const keys = Object.keys(stub.__dump());
  ok("and is not used as a blob key", !keys.some((k) => k.includes(key)), keys.filter((k) => k.startsWith("apiTokens")).join());

  // It still authenticates, and revoking still works — the hash is enough.
  const me = await call("v1/me", { token: key });
  ok("the token still authenticates", me.status === 200, `${me.status}`);

  const id = mint.data.entry.id;
  const rev = await call(`tokens/${id}`, { method: "DELETE", token: u.token });
  ok("revoke succeeds", rev.status === 200, JSON.stringify(rev.data));
  const after = await call("v1/me", { token: key });
  ok("and the revoked token is dead", after.status === 401, `${after.status}`);
}

console.log("\nhardening: webhook URL screening rejects private hosts, not ordinary domains");
{
  stub.__reset();
  const u = (await signup("hook@x.com", "student", "Hook")).data;
  const add = (url) => call("webhooks", { method: "POST", token: u.token, body: { url, events: ["state.updated"] } });

  // These are public domains that merely start with hex digits that look like
  // IPv6 prefixes. Every one of them was rejected as "on a private network".
  for (const host of ["fcbarcelona.com", "fda.gov", "fdic.gov", "fe80services.example.com"]) {
    const r = await add(`https://${host}/hook`);
    ok(`https://${host} is accepted`, r.status === 200, `${r.status} ${JSON.stringify(r.data)}`);
    if (r.status === 200) await call(`webhooks/${r.data.webhook.id}`, { method: "DELETE", token: u.token });
  }

  for (const host of ["[fd00::1]", "[fc00::1]", "[::1]", "[fe80::1]", "127.0.0.1", "10.1.2.3",
                      "169.254.169.254", "192.168.0.1", "172.16.0.1", "100.64.0.1",
                      "localhost", "metadata.google.internal", "[::ffff:10.0.0.1]"]) {
    const r = await add(`https://${host}/hook`);
    ok(`https://${host} is refused`, r.status === 400, `${r.status} ${JSON.stringify(r.data)}`);
  }

  const plain = await add("http://example.com/hook");
  ok("http:// is refused", plain.status === 400, `${plain.status}`);
  const creds = await add("https://user:pw@example.com/hook");
  ok("credentials in the URL are refused", creds.status === 400, `${creds.status}`);
}

console.log("\nhardening: only events that are actually emitted can be subscribed to");
{
  stub.__reset();
  const u = (await signup("hook2@x.com", "student", "Hook")).data;
  const listed = await call("webhooks", { token: u.token });
  ok("state.updated is offered", listed.data.events.includes("state.updated"));
  ok("no silent events are offered", listed.data.events.length === 1, JSON.stringify(listed.data.events));

  const r = await call("webhooks", {
    method: "POST", token: u.token,
    body: { url: "https://example.com/h", events: ["assignment.due", "grade.changed"] }
  });
  ok("subscribing only to unemitted events is refused", r.status === 400, `${r.status}`);
}

console.log("\nhardening: /v1 answers the same way whether or not an account has data");
{
  stub.__reset();
  const empty = (await signup("empty@x.com", "student", "Empty")).data;
  const r1 = await call("v1/nonsense", { token: empty.token });
  ok("an unknown resource on an empty account is 404", r1.status === 404, `${r1.status} ${JSON.stringify(r1.data)}`);

  const full = (await signup("full@x.com", "student", "Full")).data;
  await call("sync", { method: "PUT", token: full.token, body: { state: { classes: [] }, baseVersion: 0 } });
  const r2 = await call("v1/nonsense", { token: full.token });
  ok("and on a populated account it is also 404", r2.status === 404, `${r2.status}`);

  const good = await call("v1/classes", { token: full.token });
  ok("a real resource still works", good.status === 200, JSON.stringify(good.data));
  const post = await call("v1/classes", { method: "POST", token: full.token, body: {} });
  ok("the surface stays read-only", post.status === 405, `${post.status}`);
}

/* ======================================================== disclosure == */

console.log("\nhardening: deployment configuration isn't handed to every signed-in account");
{
  stub.__reset();
  delete process.env.ADMIN_EMAIL;
  process.env.RESEND_API_KEY = "re_testkey_0123456789";
  const nosy = (await signup("nosy@x.com", "student", "Nosy")).data;

  const h = await call("email-health", { token: nosy.token });
  ok("the endpoint still answers", h.status === 200, `${h.status}`);
  ok("but reveals no key length", h.data.keyLength === undefined, JSON.stringify(h.data));
  ok("no sender address", h.data.from === undefined, JSON.stringify(h.data));
  ok("and no SITE_URL state", h.data.siteUrlSet === undefined, JSON.stringify(h.data));
  ok("it still says whether email works", typeof h.data.deliverable === "boolean");

  process.env.ADMIN_EMAIL = "nosy@x.com";
  const own = await call("email-health", { token: nosy.token });
  ok("the operator sees the full picture", own.data.keyLength === "re_testkey_0123456789".length,
     JSON.stringify(own.data));
  ok("and is told they are the operator", own.data.operator === true);

  process.env.ADMIN_EMAIL = "someone@else.com";
  const other = await call("email-health", { token: nosy.token });
  ok("a different operator address doesn't match", other.data.keyLength === undefined, JSON.stringify(other.data));

  delete process.env.ADMIN_EMAIL;
  delete process.env.RESEND_API_KEY;
}

/* ============================================================ codes == */

console.log("\nhardening: guardian link codes can't be brute forced");
{
  stub.__reset();
  const guardian = (await signup("guess@x.com", "parent", "Guess")).data;
  let last = null;
  for (let i = 0; i < 12; i++) {
    last = await call("link/redeem", { method: "POST", token: guardian.token, body: { code: "AAAA" + String(i).padStart(2, "0") } });
  }
  ok("guessing is cut off with 429", last.status === 429, `${last.status} ${JSON.stringify(last.data)}`);

  const blank = await call("link/redeem", { method: "POST", token: guardian.token, body: {} });
  ok("an empty code is a 400, not a 500", blank.status === 400, `${blank.status}`);
}

console.log("\nhardening: a student can't redeem a link code and become a guardian");
{
  stub.__reset();
  const kid = (await signup("kid2@x.com", "student", "Kit")).data;
  const other = (await signup("other@x.com", "student", "Otto")).data;
  const c = await call("link/code", { method: "POST", token: kid.token });
  const r = await call("link/redeem", { method: "POST", token: other.token, body: { code: c.data.code } });
  ok("refused", r.status === 403, `${r.status} ${JSON.stringify(r.data)}`);
}

/* =========================================================== peers == */

console.log("\nhardening: friend requests don't reveal who has an account");
{
  stub.__reset();
  const me = (await signup("me@x.com", "student", "Me")).data;
  await signup("real@x.com", "student", "Real");

  const hit = await call("peers/request", { method: "POST", token: me.token, body: { email: "real@x.com" } });
  const miss = await call("peers/request", { method: "POST", token: me.token, body: { email: "ghost@x.com" } });
  ok("an existing address answers 200", hit.status === 200, `${hit.status}`);
  ok("a missing one answers identically", miss.status === hit.status, `${miss.status} vs ${hit.status}`);
  ok("with an identical body", JSON.stringify(miss.data) === JSON.stringify(hit.data),
     `${JSON.stringify(hit.data)} vs ${JSON.stringify(miss.data)}`);
  ok("and never leaks the target's name", !JSON.stringify(hit.data).includes("Real"), JSON.stringify(hit.data));

  const repeat = await call("peers/request", { method: "POST", token: me.token, body: { email: "real@x.com" } });
  ok("a repeat request is also indistinguishable", JSON.stringify(repeat.data) === JSON.stringify(hit.data));

  // ...but the request really did go through.
  const target = await call("auth/login", { method: "POST", body: { email: "real@x.com", password: "password123" } });
  const theirs = await call("peers", { token: target.data.token });
  ok("the recipient actually sees it", theirs.data.peers.length === 1, JSON.stringify(theirs.data.peers));
}

console.log("\nhardening: friend requests are rate limited");
{
  stub.__reset();
  const me = (await signup("spam@x.com", "student", "Spam")).data;
  let last = null;
  for (let i = 0; i < 22; i++) {
    last = await call("peers/request", { method: "POST", token: me.token, body: { email: `t${i}@x.com` } });
  }
  ok("a walk through a word list is cut off", last.status === 429, `${last.status}`);
}

/* ========================================================= routing == */

console.log("\nhardening: every feed sub-route reaches its own handler");
{
  stub.__reset();
  const a = (await signup("ra@x.com", "student", "Ana")).data;
  const b = (await signup("rb@x.com", "student", "Ben")).data;
  const g = await call("groups", { method: "POST", token: a.token, body: { name: "Study" } });
  const id = g.data.group.id;
  await call("groups/join", { method: "POST", token: b.token, body: { code: g.data.group.code } });

  const post = await call(`groups/${id}/feed`, { method: "POST", token: a.token, body: { title: "Essay" } });
  ok("posting works", post.status === 200, JSON.stringify(post.data));
  const itemId = post.data.item.id;

  const conf = await call(`groups/${id}/feed/${itemId}`, { method: "POST", token: b.token });
  ok("confirm reaches confirmFeed", conf.status === 200 && conf.data.confirms === 2,
     `${conf.status} ${JSON.stringify(conf.data)}`);

  const com = await call(`groups/${id}/feed/${itemId}/comment`, { method: "POST", token: b.token, body: { text: "Due when?" } });
  ok("comment reaches commentFeed", com.status === 200 && com.data.comment.text === "Due when?",
     `${com.status} ${JSON.stringify(com.data)}`);

  const rate = await call(`groups/${id}/feed/${itemId}/rate`, { method: "POST", token: b.token, body: { actualMinutes: 45 } });
  ok("rate reaches rateFeed", rate.status === 200 && rate.data.avgMinutes === 45,
     `${rate.status} ${JSON.stringify(rate.data)}`);

  const anon = await call(`groups/${id}`, { token: a.token });
  const item = anon.data.group.feed.find((f) => f.id === itemId);
  ok("ratings stay anonymous to the client", item._raters === undefined, JSON.stringify(item));
}

/* ========================================================== limits == */

console.log("\nhardening: the body cap is measured in bytes, not UTF-16 units");
{
  stub.__reset();
  const u = (await signup("big@x.com", "student", "Big")).data;
  // Every one of these is 4 UTF-8 bytes but 2 UTF-16 code units, so a
  // `.length` cap let through twice the intended payload.
  const huge = JSON.stringify({ note: "😀".repeat(1_400_000) });
  const r = await call("me", { method: "POST", token: u.token, raw: huge });
  ok("an oversized multibyte body is refused", r.status === 413, `${r.status} (${huge.length} units)`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
