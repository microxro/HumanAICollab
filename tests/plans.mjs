/* ==========================================================================
   tests/plans.mjs — F156: what the tiers actually gate, and what they must not

   Two halves.

   The first asserts the gates: below the tier, the API answers 402 and the
   write does not happen; at or above it, the same call goes through. It is
   driven against the real api.js, so what is proved is the server's answer,
   not a button's disabled attribute — which is the only kind of paywall worth
   testing, since the browser is the customer's to edit.

   The second asserts the promises made around the gates, which matter more
   than the gates and are easier to break by accident:

     • GET /sync is never gated. A cancelled account can always pull its own
       data back down. If that ever regresses, this app holds data hostage.
     • Cancelling is self-serve and immediate — no operator, no waiting.
     • Granting is the operator's alone, and an ordinary account cannot
       promote itself.
     • With SCHOLAR_PLANS unset, every gated route behaves exactly as it did
       before this feature existed. That is the kill switch, and it is the
       thing a future removal will lean on.

   Run: node --import ./tests/stub/register.mjs tests/plans.mjs
   ========================================================================== */

process.env.SCHOLAR_SECRET = "test-secret-value-at-least-16-chars-long";
process.env.SITE_URL = "https://scholar.example";
process.env.ADMIN_EMAIL = "operator@x.com";

const stub = await import("./stub/blobs-stub.mjs");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const BASE = "https://scholar.example/api/";

/**
 * The module reads process.env on every request, so one import serves both
 * halves of the suite — SCHOLAR_PLANS is flipped between them rather than
 * re-imported, which is also the behaviour an operator gets from flipping the
 * variable on a live deploy.
 */
const api = (await import("../netlify/functions/api.js")).default;

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

async function makeUser(email, role) {
  const r = await call("auth/signup", {
    method: "POST",
    body: { email, password: "password123", name: "Test", role: role || "student" }
  });
  return r.data;
}

const plansOn = () => { process.env.SCHOLAR_PLANS = "on"; };
const plansOff = () => { delete process.env.SCHOLAR_PLANS; };

/** Every write this feature gates, as one callable list. */
const GATED_WRITES = [
  ["sync push", (t) => call("sync", { method: "PUT", token: t, body: { state: { classes: [] }, baseVersion: 0 } })],
  ["parent link code", (t) => call("link/code", { method: "POST", token: t })],
  ["location push", (t) => call("location", { method: "POST", token: t, body: { status: null, summary: { name: "T" } } })],
  ["group create", (t) => call("groups", { method: "POST", token: t, body: { name: "Chem" } })],
  ["api token mint", (t) => call("tokens", { method: "POST", token: t, body: { label: "s" } })],
  ["webhook add", (t) => call("webhooks", { method: "POST", token: t, body: { url: "https://example.com/hook", events: ["state.updated"] } })]
];

/* ===================================================== the gates, plans on */

console.log("\nplans: a basic account is refused the paid routes, and told why");
{
  stub.__reset();
  plansOn();
  const user = await makeUser("basic@x.com");

  for (const [label, run] of GATED_WRITES) {
    const r = await run(user.token);
    ok(`402 for ${label}`, r.status === 402, `${r.status} ${JSON.stringify(r.data)}`);
  }

  const one = await GATED_WRITES[0][1](user.token);
  ok("the refusal names the tier that unlocks it",
     /Premium/i.test((one.data && one.data.error) || ""), JSON.stringify(one.data));
  ok("and says local data still works",
     /own device/i.test((one.data && one.data.error) || ""), JSON.stringify(one.data));
}

console.log("\nplans: refusing a write must not perform it");
{
  stub.__reset();
  plansOn();
  const user = await makeUser("nowrite@x.com");

  await call("sync", { method: "PUT", token: user.token, body: { state: { classes: [{ id: "c1" }] }, baseVersion: 0 } });
  const pulled = await call("sync", { token: user.token });
  ok("nothing was stored by the refused push",
     pulled.status === 200 && !pulled.data.state, JSON.stringify(pulled.data).slice(0, 120));

  await call("tokens", { method: "POST", token: user.token, body: { label: "sneaky" } });
  const tokens = await call("tokens", { token: user.token });
  ok("no API token was minted by the refused call",
     tokens.status === 200 && tokens.data.tokens.length === 0, JSON.stringify(tokens.data));
}

