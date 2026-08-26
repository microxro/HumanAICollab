/* ==========================================================================
   tests/concurrency.mjs — two people writing the same blob at the same time

   Every test here fires two requests with Promise.all and then asserts that
   *both* changes survived. That is the whole point: under the previous
   read-modify-write-with-a-plain-write code each of these lost one of the two
   edits, and returned 200 for both — the failure mode that leaves no trace
   anywhere, and the one a stress-testing team reproduces by accident.

   The storage stub implements real etag semantics, so a conditional write
   that lost the race genuinely fails and genuinely retries. A stub that
   always accepted the write would make this file pass against broken code.

   Run: node --import ./tests/stub/register.mjs tests/concurrency.mjs
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

/** A group with three members, and their tokens. */
async function makeGroup() {
  stub.__reset();
  const a = (await signup("ana@school.edu", "student", "Ana")).data;
  const b = (await signup("ben@school.edu", "student", "Ben")).data;
  const c = (await signup("cy@school.edu", "student", "Cy")).data;
  const g = await call("groups", { method: "POST", body: { name: "Bio study group" }, token: a.token });
  const id = g.data.group.id, code = g.data.group.code;
  await call("groups/join", { method: "POST", body: { code }, token: b.token });
  await call("groups/join", { method: "POST", body: { code }, token: c.token });
  return { a, b, c, id, code };
}

/* ------------------------------------------------ two notes at one moment -- */
console.log("\nconcurrency: two members share a note simultaneously");
{
  const { a, b, id } = await makeGroup();
  const [ra, rb] = await Promise.all([
    call(`groups/${id}/notes`, { method: "POST", token: a.token, body: { title: "Mitosis", body: "Prophase first." } }),
    call(`groups/${id}/notes`, { method: "POST", token: b.token, body: { title: "Meiosis", body: "Crossing over." } })
  ]);
  ok("both writes report success", ra.status === 200 && rb.status === 200, `${ra.status}/${rb.status}`);

  const g = await call(`groups/${id}`, { token: a.token });
  const titles = g.data.group.sharedNotes.map((n) => n.title).sort();
  ok("both notes are actually there", titles.join(",") === "Meiosis,Mitosis", JSON.stringify(titles));
}

/* -------------------------------------- a task and a comment at one moment -- */
console.log("\nconcurrency: different collections on the same blob don't erase each other");
{
  const { a, b, id } = await makeGroup();
  const post = await call(`groups/${id}/feed`, { method: "POST", token: a.token, body: { title: "Lab report" } });
  const itemId = post.data.item.id;

  const [rt, rc] = await Promise.all([
    call(`groups/${id}/tasks`, { method: "POST", token: a.token, body: { title: "Draw the diagram" } }),
    call(`groups/${id}/feed/${itemId}/comment`, { method: "POST", token: b.token, body: { text: "Due Friday?" } })
  ]);
  ok("both report success", rt.status === 200 && rc.status === 200, `${rt.status}/${rc.status}`);

  const g = await call(`groups/${id}`, { token: a.token });
  ok("the task survived", g.data.group.tasks.length === 1, JSON.stringify(g.data.group.tasks));
  const item = g.data.group.feed.find((f) => f.id === itemId);
  ok("the comment survived", (item.comments || []).length === 1, JSON.stringify(item.comments));
}

/* ------------------------------------------- a join during another's write -- */
console.log("\nconcurrency: a join isn't erased by a simultaneous post");
{
  const { a, id, code } = await makeGroup();
  const d = (await signup("dee@school.edu", "student", "Dee")).data;

  const [rj, rn] = await Promise.all([
    call("groups/join", { method: "POST", token: d.token, body: { code } }),
    call(`groups/${id}/notes`, { method: "POST", token: a.token, body: { title: "Osmosis", body: "Water moves." } })
  ]);
  ok("both report success", rj.status === 200 && rn.status === 200, `${rj.status}/${rn.status}`);

  const g = await call(`groups/${id}`, { token: a.token });
  ok("the new member is still in the group", g.data.group.members.some((m) => m.id === d.user.id),
     JSON.stringify(g.data.group.members.map((m) => m.name)));
  ok("and the note is still there", g.data.group.sharedNotes.length === 1);
}

