/* ==========================================================================
   api.js — the whole Scholar backend, as one Netlify Function

   Routes (all under /api):
     POST   /auth/signup            create an account
     POST   /auth/login             exchange credentials for a bearer token
     POST   /auth/forgot            (F098) email a password-reset link
     POST   /auth/reset             (F098) redeem that link's token
     GET    /me                     current user
     POST   /me                     update display name

     GET    /sync                   pull { state, version }
     PUT    /sync                   push { state, baseVersion } → { version }

     POST   /link/code              (student) mint a one-time parent link code
     POST   /link/redeem            (parent)  redeem a code
     GET    /link/children          (parent)  linked students + live status
     GET    /link/parents           (student) who can see me
     DELETE /link/:otherId          either side removes the link

     POST   /location               (student) push status + shared summary
     GET    /location/:studentId    (parent)  read a linked student's status

     GET    /groups                 my study groups
     POST   /groups                 create one
     POST   /groups/join            join by code
     GET    /groups/:id             members, shared decks, assignment feed
     POST   /groups/:id/deck        share a flashcard deck
     POST   /groups/:id/feed        post to the crowdsourced assignment feed
     POST   /groups/:id/leave       leave (ownership transfers; last one out deletes)

     Group collaboration (F054-F063) — all hang off the group blob, so
     membership is the only access check needed:
     POST   /groups/:id/tasks              (F055) add a task
     POST   /groups/:id/tasks/:taskId      update status/assignee
     DELETE /groups/:id/tasks/:taskId      remove (author or owner only)
     POST   /groups/:id/availability       (F054/F057) push my busy blocks
     POST   /groups/:id/partners           (F056) ask someone to partner
     POST   /groups/:id/partners/:pairId   accept or decline
     DELETE /groups/:id/partners/:pairId   end a partnership
     POST   /groups/:id/tutoring           (F061) offer or request help
     POST   /groups/:id/tutoring/:postId   respond to a post
     DELETE /groups/:id/tutoring/:postId   remove (author or owner only)
     POST   /groups/:id/notes              (F062) share a note, keeping credit
     GET    /groups/:id/notes/:noteId      read one shared note
     POST   /groups/:id/notes/:noteId/thanks
     DELETE /groups/:id/notes/:noteId      remove (author or owner only)
     POST   /groups/:id/challenges         (F063) create a cooperative goal
     POST   /groups/:id/challenges/:chId/join
     POST   /groups/:id/challenges/:chId/contribute
     DELETE /groups/:id/challenges/:chId   leave a challenge

   Every authenticated route verifies the bearer token, and every read of
   another person's data checks an explicit link/membership first.

   Concurrency. Anything more than one person can write — a group blob, a
   student's check-in/notes/focus-window list, either side of a friendship —
   goes through updateJSON()/updateGroup(), which is a conditional write with
   an optimistic retry. A plain read-modify-write on a shared key drops one of
   two simultaneous edits and answers 200 to both, which leaves no trace
   anywhere; tests/concurrency.mjs asserts each of those pairs survives.

   Environment:
     SCHOLAR_SECRET  required — signs session tokens, derives email lookup
                     keys, hashes API tokens at rest. No fallback.
     SITE_URL        required — the origin password-reset links are built
                     from, and the only origin allowed to call this API
                     cross-site.
     RESEND_API_KEY  optional — outbound email.
     EMAIL_FROM      optional — sender on a domain verified in Resend.
                     Unset means Resend's sandbox sender, which only reaches
                     the API key owner.
     ADMIN_EMAIL     optional — the account allowed to read this deploy's
                     configuration from /email-health. Unset means nobody.
   ========================================================================== */

import {
  hashPassword, verifyPassword, signToken, verifyToken,
  normalizeEmail, emailKey, validEmail, passwordProblem,
  randomId, randomCode, toB64Url
} from "./_lib/auth.js";
import { readJSON, updateJSON, readJSONWithEtag, writeJSONIf, rateLimit, writeJSON, remove } from "./_lib/blobs.js";
import { urlProblem } from "./_lib/urlguard.js";
import { sendEmail, layout, configured as emailConfigured, deliverable as emailDeliverable, fromAddress, SANDBOX_FROM } from "./_lib/email.js";

const MAX_STATE_BYTES = 5 * 1024 * 1024;
const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

/** The complete set of account types. Anything else is rejected, not coerced. */
const ROLES = ["student", "parent", "teacher"];

/* ------------------------------------------------------------------ F100 -- */

const API_TOKEN_PREFIX = "sk_";

/**
 * Marks a request that authenticated with an API token rather than a session.
 *
 * A Symbol, not a string key, and that matters: this rides on the live profile
 * object, and eleven routes write that object straight back with
 * writeJSON("profiles", user.id, user). As a plain `_viaApiToken` property it
 * got persisted by the first POST /me an API token ever made — after which the
 * flag was true for every future *session* too, and the account was locked out
 * of its own Developer tab for good, with no way back from inside the product.
 * JSON.stringify ignores symbol-keyed properties, so this can never be stored.
 */
const VIA_API_TOKEN = Symbol("viaApiToken");

/**
 * Blob key for an API token: SHA-256 over the token and SCHOLAR_SECRET.
 *
 * Keyed by the hash rather than the token so the store never holds the secret
 * — a read of the apiTokens store yields nothing anyone can authenticate
 * with. Mixing in SCHOLAR_SECRET means the hash can't be precomputed from a
 * guessed token either. Base64url, so it's a legal blob key.
 */
async function tokenLookupKey(token) {
  const data = new TextEncoder().encode(String(token) + "|" + (process.env.SCHOLAR_SECRET || ""));
  return toB64Url(await crypto.subtle.digest("SHA-256", data));
}
const MAX_API_TOKENS = 10;
const MAX_WEBHOOKS = 5;
const WEBHOOK_TIMEOUT_MS = 4000;
// Only events this deploy actually emits. `assignment.due` and `grade.changed`
// were listed here and never fired anywhere: a receiver could subscribe, see
// the hook registered, and wait forever for a delivery that had no producer.
// An endpoint you can subscribe to but that is structurally silent is worse
// than one that isn't offered.
const WEBHOOK_EVENTS = ["state.updated"];

/**
 * Netlify Blobs throws on an empty key, a key beginning with "/" or "%2F",
 * and anything over 600 UTF-8 bytes. readJSON only swallows "not found", so
 * every other case propagated to the generic 500 handler — free log noise and
 * a trivially discoverable defect. Validate before we ever reach storage.
 */
/** UTF-8 size of a string — what every size limit in this file actually means. */
function byteLength(s) {
  return new TextEncoder().encode(String(s == null ? "" : s)).length;
}

function validBlobKey(key) {
  if (typeof key !== "string") return false;
  const k = key.trim();
  if (!k || k.length > 300) return false;
  if (k.startsWith("/") || k.startsWith("%2F") || k.startsWith("%2f")) return false;
  if (byteLength(k) > 600) return false;
  return true;
}

/* ------------------------------------------------------------ responses -- */

/**
 * The API is only ever called by this site's own front end, so it does not
 * need to be reachable cross-origin. It used to send
 * `Access-Control-Allow-Origin: *` alongside `Authorization`, which let any
 * page on the web drive the authenticated API from a visitor's browser.
 *
 * The ICS feed is the one deliberate exception — calendar clients fetch it
 * cross-origin — and it sets its own headers.
 */
function corsFor(req) {
  const origin = req && req.headers ? req.headers.get("origin") : null;
  const allowed = process.env.SITE_URL || "";
  const base = {
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  if (!origin) return base;                       // same-origin or a non-browser client
  let ok = false;
  try { ok = !!allowed && new URL(origin).origin === new URL(allowed).origin; } catch (e) { ok = false; }
  return ok ? { ...base, "Access-Control-Allow-Origin": origin } : base;
}

// Public, read-only, and fetched by third-party calendar apps by design.
// This is the ONE place a wildcard is correct: the URL is itself the secret,
// it returns no personal identifiers, and calendar clients are cross-origin.
const CORS = { "Access-Control-Allow-Origin": "*", "Vary": "Origin" };

// JSON API responses deliberately carry NO Access-Control-Allow-Origin.
// The front end is served from the same origin, so it needs none, and its
// absence is what stops another site from reading authenticated responses
// out of a logged-in visitor's browser. A cross-origin deployment (a custom
// `apiBase`) would need SITE_URL set and corsFor() wired in here.
const API_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: API_HEADERS
  });
}

const ok = (body) => json(body || { ok: true });
const fail = (status, message, extra) => json({ error: message, ...(extra || {}) }, status);

/* ----------------------------------------------------------------- auth -- */

async function currentUser(req) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;

  // F100 — a personal API token. `sk_` makes it distinguishable from a
  // session JWT by inspection, so this is one extra branch rather than a
  // change to every call site. Same shape as the ICS feed token that already
  // works: server-minted, opaque, redeemable without a session.
  if (token.startsWith(API_TOKEN_PREFIX)) {
    if (!validBlobKey(token)) return null;
    const lookup = await tokenLookupKey(token);
    // Hashed lookup first; the plaintext key is only tried for tokens minted
    // before hashing existed, so an old token keeps working until it's revoked.
    let rec = await readJSON("apiTokens", lookup, null);
    let storedAt = lookup;
    if (!rec) { rec = await readJSON("apiTokens", token, null); storedAt = token; }
    if (!rec || !rec.userId) return null;
    const profile = await readJSON("profiles", rec.userId);
    if (!profile) return null;
    delete profile._viaApiToken;   // see VIA_API_TOKEN — clears any stored flag
    // Revoked alongside sessions when the password changes.
    if (Number(profile.tokenEpoch || 0) > Number(rec.epoch || 0)) return null;
    // Best-effort usage stamp; never let it fail the request.
    if (!rec.lastUsedAt || Date.now() - rec.lastUsedAt > 60000) {
      writeJSON("apiTokens", storedAt, { ...rec, lastUsedAt: Date.now() }).catch(() => {});
    }
    profile[VIA_API_TOKEN] = true;
    return profile;
  }

  const payload = await verifyToken(token);
  if (!payload || !payload.sub) return null;
  const profile = await readJSON("profiles", payload.sub);
  if (!profile) return null;
  // Repairs a profile written while the flag was a plain property: without
  // this, an account that once used an API token stays locked out of token
  // management forever, because the stored `true` outlives the request.
  delete profile._viaApiToken;

  // Session revocation. Tokens are stateless with a 30-day life, so before
  // this a stolen one kept working for a month and a password reset did
  // nothing about it — a compromised account could not be recovered by any
  // action available in the product. Resetting or changing a password bumps
  // tokenEpoch, which retires every token minted before it.
  const epoch = Number(profile.tokenEpoch || 0);
  if (epoch && Number(payload.epoch || 0) < epoch) return null;

  return profile;
}

async function requireUser(req) {
  const user = await currentUser(req);
  if (!user) throw { status: 401, message: "Sign in to continue." };
  return user;
}

async function body(req) {
  try {
    const text = await req.text();
    if (!text) return {};
    // Bytes, not `.length`. A JS string counts UTF-16 code units, so a body
    // of emoji or CJK measured about half its real size here while pushState
    // measured the same body in bytes — the two disagreed on what "5 MB"
    // meant, and this gate was the looser of the pair.
    if (byteLength(text) > MAX_STATE_BYTES) throw { status: 413, message: "That payload is too large." };
    return JSON.parse(text);
  } catch (e) {
    if (e && e.status) throw e;
    throw { status: 400, message: "Invalid JSON body." };
  }
}

/* --------------------------------------------------------------- routes -- */

async function signup(req) {
  const b = await body(req);
  const email = normalizeEmail(b.email);
  const name = String(b.name || "").trim().slice(0, 80);

  // Validated rather than coerced. `b.role === "parent" ? "parent" : "student"`
  // silently turned any unrecognised value — including a typo, or "teacher" —
  // into a student account, with no error and no way for the caller to tell.
  const requestedRole = b.role == null || b.role === "" ? "student" : String(b.role);
  if (!ROLES.includes(requestedRole)) {
    return fail(400, `Unknown account type "${requestedRole}". Choose one of: ${ROLES.join(", ")}.`);
  }
  const role = requestedRole;

  if (!validEmail(email)) return fail(400, "Enter a valid email address.");
  const pwProblem = passwordProblem(b.password);
  if (pwProblem) return fail(400, pwProblem);
  if (!name) return fail(400, "Enter your name.");

  // Rate limited per address so signup can't be used to walk a list of emails
  // (each attempt otherwise answers "does this account exist?" in one call),
  // and so an unbounded number of accounts can't be created on a whim.
  const key = await emailKey(email);
  const rl = await rateLimit("signup", key, 5, 60 * 60 * 1000);
  if (!rl.allowed) return fail(429, "Too many sign-up attempts for that address. Try again later.");

  const pw = await hashPassword(b.password);
  const id = randomId(12);

  // onlyIfNew: the existence check and the write are one atomic operation, so
  // two simultaneous signups for one address can't both succeed. The
  // duplicate case is reported without confirming anything to an
  // unauthenticated caller who was merely guessing.
  const claimed = await writeJSONIf("users", key,
    { id, email, pw, createdAt: Date.now(), failed: 0, lockedUntil: 0 }, null);
  if (!claimed) {
    return fail(409, "That email can't be used to create an account. If it's yours, sign in or reset your password.");
  }

  const profile = {
    id, email, name, role,
    createdAt: Date.now(),
    tokenEpoch: 1,    // bumped on password change so old tokens stop working
    links: [],        // [{ id, role: 'parent'|'child', name, since }]
    groups: []        // [groupId]
  };
  await writeJSON("profiles", id, profile);

  const token = await signToken({ sub: id, role, epoch: 1 });
  return ok({ token, user: publicUser(profile) });
}

