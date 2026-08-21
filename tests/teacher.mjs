/* ==========================================================================
   tests/teacher.mjs — F059 teacher accounts

   Run: node --import ./tests/stub/register.mjs tests/teacher.mjs
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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
