/* ==========================================================================
   tests/teacher.mjs — F059 teacher accounts

   Run: node --import ./tests/stub/register.mjs tests/teacher.mjs
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
  return { status: res.status, data };
}
const signup = (email, role, name) =>
  call("auth/signup", { method: "POST", body: { email, password: "password123", name, role } });

/* ----------------------------------------------------------------- role -- */
console.log("\nteacher: the role is accepted and preserved");
{
  stub.__reset();
  const t = await signup("vale@school.edu", "teacher", "Ms Vale");
  ok("signup succeeds", t.status === 200, JSON.stringify(t.data));
  ok("the role survives", t.data.user.role === "teacher", JSON.stringify(t.data.user));

  const me = await call("me", { token: t.data.token });
  ok("and is reported by /me", me.data.user.role === "teacher");

  const typo = await signup("x@school.edu", "techer", "Typo");
  ok("a near-miss is rejected rather than downgraded", typo.status === 400, `${typo.status}`);
}

/* --------------------------------------------------------- authoritative -- */
console.log("\nteacher: a teacher's post is marked official, a student's is not");
let teacher, student, gid, code;
{
  stub.__reset();
  teacher = (await signup("t2@school.edu", "teacher", "Ms Vale")).data;
  student = (await signup("s2@school.edu", "student", "Sam")).data;

  const g = await call("groups", { method: "POST", body: { name: "Period 3 Biology" }, token: teacher.token });
  gid = g.data.group.id; code = g.data.group.code;
  await call("groups/join", { method: "POST", body: { code }, token: student.token });

  const tp = await call(`groups/${gid}/feed`, {
    method: "POST", token: teacher.token,
    body: { title: "Chapter 7 problems", className: "Biology", due: "2026-09-01" }
  });
  ok("the teacher can post", tp.status === 200, JSON.stringify(tp.data));
  ok("the post is authoritative", tp.data.item.authoritative === true, JSON.stringify(tp.data.item));
  ok("and records the role", tp.data.item.byRole === "teacher");

  const sp = await call(`groups/${gid}/feed`, {
    method: "POST", token: student.token, body: { title: "I think there's a quiz", className: "Biology" }
  });
  ok("a student can still post", sp.status === 200);
  ok("but it is not authoritative", sp.data.item.authoritative === false, JSON.stringify(sp.data.item));

  const view = await call(`groups/${gid}`, { token: student.token });
  const feed = view.data.group.feed;
  ok("both posts are visible to the class", feed.length === 2, `${feed.length}`);
  ok("the flag survives the round trip",
     feed.filter((f) => f.authoritative).length === 1, JSON.stringify(feed.map((f) => f.authoritative)));
}

/* ---------------------------------------------------------- member roles -- */
console.log("\nteacher: membership records carry the role");
{
  const view = await call(`groups/${gid}`, { token: teacher.token });
  const members = view.data.group.members;
  const t = members.find((m) => m.id === teacher.user.id);
  const s = members.find((m) => m.id === student.user.id);
  ok("the teacher's membership says teacher", t && t.role === "teacher", JSON.stringify(t));
  ok("the student's says student", s && s.role === "student", JSON.stringify(s));
}

