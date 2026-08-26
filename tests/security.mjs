/* ==========================================================================
   tests/security.mjs — the attacks a professional tester will actually run

   Drives the real netlify/functions/api.js. Only the storage layer is
   substituted (tests/stub/blobs-stub.mjs), and that stub implements real
   etag semantics so the concurrency assertions mean something.

   Run via:  node --import ./tests/stub/register.mjs tests/security.mjs
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

/* --------------------------------------------------- F157 subject writes -- */
/*
 * A linked parent editing the student's real records. tests/authwall.mjs
 * proves a stranger cannot reach this route; this proves the person who
 * should be able to, can — and that only what was named arrives.
 */
console.log("\nsecurity: a linked parent can edit their student's records, and only theirs");
{
  stub.__reset();
  const kid = await makeUser("kid2@x.com", "student", "Kid");
  const parent = await makeUser("par2@x.com", "parent", "Parent");
  const other = await makeUser("kid3@x.com", "student", "Other");

  const code = (await call("link/code", { method: "POST", token: kid.data.token })).data.code;
  await call("link/redeem", { method: "POST", body: { code }, token: parent.data.token });

  // There has to be a database to edit into. Inventing one here would race
  // the student's first push and lose it.
  const early = await call("subject-ops", { method: "POST", token: parent.data.token,
    body: { subjectId: kid.data.user.id, ops: [{ op: "upsert", collection: "assignments", record: { title: "Too early" } }] } });
  ok("editing before the student has ever synced is refused", early.status === 409, String(early.status));

  await call("sync", { method: "PUT", token: kid.data.token,
    body: { state: { assignments: [], periods: [], classes: [] }, baseVersion: 0 } });

  const add = await call("subject-ops", { method: "POST", token: parent.data.token,
    body: { subjectId: kid.data.user.id, ops: [
      { op: "upsert", collection: "assignments",
        record: { title: "Read chapter 4", due: "2026-09-01", points: 20,
                  // Neither of these is whitelisted; neither may survive.
                  wallet: { balance: 9999 }, id: "forged-id" } },
      { op: "upsert", collection: "periods", record: { name: "Period 1", start: "08:00", end: "08:50" } }
    ] } });
  ok("a linked parent's edits are accepted", add.status === 200, `${add.status} ${JSON.stringify(add.data)}`);
  ok("both records were applied", add.data && add.data.applied === 2, JSON.stringify(add.data));

  const pulled = await call("sync", { token: kid.data.token });
  const st = (pulled.data && pulled.data.state) || {};
  const asg = (st.assignments || [])[0];
  const per = (st.periods || [])[0];

  ok("the assignment is in the student's own records", !!asg && asg.title === "Read chapter 4", JSON.stringify(asg));
  ok("the bell-schedule period landed too", !!per && per.name === "Period 1", JSON.stringify(per));
  ok("it is attributed to the parent", !!asg && asg.addedBy === "Parent", JSON.stringify(asg && asg.addedBy));
  ok("a field nobody whitelisted never arrives", !!asg && asg.wallet === undefined, JSON.stringify(asg));
  ok("a caller-supplied id cannot be forced", !!asg && asg.id !== "forged-id", JSON.stringify(asg && asg.id));

  // The link is to one student, not to students in general.
  const cross = await call("subject-ops", { method: "POST", token: parent.data.token,
    body: { subjectId: other.data.user.id, ops: [{ op: "upsert", collection: "assignments", record: { title: "Not yours" } }] } });
  ok("a parent cannot edit a student they aren't linked to", cross.status === 403, String(cross.status));

  // Only the collections named in the map are reachable.
  const nope = await call("subject-ops", { method: "POST", token: parent.data.token,
    body: { subjectId: kid.data.user.id, ops: [{ op: "upsert", collection: "account", record: { name: "x" } }] } });
  ok("an un-writable collection is refused", nope.status === 400, String(nope.status));

  const del = await call("subject-ops", { method: "POST", token: parent.data.token,
    body: { subjectId: kid.data.user.id, ops: [{ op: "delete", collection: "assignments", id: asg.id }] } });
  ok("a delete is applied", del.status === 200 && del.data.applied === 1, JSON.stringify(del.data));
  const after = await call("sync", { token: kid.data.token });
  ok("and the record is gone", ((after.data.state || {}).assignments || []).length === 0,
     JSON.stringify((after.data.state || {}).assignments));
}

/* ------------------------------------------- F157 merge instead of clobber -- */
/*
 * The point of the whole design: a parent editing while the student is
 * editing must cost nobody their work. Before this, any server-side change
 * forced the student's next push to 409, and the only ways out of a 409
 * discard one side's entire database.
 */