console.log("\nplans: premium opens the premium routes and no further");
{
  stub.__reset();
  plansOn();
  const operator = await makeUser("operator@x.com");
  const user = await makeUser("premium@x.com");

  const grant = await call("billing/grant", {
    method: "POST", token: operator.token, body: { email: "premium@x.com", plan: "premium" }
  });
  ok("the operator can grant a plan", grant.status === 200, JSON.stringify(grant.data));

  const push = await call("sync", { method: "PUT", token: user.token, body: { state: { classes: [] }, baseVersion: 0 } });
  ok("sync push now works", push.status === 200, `${push.status} ${JSON.stringify(push.data)}`);

  const group = await call("groups", { method: "POST", token: user.token, body: { name: "Chem" } });
  ok("creating a group now works", group.status === 200, `${group.status}`);

  const token = await call("tokens", { method: "POST", token: user.token, body: { label: "s" } });
  ok("but API tokens are still Ultra Premium", token.status === 402, `${token.status}`);
  ok("and the refusal names Ultra Premium",
     /Ultra Premium/i.test((token.data && token.data.error) || ""), JSON.stringify(token.data));
}

console.log("\nplans: ultra opens everything");
{
  stub.__reset();
  plansOn();
  const operator = await makeUser("operator@x.com");
  const user = await makeUser("ultra@x.com");
  await call("billing/grant", { method: "POST", token: operator.token, body: { email: "ultra@x.com", plan: "ultra" } });

  for (const [label, run] of GATED_WRITES) {
    const r = await run(user.token);
    ok(`${label} allowed`, r.status === 200, `${r.status} ${JSON.stringify(r.data)}`);
  }
}

console.log("\nplans: the operator is never locked out of their own deploy");
{
  stub.__reset();
  plansOn();
  const operator = await makeUser("operator@x.com");
  ok("operator's own plan reads as basic in storage",
     (await call("billing/plan", { token: operator.token })).data.stored === "basic");

  const push = await call("sync", { method: "PUT", token: operator.token, body: { state: {}, baseVersion: 0 } });
  ok("yet the paid routes work for them", push.status === 200, `${push.status}`);
  // Otherwise a fresh deploy is a deadlock: enforcement on, everyone basic,
  // and the one account that can grant a plan unable to reach the button.
}

/* ============================================== the promises around them */

console.log("\nplans: your data is never held hostage");
{
  stub.__reset();
  plansOn();
  const operator = await makeUser("operator@x.com");
  const user = await makeUser("leaving@x.com");
  await call("billing/grant", { method: "POST", token: operator.token, body: { email: "leaving@x.com", plan: "premium" } });
  await call("sync", { method: "PUT", token: user.token, body: { state: { classes: [{ id: "c1", name: "Chem" }] }, baseVersion: 0 } });

  const cancel = await call("billing/cancel", { method: "POST", token: user.token });
  ok("cancelling is self-serve", cancel.status === 200, JSON.stringify(cancel.data));
  ok("and immediate", cancel.data.plan === "basic", JSON.stringify(cancel.data));

  const pull = await call("sync", { token: user.token });
  ok("GET /sync still answers after cancelling", pull.status === 200, `${pull.status}`);
  ok("and the data is all still there",
     !!pull.data.state && pull.data.state.classes.length === 1, JSON.stringify(pull.data).slice(0, 160));

  const push = await call("sync", { method: "PUT", token: user.token, body: { state: {}, baseVersion: pull.data.version } });
  ok("but pushing is refused again", push.status === 402, `${push.status}`);
}