/* ------------------------------------------------------------- broadcast -- */
console.log("\nteacher: one assignment reaches every class group");
{
  stub.__reset();
  const t = (await signup("t3@school.edu", "teacher", "Ms Vale")).data;
  const s = (await signup("s3@school.edu", "student", "Sam")).data;

  const ids = [];
  for (const name of ["Period 1", "Period 3", "Period 5"]) {
    const g = await call("groups", { method: "POST", body: { name }, token: t.token });
    ids.push(g.data.group.id);
  }

  const b = await call("groups/broadcast", {
    method: "POST", token: t.token,
    body: { title: "Lab report", className: "Biology", due: "2026-09-10" }
  });
  ok("the broadcast succeeds", b.status === 200, JSON.stringify(b.data));
  ok("it reaches all three groups", b.data.posted === 3, JSON.stringify(b.data));

  for (const id of ids) {
    const g = await call(`groups/${id}`, { token: t.token });
    const feed = g.data.group.feed;
    ok(`group ${g.data.group.name} received it`,
       feed.length === 1 && feed[0].title === "Lab report" && feed[0].authoritative === true,
       JSON.stringify(feed));
  }

  // Targeting a subset.
  const one = await call("groups/broadcast", {
    method: "POST", token: t.token, body: { title: "Only P1", groupIds: [ids[0]] }
  });
  ok("a subset can be targeted", one.data.posted === 1, JSON.stringify(one.data));
  const g0 = await call(`groups/${ids[0]}`, { token: t.token });
  const g1 = await call(`groups/${ids[1]}`, { token: t.token });
  ok("only the named group got it",
     g0.data.group.feed.length === 2 && g1.data.group.feed.length === 1,
     `${g0.data.group.feed.length}/${g1.data.group.feed.length}`);

  // A student must not be able to broadcast.
  const bad = await call("groups/broadcast", { method: "POST", token: s.token, body: { title: "Cancelled!" } });
  ok("a student cannot broadcast", bad.status === 403, `${bad.status}`);

  // Nor can a teacher post into a group they don't belong to.
  const outsider = (await signup("t4@school.edu", "teacher", "Other")).data;
  const intrude = await call("groups/broadcast", {
    method: "POST", token: outsider.token, body: { title: "Not mine", groupIds: ids }
  });
  ok("a teacher can't reach groups they're not in",
     intrude.status === 400 || (intrude.data && intrude.data.posted === 0),
     JSON.stringify(intrude.data));
}

/* -------------------------------------------------- ownership on leaving -- */
console.log("\nteacher: a teacher leaving does not destroy the class");
{
  stub.__reset();
  const t = (await signup("t5@school.edu", "teacher", "Ms Vale")).data;
  const s1 = (await signup("s5a@school.edu", "student", "Ana")).data;
  const s2 = (await signup("s5b@school.edu", "student", "Ben")).data;

  const g = await call("groups", { method: "POST", body: { name: "Period 3" }, token: t.token });
  const id = g.data.group.id, joinCode = g.data.group.code;
  await call("groups/join", { method: "POST", body: { code: joinCode }, token: s1.token });
  await call("groups/join", { method: "POST", body: { code: joinCode }, token: s2.token });

  await call(`groups/${id}/feed`, { method: "POST", token: t.token, body: { title: "Keep me" } });

  const left = await call(`groups/${id}/leave`, { method: "POST", token: t.token });
  ok("the teacher leaves", left.status === 200 && left.data.left === true, JSON.stringify(left.data));

  const after = await call(`groups/${id}`, { token: s1.token });
  ok("the group survives", after.status === 200, `${after.status}`);
  ok("the feed survives with it", after.data.group.feed.length === 1, JSON.stringify(after.data.group.feed));
  ok("ownership moved to the longest-standing member",
     after.data.group.ownerId === s1.user.id, `${after.data.group.ownerId} vs ${s1.user.id}`);
}

/* ================================================== F059 — the teacher link */
/*
 * Until now a teacher account could mark a group post as official and nothing
 * more. It never touched a student's records, so a teacher could tell a class
 * what the homework was and still had no way to put it in their homework list.
 *
 * The link that fixes that is the *same* one-time code a parent redeems. Which
 * authority it grants is derived from the redeeming account's own role, never
 * from the code — which is also what closes an escalation that was live here:
 * mintLinkCode refused to issue a code to a non-student, but redeemLinkCode
 * only refused students, so a teacher redeeming a code became a full guardian.
 */