/* --------------------------------------------- one person rating twice at once */
console.log("\nconcurrency: a double-submitted rating is counted once");
{
  const { a, b, id } = await makeGroup();
  const post = await call(`groups/${id}/feed`, { method: "POST", token: a.token, body: { title: "Problem set" } });
  const itemId = post.data.item.id;

  // The same member, twice, in the same tick — a double-click, or a retry.
  const [r1, r2] = await Promise.all([
    call(`groups/${id}/feed/${itemId}/rate`, { method: "POST", token: b.token, body: { actualMinutes: 40 } }),
    call(`groups/${id}/feed/${itemId}/rate`, { method: "POST", token: b.token, body: { actualMinutes: 90 } })
  ]);
  const statuses = [r1.status, r2.status].sort();
  ok("exactly one is accepted and one is refused", statuses.join(",") === "200,409", statuses.join(","));

  const g = await call(`groups/${id}`, { token: a.token });
  const item = g.data.group.feed.find((f) => f.id === itemId);
  ok("only one rating was stored", item.ratings.length === 1, JSON.stringify(item.ratings));
}

/* ----------------------------------------- challenge contributions in parallel */
console.log("\nconcurrency: two members contribute to a challenge at once");
{
  const { a, b, id } = await makeGroup();
  const ch = await call(`groups/${id}/challenges`, {
    method: "POST", token: a.token, body: { title: "1000 minutes", target: 1000 }
  });
  const chId = ch.data.challenge.id;
  await call(`groups/${id}/challenges/${chId}/join`, { method: "POST", token: a.token });
  await call(`groups/${id}/challenges/${chId}/join`, { method: "POST", token: b.token });

  await Promise.all([
    call(`groups/${id}/challenges/${chId}/contribute`, { method: "POST", token: a.token, body: { amount: 120 } }),
    call(`groups/${id}/challenges/${chId}/contribute`, { method: "POST", token: b.token, body: { amount: 80 } })
  ]);

  const g = await call(`groups/${id}`, { token: a.token });
  const found = g.data.group.challenges.find((c) => c.id === chId);
  const total = found.participants.reduce((s, p) => s + p.contributed, 0);
  ok("both contributions are in the total", total === 200, `total ${total}: ${JSON.stringify(found.participants)}`);
}

/* --------------------------------------- two guardians writing one student's list */
console.log("\nconcurrency: per-student lists survive two writers");
let parentA, parentB, kid;
{
  stub.__reset();
  kid = (await signup("kid@school.edu", "student", "Kit")).data;
  parentA = (await signup("mum@home.com", "parent", "Mum")).data;
  parentB = (await signup("dad@home.com", "parent", "Dad")).data;

  for (const p of [parentA, parentB]) {
    const c = await call("link/code", { method: "POST", token: kid.token });
    const r = await call("link/redeem", { method: "POST", token: p.token, body: { code: c.data.code } });
    ok(`${p.user.name} linked`, r.status === 200, JSON.stringify(r.data));
  }

  const [r1, r2] = await Promise.all([
    call("guardian-notes", { method: "POST", token: parentA.token, body: { studentId: kid.user.id, text: "Dentist at 4." } }),
    call("guardian-notes", { method: "POST", token: parentB.token, body: { studentId: kid.user.id, text: "I'll pick you up." } })
  ]);
  ok("both notes report sent", r1.status === 200 && r2.status === 200, `${r1.status}/${r2.status}`);

  const notes = await call("guardian-notes", { token: kid.token });
  ok("both notes reached the student", notes.data.notes.length === 2, JSON.stringify(notes.data.notes.map((n) => n.text)));
}

/* ------------------- marking read while a guardian is still writing --------- */
console.log("\nconcurrency: marking notes read doesn't delete a note arriving at the same moment");
{
  const [, r2] = await Promise.all([
    call("guardian-notes", { token: kid.token }),                      // student opens the list
    call("guardian-notes", { method: "POST", token: parentA.token,     // parent sends one right then
      body: { studentId: kid.user.id, text: "Third note." } })
  ]);
  ok("the send succeeded", r2.status === 200);

  const after = await call("guardian-notes", { token: kid.token });
  ok("the third note was not swallowed", after.data.notes.length === 3,
     JSON.stringify(after.data.notes.map((n) => n.text)));
  ok("and everything is marked read", after.data.notes.every((n) => n.read));
}