async function login(req) {
  const b = await body(req);
  const email = normalizeEmail(b.email);
  if (!validEmail(email) || !b.password) return fail(400, "Enter your email and password.");

  const key = await emailKey(email);
  const rec = await readJSON("users", key);

  // Same response either way so the endpoint can't be used to enumerate emails.
  const generic = () => fail(401, "That email and password don't match.");
  if (!rec) {
    await hashPassword(String(b.password));   // keep timing comparable
    return generic();
  }

  // Lockout is reported with the same 401 as a wrong password. A distinct
  // 429 was an account oracle: eight wrong guesses returning "too many
  // attempts" meant the address was real, while 401 meant it wasn't.
  if (rec.lockedUntil && rec.lockedUntil > Date.now()) {
    await hashPassword(String(b.password));   // keep timing comparable
    return generic();
  }

  const good = await verifyPassword(b.password, rec.pw);
  if (!good) {
    // Atomic. The old read-modify-write meant N parallel wrong guesses all
    // read failed=0 and all wrote failed=1, so the limit never tripped and
    // brute force was effectively unlimited.
    await updateJSON("users", key, (cur) => {
      if (!cur) return undefined;
      const failed = (cur.failed || 0) + 1;
      if (failed >= MAX_FAILED_LOGINS) return { ...cur, failed: 0, lockedUntil: Date.now() + LOCKOUT_MS };
      return { ...cur, failed };
    });
    return generic();
  }

  if (rec.failed || rec.lockedUntil) {
    await updateJSON("users", key, (cur) => (cur ? { ...cur, failed: 0, lockedUntil: 0 } : undefined));
  }

  const profile = await readJSON("profiles", rec.id);
  // Leaking that the user record exists but the profile doesn't tells an
  // attacker the address is registered. Same generic answer.
  if (!profile) {
    console.error("[login] profile blob missing for user", rec.id);
    return generic();
  }

  const token = await signToken({ sub: rec.id, role: profile.role, epoch: Number(profile.tokenEpoch || 0) });
  return ok({ token, user: publicUser(profile) });
}

/**
 * Whether this account runs the deploy, and may see its configuration.
 *
 * There is no admin role in the product, and inventing one would put a
 * privilege boundary in the data where anybody who can write a profile could
 * cross it. This reads a single environment variable instead: only whoever
 * can set Netlify env vars can name the operator, and with ADMIN_EMAIL unset
 * nobody is one — the safe default, at the cost of the deploy owner having to
 * set it before the diagnostics answer them in full.
 */
function isOperator(user) {
  const admin = normalizeEmail(process.env.ADMIN_EMAIL || "");
  if (!admin) return false;
  return normalizeEmail(user && user.email) === admin;
}

function publicUser(p) {
  return { id: p.id, email: p.email, name: p.name, role: p.role, links: p.links || [], groups: p.groups || [] };
}

/* ---------------------------------------------------- F098 password reset */

const RESET_TTL_MS = 30 * 60 * 1000;   // 30 minutes

/**
 * The origin used to build emailed links.
 *
 * This used to fall back to `new URL(req.url).origin`, which in Netlify
 * Functions is derived from the inbound Host header. With SITE_URL unset, a
 * request carrying a spoofed Host produced a genuine Scholar password-reset
 * email whose button pointed at the attacker — one click from full account
 * takeover. There is no safe fallback for that, so a deploy without SITE_URL
 * refuses to send links rather than sending poisoned ones.
 */
function siteOrigin() {
  const configured = process.env.SITE_URL;
  if (!configured) {
    throw { status: 503, message: "SITE_URL isn't set on this deploy, so password-reset links can't be built safely. Set it in the Netlify environment." };
  }
  try {
    const u = new URL(configured);
    if (u.protocol !== "https:" && u.hostname !== "localhost") {
      throw { status: 503, message: "SITE_URL must be an https:// URL." };
    }
    return u.origin;
  } catch (e) {
    if (e && e.status) throw e;
    throw { status: 503, message: "SITE_URL isn't a valid URL." };
  }
}

/**
 * GET /api/email-health[?probe=1]
 *
 * Answers "why didn't the email arrive" without needing the Netlify function
 * logs. Requires a session, because ?probe=1 sends a real message and an
 * anonymous trigger would be a free spam relay.
 *
 * What it *shows* depends on who is asking. The sender address, the key's
 * length and shape, whether SITE_URL is set and the provider's verbatim
 * rejection are deployment configuration: useful to whoever runs this deploy,
 * and a free reconnaissance report for anyone else who signs up. Ordinary
 * accounts get the two facts the UI needs — can this deploy send, and can it
 * reach me — and a probe that says whether the message went out.
 */
async function emailHealth(req, user) {
  const key = process.env.RESEND_API_KEY || "";
  const from = fromAddress();
  const operator = isOperator(user);

  const out = {
    configured: emailConfigured(),
    deliverable: emailDeliverable(),
    operator
  };

  if (operator) {
    Object.assign(out, {
      keyPresent: !!key,
      keyLength: key.length,
      keyLooksTrimmed: key === key.trim(),
      keyPrefixOk: key.startsWith("re_"),
      from,
      usingSandboxSender: from === SANDBOX_FROM,
      siteUrlSet: !!process.env.SITE_URL
    });
    if (!out.configured) {
      out.diagnosis = "RESEND_API_KEY is not set in this deploy's environment.";
    } else if (out.usingSandboxSender) {
      out.diagnosis = "EMAIL_FROM is unset, so mail goes out from " + SANDBOX_FROM + ". Resend only " +
        "delivers from that address to the API key owner's own email — every other recipient is " +
        "rejected 403. Verify a domain in Resend, then set EMAIL_FROM to an address on it.";
    } else if (!out.keyPrefixOk) {
      out.diagnosis = "RESEND_API_KEY doesn't start with 're_', which Resend keys do. Check for a truncated paste.";
    } else {
      out.diagnosis = "Configuration looks right. Add ?probe=1 to send a real test message to your own address.";
    }
  } else if (!out.configured) {
    out.diagnosis = "Email isn't set up on this deploy yet.";
  } else if (!out.deliverable) {
    out.diagnosis = "Email is only half set up on this deploy, so messages may not reach you.";
  } else {
    out.diagnosis = "Email is set up. Add ?probe=1 to send yourself a test message.";
  }

  const url = new URL(req.url);
  if (url.searchParams.get("probe") === "1") {
    const to = user.email;
    if (!to) {
      out.probe = { ok: false, error: "This account has no email address on file." };
    } else {
      // A probe sends real mail. Without a limit, one signed-in account could
      // loop this endpoint and burn the deploy's Resend quota — or its
      // sending reputation — a message at a time.
      const limit = await rateLimit("emailprobe", user.id, 5, 60 * 60 * 1000);
      if (!limit.allowed) {
        out.probe = { ok: false, error: "You've sent five test messages this hour. Try again later." };
        return ok(out);
      }
      const r = await sendEmail({
        to,
        subject: "Scholar email test",
        html: layout("Email is working", "<p>This is a test message from your Scholar deploy. " +
          "If you're reading it, password resets and weekly digests can reach you.</p>")
      }).catch((e) => ({ sent: false, reason: "exception", detail: String(e && e.message || e) }));
      if (r.sent) {
        out.probe = operator ? { ok: true, to, from: r.from } : { ok: true, to };
      } else if (operator) {
        out.probe = { ok: false, to, status: r.status, error: r.detail || r.reason, hint: r.hint || "" };
      } else {
        // The provider's own text names the sending domain and the reason it
        // was refused; that's the deploy's business, not a signed-up stranger's.
        out.probe = { ok: false, to, error: "That test message couldn't be sent." };
      }
    }
  }

  return ok(out);
}

async function forgotPassword(req) {
  const b = await body(req);
  const email = normalizeEmail(b.email);
  // Same response whether or not the account exists, so this endpoint
  // can't be used to check who has a Scholar account.
  const generic = () => ok({ sent: true });

  // Deployment-level problems are checked *before* the account lookup and
  // reported for every address alike, so saying "email isn't configured"
  // reveals nothing about who has an account. Previously this returned
  // {sent:true} no matter what happened, so a deploy that could not send a
  // single email looked identical to one that just had.
  if (!emailConfigured()) {
    return fail(503, "Email isn't configured on this deploy — set RESEND_API_KEY in the Netlify environment.");
  }
  if (!emailDeliverable()) {
    return fail(503, "Email is only half-configured: EMAIL_FROM is unset, so mail would be sent from " +
      "Resend's sandbox address, which can only reach the API key owner. Verify a domain in Resend and set EMAIL_FROM.");
  }

  if (!validEmail(email)) return generic();

  const key = await emailKey(email);

  // Without this, `while true; do curl -X POST /api/auth/forgot ...; done`
  // sent one real email per request to any known address — a mail bomb
  // delivered from your own verified domain, plus an unbounded pile of
  // passwordResets blobs. Keyed on the hashed address, so the limit follows
  // the target rather than the attacker's IP.
  const rl = await rateLimit("forgot", key, 3, 60 * 60 * 1000);
  if (!rl.allowed) return generic();   // still generic: no existence signal

  const rec = await readJSON("users", key);
  if (!rec) return generic();

  const profile = await readJSON("profiles", rec.id);
  const token = randomId(24);
  await writeJSON("passwordResets", token, { userKey: key, userId: rec.id, expiresAt: Date.now() + RESET_TTL_MS });

  // ?resetToken=... (not a hash route) — same pattern as the existing
  // ?join=CODE group-invite link, read once at boot in js/app.js.
  const resetUrl = `${siteOrigin()}/?resetToken=${encodeURIComponent(token)}`;
  const result = await sendEmail({
    to: email,
    subject: "Reset your Scholar password",
    html: layout("Reset your password", `
      <p>Someone (hopefully you) asked to reset the password for this Scholar account${profile ? ", " + escapeHtml(profile.name) : ""}.</p>
      <p style="margin:24px 0"><a href="${resetUrl}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Reset password</a></p>
      <p style="color:#4b5568;font-size:.85rem">This link works once and expires in 30 minutes. If you didn't request this, ignore this email — your password hasn't changed.</p>
    `)
  }).catch((e) => {
    console.error("[forgotPassword] send failed", e);
    return { sent: false, reason: "exception", detail: String(e && e.message || e) };
  });

  // A per-account send failure still can't be reported specifically without
  // leaking whether the account exists, so it stays generic — but it is now
  // logged with the provider's own words, and /api/email-health reproduces
  // it on demand without any account involved.
  if (result && result.sent === false) {
    console.error("[forgotPassword] delivery failed", result.status || "", result.detail || "", result.hint || "");
  }

  return generic();
}

