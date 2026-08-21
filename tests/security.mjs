/* ==========================================================================
   tests/security.mjs — the attacks a professional tester will actually run

   Drives the real netlify/functions/api.js. Only the storage layer is
   substituted (tests/stub/blobs-stub.mjs), and that stub implements real
   etag semantics so the concurrency assertions mean something.

   Run via:  node --import ./tests/stub/register.mjs tests/security.mjs
   ========================================================================== */

process.env.SCHOLAR_SECRET = "test-secret-value-at-least-16-chars-long";
process.env.SITE_URL = "https://scholar.example";

const api = (await import("../netlify/functions/api.js")).default;
const stub = await import("./stub/blobs-stub.mjs");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const BASE = "https://scholar.example/api/";
async function call(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const req = new Request(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const res = await api(req);
  let data = null;
  try { data = await res.clone().json(); } catch (e) { data = null; }
  return { status: res.status, data, res };
}

async function makeUser(email, role = "student", name = "Test") {
  const r = await call("auth/signup", { method: "POST", body: { email, password: "password123", name, role } });
  return r;
}

/* ------------------------------------------------------------ role input -- */
console.log("\nsecurity: signup validates the role instead of coercing it");
{
  stub.__reset();
  const typo = await makeUser("a@x.com", "studnet");
  ok("a typo is rejected, not silently downgraded", typo.status === 400, `${typo.status} ${JSON.stringify(typo.data)}`);
  ok("the error names the valid roles", /student/.test((typo.data && typo.data.error) || ""));

  const teacher = await makeUser("t@x.com", "teacher", "Ms Vale");
  ok("teacher is now a real role", teacher.status === 200 && teacher.data.user.role === "teacher",
     JSON.stringify(teacher.data));

  const dflt = await makeUser("d@x.com", undefined, "Default");
  ok("omitted role still defaults to student", dflt.status === 200 && dflt.data.user.role === "student");
}

/* ----------------------------------------------------------- enumeration -- */
console.log("\nsecurity: no account-existence oracle");
{
  stub.__reset();
  await makeUser("real@x.com");

  const dup = await call("auth/signup", { method: "POST", body: { email: "real@x.com", password: "password123", name: "X" } });
  ok("duplicate signup does not confirm the address exists",
     !/already exists/i.test((dup.data && dup.data.error) || ""), (dup.data || {}).error);

  // Eight wrong passwords used to trip a distinct 429 only for real accounts.
  let sawLockout429 = false;
  for (let i = 0; i < 10; i++) {
    const r = await call("auth/login", { method: "POST", body: { email: "real@x.com", password: "wrongwrong1" } });
    if (r.status === 429) sawLockout429 = true;
  }
  ok("lockout does not answer with a distinguishable 429", !sawLockout429);

  const missing = await call("auth/login", { method: "POST", body: { email: "nobody@x.com", password: "wrongwrong1" } });
  const locked = await call("auth/login", { method: "POST", body: { email: "real@x.com", password: "wrongwrong1" } });
  ok("locked and nonexistent are indistinguishable",
     missing.status === locked.status && missing.data.error === locked.data.error,
     `${missing.status}/${locked.status}`);
}

/* ------------------------------------------------------------- lockout --- */
console.log("\nsecurity: the lockout counter is atomic");
{
  stub.__reset();
  await makeUser("brute@x.com");
  // Fire them in parallel: the old read-modify-write let all of these read
  // failed=0 and write failed=1, so the limit never tripped.
  await Promise.all(Array.from({ length: 12 }, () =>
    call("auth/login", { method: "POST", body: { email: "brute@x.com", password: "definitelywrong1" } })));

  const good = await call("auth/login", { method: "POST", body: { email: "brute@x.com", password: "password123" } });
  ok("the correct password is refused while locked out", good.status === 401,
     `${good.status} — parallel guesses did not trip the lockout`);
}

/* -------------------------------------------------------- token lifetime -- */
console.log("\nsecurity: a password reset revokes existing sessions");
{
  stub.__reset();
  const signup = await makeUser("reset@x.com");
  const stolen = signup.data.token;

  const before = await call("me", { token: stolen });
  ok("the token works before the reset", before.status === 200);

  // Mint a reset token the way forgotPassword would, then use it.
  const keys = await stub.listKeys("users");
  const userRec = await stub.readJSON("users", keys[0]);
  await stub.writeJSON("passwordResets", "tok123", {
    userKey: keys[0], userId: userRec.id, expiresAt: Date.now() + 60000
  });
  const reset = await call("auth/reset", { method: "POST", body: { token: "tok123", password: "brandnew123" } });
  ok("the reset succeeds", reset.status === 200, JSON.stringify(reset.data));

  const after = await call("me", { token: stolen });
  ok("the old token stops working after the reset", after.status === 401,
     `${after.status} — a stolen session survived a password reset`);
}

/* ------------------------------------------------------------ blob keys -- */
console.log("\nsecurity: malformed keys are 4xx, not 500");
{
  stub.__reset();
  const u = await makeUser("keys@x.com");
  const t = u.data.token;

  const emptyJoin = await call("groups/join", { method: "POST", body: {}, token: t });
  ok("empty join code is a 400", emptyJoin.status === 400, `${emptyJoin.status}`);

  const emptyReset = await call("auth/reset", { method: "POST", body: {} });
  ok("empty reset token is a 400", emptyReset.status === 400, `${emptyReset.status}`);

  const hugeReset = await call("auth/reset", { method: "POST", body: { token: "a".repeat(700), password: "password123" } });
  ok("oversized reset token is a 400", hugeReset.status === 400, `${hugeReset.status}`);
}

/* ------------------------------------------------------ group ownership -- */
console.log("\nsecurity: group writes require membership");
{
  stub.__reset();
  const owner = await makeUser("owner@x.com", "student", "Owner");
  const other = await makeUser("other@x.com", "student", "Other");
  const g = await call("groups", { method: "POST", body: { name: "Bio study" }, token: owner.data.token });
  ok("group created", g.status === 200, JSON.stringify(g.data));
  const gid = g.data.group.id;

  const leave = await call(`groups/${gid}/leave`, { method: "POST", token: other.data.token });
  ok("a non-member cannot write to the group via leave", leave.status === 403, `${leave.status}`);

  const read = await call(`groups/${gid}`, { token: other.data.token });
  ok("a non-member cannot read the group", read.status === 403, `${read.status}`);
}

console.log("\nsecurity: owner leaving transfers ownership instead of deleting");
{
  stub.__reset();
  const owner = await makeUser("o2@x.com", "student", "Owner");
  const mate = await makeUser("m2@x.com", "student", "Mate");
  const g = await call("groups", { method: "POST", body: { name: "Chem" }, token: owner.data.token });
  const gid = g.data.group.id, code = g.data.group.code;
  await call("groups/join", { method: "POST", body: { code }, token: mate.data.token });

  const left = await call(`groups/${gid}/leave`, { method: "POST", token: owner.data.token });
  ok("owner leaves without deleting the group", left.status === 200 && left.data.left === true,
     JSON.stringify(left.data));

  const still = await call(`groups/${gid}`, { token: mate.data.token });
  ok("the remaining member still has the group", still.status === 200, `${still.status}`);
  ok("ownership transferred to the remaining member",
     still.data.group.ownerId === undefined || still.data.group.ownerId !== owner.data.user.id);

  const last = await call(`groups/${gid}/leave`, { method: "POST", token: mate.data.token });
  ok("the last member leaving deletes it", last.status === 200 && last.data.deleted === true,
     JSON.stringify(last.data));
}

/* ---------------------------------------------------- stranger profiles -- */
console.log("\nsecurity: you cannot write to a stranger's profile");
{
  stub.__reset();
  const a = await makeUser("a2@x.com");
  const b = await makeUser("b2@x.com");
  const victimId = b.data.user.id;

  const unlink = await call(`link/${victimId}`, { method: "DELETE", token: a.data.token });
  ok("unlink on a non-link is refused", unlink.status === 404, `${unlink.status}`);

  const unfriend = await call(`peers/${victimId}`, { method: "DELETE", token: a.data.token });
  ok("removeFriend on a non-friend is refused", unfriend.status === 404, `${unfriend.status}`);
}

/* ------------------------------------------------------ guardian escalation */
console.log("\nsecurity: a student cannot become a stranger's guardian");
{
  stub.__reset();
  const kid = await makeUser("kid@x.com", "student", "Kid");
  const parent = await makeUser("par@x.com", "parent", "Parent");
  const snoop = await makeUser("snoop@x.com", "student", "Snoop");

  const mint = await call("link/code", { method: "POST", token: kid.data.token });
  ok("a student can mint a link code", mint.status === 200, JSON.stringify(mint.data));
  const code = mint.data.code;

  const bad = await call("link/redeem", { method: "POST", body: { code }, token: snoop.data.token });
  ok("a student redeeming is refused", bad.status === 403, `${bad.status} ${JSON.stringify(bad.data)}`);

  const good = await call("link/redeem", { method: "POST", body: { code }, token: parent.data.token });
  ok("a parent redeeming still works", good.status === 200, JSON.stringify(good.data));
}

/* ------------------------------------------------------------ sync race -- */
console.log("\nsecurity: concurrent sync writes cannot silently destroy data");
{
  stub.__reset();
  const u = await makeUser("sync@x.com");
  const t = u.data.token;

  const first = await call("sync", { method: "PUT", body: { state: { a: 1 }, baseVersion: 0 }, token: t });
  ok("first push accepted", first.status === 200, JSON.stringify(first.data));
  const v = first.data.version;

  // Two devices both at the same baseVersion. Exactly one must win.
  const [r1, r2] = await Promise.all([
    call("sync", { method: "PUT", body: { state: { device: "A" }, baseVersion: v }, token: t }),
    call("sync", { method: "PUT", body: { state: { device: "B" }, baseVersion: v }, token: t })
  ]);
  const statuses = [r1.status, r2.status].sort();
  ok("exactly one of two concurrent writers wins",
     statuses[0] === 200 && statuses[1] === 409, `got ${statuses.join("/")}`);

  const stale = await call("sync", { method: "PUT", body: { state: { x: 1 }, baseVersion: 1 }, token: t });
  ok("a stale baseVersion is a conflict", stale.status === 409, `${stale.status}`);

  // The bypass that made all of the above pointless.
  const forced = await call("sync", { method: "PUT", body: { state: { evil: true }, baseVersion: 0, force: true }, token: t });
  ok("force:true no longer bypasses the conflict check", forced.status === 409,
     `${forced.status} — a client flag can still overwrite another device`);
}

/* ----------------------------------------------------------- validation -- */
console.log("\nsecurity: location payloads are validated");
{
  stub.__reset();
  const u = await makeUser("loc@x.com");
  const t = u.data.token;

  const evil = await call("location", {
    method: "POST",
    token: t,
    body: {
      summary: {
        attendance: "<a href='https://evil/'>Click</a>",
        openAssignments: "<script>alert(1)</script>",
        upcoming: "not-an-array"
      }
    }
  });
  ok("the push is accepted", evil.status === 200, `${evil.status}`);

  const stored = await stub.readJSON("locations", u.data.user.id);
  ok("markup did not survive into storage",
     !/</.test(JSON.stringify(stored.summary)), JSON.stringify(stored.summary));
  ok("a string 'upcoming' became an array", Array.isArray(stored.summary.upcoming));
}

/* ----------------------------------------------------------------- cors -- */
console.log("\nsecurity: API responses are not readable cross-origin");
{
  stub.__reset();
  const u = await makeUser("cors@x.com");
  const r = await call("me", { token: u.data.token });
  ok("no Access-Control-Allow-Origin on API responses",
     r.res.headers.get("access-control-allow-origin") === null,
     r.res.headers.get("access-control-allow-origin"));
}

/* ------------------------------------------------- capability reporting -- */
console.log("\nsecurity: the public health route reports capability, not configuration");
{
  stub.__reset();
  const before = process.env.EMAIL_FROM;
  const beforeKey = process.env.RESEND_API_KEY;

  // No key at all.
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  let h = await call("health");
  ok("health is public", h.status === 200);
  ok("email is not deliverable with no key", h.data.email.deliverable === false);

  // A key but no verified sender — the case a deploy without a custom domain
  // is in. Mail would go from the provider's sandbox address, which only
  // reaches the account owner, so this must still read as undeliverable.
  process.env.RESEND_API_KEY = "re_test_key_123456";
  h = await call("health");
  ok("a key alone is still not deliverable", h.data.email.deliverable === false,
     JSON.stringify(h.data.email));

  process.env.EMAIL_FROM = "noreply@scholar.example";
  h = await call("health");
  ok("deliverable once a real sender is set", h.data.email.deliverable === true);

  ok("no configuration detail is exposed",
     !JSON.stringify(h.data).includes("re_test_key") &&
     !JSON.stringify(h.data).includes("noreply@scholar.example"),
     JSON.stringify(h.data));

  // And the reset endpoint refuses rather than pretending, in that state.
  delete process.env.EMAIL_FROM;
  const forgot = await call("auth/forgot", { method: "POST", body: { email: "someone@x.com" } });
  ok("password reset refuses when mail can't reach anyone", forgot.status === 503, `${forgot.status}`);
  ok("and the reason names EMAIL_FROM", /EMAIL_FROM/.test((forgot.data && forgot.data.error) || ""),
     (forgot.data || {}).error);

  if (before) process.env.EMAIL_FROM = before; else delete process.env.EMAIL_FROM;
  if (beforeKey) process.env.RESEND_API_KEY = beforeKey; else delete process.env.RESEND_API_KEY;
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