console.log("\nteacher: a link makes a teacher a teacher, not a guardian");
{
  stub.__reset();
  const t = (await signup("vale2@school.edu", "teacher", "Ms Vale")).data;
  const s1 = (await signup("sam2@school.edu", "student", "Sam")).data;

  const code = (await call("link/code", { method: "POST", token: s1.token })).data.code;
  const redeemed = await call("link/redeem", { method: "POST", body: { code }, token: t.token });
  ok("a teacher can redeem a student's code", redeemed.status === 200, JSON.stringify(redeemed.data));
  ok("and it says what kind of link it made", redeemed.data.as === "teacher", String(redeemed.data.as));

  const me = await call("me", { token: t.token });
  const link = (me.data.user.links || [])[0];
  ok("the teacher files the student as a pupil, not a child",
     link && link.role === "pupil", JSON.stringify(me.data.user.links));

  // The five guardian routes all authorize on role === "child" and must all
  // still refuse. This is the whole reason the roles are separate: grading a
  // student is a teacher's job, knowing where they are standing is not.
  const guardianOnly = [
    ["a check-in request", "checkin/request", { method: "POST", body: { studentId: s1.user.id } }],
    ["a focus window", "focus-windows/propose",
      { method: "POST", body: { studentId: s1.user.id, startAt: Date.now(), endAt: Date.now() + 3600e3 } }],
    ["a guardian note", "guardian-notes", { method: "POST", body: { studentId: s1.user.id, text: "hello" } }],
    ["an activity suggestion", "activity-suggestions",
      { method: "POST", body: { studentId: s1.user.id, activity: { name: "Violin" } } }],
    ["live location", "location/" + s1.user.id, {}]
  ];
  for (const [label, path, opts] of guardianOnly) {
    const res = await call(path, { ...opts, token: t.token });
    // 403 specifically, not just "not 200": a 404 would pass a laxer check
    // while proving only that the path was wrong.
    ok(`a teacher still can't send ${label}`, res.status === 403, `${res.status} at ${path}`);
  }

  const kids = await call("link/children", { token: t.token });
  ok("and the student doesn't appear on the guardian roster",
     (kids.data.children || []).length === 0, JSON.stringify(kids.data.children));
}

console.log("\nteacher: a teacher can edit a linked student's records");
{
  stub.__reset();
  const t = (await signup("vale3@school.edu", "teacher", "Ms Vale")).data;
  const s1 = (await signup("sam3@school.edu", "student", "Sam")).data;
  const other = (await signup("kai3@school.edu", "student", "Kai")).data;

  const code = (await call("link/code", { method: "POST", token: s1.token })).data.code;
  await call("link/redeem", { method: "POST", body: { code }, token: t.token });

  await call("sync", { method: "PUT", token: s1.token,
    body: { state: { assignments: [], classes: [], periods: [], events: [] }, baseVersion: 0 } });

  const op = await call("subject-ops", { method: "POST", token: t.token,
    body: { subjectId: s1.user.id, ops: [
      { op: "upsert", collection: "assignments", record: { title: "Chapter 7 problems", points: 20 } },
      { op: "upsert", collection: "periods", record: { name: "Period 3", start: "10:00", end: "10:50" } }] } });
  ok("the teacher's edits land", op.status === 200 && op.data.applied === 2, JSON.stringify(op.data));

  const state = (await call("sync", { token: s1.token })).data.state;
  ok("the assignment is in the student's own records",
     state.assignments.length === 1 && state.assignments[0].title === "Chapter 7 problems",
     JSON.stringify(state.assignments));
  ok("stamped with the teacher's name",
     state.assignments[0].addedBy === "Ms Vale", JSON.stringify(state.assignments[0]));
  ok("and the bell schedule too", state.periods.length === 1, JSON.stringify(state.periods));

  // A grade is earned/points on an assignment, so entering one needs no new
  // record type and no new route.
  const graded = await call("subject-ops", { method: "POST", token: t.token,
    body: { subjectId: s1.user.id, ops: [{ op: "upsert", collection: "assignments",
      id: state.assignments[0].id,
      record: { title: "Chapter 7 problems", points: 20, earned: 18, graded: true } }] } });
  ok("entering a score is an ordinary upsert", graded.status === 200, JSON.stringify(graded.data));

  const after = (await call("sync", { token: s1.token })).data.state;
  ok("the score is on the student's assignment",
     after.assignments[0].earned === 18 && after.assignments[0].graded === true,
     JSON.stringify(after.assignments[0]));
  ok("and the change is attributed to the teacher",
     after.assignments[0].editedBy === "Ms Vale", JSON.stringify(after.assignments[0]));

  // Authority comes from the link and nothing else.
  const forged = await call("subject-ops", { method: "POST", token: t.token,
    body: { subjectId: other.user.id, ops: [
      { op: "upsert", collection: "assignments", record: { title: "Not yours" } }] } });
  ok("a teacher can't write a student they aren't linked to", forged.status === 403, `${forged.status}`);

  const roster = await call("link/pupils", { token: t.token });
  ok("the roster lists the linked student", roster.status === 200
     && roster.data.pupils.length === 1 && roster.data.pupils[0].name === "Sam",
     JSON.stringify(roster.data.pupils));
  ok("with the numbers the roster screen shows",
     roster.data.pupils[0].graded === 1 && roster.data.pupils[0].percent === 90,
     JSON.stringify(roster.data.pupils[0]));

  const notTeacher = await call("link/pupils", { token: s1.token });
  ok("and only a teacher account can read it", notTeacher.status === 403, `${notTeacher.status}`);
}