async function resetPassword(req) {
  const b = await body(req);
  const token = String(b.token || "");
  // Blobs rejects an empty key, a key starting with "/", and anything over
  // 600 bytes by throwing — which reached the generic 500 handler. A missing
  // or absurd token is a 400, not a server error.
  if (!validBlobKey(token)) return fail(400, "That reset link is invalid or has expired.");

  const rec = await readJSON("passwordResets", token, null);
  if (!rec || rec.expiresAt < Date.now()) return fail(400, "That reset link is invalid or has expired.");

  const pwProblem = passwordProblem(b.password);
  if (pwProblem) return fail(400, pwProblem);

  const user = await readJSON("users", rec.userKey);
  if (!user) return fail(404, "That account no longer exists.");

  user.pw = await hashPassword(b.password);
  user.failed = 0;
  user.lockedUntil = 0;
  await writeJSON("users", rec.userKey, user);

  // Retire every session minted before now. Without this, resetting your
  // password after a token was stolen changed nothing for up to 30 days.
  await updateJSON("profiles", rec.userId, (cur) =>
    (cur ? { ...cur, tokenEpoch: Number(cur.tokenEpoch || 0) + 1 } : undefined));

  await remove("passwordResets", token);
  return ok({ reset: true });
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ----------------------------------------------------------------- sync -- */

async function pullState(user) {
  const rec = await readJSON("state", user.id, { version: 0, data: null, updatedAt: 0 });
  return ok({ version: rec.version || 0, updatedAt: rec.updatedAt || 0, state: rec.data || null });
}

async function pushState(req, user) {
  const b = await body(req);
  // `typeof [] === "object"`, and an array here would be stored and handed
  // back to the client as its whole database.
  if (!b.state || typeof b.state !== "object" || Array.isArray(b.state)) {
    return fail(400, "Missing state.");
  }

  // Measured in UTF-8 bytes, not UTF-16 code units: the old length check let
  // a payload of multi-byte characters through at roughly 3x the stated cap.
  const size = byteLength(JSON.stringify(b.state));
  if (size > MAX_STATE_BYTES) return fail(413, "Your data is too large to sync (over 5 MB).");

  const base = Number(b.baseVersion || 0);

  // Optimistic concurrency, enforced at the storage layer.
  //
  // This used to read, compare, then write with nothing tying the three
  // together, so two devices sitting at the same baseVersion both passed the
  // check and both wrote — one device's entire database silently gone. Worse,
  // both then believed they were current, so no conflict was ever raised
  // again and the loss was permanent and invisible. The conditional write
  // below makes the second writer lose the race and get a 409 instead.
  //
  // `b.force` used to skip the check entirely. A client-supplied flag that
  // disables concurrency control is not a safety valve, it is the bug: any
  // caller could overwrite another device's data by sending force:true. It is
  // no longer honoured. A real conflict is resolved by the client merging and
  // pushing at the new version.
  let conflict = null;
  const stored = await updateJSON("state", user.id, (cur) => {
    const rec = cur || { version: 0, data: null, updatedAt: 0 };
    if (rec.version && base !== rec.version) {
      conflict = rec;
      return undefined;                       // abort without writing
    }
    return { version: (rec.version || 0) + 1, data: b.state, updatedAt: Date.now() };
  }, { fallback: { version: 0, data: null, updatedAt: 0 } });

  if (conflict) {
    return json({
      error: "conflict",
      version: conflict.version,
      updatedAt: conflict.updatedAt,
      state: conflict.data
    }, 409);
  }

  // F100 — the only point at which the server observes a change, so it is
  // where a delivery can be fired. Awaited rather than left dangling: a
  // request-scoped function may be frozen the moment it responds, which would
  // cut an in-flight delivery off mid-send. The cost is bounded by the 4s
  // per-hook timeout, and only for accounts that registered one.
  if (Array.isArray(user.webhooks) && user.webhooks.length) {
    try {
      await deliverWebhooks(user, "state.updated", {
        version: stored.version,
        updatedAt: stored.updatedAt,
        userId: user.id
      });
    } catch (e) {
      console.error("[webhooks] delivery pass failed", e);
    }
  }

  return ok({ version: stored.version, updatedAt: stored.updatedAt });
}

/* ---------------------------------------------------------------- links -- */

async function mintLinkCode(user) {
  if (user.role !== "student") return fail(403, "Only a student account can create a link code.");
  const code = randomCode(6);
  await writeJSON("links", code, { studentId: user.id, createdAt: Date.now(), expiresAt: Date.now() + 86400000 });
  return ok({ code, expiresIn: 86400 });
}

async function redeemLinkCode(req, user) {
  const b = await body(req);
  const code = String(b.code || "").trim().toUpperCase();
  // joinGroup validates the key shape and limits guesses; this route did
  // neither, and it is the more dangerous of the two. A link code is also six
  // characters, and redeeming one makes the caller a *guardian*: live
  // location, check-in requests, notes, focus windows. Unlimited guessing
  // against that is a worse deal than unlimited guessing at a study group.
  if (!validBlobKey(code)) return fail(400, "Enter a link code.");

  const guessLimit = await rateLimit("linkcode", user.id, 10, 60 * 60 * 1000);
  if (!guessLimit.allowed) {
    return fail(429, "Too many link-code attempts. Try again in an hour.");
  }

  const rec = await readJSON("links", code);
  if (!rec) return fail(404, "That code isn't valid.");
  if (rec.expiresAt && rec.expiresAt < Date.now()) {
    await remove("links", code);
    return fail(410, "That code has expired — ask for a new one.");
  }
  if (rec.studentId === user.id) return fail(400, "You can't link to yourself.");

  // mintLinkCode refuses to issue a code to a student; redeeming had no role
  // check at all, so a second student who got hold of a code became a
  // *guardian* — able to read live location, request check-ins, send notes
  // and propose focus windows, all of which authorize purely on the link.
  if (user.role === "student") {
    return fail(403, "Link codes connect a parent or guardian to a student account. " +
      "This is a student account — ask them to share with your guardian's account instead.");
  }

  const student = await readJSON("profiles", rec.studentId);
  if (!student) return fail(404, "That student account no longer exists.");

  // Conditional, like the student's side below: redeeming two codes at once
  // otherwise drops one of the two children off the guardian's list.
  await updateJSON("profiles", user.id, (cur) => {
    if (!cur) return undefined;
    if ((cur.links || []).some((l) => l.id === student.id)) return undefined;
    return { ...cur, links: (cur.links || []).concat([{ id: student.id, role: "child", name: student.name, since: Date.now() }]) };
  });
  await updateJSON("profiles", student.id, (cur) => {
    if (!cur) return undefined;
    if ((cur.links || []).some((l) => l.id === user.id)) return undefined;
    return { ...cur, links: (cur.links || []).concat([{ id: user.id, role: "parent", name: user.name, since: Date.now() }]) };
  });

  await remove("links", code);   // single use
  return ok({ linked: { id: student.id, name: student.name } });
}

async function listChildren(user) {
  const kids = (user.links || []).filter((l) => l.role === "child");
  const out = [];
  for (const k of kids) {
    const loc = await readJSON("locations", k.id, null);
    const events = await readJSON("locationEvents", k.id, []);   // F069
    out.push({
      id: k.id, name: k.name, since: k.since,
      status: loc ? loc.status : null,
      summary: loc ? loc.summary : null,
      updatedAt: loc ? loc.at : null,
      events: events.slice(0, 5)
    });
  }
  return ok({ children: out });
}

async function listParents(user) {
  return ok({ parents: (user.links || []).filter((l) => l.role === "parent") });
}

async function unlink(user, otherId) {
  // Without this check any authenticated caller could name any user id — ids
  // are visible to every groupmate — and trigger a full read-modify-write of
  // that stranger's profile, dropping whatever they were saving at the time.
  const linked = (user.links || []).some((l) => l.id === otherId);
  if (!linked) return fail(404, "You aren't linked to that account.");

  await updateJSON("profiles", user.id, (cur) =>
    cur ? { ...cur, links: (cur.links || []).filter((l) => l.id !== otherId) } : undefined);

  // Conditional so an unlink can't clobber a concurrent change to the other
  // person's profile, and scoped to removing exactly one entry.
  await updateJSON("profiles", otherId, (other) => {
    if (!other) return undefined;
    return { ...other, links: (other.links || []).filter((l) => l.id !== user.id) };
  });
  return ok({ unlinked: otherId });
}

/* ---------------------------------------------------------------- peers -- */
// F053 — real friend requests, replacing locally-stored classmates that the
// other person never agreed to. Mirrors the parent/child `links` pattern:
// each profile keeps its own view of the relationship (`peers`), so an
// accept/decline is a two-write, symmetric update rather than a shared row.

const MAX_PEERS = 200;

async function requestFriend(req, user) {
  const b = await body(req);
  const email = normalizeEmail(b.email || "");
  if (!validEmail(email)) return fail(400, "Enter a valid email address.");
  if (email === user.email) return fail(400, "You can't friend yourself.");

  // This route answers a question about an address the caller supplies, so
  // without a limit it is an account-enumeration tool: feed it a list and
  // sort the replies. The limit doesn't make enumeration impossible, it makes
  // it cost 20 addresses an hour instead of thousands a minute.
  const limit = await rateLimit("friendreq", user.id, 20, 60 * 60 * 1000);
  if (!limit.allowed) {
    return fail(429, "You've sent a lot of requests this hour. Try again later.");
  }

  if ((user.peers || []).length >= MAX_PEERS) {
    return fail(409, `You already have ${MAX_PEERS} connections and pending requests. Clear some first.`);
  }

  const key = await emailKey(email);
  const rec = await readJSON("users", key);
  const target = rec ? await readJSON("profiles", rec.id) : null;

  // One reply for "no such account", "already connected" and "already
  // pending". Distinct answers told the caller which addresses have Scholar
  // accounts, and 409-vs-404 told them which of *those* they had already
  // reached — free contact-graph reconnaissance for anyone with a word list.
  // Nothing here reveals the target's name either; the requester learns it
  // only if the request is accepted.
  const vague = () => ok({ requested: true });

  if (!target) return vague();
  if ((user.peers || []).some((p) => p.id === target.id)) return vague();

  const now = Date.now();
  // Each side is written conditionally and independently, because these are
  // two different people's profiles: a plain write of `target` here would
  // clobber whatever that person saved between our read and our write —
  // including a friend request they accepted a second ago.
  const mine = await updateJSON("profiles", user.id, (cur) => {
    if (!cur) return undefined;
    const peers = cur.peers || [];
    if (peers.some((p) => p.id === target.id)) return undefined;
    if (peers.length >= MAX_PEERS) return undefined;
    return { ...cur, peers: peers.concat([{ id: target.id, name: target.name, status: "pending-out", since: now }]) };
  });
  // Only touch the recipient once our own side landed, so a failure can't
  // leave them holding a request that doesn't exist on the sender's list.
  if (mine && (mine.peers || []).some((p) => p.id === target.id)) {
    await updateJSON("profiles", target.id, (cur) => {
      if (!cur) return undefined;
      const peers = cur.peers || [];
      if (peers.some((p) => p.id === user.id)) return undefined;
      if (peers.length >= MAX_PEERS) return undefined;
      return { ...cur, peers: peers.concat([{ id: user.id, name: user.name, status: "pending-in", since: now }]) };
    });
  }
  return vague();
}

async function respondFriend(req, user) {
  const b = await body(req);
  const otherId = String(b.id || "");
  const accept = !!b.accept;
  user.peers = user.peers || [];
  const mine = user.peers.find((p) => p.id === otherId && p.status === "pending-in");
  if (!mine) return fail(404, "No pending request from that person.");

  // Both sides conditionally, for the same reason as requestFriend: these
  // are two people's live profiles, and a straight write of either one
  // discards whatever the other person changed in the meantime.
  if (!accept) {
    await updateJSON("profiles", user.id, (cur) =>
      cur ? { ...cur, peers: (cur.peers || []).filter((p) => p.id !== otherId) } : undefined);
    await updateJSON("profiles", otherId, (cur) =>
      cur ? { ...cur, peers: (cur.peers || []).filter((p) => p.id !== user.id) } : undefined);
    return ok({ declined: otherId });
  }

  await updateJSON("profiles", user.id, (cur) => {
    if (!cur) return undefined;
    return { ...cur, peers: (cur.peers || []).map((p) => (p.id === otherId ? { ...p, status: "accepted" } : p)) };
  });
  await updateJSON("profiles", otherId, (cur) => {
    if (!cur) return undefined;
    return { ...cur, peers: (cur.peers || []).map((p) => (p.id === user.id ? { ...p, status: "accepted" } : p)) };
  });
  return ok({ accepted: otherId });
}

async function listFriends(user) {
  return ok({ peers: user.peers || [] });
}

async function removeFriend(user, otherId) {
  const known = (user.peers || []).some((p) => p.id === otherId);
  if (!known) return fail(404, "That isn't one of your connections.");

  await updateJSON("profiles", user.id, (cur) =>
    cur ? { ...cur, peers: (cur.peers || []).filter((p) => p.id !== otherId) } : undefined);
  await updateJSON("profiles", otherId, (other) => {
    if (!other) return undefined;
    return { ...other, peers: (other.peers || []).filter((p) => p.id !== user.id) };
  });
  return ok({ removed: otherId });
}

/* ------------------------------------------------ per-student list stores --
   checkins, guardianNotes and focusWindows are each a single blob under the
   *student's* id that both sides write: a guardian appends, the student marks
   items answered. Read-modify-write with a plain writeJSON therefore drops
   whichever of the two lands second — a parent's note posted while the
   student is answering a check-in simply vanishes, with a 200 either way.
   Both operations go through the conditional path instead.
   ------------------------------------------------------------------------ */

/** Append to a capped, newest-first per-student list, conditionally. */
async function prependCapped(storeName, key, item, cap) {
  await updateJSON(storeName, key, (cur) => {
    const list = Array.isArray(cur) ? cur : [];
    return [item].concat(list).slice(0, cap);
  }, { fallback: [] });
}

/**
 * Change one item in a per-student list, conditionally.
 * `mutate` gets the matching item and may return false to abort the write.
 * Throws {status,message} when nothing matches, so callers stay one-liners.
 */
async function mutateListItem(storeName, key, match, mutate, missing) {
  let found = false;
  await updateJSON(storeName, key, (cur) => {
    const list = Array.isArray(cur) ? cur : [];
    const i = list.findIndex(match);
    if (i < 0) { found = false; return undefined; }
    found = true;
    const next = list.slice();
    const patched = mutate({ ...next[i] });
    if (patched === false) return undefined;
    next[i] = patched;
    return next;
  }, { fallback: [] });
  if (!found) throw { status: 404, message: missing };
}

/* ------------------------------------------------------ guardian check-ins */
// F068 — a parent asks, the student taps once to confirm they're okay.
// F071 — a short reminder from a guardian the student sees in-app.

async function requestCheckin(req, user) {
  const b = await body(req);
  const studentId = String(b.studentId || "");
  const linked = (user.links || []).some((l) => l.id === studentId && l.role === "child");
  if (!linked) return fail(403, "You aren't linked to that student.");

  await prependCapped("checkins", studentId,
    { id: randomId(8), fromId: user.id, fromName: user.name, at: Date.now(), respondedAt: null }, 30);
  return ok({ requested: true });
}

async function listCheckins(user) {
  const list = await readJSON("checkins", user.id, []);
  return ok({ checkins: list });
}

async function respondCheckin(req, user) {
  const b = await body(req);
  const id = String(b.id || "");
  await mutateListItem("checkins", user.id, (c) => c.id === id,
    (c) => ({ ...c, respondedAt: Date.now() }), "That check-in request is gone.");
  return ok({ responded: true });
}

/* --------------------------------------------------------- F046 ics feed -- */
// The device that already builds the one-time .ics export (js/ics.js) also
// pushes that same text here — the server just stores and serves the last
// copy under an unguessable token, so there's exactly one place that knows
// how to turn Scholar data into iCalendar, and it isn't this file.

/* ============================================================== F100 API == */

/**
 * Personal API tokens.
 *
 * Minted server-side and stored in Blobs under a SHA-256 of the token, so
 * redeeming one is still a direct lookup with no session involved, but the
 * secret itself is never written down anywhere. The full token is returned
 * exactly once, at mint time; afterwards only a prefix is shown.
 *
 * The profile index used to carry `key: <the token>` so revoke could find the
 * blob to delete — which meant the plaintext token sat in the profile, read
 * back by every route that loads a profile, and directly contradicted the
 * claim above that it was unrecoverable. The index now stores the same hash
 * the store is keyed by: enough to revoke, useless to an attacker.
 */
async function listApiTokens(user) {
  const index = Array.isArray(user.apiTokens) ? user.apiTokens : [];
  return ok({
    tokens: index.map((t) => ({
      id: t.id, label: t.label, hint: t.hint,
      createdAt: t.createdAt, lastUsedAt: t.lastUsedAt || null
    })),
    max: MAX_API_TOKENS
  });
}

async function mintApiToken(req, user) {
  const b = await body(req);
  const label = String(b.label || "").trim().slice(0, 60) || "Untitled token";

  const index = Array.isArray(user.apiTokens) ? user.apiTokens : [];
  if (index.length >= MAX_API_TOKENS) {
    return fail(409, `You already have ${MAX_API_TOKENS} tokens. Revoke one first.`);
  }

  const token = API_TOKEN_PREFIX + randomId(32);
  const id = randomId(8);
  const lookup = await tokenLookupKey(token);
  const entry = {
    id, label,
    hint: token.slice(0, API_TOKEN_PREFIX.length + 6) + "…",
    createdAt: Date.now()
  };

  await writeJSON("apiTokens", lookup, {
    userId: user.id,
    id,
    label,
    epoch: Number(user.tokenEpoch || 0),
    createdAt: Date.now(),
    lastUsedAt: null
  });

  await updateJSON("profiles", user.id, (cur) => {
    if (!cur) return undefined;
    const list = Array.isArray(cur.apiTokens) ? cur.apiTokens : [];
    return { ...cur, apiTokens: list.concat([{ ...entry, lookup }]) };
  });

  // The only time the caller ever sees it.
  return ok({ token, entry });
}

async function revokeApiToken(user, id) {
  const index = Array.isArray(user.apiTokens) ? user.apiTokens : [];
  const hit = index.find((t) => t.id === id);
  if (!hit) return fail(404, "No such token.");

  // `key` is the legacy plaintext field; tokens minted before hashing landed
  // are still revocable, and revoking one removes the plaintext record too.
  if (hit.lookup) await remove("apiTokens", hit.lookup);
  if (hit.key) await remove("apiTokens", hit.key);
  await updateJSON("profiles", user.id, (cur) => {
    if (!cur) return undefined;
    return { ...cur, apiTokens: (cur.apiTokens || []).filter((t) => t.id !== id) };
  });
  return ok({ revoked: id });
}

/* ------------------------------------------------------------- webhooks -- */

/**
 * Rejects anything that isn't a public https endpoint.
 *
 * An outbound POST to a caller-supplied URL is a server-side request forgery
 * primitive: without this, a webhook pointed at 169.254.169.254 or
 * http://localhost:8888 would have the function fetch internal endpoints and
 * report back. This is the first thing a security tester probes.
 *
 * The screening itself now lives in _lib/urlguard.js, because "add this from
 * a link" needs exactly the same check and a duplicated security check is one
 * that drifts — the copy that gets fixed is whichever one someone was looking
 * at. Webhooks stay https-only: the URL is stored and replayed rather than
 * followed once by the person who typed it.
 */
function webhookUrlProblem(raw) {
  return urlProblem(raw, { allowHttp: false });
}

async function listWebhooks(user) {
  const hooks = Array.isArray(user.webhooks) ? user.webhooks : [];
  return ok({
    webhooks: hooks.map((h) => ({
      id: h.id, url: h.url, events: h.events, createdAt: h.createdAt,
      lastDeliveryAt: h.lastDeliveryAt || null,
      lastStatus: h.lastStatus || null,
      lastError: h.lastError || null
    })),
    max: MAX_WEBHOOKS,
    events: WEBHOOK_EVENTS
  });
}

async function addWebhook(req, user) {
  const b = await body(req);
  const url = String(b.url || "").trim();
  const problem = webhookUrlProblem(url);
  if (problem) return fail(400, problem);

  const events = Array.isArray(b.events)
    ? b.events.filter((e) => WEBHOOK_EVENTS.includes(e))
    : [];
  if (!events.length) return fail(400, `Choose at least one event: ${WEBHOOK_EVENTS.join(", ")}.`);

  const hooks = Array.isArray(user.webhooks) ? user.webhooks : [];
  if (hooks.length >= MAX_WEBHOOKS) return fail(409, `You already have ${MAX_WEBHOOKS} webhooks.`);

  // Per-hook secret, combined with SCHOLAR_SECRET when signing, so a receiver
  // can verify a delivery really came from this deploy and this hook.
  const hook = {
    id: randomId(8),
    url,
    events,
    secret: randomId(24),
    createdAt: Date.now(),
    lastDeliveryAt: null,
    lastStatus: null,
    lastError: null
  };

  await updateJSON("profiles", user.id, (cur) => {
    if (!cur) return undefined;
    const list = Array.isArray(cur.webhooks) ? cur.webhooks : [];
    if (list.length >= MAX_WEBHOOKS) return undefined;
    return { ...cur, webhooks: list.concat([hook]) };
  });

  return ok({ webhook: hook });   // secret shown so the receiver can verify
}

async function removeWebhook(user, id) {
  const hooks = Array.isArray(user.webhooks) ? user.webhooks : [];
  if (!hooks.some((h) => h.id === id)) return fail(404, "No such webhook.");
  await updateJSON("profiles", user.id, (cur) => {
    if (!cur) return undefined;
    return { ...cur, webhooks: (cur.webhooks || []).filter((h) => h.id !== id) };
  });
  return ok({ removed: id });
}

/**
 * Delivers one event to every hook subscribed to it.
 *
 * Netlify functions are request-scoped: there is no queue and no worker, so
 * this is a single attempt with a short timeout, fired inline while the
 * request that caused the change is still running. Failures are recorded on
 * the hook for the owner to see rather than retried — the ROADMAP line
 * promising "delivery retries" overstated what this architecture supports,
 * and it has been corrected rather than faked.
 */
async function deliverWebhooks(user, event, payload) {
  const hooks = (Array.isArray(user.webhooks) ? user.webhooks : []).filter((h) => (h.events || []).includes(event));
  if (!hooks.length) return;

  const results = await Promise.all(hooks.map(async (h) => {
    const bodyText = JSON.stringify({ event, at: Date.now(), data: payload });
    let signature = "";
    try {
      signature = await hmacHex(process.env.SCHOLAR_SECRET + ":" + h.secret, bodyText);
    } catch (e) {
      return { id: h.id, lastDeliveryAt: Date.now(), lastStatus: null, lastError: "Couldn't sign the payload." };
    }

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const res = await fetch(h.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Scholar-Webhook/1",
          "X-Scholar-Event": event,
          "X-Scholar-Signature": "sha256=" + signature
        },
        body: bodyText,
        signal: ctl.signal,
        redirect: "error"      // a redirect could point back at a private host
      });
      return {
        id: h.id, lastDeliveryAt: Date.now(), lastStatus: res.status,
        lastError: res.ok ? null : `Endpoint responded ${res.status}`
      };
    } catch (e) {
      return {
        id: h.id, lastDeliveryAt: Date.now(), lastStatus: null,
        lastError: e.name === "AbortError" ? "Timed out after 4s" : String(e.message || e).slice(0, 140)
      };
    } finally {
      clearTimeout(timer);
    }
  }));

  await updateJSON("profiles", user.id, (cur) => {
    if (!cur) return undefined;
    const byId = new Map(results.map((r) => [r.id, r]));
    return {
      ...cur,
      webhooks: (cur.webhooks || []).map((h) => (byId.has(h.id) ? { ...h, ...byId.get(h.id) } : h))
    };
  });
}