console.log("\nsecurity: a parent's edit and a student's push both survive");
{
  stub.__reset();
  const kid = await makeUser("kid4@x.com", "student", "Kid");
  const parent = await makeUser("par4@x.com", "parent", "Parent");
  const code = (await call("link/code", { method: "POST", token: kid.data.token })).data.code;
  await call("link/redeem", { method: "POST", body: { code }, token: parent.data.token });

  const first = await call("sync", { method: "PUT", token: kid.data.token,
    body: { state: { assignments: [], notes: [] }, baseVersion: 0 } });
  const base = first.data.version;

  // The parent adds an assignment. The student's device knows nothing of it.
  const op = await call("subject-ops", { method: "POST", token: parent.data.token,
    body: { subjectId: kid.data.user.id, ops: [
      { op: "upsert", collection: "assignments", record: { title: "Parent's task" } }] } });
  ok("the parent's edit lands", op.status === 200, JSON.stringify(op.data));

  // The student now pushes work of their own, from before that edit existed.
  const stale = await call("sync", { method: "PUT", token: kid.data.token,
    body: { state: { assignments: [], notes: [{ id: "n1", title: "My note" }] }, baseVersion: base } });

  ok("a stale push is merged, not rejected", stale.status === 200, `${stale.status} ${JSON.stringify(stale.data)}`);
  ok("and it says how much it merged in", stale.data && stale.data.merged === 1, JSON.stringify(stale.data));

  const final = (await call("sync", { token: kid.data.token })).data.state || {};
  ok("the student's own work survived", (final.notes || []).length === 1, JSON.stringify(final.notes));
  ok("the parent's edit survived too", (final.assignments || []).length === 1
     && final.assignments[0].title === "Parent's task", JSON.stringify(final.assignments));
}

/*
 * cleanSummary() is an allow-list, so a field it forgets is dropped without a
 * word — and the parent portal then renders an empty space forever, which
 * reads as "nothing here" rather than "broken". Its own docstring warns about
 * this after it happened to four fields; it had since happened again, to
 * `currency` and `activities`, disabling the portal's whole "Outside school"
 * section for everybody.
 *
 * A round trip of everything js/sync.js pushLocation() sends is the only
 * check that catches the next one.
 */
console.log("\nsecurity: the parent summary keeps every field the client sends");
{
  stub.__reset();
  const kid = await makeUser("kid6@x.com", "student", "Kid");
  const parent = await makeUser("par6@x.com", "parent", "Parent");
  const code = (await call("link/code", { method: "POST", token: kid.data.token })).data.code;
  await call("link/redeem", { method: "POST", body: { code }, token: parent.data.token });

  const sent = {
    name: "Kid", openAssignments: 4, overdue: 1, streak: 9, gpa: 3.7, attendance: 96,
    studyWeek: 320, usageToday: 45, usageWeek: 300,
    upcoming: [{ title: "Essay", className: "English", due: "2026-09-01" }],
    classes: [{ name: "English", grade: 91.5 }],
    gradeAlerts: [{ classId: "c1", className: "English", delta: -4 }],
    currency: "EUR",
    activities: [{ name: "Violin", type: "music", provider: "Studio 9",
                   days: ["Mon", "Wed"], start: "17:00", end: "18:00",
                   cost: 120, costPer: "month", monthly: 120 }]
  };
  await call("location", { method: "POST", token: kid.data.token, body: { status: null, summary: sent } });

  const got = (await call("location/" + kid.data.user.id, { token: parent.data.token })).data.location;
  const sum = (got && got.summary) || {};

  for (const key of Object.keys(sent)) {
    ok(`the summary keeps "${key}"`, sum[key] !== undefined, JSON.stringify(sum[key]));
  }
  ok("the student's own currency comes through, not the parent's",
     sum.currency === "EUR", String(sum.currency));
  ok("an activity keeps the fields the portal renders",
     sum.activities && sum.activities.length === 1
     && sum.activities[0].name === "Violin"
     && sum.activities[0].provider === "Studio 9"
     && sum.activities[0].monthly === 120
     && Array.isArray(sum.activities[0].days) && sum.activities[0].days.length === 2,
     JSON.stringify(sum.activities));

  // Still an allow-list: anything not named is still dropped, and the bounds
  // still apply. Otherwise the fix would just be "stop validating".
  const junk = await call("location", { method: "POST", token: kid.data.token,
    body: { status: null, summary: { ...sent, sneaky: "x",
      activities: [{ name: "A".repeat(500), monthly: 99999999999, evil: "<script>" }] } } });
  ok("a junk push is still accepted", junk.status === 200, String(junk.status));

  const after = ((await call("location/" + kid.data.user.id, { token: parent.data.token }))
    .data.location || {}).summary || {};
  ok("an unknown field is still dropped", after.sneaky === undefined);
  ok("an unknown field inside an activity is dropped too",
     after.activities[0].evil === undefined, JSON.stringify(after.activities[0]));
  ok("a long activity name is still clipped", after.activities[0].name.length <= 80,
     String(after.activities[0].name.length));
  ok("an absurd cost is still bounded", after.activities[0].monthly <= 1000000,
     String(after.activities[0].monthly));
}