console.log("\nplans: nobody promotes themselves");
{
  stub.__reset();
  plansOn();
  const user = await makeUser("sneaky@x.com");
  const self = await call("billing/grant", {
    method: "POST", token: user.token, body: { email: "sneaky@x.com", plan: "ultra" }
  });
  ok("a non-operator cannot grant", self.status === 403, `${self.status} ${JSON.stringify(self.data)}`);
  ok("and stays basic", (await call("billing/plan", { token: user.token })).data.plan === "basic");

  // The same attempt through the profile-writing route that already exists.
  await call("me", { method: "POST", token: user.token, body: { name: "x", billing: { plan: "ultra" } } });
  ok("POST /me cannot smuggle a plan in",
     (await call("billing/plan", { token: user.token })).data.plan === "basic");
}

console.log("\nplans: a grant can expire, and expiry is applied on read");
{
  stub.__reset();
  plansOn();
  const operator = await makeUser("operator@x.com");
  const user = await makeUser("trial@x.com");

  const past = await call("billing/grant", {
    method: "POST", token: operator.token,
    body: { email: "trial@x.com", plan: "premium", until: Date.now() - 1000 }
  });
  ok("a grant that already expired is refused at the door", past.status === 400, `${past.status}`);

  await call("billing/grant", {
    method: "POST", token: operator.token,
    body: { email: "trial@x.com", plan: "premium", until: Date.now() + 50 }
  });
  ok("a live grant works", (await call("sync", {
    method: "PUT", token: user.token, body: { state: {}, baseVersion: 0 }
  })).status === 200);

  await new Promise((r) => setTimeout(r, 80));
  const after = await call("sync", { method: "PUT", token: user.token, body: { state: {}, baseVersion: 1 } });
  ok("and stops the moment it runs out, with no sweep job involved",
     after.status === 402, `${after.status}`);
  ok("the plan reads as basic once expired",
     (await call("billing/plan", { token: user.token })).data.plan === "basic");
}

console.log("\nplans: bad input to a grant is refused, not coerced");
{
  stub.__reset();
  plansOn();
  const operator = await makeUser("operator@x.com");
  await makeUser("real@x.com");

  const bogus = await call("billing/grant", { method: "POST", token: operator.token, body: { email: "real@x.com", plan: "gold" } });
  ok("an unknown tier is a 400", bogus.status === 400, JSON.stringify(bogus.data));
  ok("and the message lists the real ones",
     /basic/.test(bogus.data.error) && /ultra/.test(bogus.data.error), bogus.data.error);

  const missing = await call("billing/grant", { method: "POST", token: operator.token, body: { email: "nobody@x.com", plan: "premium" } });
  ok("granting to an address with no account is a 404", missing.status === 404, `${missing.status}`);
}

/* ============================================================ the switch */

console.log("\nplans: with SCHOLAR_PLANS unset, nothing is gated at all");
{
  stub.__reset();
  plansOff();
  const user = await makeUser("free@x.com");

  for (const [label, run] of GATED_WRITES) {
    const r = await run(user.token);
    ok(`${label} works with plans off`, r.status === 200, `${r.status} ${JSON.stringify(r.data)}`);
  }

  const billing = await call("billing/plan", { token: user.token });
  ok("the client is told there is nothing to sell",
     billing.status === 200 && billing.data.enabled === false, JSON.stringify(billing.data));
  ok("and reads as fully unlocked so its own gates fall open",
     billing.data.plan === "ultra", JSON.stringify(billing.data));

  const cancel = await call("billing/cancel", { method: "POST", token: user.token });
  ok("cancelling is a 404 when there are no plans", cancel.status === 404, `${cancel.status}`);
}

console.log("\nplans: enforcement refuses to run with no operator to grant plans");
{
  stub.__reset();
  plansOn();
  const saved = process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_EMAIL;

  const user = await makeUser("orphan@x.com");
  const push = await call("sync", { method: "PUT", token: user.token, body: { state: {}, baseVersion: 0 } });
  ok("sync still works rather than locking everyone out forever",
     push.status === 200, `${push.status}`);

  process.env.ADMIN_EMAIL = saved;
}

plansOff();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