/** Hex HMAC-SHA256, for the webhook signature header. */
async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* --------------------------------------------------------- /v1 read API -- */

/**
 * Read-only, deliberately.
 *
 * Writes would have to reconcile with the optimistic-concurrency versioning
 * that pushState uses, which is a second design problem rather than a longer
 * endpoint list — so the limit is documented rather than left to be
 * discovered. Everything is served from the state blob the user's own devices
 * already sync.
 */
const V1_RESOURCES = ["me", "classes", "assignments", "schedule", "grades"];

async function v1(user, resource, url) {
  // Validated before the state read, so an unknown resource answers 404
  // whether or not the account has synced anything. It used to fall through
  // to the "hasn't synced any data yet" 200 for an empty account and 404 for
  // a populated one — which made this endpoint a way to ask, per account,
  // whether it holds data, and made the API's own contract depend on state.
  if (!V1_RESOURCES.includes(resource)) {
    return fail(404, `Unknown resource. Try: ${V1_RESOURCES.join(", ")}.`);
  }

  // Reads are cheap but not free, and an API token is a long-lived credential
  // meant for scripts — the shape of client most likely to poll in a loop.
  const limit = await rateLimit("v1", user.id, 600, 60 * 60 * 1000);
  if (!limit.allowed) {
    return fail(429, "You've made too many API requests this hour. The limit is 600.");
  }

  const rec = await readJSON("state", user.id, null);
  const db = (rec && rec.data) || null;

  if (resource === "me") {
    return ok({
      id: user.id, name: user.name, email: user.email, role: user.role,
      syncedAt: rec ? rec.updatedAt : null, version: rec ? rec.version : 0
    });
  }
  if (!db) return ok({ [resource]: [], syncedAt: null, note: "This account hasn't synced any data yet." });

  const pageSize = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 200));
  const list = (arr) => (Array.isArray(arr) ? arr : []).slice(0, pageSize);

  switch (resource) {
    case "classes":
      return ok({ classes: list(db.classes).map((c) => ({
        id: c.id, name: c.name, code: c.code || null, room: c.room || null,
        credits: c.credits, color: c.color, days: c.days || [], periodId: c.periodId || null
      })), syncedAt: rec.updatedAt });

    case "assignments": {
      const status = url.searchParams.get("status");
      let rows = list(db.assignments);
      if (status) rows = rows.filter((a) => a.status === status);
      return ok({ assignments: rows.map((a) => ({
        id: a.id, title: a.title, classId: a.classId, due: a.due, status: a.status,
        points: a.points, earned: a.earned, graded: !!a.graded, type: a.type || null
      })), syncedAt: rec.updatedAt });
    }

    case "schedule":
      return ok({
        periods: list(db.periods).map((p) => ({ id: p.id, name: p.name, start: p.start, end: p.end })),
        terms: list(db.terms).map((t) => ({ id: t.id, name: t.name, start: t.start, end: t.end, current: !!t.current })),
        syncedAt: rec.updatedAt
      });

    case "grades":
      return ok({ grades: list(db.classes).map((c) => {
        const rows = (db.assignments || []).filter((a) => a.classId === c.id && a.graded && a.earned != null && a.points > 0);
        const earned = rows.reduce((n, a) => n + Number(a.earned || 0), 0);
        const possible = rows.reduce((n, a) => n + Number(a.points || 0), 0);
        return {
          classId: c.id, className: c.name, graded: rows.length,
          percent: possible ? Math.round((earned / possible) * 1000) / 10 : null
        };
      }), syncedAt: rec.updatedAt });

    /* istanbul ignore next — V1_RESOURCES is checked at the top. */
    default:
      return fail(404, `Unknown resource. Try: ${V1_RESOURCES.join(", ")}.`);
  }
}