/* ------------------------- a check-in answered while another is requested --- */
console.log("\nconcurrency: answering a check-in doesn't drop a new request");
{
  await call("checkin/request", { method: "POST", token: parentA.token, body: { studentId: kid.user.id } });
  const first = (await call("checkin", { token: kid.token })).data.checkins[0];

  const [ra, rb] = await Promise.all([
    call("checkin/respond", { method: "POST", token: kid.token, body: { id: first.id } }),
    call("checkin/request", { method: "POST", token: parentB.token, body: { studentId: kid.user.id } })
  ]);
  ok("both report success", ra.status === 200 && rb.status === 200, `${ra.status}/${rb.status}`);

  const list = (await call("checkin", { token: kid.token })).data.checkins;
  ok("both check-ins exist", list.length === 2, JSON.stringify(list));
  ok("the answered one is still marked answered", list.some((c) => c.id === first.id && c.respondedAt),
     JSON.stringify(list));
}

/* ------------------------------ two friend requests to the same person ------ */
console.log("\nconcurrency: two people friend the same person at once");
{
  stub.__reset();
  const x = (await signup("x@s.edu", "student", "Xu")).data;
  const y = (await signup("y@s.edu", "student", "Yara")).data;
  const z = (await signup("z@s.edu", "student", "Zed")).data;

  await Promise.all([
    call("peers/request", { method: "POST", token: x.token, body: { email: "z@s.edu" } }),
    call("peers/request", { method: "POST", token: y.token, body: { email: "z@s.edu" } })
  ]);

  const zsPeers = (await call("peers", { token: z.token })).data.peers;
  ok("Zed sees both requests", zsPeers.length === 2, JSON.stringify(zsPeers));
  ok("both are pending-in", zsPeers.every((p) => p.status === "pending-in"), JSON.stringify(zsPeers));
}

/* ------------- F157: a parent editing while the student is syncing ---------- */
/*
 * The case the record-level-op design exists for. These are two different
 * people writing the *same* blob — the student's state — which the old
 * whole-DB path could only resolve by discarding one of them.
 */
console.log("\nconcurrency: a parent's edit and a student's sync don't erase each other");
{
  stub.__reset();
  const kid2 = (await signup("kit2@school.edu", "student", "Kit")).data;
  const mum = (await signup("mum2@home.com", "parent", "Mum")).data;
  const c = await call("link/code", { method: "POST", token: kid2.token });
  await call("link/redeem", { method: "POST", token: mum.token, body: { code: c.data.code } });

  const first = await call("sync", { method: "PUT", token: kid2.token,
    body: { state: { assignments: [], notes: [] }, baseVersion: 0 } });
  const base = first.data.version;

  // Fired together: the parent adds an assignment while the student's device
  // pushes a note it wrote before either knew about the other.
  const [pOp, sPush] = await Promise.all([
    call("subject-ops", { method: "POST", token: mum.token,
      body: { subjectId: kid2.user.id, ops: [
        { op: "upsert", collection: "assignments", record: { title: "Dentist form" } }] } }),
    call("sync", { method: "PUT", token: kid2.token,
      body: { state: { assignments: [], notes: [{ id: "n1", title: "Chemistry" }] }, baseVersion: base } })
  ]);

  ok("the parent's edit is accepted", pOp.status === 200, `${pOp.status} ${JSON.stringify(pOp.data)}`);
  // Whichever order they land in, the student's push either wins outright or
  // comes back as a conflict it can retry — never silently dropped.
  ok("the student's push is accepted or retryable", sPush.status === 200 || sPush.status === 409,
     `${sPush.status} ${JSON.stringify(sPush.data)}`);

  if (sPush.status === 409) {
    // The client's retry: adopt the reported version and push again. With the
    // journal in place this must merge rather than conflict forever.
    const retry = await call("sync", { method: "PUT", token: kid2.token,
      body: { state: { assignments: [], notes: [{ id: "n1", title: "Chemistry" }] },
              baseVersion: sPush.data.version } });
    ok("the retry succeeds", retry.status === 200, `${retry.status} ${JSON.stringify(retry.data)}`);
  }

  const final = (await call("sync", { token: kid2.token })).data.state || {};
  ok("the student's note survived", (final.notes || []).length === 1, JSON.stringify(final.notes));
  ok("the parent's assignment survived", (final.assignments || []).length === 1,
     JSON.stringify(final.assignments));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
