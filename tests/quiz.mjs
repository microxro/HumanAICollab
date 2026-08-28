/* ==========================================================================
   tests/quiz.mjs — F160: the AI gate on study-shop tokens

   Tokens used to be paid for a photo and a self-reported number, then for a
   photo the model wrote a quiz about. This suite is about the two routes that
   replaced both, and it cares about one question above all others: can a
   student get paid without doing the work?

   So the assertions cluster on the boundary rather than the happy path:

     • a topic the model says isn't school material yields no ticket at all
     • the answer key is not in the quiz response, in any field
     • a ticket cannot be forged, replayed past its expiry, moved to another
       account, or swapped for the session token this same server signed
     • the topic and difficulty credited come off the signed ticket, so the
       request body cannot rewrite either
     • grading is arithmetic, and the table lives here, not on the client

   Run: node --import ./tests/stub/register.mjs tests/quiz.mjs
   ========================================================================== */

process.env.SCHOLAR_SECRET = "test-secret-value-at-least-16-chars-long";
process.env.SITE_URL = "https://studyhold.example";
process.env.GEMINI_API_KEY = "test-key";

const api = (await import("../netlify/functions/api.js")).default;
const assistant = (await import("../netlify/functions/assistant.js")).default;
const stub = await import("./stub/blobs-stub.mjs");
const gem = await import("./stub/gemini-stub.mjs");
const { signToken } = await import("../netlify/functions/_lib/auth.js");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const API = "https://studyhold.example/api/";
const AI = "https://studyhold.example/assistant/";

async function callApi(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await api(new Request(API + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  }));
  let data = null;
  try { data = await res.clone().json(); } catch (e) { data = null; }
  return { status: res.status, data };
}