async function pushIcsFeed(req, user) {
  const b = await body(req);
  const ics = String(b.ics || "");
  if (!ics.startsWith("BEGIN:VCALENDAR")) return fail(400, "That doesn't look like a calendar.");
  if (ics.length > 500000) return fail(413, "That calendar is too large to host.");

  let rec = await readJSON("icsTokens", user.id, null);
  if (!rec || !rec.token) { rec = { token: randomId(24) }; await writeJSON("icsTokens", user.id, rec); }
  await writeJSON("icsFeeds", rec.token, { ics, updatedAt: Date.now() });
  return ok({ token: rec.token });
}

async function getIcsFeed(token) {
  // A path segment like %2Fx is not decoded by URL.pathname, so it reached
  // Blobs verbatim and threw into the generic 500 handler.
  if (!validBlobKey(token)) return new Response("Not found", { status: 404, headers: CORS });
  const feed = await readJSON("icsFeeds", token, null);
  if (!feed) return new Response("Not found", { status: 404, headers: CORS });
  return new Response(feed.ics, {
    status: 200,
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-cache", ...CORS }
  });
}

/* --------------------------------------------------- F070 focus windows -- */
// A shared quiet period both sides agree to — a parent proposes it, the
// student can see it, agree to it, or decline, and can end it early once
// it's running. Nothing here enforces anything device-side; it's a shared
// agreement, not a lock.

async function proposeFocusWindow(req, user) {
  const b = await body(req);
  const studentId = String(b.studentId || "");
  const linked = (user.links || []).some((l) => l.id === studentId && l.role === "child");
  if (!linked) return fail(403, "You aren't linked to that student.");
  const startAt = Number(b.startAt) || Date.now();
  const endAt = Number(b.endAt) || 0;
  if (!endAt || endAt <= startAt) return fail(400, "End time has to be after the start time.");

  await prependCapped("focusWindows", studentId, {
    id: randomId(8), fromId: user.id, fromName: user.name,
    startAt, endAt, note: String(b.note || "").trim().slice(0, 200),
    status: "pending", createdAt: Date.now(), agreedAt: null, endedAt: null
  }, 30);
  return ok({ proposed: true });
}

async function listFocusWindows(user) {
  const list = await readJSON("focusWindows", user.id, []);
  return ok({ focusWindows: list });
}

async function respondFocusWindow(req, user) {
  const b = await body(req);
  const action = b.action === "decline" ? "declined" : "agreed";
  const id = String(b.id || "");
  await mutateListItem("focusWindows", user.id,
    (f) => f.id === id && f.status === "pending",
    (f) => ({ ...f, status: action, agreedAt: action === "agreed" ? Date.now() : f.agreedAt }),
    "That proposal is gone or already answered.");
  return ok({ status: action });
}

async function endFocusWindow(req, user) {
  const b = await body(req);
  const id = String(b.id || "");
  await mutateListItem("focusWindows", user.id,
    (f) => f.id === id && f.status === "agreed",
    (f) => ({ ...f, status: "ended", endedAt: Date.now() }),
    "That focus window isn't running.");
  return ok({ ended: true });
}

async function sendGuardianNote(req, user) {
  const b = await body(req);
  const studentId = String(b.studentId || "");
  const text = String(b.text || "").trim().slice(0, 500);
  if (!text) return fail(400, "Write something first.");
  const linked = (user.links || []).some((l) => l.id === studentId && l.role === "child");
  if (!linked) return fail(403, "You aren't linked to that student.");

  await prependCapped("guardianNotes", studentId,
    { id: randomId(8), fromId: user.id, fromName: user.name, text, at: Date.now(), read: false }, 50);
  return ok({ sent: true });
}

async function listGuardianNotes(user) {
  // Marking as read on fetch — the student just opened the list. Conditional,
  // because a guardian may be posting a new note at this exact moment and a
  // straight write-back of the list we read would delete it. The response
  // still shows what *this* read saw, so the flags the student is looking at
  // are the ones that were just written.
  const saved = await updateJSON("guardianNotes", user.id, (cur) => {
    const list = Array.isArray(cur) ? cur : [];
    if (!list.some((n) => !n.read)) return undefined;
    return list.map((n) => (n.read ? n : { ...n, read: true }));
  }, { fallback: [] });
  return ok({ notes: Array.isArray(saved) ? saved : [] });
}

/* ------------------------------------------------------------- location -- */

async function pushLocation(req, user) {
  const b = await body(req);
  const newPresence = b.status && b.status.presence;

  // F069 — fire an event on an actual on-campus <-> off-campus crossing,
  // not on every periodic status push (this fires far less often than
  // pushLocation itself gets called while the app is open).
  if (newPresence === "on-campus" || newPresence === "off-campus") {
    const prev = await readJSON("locations", user.id, null);
    const prevPresence = prev && prev.status && prev.status.presence;
    if (prevPresence && prevPresence !== newPresence &&
        (prevPresence === "on-campus" || newPresence === "on-campus")) {
      const events = await readJSON("locationEvents", user.id, []);
      events.unshift({ type: newPresence === "on-campus" ? "arrival" : "departure", at: Date.now() });
      await writeJSON("locationEvents", user.id, events.slice(0, 20));
    }
  }

  // `status` and `summary` used to be stored exactly as sent, with no size or
  // type checking at all. Two consequences: the blob grew without bound (the
  // client pushes on a timer), and the weekly parent digest interpolated
  // summary fields straight into HTML — so a student could put markup into
  // mail sent from your verified domain to their own parent, and a
  // wrong-typed `upcoming` crashed the scheduled run for *every* parent.
  await writeJSON("locations", user.id, {
    status: cleanStatus(b.status),
    summary: cleanSummary(b.summary),
    at: Date.now()
  });
  return ok({ at: Date.now() });
}

const str = (v, max) => (v == null ? "" : String(v)).slice(0, max || 120);
const num = (v, lo, hi) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, n));
};

function cleanStatus(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return {
    presence: ["on-campus", "off-campus", "unknown"].includes(raw.presence) ? raw.presence : "unknown",
    place: str(raw.place, 80),
    className: str(raw.className, 80),
    until: str(raw.until, 20)
  };
}

/**
 * Validates the shared summary without narrowing it.
 *
 * This is an allow-list, which means a field the client sends and this
 * function forgets is silently dropped — and the parent portal then renders
 * an em dash forever with no error anywhere. An earlier version of this
 * function did exactly that to `classes`, `gradeAlerts`, `studyWeek` and
 * `usageWeek`, quietly disabling per-class grade sharing (F065), the
 * grade-drop alerts, study time and screen time. Every field js/sync.js
 * pushLocation() sends is listed here; adding one there means adding it here.
 */
function cleanSummary(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const rows = (v, n) => (Array.isArray(v) ? v : []).slice(0, n)
    .filter((x) => x && typeof x === "object" && !Array.isArray(x));

  return {
    name: str(raw.name, 80),
    openAssignments: num(raw.openAssignments, 0, 9999) ?? 0,
    overdue: num(raw.overdue, 0, 9999) ?? 0,
    streak: num(raw.streak, 0, 100000) ?? 0,
    gpa: raw.gpa == null ? null : num(raw.gpa, 0, 6),
    attendance: raw.attendance == null ? null : num(raw.attendance, 0, 100),

    // Minutes. `studyWeek` is the name the parent portal and the weekly
    // digest both read; `studyMinutes` is accepted as an alias so an older
    // client that sends that name still populates the same figure.
    studyWeek: num(raw.studyWeek, 0, 100000) ?? num(raw.studyMinutes, 0, 100000) ?? 0,
    usageToday: num(raw.usageToday, 0, 100000) ?? 0,
    usageWeek: num(raw.usageWeek, 0, 1000000) ?? 0,

    upcoming: rows(raw.upcoming, 6)
      .map((u) => ({ title: str(u.title, 120), className: str(u.className, 80), due: str(u.due, 20) })),

    // Null rather than [] when grade sharing is off, so the portal can tell
    // "not shared" apart from "shared, but no classes".
    classes: raw.classes == null ? null : rows(raw.classes, 30)
      .map((c) => ({ name: str(c.name, 80), grade: num(c.grade, 0, 150) })),

    // F065 — every field is rendered, so every field is bounded.
    gradeAlerts: rows(raw.gradeAlerts, 20)
      .map((g) => ({
        classId: str(g.classId, 40),
        className: str(g.className, 80),
        delta: num(g.delta, -150, 150) ?? 0
      }))
  };
}

async function readLocation(user, studentId) {
  const linked = (user.links || []).some((l) => l.id === studentId && l.role === "child");
  if (!linked && studentId !== user.id) return fail(403, "You aren't linked to that student.");
  const loc = await readJSON("locations", studentId, null);
  return ok({ location: loc });
}

/* --------------------------------------------------------------- groups -- */

async function createGroup(req, user) {
  // Tighter than the global write ceiling because each group permanently
  // allocates two blobs and burns a six-character code from a finite space.
  // Twenty an hour is far past what any student does and far short of what
  // it takes to exhaust anything.
  const rl = await rateLimit("mkgroup", user.id, 20, 60 * 60 * 1000);
  if (!rl.allowed) return fail(429, "You've created a lot of groups. Try again in an hour.");

  const b = await body(req);
  const name = String(b.name || "").trim().slice(0, 60);
  if (!name) return fail(400, "Give the group a name.");

  const id = randomId(10);
  // Claim the join code conditionally rather than checking-then-writing: a
  // read followed by a write is exactly where two simultaneous creates both
  // see the code as free, and the second silently steals the first group's
  // code — after which one of the two is unjoinable and the other collects
  // strangers. writeJSONIf(..., null) is "only if this key doesn't exist".
  let code = null;
  for (let i = 0; i < 6; i++) {
    const candidate = randomCode(6);
    if (await writeJSONIf("codes", candidate, id, null)) { code = candidate; break; }
  }
  if (!code) return fail(503, "Couldn't allocate a join code — try again.");

  const group = {
    id, code, name, ownerId: user.id, createdAt: Date.now(),
    // F059 — the role travels with the membership, so the feed can mark a
    // teacher's post authoritative without a second lookup per item.
    members: [{ id: user.id, name: user.name, role: user.role || "student", joinedAt: Date.now() }],
    decks: [], feed: []
  };
  await writeJSON("groups", id, group);

  await updateJSON("profiles", user.id, (cur) => {
    if (!cur) return undefined;
    const groups = cur.groups || [];
    if (groups.includes(id)) return undefined;
    return { ...cur, groups: groups.concat([id]) };
  });

  return ok({ group: slimGroup(group) });
}

async function joinGroup(req, user) {
  const b = await body(req);
  const code = String(b.code || "").trim().toUpperCase();
  // joinGroup never checked for an empty code (redeemLinkCode did), so
  // `POST /api/groups/join {}` reached Blobs with "" and returned a 500.
  if (!validBlobKey(code)) return fail(400, "Enter a join code.");

  // Join codes are six characters from a 32-symbol alphabet — about 1.07e9
  // combinations, which is walkable with an unlimited guess rate. A hit gave
  // the attacker every shared note, every member's id and their busy blocks.
  const guessLimit = await rateLimit("joincode", user.id, 20, 60 * 60 * 1000);
  if (!guessLimit.allowed) {
    return fail(429, "Too many join attempts. Try again in an hour.");
  }

  const groupId = await readJSON("codes", code);
  if (!groupId) return fail(404, "No group with that code.");

  const group = await readJSON("groups", groupId);
  if (!group) return fail(404, "That group no longer exists.");

  // Conditional so two people joining at once can't drop each other, and so
  // a join can't clobber a concurrent post to the same group blob.
  let full = false;
  const saved = await updateJSON("groups", group.id, (cur) => {
    if (!cur) return undefined;
    if ((cur.members || []).some((m) => m.id === user.id)) return undefined;
    if ((cur.members || []).length >= 60) { full = true; return undefined; }
    return { ...cur, members: (cur.members || []).concat([{ id: user.id, name: user.name, role: user.role || "student", joinedAt: Date.now() }]) };
  });
  if (full) return fail(409, "That group is full.");

  await updateJSON("profiles", user.id, (cur) => {
    if (!cur) return undefined;
    const groups = cur.groups || [];
    if (groups.includes(group.id)) return undefined;
    return { ...cur, groups: groups.concat([group.id]) };
  });
  return ok({ group: slimGroup(saved || group) });
}