console.log("\nteacher: setting work for several students is per-student, not all-or-nothing");
{
  stub.__reset();
  const t = (await signup("vale4@school.edu", "teacher", "Ms Vale")).data;
  const a = (await signup("a4@school.edu", "student", "Ada")).data;
  const b = (await signup("b4@school.edu", "student", "Ben")).data;
  const c = (await signup("c4@school.edu", "student", "Cy")).data;

  for (const kid of [a, b]) {
    const code = (await call("link/code", { method: "POST", token: kid.token })).data.code;
    await call("link/redeem", { method: "POST", body: { code }, token: t.token });
  }
  // Ada has synced; Ben never has. Cy is not linked at all.
  await call("sync", { method: "PUT", token: a.token,
    body: { state: { assignments: [], classes: [], periods: [], events: [] }, baseVersion: 0 } });

  const work = { op: "upsert", collection: "assignments", record: { title: "Chapter 7", points: 10 } };
  const results = {};
  for (const [label, kid] of [["linked and synced", a], ["linked, never synced", b], ["not linked", c]]) {
    results[label] = (await call("subject-ops", { method: "POST", token: t.token,
      body: { subjectId: kid.user.id, ops: [work] } })).status;
  }

  ok("it lands for the student who has synced", results["linked and synced"] === 200,
     String(results["linked and synced"]));
  // 409, not 500 and not a silent 200: inventing a database here would race
  // that student's very first push and lose it.
  ok("a student who never synced is a clean 409, not a crash",
     results["linked, never synced"] === 409, String(results["linked, never synced"]));
  ok("and an unlinked student is still 403", results["not linked"] === 403,
     String(results["not linked"]));

  // The one that matters: a failure for one student changed nothing for the
  // other. The client fans out per student for exactly this reason — there is
  // no transaction across three accounts to roll back to.
  const ada = (await call("sync", { token: a.token })).data.state;
  ok("the successful one is unaffected by the failures",
     ada.assignments.length === 1 && ada.assignments[0].title === "Chapter 7",
     JSON.stringify(ada.assignments));
  ok("and each copy is the student's own record, not a shared id",
     typeof ada.assignments[0].id === "string" && ada.assignments[0].id.length > 0,
     JSON.stringify(ada.assignments[0].id));
}

console.log("\nteacher: an account can change what kind it is");
{
  stub.__reset();
  const u = (await signup("switch@school.edu", "parent", "Alex")).data;

  const bad = await call("me", { method: "POST", token: u.token, body: { role: "wizard" } });
  ok("an unknown role is refused", bad.status === 400, `${bad.status}`);

  const good = await call("me", { method: "POST", token: u.token, body: { role: "teacher" } });
  ok("a real one is accepted", good.status === 200 && good.data.user.role === "teacher",
     JSON.stringify(good.data.user));
  ok("and it sticks", (await call("me", { token: u.token })).data.user.role === "teacher");

  // The role decides what a link *means*, so flipping it under an existing
  // link would silently re-grade every link the account holds.
  const kid = (await signup("kid9@school.edu", "student", "Kid")).data;
  const code = (await call("link/code", { method: "POST", token: kid.token })).data.code;
  await call("link/redeem", { method: "POST", body: { code }, token: u.token });

  const blocked = await call("me", { method: "POST", token: u.token, body: { role: "parent" } });
  ok("changing role while linked is refused", blocked.status === 409, `${blocked.status}`);
  ok("and the role is unchanged",
     (await call("me", { token: u.token })).data.user.role === "teacher");

  await call("link/" + kid.user.id, { method: "DELETE", token: u.token });
  const now = await call("me", { method: "POST", token: u.token, body: { role: "parent" } });
  ok("unlinking first lets it through", now.status === 200 && now.data.user.role === "parent",
     JSON.stringify(now.data.user));

  // Changing the name still works, and a no-op role is not a change.
  const named = await call("me", { method: "POST", token: u.token, body: { name: "Alex R", role: "parent" } });
  ok("the same role is not treated as a change", named.status === 200, `${named.status}`);
  ok("and the name still saves", named.data.user.name === "Alex R", JSON.stringify(named.data.user));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