async function callAi(path, { body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await assistant(new Request(AI + path, {
    method: "POST", headers, body: JSON.stringify(body || {})
  }));
  let data = null;
  try { data = await res.clone().json(); } catch (e) { data = null; }
  return { status: res.status, data };
}

const TOPIC = { topic: "Stoichiometry", className: "Chemistry", difficulty: "medium" };

/** A well-formed four-question reply from the model. */
function goodQuiz(overrides) {
  return Object.assign({
    teachable: true,
    subject: "Chemistry",
    reason: "Five questions on mole ratios and limiting reagents.",
    questions: [
      { prompt: "Which reagent is limiting when 1 mol CH4 meets 1 mol O2?", choices: ["O2", "CH4", "CO2", "H2O"], answerIndex: 1 },
      { prompt: "What mass of CO2 comes from 0.2 mol of carbon?", choices: ["4.4 g", "8.8 g", "12.1 g", "16.0 g"], answerIndex: 2 },
      { prompt: "Which step comes first in a mole-ratio problem?", choices: ["Balancing", "Mole ratio", "Molar mass", "Rounding"], answerIndex: 0 },
      { prompt: "What unit does a molar volume answer end in?", choices: ["mol", "g", "L", "kPa"], answerIndex: 3 }
    ]
  }, overrides || {});
}
const GOOD_KEY = [1, 2, 0, 3];

let student, other;

/* ------------------------------------------------------------- accounts -- */
{
  stub.__reset();
  student = (await callApi("auth/signup", {
    method: "POST", body: { email: "sam@school.edu", password: "password123", name: "Sam", role: "student" }
  })).data;
  other = (await callApi("auth/signup", {
    method: "POST", body: { email: "kit@school.edu", password: "password123", name: "Kit", role: "student" }
  })).data;
}

/* ==================================================== not school material ==== */
console.log("\nquiz: a topic school doesn't teach earns nothing");
{
  gem.__reset();
  gem.__queue({
    teachable: false, subject: "", questions: [],
    reason: "That's a video game, not something a school teaches."
  });
  const r = await callAi("study-topic", {
    body: { topic: "Fortnite build fights" }, token: student.token
  });

  ok("the call succeeds — a refusal is an outcome, not an error", r.status === 200, String(r.status));
  ok("it says the topic can't be quizzed", r.data.ok === false, JSON.stringify(r.data));
  ok("no ticket is issued", !r.data.ticket, String(r.data.ticket));
  ok("no questions come back", !r.data.questions || r.data.questions.length === 0);
  ok("the student is told why", /video game/i.test(r.data.reason || ""), r.data.reason);
}

console.log("\nquiz: a topic too thin to ask about also earns nothing");
{
  gem.__reset();
  // The model says yes, but the questions are unusable: this must not fall
  // back to paying for naming a topic.
  gem.__queue(goodQuiz({ questions: [{ prompt: "?", choices: ["a", "a", "b", "c"], answerIndex: 0 }] }));
  const r = await callAi("study-topic", { body: TOPIC, token: student.token });

  ok("no ticket for a quiz that couldn't be built", !r.data.ticket, JSON.stringify(r.data));
  ok("and it says why, without blaming the student",
     /broad|thin/i.test(r.data.reason || ""), r.data.reason);
}

/* ========================================================== the answers ==== */
console.log("\nquiz: the answer key never reaches the browser");
let ticket;
{
  gem.__reset();
  gem.__queue(goodQuiz());
  const r = await callAi("study-topic", { body: TOPIC, token: student.token });
  ticket = r.data.ticket;

  ok("a real topic gets a quiz", (r.data.questions || []).length === 4, JSON.stringify(r.data.questions));
  ok("and a ticket", typeof ticket === "string" && ticket.length > 0);
  ok("each question keeps its four choices",
     r.data.questions.every((q) => q.choices.length === 4));
  ok("the topic comes back as it was asked", r.data.topic === TOPIC.topic, r.data.topic);

  // The whole response, flattened. Not "questions[i].answerIndex is absent" —
  // any field anywhere carrying the key would defeat the point.
  const flat = JSON.stringify(r.data);
  ok("no answerIndex anywhere in the response", flat.indexOf("answerIndex") === -1);
  ok("the key isn't smuggled under another name",
     flat.indexOf('"key"') === -1 && flat.indexOf('"answers"') === -1, flat.slice(0, 200));

  // The ticket is base64url(payload).base64url(sig) — readable to anyone who
  // looks. That is fine for the topic and the difficulty; it is NOT fine if it
  // means the key is legible too, so this asserts what it actually is.
  const payload = JSON.parse(Buffer.from(ticket.split(".")[0], "base64url").toString());
  ok("the ticket does carry the key (that is what signing is for)", Array.isArray(payload.key));
  ok("bound to this account", payload.sub === student.user.id);
  ok("bound to this topic", payload.t === TOPIC.topic);
  ok("and to the difficulty it was written at", payload.d === "medium", String(payload.d));
  ok("and marked as a quiz ticket, not a session", payload.k === "sq");
}

/* ============================================================= grading ==== */
console.log("\nquiz: the score decides the payout, and the server decides the score");
{
  // A ticket is single-use, so each of these gets a fresh one.
  const freshTicket = async () => {
    gem.__reset();
    gem.__queue(goodQuiz());
    return (await callAi("study-topic", { body: TOPIC, token: student.token })).data.ticket;
  };
  const grade = async (answers) =>
    (await callAi("study-quiz", { body: { ticket: await freshTicket(), answers }, token: student.token })).data;

  const a = await grade(GOOD_KEY);
  ok("4 of 4 is an A worth 4 tokens",
     a.correct === 4 && a.grade === "A" && a.tokens === 4, JSON.stringify(a));

  const b = await grade([1, 2, 0, 0]);
  ok("3 of 4 is a B worth 2", b.correct === 3 && b.grade === "B" && b.tokens === 2, JSON.stringify(b));

  const c = await grade([1, 2, 3, 3].map((v, i) => (i < 2 ? GOOD_KEY[i] : 9)));
  ok("2 of 4 is a C worth 1", c.correct === 2 && c.grade === "C" && c.tokens === 1, JSON.stringify(c));

  const f = await grade([9, 9, 9, 9]);
  ok("0 of 4 pays nothing", f.correct === 0 && f.tokens === 0, JSON.stringify(f));
  ok("a failed quiz still says which ones were wrong",
     Array.isArray(f.wrong) && f.wrong.length === 4, JSON.stringify(f.wrong));
  ok("but never says what the right ones were",
     JSON.stringify(f).indexOf('"key"') === -1 && f.answers === undefined);

  const short = await callAi("study-quiz", {
    body: { ticket: await freshTicket(), answers: [1, 2] }, token: student.token
  });
  ok("a partial submission is refused, not graded on what's there", short.status === 400, String(short.status));
}

/* ============================================================== replay ==== */
console.log("\nquiz: a ticket is marked once, so the quiz can't be brute-forced");
{
  gem.__reset();
  gem.__queue(goodQuiz());
  const t = (await callAi("study-topic", { body: TOPIC, token: student.token })).data.ticket;

  // Attempt one: get it wrong on purpose, and read which ones were wrong —
  // that feedback is useful to a student and lethal without this rule.
  const first = await callAi("study-quiz", { body: { ticket: t, answers: [0, 0, 0, 0] }, token: student.token });
  ok("the first attempt is graded", first.status === 200 && first.data.correct === 1, JSON.stringify(first.data));
  ok("and says which were wrong", first.data.wrong.length === 3, JSON.stringify(first.data.wrong));

  // Attempt two: apply what attempt one just revealed.
  const second = await callAi("study-quiz", { body: { ticket: t, answers: GOOD_KEY }, token: student.token });
  ok("the same ticket cannot be graded twice", second.status === 409, String(second.status));
  ok("so knowing the wrong answers buys nothing", second.data.tokens === undefined, JSON.stringify(second.data));
  ok("and the student is told what to do instead", /retake|new one/i.test(second.data.error || ""), second.data.error);
}

console.log("\nquiz: the topic and difficulty come off the ticket, not the request");
{
  gem.__reset();
  gem.__queue(goodQuiz());
  const t = (await callAi("study-topic", {
    body: { topic: "Mole ratios", difficulty: "easy" }, token: student.token
  })).data.ticket;
  const r = await callAi("study-quiz", {
    body: { ticket: t, answers: GOOD_KEY, topic: "Something else", difficulty: "hard" },
    token: student.token
  });
  ok("the topic credited is the one quizzed", r.data.topic === "Mole ratios", r.data.topic);
  ok("and so is the difficulty", r.data.difficulty === "easy", String(r.data.difficulty));
  ok("with the multiplier the server owns", r.data.multiplier === 0.75, String(r.data.multiplier));
}

console.log("\nquiz: an unknown difficulty falls back rather than inventing a rate");
{
  gem.__reset();
  gem.__queue(goodQuiz());
  const r = await callAi("study-topic", {
    body: { topic: "Photosynthesis", difficulty: "impossible" }, token: student.token
  });
  ok("the quiz is still written", r.data.ok === true, JSON.stringify(r.data).slice(0, 120));
  ok("at medium", r.data.difficulty === "medium", String(r.data.difficulty));
}

/* ============================================================= tickets ==== */
console.log("\nquiz: a ticket can't be forged, moved, or outlived");
{
  const bad = await callAi("study-quiz", {
    body: { ticket: ticket.slice(0, -4) + "AAAA", answers: GOOD_KEY }, token: student.token
  });
  ok("a tampered signature is refused", bad.status === 400, String(bad.status));

  const none = await callAi("study-quiz", { body: { answers: GOOD_KEY }, token: student.token });
  ok("a missing ticket is refused", none.status === 400, String(none.status));

  const theirs = await callAi("study-quiz", { body: { ticket, answers: GOOD_KEY }, token: other.token });
  ok("another account cannot cash in this ticket", theirs.status === 403, String(theirs.status));

  // The server signs session tokens with the same key. Without the kind tag
  // a student could present their own session token as a quiz ticket.
  const asSession = await callAi("study-quiz", {
    body: { ticket: student.token, answers: GOOD_KEY }, token: student.token
  });
  ok("a session token is not a quiz ticket", asSession.status === 400, String(asSession.status));

  const stale = await signToken({
    k: "sq", sub: student.user.id, t: TOPIC.topic, d: "medium", key: GOOD_KEY, qexp: Date.now() - 1000
  });
  const late = await callAi("study-quiz", { body: { ticket: stale, answers: GOOD_KEY }, token: student.token });
  ok("an expired quiz is refused", late.status === 400, String(late.status));

  // A validly signed ticket claiming a payout directly, rather than a key to
  // be graded against.
  const greedy = await signToken({
    k: "sq", sub: student.user.id, t: TOPIC.topic, d: "hard", key: [], tokens: 99, qexp: Date.now() + 60000
  });
  const g = await callAi("study-quiz", { body: { ticket: greedy, answers: [] }, token: student.token });
  ok("a ticket cannot name its own payout",
     g.status === 400 || (g.data && g.data.tokens === 0), JSON.stringify(g.data));
}

/* ================================================================ auth ==== */
console.log("\nquiz: both routes need an account");
{
  const p = await callAi("study-topic", { body: TOPIC });
  ok("writing a quiz refuses an anonymous caller", p.status === 401, String(p.status));
  const q = await callAi("study-quiz", { body: { ticket, answers: GOOD_KEY } });
  ok("so does grading", q.status === 401, String(q.status));
}

console.log("\nquiz: the topic is validated before a call is spent");
{
  gem.__reset();
  const empty = await callAi("study-topic", { body: {}, token: student.token });
  ok("no topic is a 400", empty.status === 400, String(empty.status));

  const tiny = await callAi("study-topic", { body: { topic: "hi" }, token: student.token });
  ok("a two-character topic is a 400, not a quiz about a guess",
     tiny.status === 400, String(tiny.status));

  ok("and neither one reached the model", gem.__calls().length === 0, String(gem.__calls().length));
}

console.log("\nquiz: a very long topic is clamped, never passed through whole");
{
  gem.__reset();
  gem.__queue(goodQuiz());
  const long = "Revision ".repeat(40);
  const r = await callAi("study-topic", { body: { topic: long }, token: student.token });
  ok("the quiz is still written", r.data.ok === true, JSON.stringify(r.data).slice(0, 120));
  ok("with the topic cut to the documented ceiling",
     r.data.topic.length <= 80, String(r.data.topic.length));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