function slimGroup(g) {
  return {
    id: g.id, code: g.code, name: g.name, ownerId: g.ownerId,
    memberCount: g.members.length, deckCount: g.decks.length, feedCount: g.feed.length
  };
}

async function listGroups(user) {
  const out = [];
  for (const gid of user.groups || []) {
    const g = await readJSON("groups", gid);
    if (g) out.push(slimGroup(g));
  }
  return ok({ groups: out });
}

async function memberGroup(user, id) {
  const g = await readJSON("groups", id);
  if (!g) throw { status: 404, message: "Group not found." };
  const me = (g.members || []).find((m) => m.id === user.id);
  if (!me) throw { status: 403, message: "You're not a member of that group." };
  // Memberships created before F059 have no role. Fill it in from the live
  // profile so an existing group starts badging its teacher correctly
  // without a migration pass over every group blob.
  if (!me.role && user.role) me.role = user.role;
  return g;
}

async function getGroup(user, id) {
  const g = ensureGroupCollections(await memberGroup(user, id));
  return ok({
    group: {
      ...slimGroup(g),
      // F059 — role is part of the membership the client needs: it decides
      // whether the member list shows a teacher marker. This mapping is an
      // explicit whitelist, so a new field is invisible until added here.
      members: g.members.map((m) => ({ id: m.id, name: m.name, role: m.role || "student", joinedAt: m.joinedAt })),
      decks: g.decks.map((d) => ({
        id: d.id, name: d.name, cardCount: (d.cards || []).length,
        byName: d.byName, at: d.at
      })),
      // _raters (F060) is who-voted bookkeeping only — never leaves the server.
      feed: g.feed.slice(-80).map(({ _raters, ...f }) => f),
      tasks: g.tasks,
      availability: g.availability,
      partners: g.partners,
      tutoring: g.tutoring,
      // Note bodies can be long; the list carries metadata only and the full
      // text is fetched per-note on open.
      sharedNotes: g.sharedNotes.map(({ body: _b, ...n }) => ({ ...n, thanks: n.thanks.length })),
      challenges: g.challenges
    }
  });
}

/**
 * Membership check and a conditional read-modify-write of a group blob, in one.
 *
 * A group blob is the one thing in this system that many people write at
 * once, and every handler below used to do `memberGroup()` → mutate → plain
 * `writeJSON`. Two members acting in the same second each wrote a whole blob
 * built from their own stale snapshot, so one of the two changes disappeared
 * with a 200 — and it took the *rest* of that snapshot with it: a note shared
 * a moment earlier, a task someone just ticked off, even a member who joined
 * in between. Nothing surfaced; the group just quietly lost work.
 *
 * `mutate` receives the live group and edits it in place. Return `false` to
 * finish without writing (nothing changed), or throw `{status, message}` to
 * reject — the router turns that into the right response. It may run more
 * than once, on a fresh read each time, so it must not depend on anything
 * computed from an earlier attempt.
 */
async function updateGroup(user, id, mutate) {
  return await updateJSON("groups", id, (cur) => {
    if (!cur) throw { status: 404, message: "Group not found." };
    const g = ensureGroupCollections(cur);
    const me = (g.members || []).find((m) => m.id === user.id);
    if (!me) throw { status: 403, message: "You're not a member of that group." };
    if (!me.role && user.role) me.role = user.role;
    return mutate(g) === false ? undefined : g;
  });
}

/* ============================================ F054-F063 group collaboration ==
   Everything below hangs off the existing group blob rather than new stores,
   so membership is the single access check for all of it: memberGroup() has
   already thrown 403 by the time any of these run. Each collection is capped
   so one member can't balloon a shared blob past what Blobs will hold.
   ============================================================================ */

const GROUP_LIMITS = { tasks: 200, availability: 60, partners: 40, tutoring: 100, notes: 100, challenges: 20 };

/** Lazily add collections to groups created before these features existed. */
function ensureGroupCollections(g) {
  if (!Array.isArray(g.tasks)) g.tasks = [];              // F055
  if (!Array.isArray(g.availability)) g.availability = []; // F054/F057
  if (!Array.isArray(g.partners)) g.partners = [];        // F056
  if (!Array.isArray(g.tutoring)) g.tutoring = [];        // F061
  if (!Array.isArray(g.sharedNotes)) g.sharedNotes = [];  // F062
  if (!Array.isArray(g.challenges)) g.challenges = [];    // F063
  return g;
}

/* --- F055 group task assignment --- */
async function addGroupTask(req, user, id) {
  const b = await body(req);
  const title = String(b.title || "").trim().slice(0, 120);
  if (!title) return fail(400, "Give the task a title.");

  const taskId = randomId(8);
  let task;
  await updateGroup(user, id, (g) => {
    if (g.tasks.length >= GROUP_LIMITS.tasks) {
      throw { status: 409, message: "This group has too many tasks — finish or remove some first." };
    }
    // An assignee must actually be in the group; otherwise it's unassigned.
    const assigneeId = g.members.some((m) => m.id === b.assigneeId) ? b.assigneeId : null;
    task = {
      id: taskId, title,
      detail: String(b.detail || "").slice(0, 500),
      assigneeId,
      assigneeName: assigneeId ? (g.members.find((m) => m.id === assigneeId) || {}).name : null,
      due: String(b.due || "").slice(0, 10),
      status: "todo",
      byId: user.id, byName: user.name, at: Date.now()
    };
    g.tasks.push(task);
  });
  return ok({ task });
}

async function updateGroupTask(req, user, id, taskId) {
  const b = await body(req);
  let task;
  await updateGroup(user, id, (g) => {
    const t = g.tasks.find((x) => x.id === taskId);
    if (!t) throw { status: 404, message: "That task no longer exists." };

    if (b.status && ["todo", "doing", "done"].includes(b.status)) t.status = b.status;
    if (b.assigneeId !== undefined) {
      const inGroup = g.members.some((m) => m.id === b.assigneeId);
      t.assigneeId = inGroup ? b.assigneeId : null;
      t.assigneeName = inGroup ? (g.members.find((m) => m.id === b.assigneeId) || {}).name : null;
    }
    if (typeof b.title === "string" && b.title.trim()) t.title = b.title.trim().slice(0, 120);
    if (typeof b.due === "string") t.due = b.due.slice(0, 10);
    t.updatedAt = Date.now();
    task = t;
  });
  return ok({ task });
}

async function deleteGroupTask(user, id, taskId) {
  await updateGroup(user, id, (g) => {
    const t = g.tasks.find((x) => x.id === taskId);
    if (!t) throw { status: 404, message: "That task no longer exists." };
    // Only the creator or the group owner can remove someone's task.
    if (t.byId !== user.id && g.ownerId !== user.id) {
      throw { status: 403, message: "Only the person who added this, or the group owner, can remove it." };
    }
    g.tasks = g.tasks.filter((x) => x.id !== taskId);
  });
  return ok({ removed: true });
}

/* --- F054 shared project calendar + F057 common free period ---
   Each member pushes their own busy blocks; the server never derives them.
   Storing busy (not full schedules) keeps class names and grades out of a
   shared blob other students can read. */
async function pushAvailability(req, user, id) {
  const b = await body(req);
  const busy = Array.isArray(b.busy) ? b.busy.slice(0, 400) : [];

  const clean = busy.map((x) => ({
    day: String(x.day || "").slice(0, 3),
    start: String(x.start || "").slice(0, 5),
    end: String(x.end || "").slice(0, 5)
  })).filter((x) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test(x.day) && /^\d\d:\d\d$/.test(x.start) && /^\d\d:\d\d$/.test(x.end));

  await updateGroup(user, id, (g) => {
    g.availability = g.availability.filter((a) => a.id !== user.id);
    if (g.availability.length >= GROUP_LIMITS.availability) g.availability.shift();
    g.availability.push({ id: user.id, name: user.name, busy: clean, at: Date.now() });
  });
  return ok({ shared: clean.length });
}

/* --- F056 accountability partners --- */
async function requestPartner(req, user, id) {
  const b = await body(req);
  const withId = String(b.withId || "");
  if (withId === user.id) return fail(400, "Pick someone other than yourself.");

  const pairId = randomId(8);
  let pair;
  await updateGroup(user, id, (g) => {
    const other = g.members.find((m) => m.id === withId);
    if (!other) throw { status: 404, message: "That person isn't in this group." };
    if (g.partners.length >= GROUP_LIMITS.partners) {
      throw { status: 409, message: "Too many partner requests in this group." };
    }
    const existing = g.partners.find((p) =>
      (p.aId === user.id && p.bId === withId) || (p.aId === withId && p.bId === user.id));
    if (existing) {
      throw { status: 409, message: existing.status === "accepted" ? "You're already partners." : "There's already a pending request." };
    }
    pair = {
      id: pairId,
      aId: user.id, aName: user.name,
      bId: withId, bName: other.name,
      status: "pending", at: Date.now()
    };
    g.partners.push(pair);
  });
  return ok({ partner: pair });
}

async function respondPartner(req, user, id, pairId) {
  const b = await body(req);
  await updateGroup(user, id, (g) => {
    const pair = g.partners.find((p) => p.id === pairId);
    if (!pair) throw { status: 404, message: "That request no longer exists." };
    // Only the person who was asked can answer.
    if (pair.bId !== user.id) throw { status: 403, message: "Only the person who was asked can answer this." };
    if (b.accept) { pair.status = "accepted"; pair.respondedAt = Date.now(); }
    else { g.partners = g.partners.filter((p) => p.id !== pairId); }
  });
  return ok({ status: b.accept ? "accepted" : "declined" });
}

async function endPartner(user, id, pairId) {
  await updateGroup(user, id, (g) => {
    const pair = g.partners.find((p) => p.id === pairId);
    if (!pair) throw { status: 404, message: "That partnership no longer exists." };
    if (pair.aId !== user.id && pair.bId !== user.id) throw { status: 403, message: "That isn't your partnership." };
    g.partners = g.partners.filter((p) => p.id !== pairId);
  });
  return ok({ ended: true });
}

/* --- F061 peer tutoring board --- */
async function postTutoring(req, user, id) {
  const b = await body(req);
  const subject = String(b.subject || "").trim().slice(0, 60);
  if (!subject) return fail(400, "What subject?");

  const postId = randomId(8);
  let post;
  await updateGroup(user, id, (g) => {
    if (g.tutoring.length >= GROUP_LIMITS.tutoring) g.tutoring.shift();
    post = {
      id: postId,
      kind: b.kind === "offer" ? "offer" : "request",
      subject,
      detail: String(b.detail || "").slice(0, 400),
      availability: String(b.availability || "").slice(0, 120),
      byId: user.id, byName: user.name, at: Date.now(),
      responders: []
    };
    g.tutoring.push(post);
  });
  return ok({ post });
}

async function respondTutoring(user, id, postId) {
  let count = 0;
  await updateGroup(user, id, (g) => {
    const post = g.tutoring.find((x) => x.id === postId);
    if (!post) throw { status: 404, message: "That post no longer exists." };
    if (post.byId === user.id) throw { status: 400, message: "That's your own post." };
    count = post.responders.length;
    if (post.responders.some((r) => r.id === user.id)) return false;
    post.responders.push({ id: user.id, name: user.name, at: Date.now() });
    count = post.responders.length;
  });
  return ok({ responders: count });
}

async function removeTutoring(user, id, postId) {
  await updateGroup(user, id, (g) => {
    const post = g.tutoring.find((x) => x.id === postId);
    if (!post) throw { status: 404, message: "That post no longer exists." };
    if (post.byId !== user.id && g.ownerId !== user.id) {
      throw { status: 403, message: "Only the author or the group owner can remove this." };
    }
    g.tutoring = g.tutoring.filter((x) => x.id !== postId);
  });
  return ok({ removed: true });
}

