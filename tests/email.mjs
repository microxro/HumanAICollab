/* ==========================================================================
   tests/email.mjs — outbound email reports what actually happened

   The original failure mode wasn't that email broke; it was that a broken
   send and a successful send returned the same thing. These assert that the
   provider's own words survive, and that the single most common
   misconfiguration is named explicitly.
   ========================================================================== */

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const realFetch = globalThis.fetch;
function mockFetch(status, bodyObj) {
  globalThis.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(bodyObj),
    json: async () => bodyObj
  });
}

const mod = await import("../netlify/functions/_lib/email.js");
const { sendEmail, configured, deliverable, fromAddress, SANDBOX_FROM } = mod;

console.log("\nemail: configuration detection");
{
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  ok("unconfigured when no key", configured() === false);
  ok("not deliverable when no key", deliverable() === false);

  process.env.RESEND_API_KEY = "re_test_key_123456";
  ok("configured once key is set", configured() === true);
  ok("sandbox sender is the fallback", fromAddress() === SANDBOX_FROM);
  ok("key alone is NOT deliverable", deliverable() === false,
     "a key with no EMAIL_FROM can only reach the key owner");

  process.env.EMAIL_FROM = "noreply@scholar.example";
  ok("deliverable once EMAIL_FROM is set", deliverable() === true);
}

console.log("\nemail: an unconfigured deploy does not pretend to send");
{
  delete process.env.RESEND_API_KEY;
  const r = await sendEmail({ to: "a@b.co", subject: "x", html: "<p>x</p>" });
  ok("sent is false", r.sent === false);
  ok("reason is not-configured", r.reason === "not-configured");
}

console.log("\nemail: THE bug — sandbox sender rejected with 403");
{
  process.env.RESEND_API_KEY = "re_test_key_123456";
  delete process.env.EMAIL_FROM;
  mockFetch(403, { message: "You can only send testing emails to your own email address (owner@example.com)." });
  const r = await sendEmail({ to: "someone-else@school.edu", subject: "Reset", html: "<p>x</p>" });
  ok("sent is false", r.sent === false);
  ok("status preserved", r.status === 403);
  ok("provider's own words preserved", /only send testing emails/.test(r.detail || ""), r.detail);
  ok("names EMAIL_FROM as the fix", /EMAIL_FROM/.test(r.hint || ""), r.hint);
  ok("reports which sender was used", r.from === SANDBOX_FROM);
}

console.log("\nemail: bad key is distinguishable from bad sender");
{
  process.env.RESEND_API_KEY = "re_bad";
  process.env.EMAIL_FROM = "noreply@scholar.example";
  mockFetch(401, { message: "API key is invalid" });
  const r = await sendEmail({ to: "a@b.co", subject: "x", html: "<p>x</p>" });
  ok("401 surfaced", r.status === 401);
  ok("detail carries the provider message", /invalid/i.test(r.detail || ""), r.detail);
  ok("hint does not blame EMAIL_FROM alone", /RESEND_API_KEY/.test(r.hint || ""), r.hint);
}

console.log("\nemail: a network failure is reported, not swallowed");
{
  globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };
  const r = await sendEmail({ to: "a@b.co", subject: "x", html: "<p>x</p>" });
  ok("sent is false", r.sent === false);
  ok("reason is network-error", r.reason === "network-error");
  ok("does not throw out of sendEmail", true);
}

console.log("\nemail: a success is a success");
{
  process.env.RESEND_API_KEY = "re_test_key_123456";
  process.env.EMAIL_FROM = "noreply@scholar.example";
  mockFetch(200, { id: "msg_1" });
  const r = await sendEmail({ to: "a@b.co", subject: "x", html: "<p>x</p>" });
  ok("sent is true", r.sent === true);
  ok("reports the sender used", r.from === "noreply@scholar.example");
}

globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