console.log("\nsecurity: a gap the journal can't explain is still a real conflict");
{
  stub.__reset();
  const kid = await makeUser("kid5@x.com", "student", "Kid");
  const t = kid.data.token;

  const first = await call("sync", { method: "PUT", token: t, body: { state: { a: 1 }, baseVersion: 0 } });
  const base = first.data.version;

  // A second device pushes a whole database. That is not expressible as
  // record ops, so replaying it is impossible and the next stale push must
  // still stop for a human rather than quietly dropping it.
  await call("sync", { method: "PUT", token: t, body: { state: { a: 2 }, baseVersion: base } });

  const stale = await call("sync", { method: "PUT", token: t, body: { state: { a: 3 }, baseVersion: base } });
  ok("a whole-DB push in the gap still conflicts", stale.status === 409, `${stale.status}`);
  ok("and the conflict still carries the winner's state",
     stale.data && stale.data.state && stale.data.state.a === 2, JSON.stringify(stale.data && stale.data.state));
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

/* ----------------------------------------- summary round-trip fidelity -- */
console.log("\nsecurity: validating the shared summary must not narrow it");
{
  stub.__reset();
  const u = await makeUser("summary@x.com");
  const t = u.data.token;

  // Exactly what js/sync.js pushLocation() sends. If a field is added there
  // and not to cleanSummary(), the parent portal renders an em dash forever
  // with no error anywhere — which is how per-class grades, grade alerts,
  // study time and screen time were silently disabled once already.
  const sent = {
    name: "Sam Rivera",
    usageToday: 42,
    usageWeek: 310,
    studyWeek: 275,
    openAssignments: 7,
    overdue: 2,
    attendance: 96.4,
    streak: 12,
    gpa: 3.82,
    classes: [{ name: "AP Biology", grade: 91.5 }, { name: "US History", grade: 88 }],
    upcoming: [{ title: "Cell lab", className: "AP Biology", due: "2026-09-01" }],
    gradeAlerts: [{ classId: "c1", className: "AP Biology", delta: -7.5 }]
  };

  const push = await call("location", { method: "POST", token: t, body: { summary: sent } });
  ok("the push is accepted", push.status === 200, `${push.status}`);

  const stored = (await stub.readJSON("locations", u.data.user.id)).summary;

  // Every field the parent portal reads.
  for (const k of ["attendance", "classes", "gpa", "gradeAlerts", "openAssignments",
                   "overdue", "studyWeek", "upcoming", "usageWeek"]) {
    ok(`survives validation: ${k}`, stored[k] != null, `${k} = ${JSON.stringify(stored[k])}`);
  }

  ok("numbers keep their value", stored.studyWeek === 275 && stored.usageWeek === 310 && stored.gpa === 3.82,
     JSON.stringify({ studyWeek: stored.studyWeek, usageWeek: stored.usageWeek, gpa: stored.gpa }));
  ok("per-class grades survive with their values",
     stored.classes.length === 2 && stored.classes[0].name === "AP Biology" && stored.classes[0].grade === 91.5,
     JSON.stringify(stored.classes));
  ok("grade alerts survive, including a negative delta",
     stored.gradeAlerts.length === 1 && stored.gradeAlerts[0].delta === -7.5,
     JSON.stringify(stored.gradeAlerts));

  // And it still refuses hostile content — the reason the validator exists.
  const evil = await call("location", {
    method: "POST", token: t,
    body: { summary: { ...sent, attendance: "<img src=x onerror=1>", classes: [{ name: "<script>", grade: "abc" }] } }
  });
  ok("hostile push still accepted without error", evil.status === 200);
  const after = (await stub.readJSON("locations", u.data.user.id)).summary;
  ok("markup never reaches storage in a numeric field", after.attendance === null || typeof after.attendance === "number",
     JSON.stringify(after.attendance));
  ok("a non-numeric grade becomes null rather than a string",
     after.classes[0].grade === null, JSON.stringify(after.classes[0]));

  // Grade sharing off sends null, which must stay distinguishable from [].
  await call("location", { method: "POST", token: t, body: { summary: { ...sent, classes: null } } });
  const off = (await stub.readJSON("locations", u.data.user.id)).summary;
  ok("classes: null stays null, not an empty array", off.classes === null, JSON.stringify(off.classes));
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