/* --- F062 shared notes with attribution --- */
async function shareNote(req, user, id) {
  const b = await body(req);
  const title = String(b.title || "").trim().slice(0, 120);
  const noteBody = String(b.body || "").slice(0, 20000);
  if (!title || !noteBody) return fail(400, "A shared note needs a title and some content.");

  const noteId = randomId(8);
  let note;
  await updateGroup(user, id, (g) => {
    if (g.sharedNotes.length >= GROUP_LIMITS.notes) {
      throw { status: 409, message: `This group already has ${GROUP_LIMITS.notes} shared notes.` };
    }
    note = {
      id: noteId, title, body: noteBody,
      subject: String(b.subject || "").slice(0, 60),
      byId: user.id, byName: user.name, at: Date.now(),
      thanks: []   // attribution is the point: who wrote it stays attached
    };
    g.sharedNotes.push(note);
  });
  return ok({ note: { ...note, body: undefined } });
}

async function thankNote(user, id, noteId) {
  let count = 0;
  await updateGroup(user, id, (g) => {
    const note = g.sharedNotes.find((n) => n.id === noteId);
    if (!note) throw { status: 404, message: "That note no longer exists." };
    if (note.byId === user.id) throw { status: 400, message: "That's your own note." };
    count = note.thanks.length;
    if (note.thanks.includes(user.id)) return false;
    note.thanks.push(user.id);
    count = note.thanks.length;
  });
  return ok({ thanks: count });
}

async function getSharedNote(user, id, noteId) {
  const g = ensureGroupCollections(await memberGroup(user, id));
  const note = g.sharedNotes.find((n) => n.id === noteId);
  if (!note) return fail(404, "That note no longer exists.");
  return ok({ note });
}

async function removeSharedNote(user, id, noteId) {
  await updateGroup(user, id, (g) => {
    const note = g.sharedNotes.find((n) => n.id === noteId);
    if (!note) throw { status: 404, message: "That note no longer exists." };
    if (note.byId !== user.id && g.ownerId !== user.id) {
      throw { status: 403, message: "Only the author or the group owner can remove this." };
    }
    g.sharedNotes = g.sharedNotes.filter((n) => n.id !== noteId);
  });
  return ok({ removed: true });
}

/* --- F063 opt-in group challenges (cooperative, never a ranked leaderboard) --- */
async function createChallenge(req, user, id) {
  const b = await body(req);
  const title = String(b.title || "").trim().slice(0, 100);
  const target = Number(b.target) || 0;
  if (!title || !Number.isFinite(target) || target <= 0) return fail(400, "A challenge needs a title and a target.");

  const chId = randomId(8);
  let ch;
  await updateGroup(user, id, (g) => {
    if (g.challenges.length >= GROUP_LIMITS.challenges) {
      throw { status: 409, message: `This group already has ${GROUP_LIMITS.challenges} challenges.` };
    }
    ch = {
      id: chId, title,
      metric: ["studyMinutes", "assignmentsDone", "custom"].includes(b.metric) ? b.metric : "studyMinutes",
      target,
      unit: String(b.unit || "minutes").slice(0, 20),
      endsOn: String(b.endsOn || "").slice(0, 10),
      byId: user.id, byName: user.name, at: Date.now(),
      // Opt-in: joining is a separate act from the challenge existing.
      participants: []
    };
    g.challenges.push(ch);
  });
  return ok({ challenge: ch });
}

async function joinChallenge(user, id, chId) {
  let count = 0;
  await updateGroup(user, id, (g) => {
    const ch = g.challenges.find((c) => c.id === chId);
    if (!ch) throw { status: 404, message: "That challenge no longer exists." };
    count = ch.participants.length;
    if (ch.participants.some((p) => p.id === user.id)) return false;
    ch.participants.push({ id: user.id, name: user.name, contributed: 0, at: Date.now() });
    count = ch.participants.length;
  });
  return ok({ joined: true, participants: count });
}

async function contributeChallenge(req, user, id, chId) {
  const b = await body(req);
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount < 0) return fail(400, "That isn't a valid amount.");

  let total = 0, target = 0;
  await updateGroup(user, id, (g) => {
    const ch = g.challenges.find((c) => c.id === chId);
    if (!ch) throw { status: 404, message: "That challenge no longer exists." };
    const p = ch.participants.find((x) => x.id === user.id);
    if (!p) throw { status: 403, message: "Join the challenge first." };
    // Absolute, not additive — the client owns the running total, so a
    // retried request can't double-count someone's study minutes.
    p.contributed = Math.min(amount, 100000);
    p.updatedAt = Date.now();
    total = ch.participants.reduce((sum, x) => sum + (Number(x.contributed) || 0), 0);
    target = ch.target;
  });
  return ok({ total, target });
}

async function leaveChallenge(user, id, chId) {
  await updateGroup(user, id, (g) => {
    const ch = g.challenges.find((c) => c.id === chId);
    if (!ch) throw { status: 404, message: "That challenge no longer exists." };
    ch.participants = ch.participants.filter((p) => p.id !== user.id);
  });
  return ok({ left: true });
}

async function shareDeck(req, user, id) {
  const b = await body(req);
  const deck = b.deck;
  if (!deck || typeof deck !== "object" || !Array.isArray(deck.cards)) return fail(400, "Missing deck.");
  if (deck.cards.length > 500) return fail(413, "That deck is too large (max 500 cards).");

  const rec = {
    id: randomId(8),
    name: String(deck.name || "Untitled deck").slice(0, 80),
    cards: deck.cards
      .slice(0, 500)
      .filter((c) => c && typeof c === "object")
      .map((c) => ({
        front: String(c.front || "").slice(0, 500),
        back: String(c.back || "").slice(0, 500)
      })),
    byId: user.id, byName: user.name, at: Date.now()
  };

  await updateGroup(user, id, (g) => {
    if ((g.decks || []).length >= 50) throw { status: 409, message: "This group already has 50 shared decks." };
    g.decks.push(rec);
  });
  return ok({ deck: { id: rec.id, name: rec.name, cardCount: rec.cards.length } });
}

async function getDeck(user, id, deckId) {
  const g = await memberGroup(user, id);
  const d = g.decks.find((x) => x.id === deckId);
  if (!d) return fail(404, "Deck not found.");
  return ok({ deck: d });
}

async function postFeed(req, user, id) {
  const g = await memberGroup(user, id);
  const b = await body(req);
  const title = String(b.title || "").trim().slice(0, 140);
  if (!title) return fail(400, "Say what the assignment is.");

  // F059 — a teacher's post is the assignment, not a classmate's guess at
  // it. The crowdsourced "confirm" affordance exists to corroborate a
  // student's post; corroboration is exactly what an authoritative one
  // replaces, so the flag lets the UI drop it rather than ask three people
  // to agree with their teacher.
  const authoritative = user.role === "teacher";

  const item = {
    id: randomId(8),
    title,
    className: String(b.className || "").slice(0, 60),
    due: String(b.due || "").slice(0, 10),
    notes: String(b.notes || "").slice(0, 500),
    byId: user.id, byName: user.name, byRole: user.role || "student",
    authoritative,
    at: Date.now(),
    confirms: [user.id]
  };

  const saved = await updateJSON("groups", g.id, (cur) => {
    if (!cur) return undefined;
    const feed = (cur.feed || []).concat([item]);
    return { ...cur, feed: feed.length > 300 ? feed.slice(-300) : feed };
  });
  if (!saved) return fail(404, "That group no longer exists.");
  return ok({ item });
}

/**
 * F059 — post one assignment to every class group the teacher belongs to.
 *
 * A teacher typically owns several sections of the same course; without this
 * they would post the same thing five times. Partial failure is reported per
 * group rather than rolled back: four sections receiving it is better than
 * none, and the teacher can see which one missed.
 */
async function postFeedToAll(req, user) {
  if (user.role !== "teacher") {
    return fail(403, "Only teacher accounts can post to every class at once.");
  }
  const b = await body(req);
  const title = String(b.title || "").trim().slice(0, 140);
  if (!title) return fail(400, "Say what the assignment is.");

  const ids = Array.isArray(b.groupIds) && b.groupIds.length
    ? b.groupIds.filter((x) => (user.groups || []).includes(x))
    : (user.groups || []);
  if (!ids.length) return fail(400, "You aren't in any class groups yet.");

  const results = [];
  for (const gid of ids) {
    try {
      const g = await memberGroup(user, gid);
      const item = {
        id: randomId(8),
        title,
        className: String(b.className || "").slice(0, 60),
        due: String(b.due || "").slice(0, 10),
        notes: String(b.notes || "").slice(0, 500),
        byId: user.id, byName: user.name, byRole: "teacher",
        authoritative: true,
        at: Date.now(),
        confirms: [user.id]
      };
      await updateJSON("groups", gid, (cur) => {
        if (!cur) return undefined;
        const feed = (cur.feed || []).concat([item]);
        return { ...cur, feed: feed.length > 300 ? feed.slice(-300) : feed };
      });
      results.push({ groupId: gid, name: g.name, ok: true });
    } catch (e) {
      results.push({ groupId: gid, ok: false, error: (e && e.message) || "Couldn't post" });
    }
  }
  return ok({ posted: results.filter((r) => r.ok).length, results });
}

async function confirmFeed(req, user, id, itemId) {
  let count = 0;
  await updateGroup(user, id, (g) => {
    const item = (g.feed || []).find((f) => f.id === itemId);
    if (!item) throw { status: 404, message: "That post is gone." };
    if (!Array.isArray(item.confirms)) item.confirms = [];
    count = item.confirms.length;
    if (item.confirms.includes(user.id)) return false;
    item.confirms.push(user.id);
    count = item.confirms.length;
  });
  return ok({ confirms: count });
}

/* F058 — discuss a crowdsourced post inline instead of a separate chat. */
async function commentFeed(req, user, id, itemId) {
  const b = await body(req);
  const text = String(b.text || "").trim().slice(0, 500);
  if (!text) return fail(400, "Write something first.");

  const comment = { id: randomId(8), text, byId: user.id, byName: user.name, at: Date.now() };
  await updateGroup(user, id, (g) => {
    const item = (g.feed || []).find((f) => f.id === itemId);
    if (!item) throw { status: 404, message: "That post is gone." };
    if (!Array.isArray(item.comments)) item.comments = [];
    item.comments.push(comment);
    if (item.comments.length > 200) item.comments = item.comments.slice(-200);
  });
  return ok({ comment });
}

/* F060 — anonymous: the client only ever gets the aggregate back, never
   who submitted what. _raters tracks who already voted so one person can't
   skew it, without linking any stored value to their identity. */
async function rateFeed(req, user, id, itemId) {
  const b = await body(req);
  const mins = Number(b.actualMinutes);
  if (!Number.isFinite(mins) || mins <= 0 || mins > 1440) return fail(400, "Enter a realistic number of minutes.");

  let count = 0, avg = 0;
  await updateGroup(user, id, (g) => {
    const item = (g.feed || []).find((f) => f.id === itemId);
    if (!item) throw { status: 404, message: "That post is gone." };
    if (!Array.isArray(item._raters)) item._raters = [];
    // Inside the conditional write, so two ratings racing can't both pass the
    // "already rated" check and land — the loser re-reads and is rejected.
    if (item._raters.includes(user.id)) throw { status: 409, message: "You already rated this one." };
    if (!Array.isArray(item.ratings)) item.ratings = [];
    item.ratings.push(Math.round(mins));
    item._raters.push(user.id);
    if (item.ratings.length > 200) { item.ratings = item.ratings.slice(-200); item._raters = item._raters.slice(-200); }
    count = item.ratings.length;
    avg = Math.round(item.ratings.reduce((sum, x) => sum + x, 0) / count);
  });
  return ok({ count, avgMinutes: avg });
}

async function leaveGroup(user, id) {
  // Every other group route goes through memberGroup(); this one read the
  // blob directly, so a non-member's call still performed a full
  // read-modify-write of somebody else's group — a way to clobber concurrent
  // posts from outside the group entirely. Group ids are handed to every
  // member by getGroup, so that was reachable by any ex-member.
  const g = await memberGroup(user, id);

  const remaining = g.members.filter((m) => m.id !== user.id);

  if (remaining.length === 0) {
    // Last one out deletes the group. Nothing is left to own it.
    await remove("groups", id);
    await remove("codes", g.code);
    await updateJSON("profiles", user.id, (cur) =>
      cur ? { ...cur, groups: (cur.groups || []).filter((x) => x !== id) } : undefined);
    return ok({ deleted: true });
  }

  await updateJSON("groups", id, (cur) => {
    if (!cur) return undefined;
    const members = (cur.members || []).filter((m) => m.id !== user.id);
    if (!members.length) return undefined;
    // Ownership transfers instead of the group being destroyed. Deleting a
    // shared workspace because one person — who might be the teacher who
    // created it — walked away takes everyone else's notes, tasks and feed
    // with it. The longest-standing remaining member inherits it.
    let ownerId = cur.ownerId;
    if (ownerId === user.id) {
      const byTenure = [...members].sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
      ownerId = byTenure[0].id;
    }
    return { ...cur, members, ownerId };
  });

  await updateJSON("profiles", user.id, (cur) =>
    cur ? { ...cur, groups: (cur.groups || []).filter((x) => x !== id) } : undefined);
  return ok({ left: true });
}

/* --------------------------------------------------------------- router -- */

export default async (req) => {
  // Preflight is answered only for this site's own origin, and only for
  // paths that exist — a blanket 204 for every URL is free reconnaissance.
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsFor(req) });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  const parts = path ? path.split("/") : [];
  const method = req.method.toUpperCase();

  try {
    if (!process.env.SCHOLAR_SECRET) {
      return fail(503, "The server isn't configured yet — set SCHOLAR_SECRET in the Netlify environment.");
    }

    // Every path segment is a candidate blob key.
    //
    // Sixty-odd handlers take an id straight out of the URL and hand it to
    // Blobs — group ids, note ids, task ids, user ids. validBlobKey() was
    // applied at five call sites and not the rest, so a malformed segment
    // reached storage and came back as a 500 with a stack in the logs. That
    // is a fuzzing target: garbage in, server error out, on any of sixty
    // routes. Validating once here covers all of them and cannot be
    // forgotten by the next handler, which is the point — a check repeated
    // per call site is a check that gets missed.
    for (const seg of parts) {
      if (!validBlobKey(seg)) return fail(400, "That request has a malformed path.");
    }

    // --- public
    // Public. Reports only whether a *capability* is available, never any
    // configuration detail — the sign-in screen needs this to decide whether
    // to offer password reset at all, and it is asked before anyone signs in.
    if (parts[0] === "health") {
      return ok({
        ok: true,
        time: Date.now(),
        email: {
          // False when RESEND_API_KEY is missing, and also when EMAIL_FROM is
          // unset: mail then goes from Resend's sandbox address, which only
          // delivers to the API key owner. Offering "reset my password" that
          // silently cannot arrive is worse than not offering it.
          deliverable: emailDeliverable()
        }
      });
    }
    if (parts[0] === "auth" && parts[1] === "signup" && method === "POST") return await signup(req);
    if (parts[0] === "auth" && parts[1] === "login" && method === "POST") return await login(req);
    // F098 — forgotten-password flow is necessarily unauthenticated.
    if (parts[0] === "auth" && parts[1] === "forgot" && method === "POST") return await forgotPassword(req);
    if (parts[0] === "auth" && parts[1] === "reset" && method === "POST") return await resetPassword(req);
    // F046 — a calendar app polling a subscribe URL can't send a bearer
    // token, so this one route is public, gated by an unguessable token
    // instead (minted by the authenticated POST route below).
    if (parts[0] === "ics-feed" && parts[1] && method === "GET") return await getIcsFeed(parts[1]);

    // --- everything below needs a valid token
    const user = await requireUser(req);

    /*
     * A ceiling on writes, per account, as a backstop.
     *
     * Individual limits guard the routes where abuse has a specific shape —
     * guessing a join code, walking a list of emails, spending AI quota. But
     * every other mutating route had none, so one signed-in account could
     * loop POST /sync, POST /groups or POST /location as fast as the network
     * allowed: unbounded storage churn, unbounded blob growth, and a bill.
     * Enumerating the ~50 mutating routes and limiting each would leave the
     * next one added uncovered, so the ceiling lives here where every write
     * passes through.
     *
     * 900/hour is roughly one write every four seconds sustained for an
     * hour. Real use is nowhere near it — sync is debounced and the app
     * writes on user actions — so this is invisible until something is
     * looping, which is exactly when it should not be.
     */
    if (method !== "GET" && method !== "HEAD") {
      const writes = await rateLimit("writes", user.id, 900, 60 * 60 * 1000);
      if (!writes.allowed) {
        const mins = Math.max(1, Math.ceil((writes.resetAt - Date.now()) / 60000));
        return fail(429, `That's a lot of changes at once — this account is paused for ${mins} minute${mins === 1 ? "" : "s"}.`);
      }
    }

    // Diagnostics for outbound email. Authenticated because ?probe=1 sends.
    if (parts[0] === "email-health" && method === "GET") return await emailHealth(req, user);

    /* --------------------------------------------------------- F100 --- */

    // The public read surface. Reachable with a session token too, which is
    // what makes it testable from the app itself.
    if (parts[0] === "v1") {
      if (method !== "GET") return fail(405, "The /v1 API is read-only.");
      return await v1(user, parts[1] || "me", url);
    }

    // Managing tokens and webhooks needs a *session*, never an API token —
    // otherwise a leaked token could mint more tokens for itself and quietly
    // survive the one being revoked.
    if (parts[0] === "tokens" || parts[0] === "webhooks") {
      if (user[VIA_API_TOKEN]) {
        return fail(403, "API tokens can't manage tokens or webhooks. Sign in to do that.");
      }
    }
    if (parts[0] === "tokens") {
      if (!parts[1] && method === "GET") return await listApiTokens(user);
      if (!parts[1] && method === "POST") return await mintApiToken(req, user);
      if (parts[1] && method === "DELETE") return await revokeApiToken(user, parts[1]);
    }
    if (parts[0] === "webhooks") {
      if (!parts[1] && method === "GET") return await listWebhooks(user);
      if (!parts[1] && method === "POST") return await addWebhook(req, user);
      if (parts[1] && method === "DELETE") return await removeWebhook(user, parts[1]);
    }

    if (parts[0] === "me") {
      if (method === "GET") return ok({ user: publicUser(user) });
      if (method === "POST") {
        const b = await body(req);
        const name = String(b.name || "").trim().slice(0, 80);
        if (name) {
          user.name = name;
          await updateJSON("profiles", user.id, (cur) => (cur ? { ...cur, name } : undefined));
        }
        return ok({ user: publicUser(user) });
      }
    }

    if (parts[0] === "sync") {
      if (method === "GET") return await pullState(user);
      if (method === "PUT" || method === "POST") return await pushState(req, user);
    }

    if (parts[0] === "link") {
      if (parts[1] === "code" && method === "POST") return await mintLinkCode(user);
      if (parts[1] === "redeem" && method === "POST") return await redeemLinkCode(req, user);
      if (parts[1] === "children" && method === "GET") return await listChildren(user);
      if (parts[1] === "parents" && method === "GET") return await listParents(user);
      if (parts[1] && method === "DELETE") return await unlink(user, parts[1]);
    }

    if (parts[0] === "location") {
      if (!parts[1] && method === "POST") return await pushLocation(req, user);
      if (parts[1] && method === "GET") return await readLocation(user, parts[1]);
    }

    if (parts[0] === "peers") {
      if (parts[1] === "request" && method === "POST") return await requestFriend(req, user);
      if (parts[1] === "respond" && method === "POST") return await respondFriend(req, user);
      if (!parts[1] && method === "GET") return await listFriends(user);
      if (parts[1] && method === "DELETE") return await removeFriend(user, parts[1]);
    }

    if (parts[0] === "checkin") {
      if (parts[1] === "request" && method === "POST") return await requestCheckin(req, user);
      if (parts[1] === "respond" && method === "POST") return await respondCheckin(req, user);
      if (!parts[1] && method === "GET") return await listCheckins(user);
    }

    if (parts[0] === "ics-feed" && !parts[1] && method === "POST") return await pushIcsFeed(req, user);

    if (parts[0] === "focus-windows") {
      if (parts[1] === "propose" && method === "POST") return await proposeFocusWindow(req, user);
      if (parts[1] === "respond" && method === "POST") return await respondFocusWindow(req, user);
      if (parts[1] === "end" && method === "POST") return await endFocusWindow(req, user);
      if (!parts[1] && method === "GET") return await listFocusWindows(user);
    }

    if (parts[0] === "guardian-notes") {
      if (!parts[1] && method === "GET") return await listGuardianNotes(user);
      if (!parts[1] && method === "POST") return await sendGuardianNote(req, user);
    }

    if (parts[0] === "groups") {
      if (!parts[1] && method === "GET") return await listGroups(user);
      if (!parts[1] && method === "POST") return await createGroup(req, user);
      if (parts[1] === "join" && method === "POST") return await joinGroup(req, user);
      // F059 — one assignment to every class group the teacher is in.
      if (parts[1] === "broadcast" && method === "POST") return await postFeedToAll(req, user);
      if (parts[1] && !parts[2] && method === "GET") return await getGroup(user, parts[1]);
      if (parts[1] && parts[2] === "deck" && method === "POST") return await shareDeck(req, user, parts[1]);
      if (parts[1] && parts[2] === "deck" && parts[3] && method === "GET") return await getDeck(user, parts[1], parts[3]);
      // `!parts[3]` matters: without it this line matched every POST under
      // /feed/*, so /feed/:itemId/comment, /rate and the bare confirm route
      // below were all unreachable — the three lines after this one were dead
      // code. The client called them and got postFeed's "Say what the
      // assignment is." 400 back, which reads as a validation bug in the
      // comment box rather than a route that never ran.
      if (parts[1] && parts[2] === "feed" && !parts[3] && method === "POST") return await postFeed(req, user, parts[1]);
      if (parts[1] && parts[2] === "feed" && parts[3] && parts[4] === "comment" && method === "POST") return await commentFeed(req, user, parts[1], parts[3]);
      if (parts[1] && parts[2] === "feed" && parts[3] && parts[4] === "rate" && method === "POST") return await rateFeed(req, user, parts[1], parts[3]);
      if (parts[1] && parts[2] === "feed" && parts[3] && !parts[4] && method === "POST") return await confirmFeed(req, user, parts[1], parts[3]);
      if (parts[1] && parts[2] === "leave" && method === "POST") return await leaveGroup(user, parts[1]);

      // F055 tasks
      if (parts[1] && parts[2] === "tasks" && !parts[3] && method === "POST") return await addGroupTask(req, user, parts[1]);
      if (parts[1] && parts[2] === "tasks" && parts[3] && method === "POST") return await updateGroupTask(req, user, parts[1], parts[3]);
      if (parts[1] && parts[2] === "tasks" && parts[3] && method === "DELETE") return await deleteGroupTask(user, parts[1], parts[3]);
      // F054/F057 availability
      if (parts[1] && parts[2] === "availability" && method === "POST") return await pushAvailability(req, user, parts[1]);
      // F056 accountability partners
      if (parts[1] && parts[2] === "partners" && !parts[3] && method === "POST") return await requestPartner(req, user, parts[1]);
      if (parts[1] && parts[2] === "partners" && parts[3] && method === "POST") return await respondPartner(req, user, parts[1], parts[3]);
      if (parts[1] && parts[2] === "partners" && parts[3] && method === "DELETE") return await endPartner(user, parts[1], parts[3]);
      // F061 peer tutoring
      if (parts[1] && parts[2] === "tutoring" && !parts[3] && method === "POST") return await postTutoring(req, user, parts[1]);
      if (parts[1] && parts[2] === "tutoring" && parts[3] && method === "POST") return await respondTutoring(user, parts[1], parts[3]);
      if (parts[1] && parts[2] === "tutoring" && parts[3] && method === "DELETE") return await removeTutoring(user, parts[1], parts[3]);
      // F062 shared notes
      if (parts[1] && parts[2] === "notes" && !parts[3] && method === "POST") return await shareNote(req, user, parts[1]);
      if (parts[1] && parts[2] === "notes" && parts[3] && !parts[4] && method === "GET") return await getSharedNote(user, parts[1], parts[3]);
      if (parts[1] && parts[2] === "notes" && parts[3] && parts[4] === "thanks" && method === "POST") return await thankNote(user, parts[1], parts[3]);
      if (parts[1] && parts[2] === "notes" && parts[3] && method === "DELETE") return await removeSharedNote(user, parts[1], parts[3]);
      // F063 challenges
      if (parts[1] && parts[2] === "challenges" && !parts[3] && method === "POST") return await createChallenge(req, user, parts[1]);
      if (parts[1] && parts[2] === "challenges" && parts[3] && parts[4] === "join" && method === "POST") return await joinChallenge(user, parts[1], parts[3]);
      if (parts[1] && parts[2] === "challenges" && parts[3] && parts[4] === "contribute" && method === "POST") return await contributeChallenge(req, user, parts[1], parts[3]);
      if (parts[1] && parts[2] === "challenges" && parts[3] && method === "DELETE") return await leaveChallenge(user, parts[1], parts[3]);
    }

    return fail(404, "No such endpoint: " + method + " /" + path);
  } catch (e) {
    if (e && e.status) return fail(e.status, e.message);
    console.error("[api]", e);
    return fail(500, "Something went wrong on the server.");
  }
};

export const config = { path: "/api/*" };
