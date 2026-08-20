/* ==========================================================================
   api.js — the whole Scholar backend, as one Netlify Function

   Routes (all under /api):
     POST   /auth/signup            create an account
     POST   /auth/login             exchange credentials for a bearer token
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
     POST   /groups/:id/leave       leave (owner leaving deletes the group)

   Every authenticated route verifies the bearer token, and every read of
   another person's data checks an explicit link/membership first.
   ========================================================================== */

import {
  hashPassword, verifyPassword, signToken, verifyToken,
  normalizeEmail, emailKey, validEmail, passwordProblem,
  randomId, randomCode
} from "./_lib/auth.js";
import { readJSON, writeJSON, remove } from "./_lib/blobs.js";

const MAX_STATE_BYTES = 5 * 1024 * 1024;
const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

/* ------------------------------------------------------------ responses -- */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400"
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS }
  });
}

const ok = (body) => json(body || { ok: true });
const fail = (status, message, extra) => json({ error: message, ...(extra || {}) }, status);

/* ----------------------------------------------------------------- auth -- */

async function currentUser(req) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !payload.sub) return null;
  const profile = await readJSON("profiles", payload.sub);
  if (!profile) return null;
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
    if (text.length > MAX_STATE_BYTES) throw { status: 413, message: "That payload is too large." };
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
  const role = b.role === "parent" ? "parent" : "student";

  if (!validEmail(email)) return fail(400, "Enter a valid email address.");
  const pwProblem = passwordProblem(b.password);
  if (pwProblem) return fail(400, pwProblem);
  if (!name) return fail(400, "Enter your name.");

  const key = await emailKey(email);
  const existing = await readJSON("users", key);
  if (existing) return fail(409, "An account with that email already exists.");

  const pw = await hashPassword(b.password);
  const id = randomId(12);

  await writeJSON("users", key, { id, email, pw, createdAt: Date.now(), failed: 0, lockedUntil: 0 });
  const profile = {
    id, email, name, role,
    createdAt: Date.now(),
    links: [],        // [{ id, role: 'parent'|'child', name, since }]
    groups: []        // [groupId]
  };
  await writeJSON("profiles", id, profile);

  const token = await signToken({ sub: id, role });
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

  if (rec.lockedUntil && rec.lockedUntil > Date.now()) {
    const mins = Math.ceil((rec.lockedUntil - Date.now()) / 60000);
    return fail(429, `Too many attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`);
  }

  const good = await verifyPassword(b.password, rec.pw);
  if (!good) {
    rec.failed = (rec.failed || 0) + 1;
    if (rec.failed >= MAX_FAILED_LOGINS) {
      rec.lockedUntil = Date.now() + LOCKOUT_MS;
      rec.failed = 0;
    }
    await writeJSON("users", key, rec);
    return generic();
  }

  if (rec.failed || rec.lockedUntil) {
    rec.failed = 0; rec.lockedUntil = 0;
    await writeJSON("users", key, rec);
  }

  const profile = await readJSON("profiles", rec.id);
  if (!profile) return fail(500, "Account record is missing.");

  const token = await signToken({ sub: rec.id, role: profile.role });
  return ok({ token, user: publicUser(profile) });
}

function publicUser(p) {
  return { id: p.id, email: p.email, name: p.name, role: p.role, links: p.links || [], groups: p.groups || [] };
}

/* ----------------------------------------------------------------- sync -- */

async function pullState(user) {
  const rec = await readJSON("state", user.id, { version: 0, data: null, updatedAt: 0 });
  return ok({ version: rec.version || 0, updatedAt: rec.updatedAt || 0, state: rec.data || null });
}

async function pushState(req, user) {
  const b = await body(req);
  if (!b.state || typeof b.state !== "object") return fail(400, "Missing state.");

  const size = JSON.stringify(b.state).length;
  if (size > MAX_STATE_BYTES) return fail(413, "Your data is too large to sync (over 5 MB).");

  const rec = await readJSON("state", user.id, { version: 0, data: null, updatedAt: 0 });
  const base = Number(b.baseVersion || 0);

  // Optimistic concurrency: a stale writer gets the server copy back instead
  // of silently clobbering a newer device's changes.
  if (rec.version && base !== rec.version && !b.force) {
    return json({
      error: "conflict",
      version: rec.version,
      updatedAt: rec.updatedAt,
      state: rec.data
    }, 409);
  }

  const next = { version: (rec.version || 0) + 1, data: b.state, updatedAt: Date.now() };
  await writeJSON("state", user.id, next);
  return ok({ version: next.version, updatedAt: next.updatedAt });
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
  if (!code) return fail(400, "Enter a link code.");

  const rec = await readJSON("links", code);
  if (!rec) return fail(404, "That code isn't valid.");
  if (rec.expiresAt && rec.expiresAt < Date.now()) {
    await remove("links", code);
    return fail(410, "That code has expired — ask for a new one.");
  }
  if (rec.studentId === user.id) return fail(400, "You can't link to yourself.");

  const student = await readJSON("profiles", rec.studentId);
  if (!student) return fail(404, "That student account no longer exists.");

  const already = (user.links || []).some((l) => l.id === student.id);
  if (!already) {
    user.links = (user.links || []).concat([{ id: student.id, role: "child", name: student.name, since: Date.now() }]);
    await writeJSON("profiles", user.id, user);
  }
  const back = (student.links || []).some((l) => l.id === user.id);
  if (!back) {
    student.links = (student.links || []).concat([{ id: user.id, role: "parent", name: user.name, since: Date.now() }]);
    await writeJSON("profiles", student.id, student);
  }

  await remove("links", code);   // single use
  return ok({ linked: { id: student.id, name: student.name } });
}

async function listChildren(user) {
  const kids = (user.links || []).filter((l) => l.role === "child");
  const out = [];
  for (const k of kids) {
    const loc = await readJSON("locations", k.id, null);
    out.push({
      id: k.id, name: k.name, since: k.since,
      status: loc ? loc.status : null,
      summary: loc ? loc.summary : null,
      updatedAt: loc ? loc.at : null
    });
  }
  return ok({ children: out });
}

async function listParents(user) {
  return ok({ parents: (user.links || []).filter((l) => l.role === "parent") });
}

async function unlink(user, otherId) {
  user.links = (user.links || []).filter((l) => l.id !== otherId);
  await writeJSON("profiles", user.id, user);

  const other = await readJSON("profiles", otherId);
  if (other) {
    other.links = (other.links || []).filter((l) => l.id !== user.id);
    await writeJSON("profiles", otherId, other);
  }
  return ok({ unlinked: otherId });
}

/* ---------------------------------------------------------------- peers -- */
// F053 — real friend requests, replacing locally-stored classmates that the
// other person never agreed to. Mirrors the parent/child `links` pattern:
// each profile keeps its own view of the relationship (`peers`), so an
// accept/decline is a two-write, symmetric update rather than a shared row.

async function requestFriend(req, user) {
  const b = await body(req);
  const email = normalizeEmail(b.email || "");
  if (!validEmail(email)) return fail(400, "Enter a valid email address.");
  if (email === user.email) return fail(400, "You can't friend yourself.");

  const key = await emailKey(email);
  const rec = await readJSON("users", key);
  if (!rec) return fail(404, "No Scholar account with that email.");
  const target = await readJSON("profiles", rec.id);
  if (!target) return fail(404, "No Scholar account with that email.");

  user.peers = user.peers || [];
  target.peers = target.peers || [];
  if (user.peers.some((p) => p.id === target.id)) return fail(409, "You're already connected or a request is pending.");

  user.peers.push({ id: target.id, name: target.name, status: "pending-out", since: Date.now() });
  target.peers.push({ id: user.id, name: user.name, status: "pending-in", since: Date.now() });
  await writeJSON("profiles", user.id, user);
  await writeJSON("profiles", target.id, target);
  return ok({ requested: { id: target.id, name: target.name } });
}

async function respondFriend(req, user) {
  const b = await body(req);
  const otherId = String(b.id || "");
  const accept = !!b.accept;
  user.peers = user.peers || [];
  const mine = user.peers.find((p) => p.id === otherId && p.status === "pending-in");
  if (!mine) return fail(404, "No pending request from that person.");

  const other = await readJSON("profiles", otherId);
  if (!accept) {
    user.peers = user.peers.filter((p) => p.id !== otherId);
    if (other) { other.peers = (other.peers || []).filter((p) => p.id !== user.id); await writeJSON("profiles", otherId, other); }
    await writeJSON("profiles", user.id, user);
    return ok({ declined: otherId });
  }

  mine.status = "accepted";
  await writeJSON("profiles", user.id, user);
  if (other) {
    other.peers = other.peers || [];
    const theirs = other.peers.find((p) => p.id === user.id);
    if (theirs) theirs.status = "accepted";
    await writeJSON("profiles", otherId, other);
  }
  return ok({ accepted: otherId });
}

async function listFriends(user) {
  return ok({ peers: user.peers || [] });
}

async function removeFriend(user, otherId) {
  user.peers = (user.peers || []).filter((p) => p.id !== otherId);
  await writeJSON("profiles", user.id, user);
  const other = await readJSON("profiles", otherId);
  if (other) { other.peers = (other.peers || []).filter((p) => p.id !== user.id); await writeJSON("profiles", otherId, other); }
  return ok({ removed: otherId });
}

/* ------------------------------------------------------ guardian check-ins */
// F068 — a parent asks, the student taps once to confirm they're okay.
// F071 — a short reminder from a guardian the student sees in-app.

async function requestCheckin(req, user) {
  const b = await body(req);
  const studentId = String(b.studentId || "");
  const linked = (user.links || []).some((l) => l.id === studentId && l.role === "child");
  if (!linked) return fail(403, "You aren't linked to that student.");

  const list = await readJSON("checkins", studentId, []);
  list.unshift({ id: randomId(8), fromId: user.id, fromName: user.name, at: Date.now(), respondedAt: null });
  await writeJSON("checkins", studentId, list.slice(0, 30));
  return ok({ requested: true });
}

async function listCheckins(user) {
  const list = await readJSON("checkins", user.id, []);
  return ok({ checkins: list });
}

async function respondCheckin(req, user) {
  const b = await body(req);
  const list = await readJSON("checkins", user.id, []);
  const item = list.find((c) => c.id === b.id);
  if (!item) return fail(404, "That check-in request is gone.");
  item.respondedAt = Date.now();
  await writeJSON("checkins", user.id, list);
  return ok({ responded: true });
}

/* --------------------------------------------------------- F046 ics feed -- */
// The device that already builds the one-time .ics export (js/ics.js) also
// pushes that same text here — the server just stores and serves the last
// copy under an unguessable token, so there's exactly one place that knows
// how to turn Scholar data into iCalendar, and it isn't this file.

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

  const list = await readJSON("focusWindows", studentId, []);
  list.unshift({
    id: randomId(8), fromId: user.id, fromName: user.name,
    startAt, endAt, note: String(b.note || "").trim().slice(0, 200),
    status: "pending", createdAt: Date.now(), agreedAt: null, endedAt: null
  });
  await writeJSON("focusWindows", studentId, list.slice(0, 30));
  return ok({ proposed: true });
}

async function listFocusWindows(user) {
  const list = await readJSON("focusWindows", user.id, []);
  return ok({ focusWindows: list });
}

async function respondFocusWindow(req, user) {
  const b = await body(req);
  const action = b.action === "decline" ? "declined" : "agreed";
  const list = await readJSON("focusWindows", user.id, []);
  const item = list.find((f) => f.id === b.id && f.status === "pending");
  if (!item) return fail(404, "That proposal is gone or already answered.");
  item.status = action;
  if (action === "agreed") item.agreedAt = Date.now();
  await writeJSON("focusWindows", user.id, list);
  return ok({ status: action });
}

async function endFocusWindow(req, user) {
  const b = await body(req);
  const list = await readJSON("focusWindows", user.id, []);
  const item = list.find((f) => f.id === b.id && f.status === "agreed");
  if (!item) return fail(404, "That focus window isn't running.");
  item.status = "ended";
  item.endedAt = Date.now();
  await writeJSON("focusWindows", user.id, list);
  return ok({ ended: true });
}

async function sendGuardianNote(req, user) {
  const b = await body(req);
  const studentId = String(b.studentId || "");
  const text = String(b.text || "").trim().slice(0, 500);
  if (!text) return fail(400, "Write something first.");
  const linked = (user.links || []).some((l) => l.id === studentId && l.role === "child");
  if (!linked) return fail(403, "You aren't linked to that student.");

  const list = await readJSON("guardianNotes", studentId, []);
  list.unshift({ id: randomId(8), fromId: user.id, fromName: user.name, text, at: Date.now(), read: false });
  await writeJSON("guardianNotes", studentId, list.slice(0, 50));
  return ok({ sent: true });
}

async function listGuardianNotes(user) {
  const list = await readJSON("guardianNotes", user.id, []);
  // Marking as read on fetch — the student just opened the list.
  if (list.some((n) => !n.read)) {
    list.forEach((n) => { n.read = true; });
    await writeJSON("guardianNotes", user.id, list);
  }
  return ok({ notes: list });
}

/* ------------------------------------------------------------- location -- */

async function pushLocation(req, user) {
  const b = await body(req);
  await writeJSON("locations", user.id, {
    status: b.status || null,
    summary: b.summary || null,
    at: Date.now()
  });
  return ok({ at: Date.now() });
}

async function readLocation(user, studentId) {
  const linked = (user.links || []).some((l) => l.id === studentId && l.role === "child");
  if (!linked && studentId !== user.id) return fail(403, "You aren't linked to that student.");
  const loc = await readJSON("locations", studentId, null);
  return ok({ location: loc });
}

/* --------------------------------------------------------------- groups -- */

async function createGroup(req, user) {
  const b = await body(req);
  const name = String(b.name || "").trim().slice(0, 60);
  if (!name) return fail(400, "Give the group a name.");

  const id = randomId(10);
  let code = randomCode(6);
  // Avoid the (very unlikely) collision rather than silently overwrite.
  for (let i = 0; i < 5 && (await readJSON("codes", code)); i++) code = randomCode(6);

  const group = {
    id, code, name, ownerId: user.id, createdAt: Date.now(),
    members: [{ id: user.id, name: user.name, joinedAt: Date.now() }],
    decks: [], feed: []
  };
  await writeJSON("groups", id, group);
  await writeJSON("codes", code, id);

  user.groups = (user.groups || []).concat([id]);
  await writeJSON("profiles", user.id, user);

  return ok({ group: slimGroup(group) });
}

async function joinGroup(req, user) {
  const b = await body(req);
  const code = String(b.code || "").trim().toUpperCase();
  const groupId = await readJSON("codes", code);
  if (!groupId) return fail(404, "No group with that code.");

  const group = await readJSON("groups", groupId);
  if (!group) return fail(404, "That group no longer exists.");

  if (!group.members.some((m) => m.id === user.id)) {
    if (group.members.length >= 60) return fail(409, "That group is full.");
    group.members.push({ id: user.id, name: user.name, joinedAt: Date.now() });
    await writeJSON("groups", group.id, group);
  }
  if (!(user.groups || []).includes(group.id)) {
    user.groups = (user.groups || []).concat([group.id]);
    await writeJSON("profiles", user.id, user);
  }
  return ok({ group: slimGroup(group) });
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
  if (!g.members.some((m) => m.id === user.id)) throw { status: 403, message: "You're not a member of that group." };
  return g;
}

async function getGroup(user, id) {
  const g = await memberGroup(user, id);
  return ok({
    group: {
      ...slimGroup(g),
      members: g.members.map((m) => ({ id: m.id, name: m.name, joinedAt: m.joinedAt })),
      decks: g.decks.map((d) => ({
        id: d.id, name: d.name, cardCount: (d.cards || []).length,
        byName: d.byName, at: d.at
      })),
      // _raters (F060) is who-voted bookkeeping only — never leaves the server.
      feed: g.feed.slice(-80).map(({ _raters, ...f }) => f)
    }
  });
}

async function shareDeck(req, user, id) {
  const g = await memberGroup(user, id);
  const b = await body(req);
  const deck = b.deck;
  if (!deck || !Array.isArray(deck.cards)) return fail(400, "Missing deck.");
  if (deck.cards.length > 500) return fail(413, "That deck is too large (max 500 cards).");
  if (g.decks.length >= 50) return fail(409, "This group already has 50 shared decks.");

  const rec = {
    id: randomId(8),
    name: String(deck.name || "Untitled deck").slice(0, 80),
    cards: deck.cards.slice(0, 500).map((c) => ({
      front: String(c.front || "").slice(0, 500),
      back: String(c.back || "").slice(0, 500)
    })),
    byId: user.id, byName: user.name, at: Date.now()
  };
  g.decks.push(rec);
  await writeJSON("groups", g.id, g);
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

  const item = {
    id: randomId(8),
    title,
    className: String(b.className || "").slice(0, 60),
    due: String(b.due || "").slice(0, 10),
    notes: String(b.notes || "").slice(0, 500),
    byId: user.id, byName: user.name, at: Date.now(),
    confirms: [user.id]
  };
  g.feed.push(item);
  if (g.feed.length > 300) g.feed = g.feed.slice(-300);
  await writeJSON("groups", g.id, g);
  return ok({ item });
}

async function confirmFeed(req, user, id, itemId) {
  const g = await memberGroup(user, id);
  const item = g.feed.find((f) => f.id === itemId);
  if (!item) return fail(404, "That post is gone.");
  if (!item.confirms.includes(user.id)) {
    item.confirms.push(user.id);
    await writeJSON("groups", g.id, g);
  }
  return ok({ confirms: item.confirms.length });
}

/* F058 — discuss a crowdsourced post inline instead of a separate chat. */
async function commentFeed(req, user, id, itemId) {
  const g = await memberGroup(user, id);
  const item = g.feed.find((f) => f.id === itemId);
  if (!item) return fail(404, "That post is gone.");
  const b = await body(req);
  const text = String(b.text || "").trim().slice(0, 500);
  if (!text) return fail(400, "Write something first.");
  if (!item.comments) item.comments = [];
  const comment = { id: randomId(8), text, byId: user.id, byName: user.name, at: Date.now() };
  item.comments.push(comment);
  if (item.comments.length > 200) item.comments = item.comments.slice(-200);
  await writeJSON("groups", g.id, g);
  return ok({ comment });
}

/* F060 — anonymous: the client only ever gets the aggregate back, never
   who submitted what. _raters tracks who already voted so one person can't
   skew it, without linking any stored value to their identity. */
async function rateFeed(req, user, id, itemId) {
  const g = await memberGroup(user, id);
  const item = g.feed.find((f) => f.id === itemId);
  if (!item) return fail(404, "That post is gone.");
  if (!item._raters) item._raters = [];
  if (item._raters.includes(user.id)) return fail(409, "You already rated this one.");
  const b = await body(req);
  const mins = Number(b.actualMinutes);
  if (!Number.isFinite(mins) || mins <= 0 || mins > 1440) return fail(400, "Enter a realistic number of minutes.");
  if (!item.ratings) item.ratings = [];
  item.ratings.push(Math.round(mins));
  item._raters.push(user.id);
  if (item.ratings.length > 200) { item.ratings = item.ratings.slice(-200); item._raters = item._raters.slice(-200); }
  await writeJSON("groups", g.id, g);
  const avg = Math.round(item.ratings.reduce((a, b2) => a + b2, 0) / item.ratings.length);
  return ok({ count: item.ratings.length, avgMinutes: avg });
}

async function leaveGroup(user, id) {
  const g = await readJSON("groups", id);
  if (g) {
    if (g.ownerId === user.id) {
      // Owner leaving deletes the group, so orphaned groups don't pile up.
      for (const m of g.members) {
        const p = await readJSON("profiles", m.id);
        if (p) { p.groups = (p.groups || []).filter((x) => x !== id); await writeJSON("profiles", m.id, p); }
      }
      await remove("groups", id);
      await remove("codes", g.code);
      return ok({ deleted: true });
    }
    g.members = g.members.filter((m) => m.id !== user.id);
    await writeJSON("groups", id, g);
  }
  user.groups = (user.groups || []).filter((x) => x !== id);
  await writeJSON("profiles", user.id, user);
  return ok({ left: true });
}

/* --------------------------------------------------------------- router -- */

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  const parts = path ? path.split("/") : [];
  const method = req.method.toUpperCase();

  try {
    if (!process.env.SCHOLAR_SECRET) {
      return fail(503, "The server isn't configured yet — set SCHOLAR_SECRET in the Netlify environment.");
    }

    // --- public
    if (parts[0] === "health") return ok({ ok: true, time: Date.now() });
    if (parts[0] === "auth" && parts[1] === "signup" && method === "POST") return await signup(req);
    if (parts[0] === "auth" && parts[1] === "login" && method === "POST") return await login(req);
    // F046 — a calendar app polling a subscribe URL can't send a bearer
    // token, so this one route is public, gated by an unguessable token
    // instead (minted by the authenticated POST route below).
    if (parts[0] === "ics-feed" && parts[1] && method === "GET") return await getIcsFeed(parts[1]);

    // --- everything below needs a valid token
    const user = await requireUser(req);

    if (parts[0] === "me") {
      if (method === "GET") return ok({ user: publicUser(user) });
      if (method === "POST") {
        const b = await body(req);
        const name = String(b.name || "").trim().slice(0, 80);
        if (name) { user.name = name; await writeJSON("profiles", user.id, user); }
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
      if (parts[1] && !parts[2] && method === "GET") return await getGroup(user, parts[1]);
      if (parts[1] && parts[2] === "deck" && method === "POST") return await shareDeck(req, user, parts[1]);
      if (parts[1] && parts[2] === "deck" && parts[3] && method === "GET") return await getDeck(user, parts[1], parts[3]);
      if (parts[1] && parts[2] === "feed" && method === "POST") return await postFeed(req, user, parts[1]);
      if (parts[1] && parts[2] === "feed" && parts[3] && parts[4] === "comment" && method === "POST") return await commentFeed(req, user, parts[1], parts[3]);
      if (parts[1] && parts[2] === "feed" && parts[3] && parts[4] === "rate" && method === "POST") return await rateFeed(req, user, parts[1], parts[3]);
      if (parts[1] && parts[2] === "feed" && parts[3] && !parts[4] && method === "POST") return await confirmFeed(req, user, parts[1], parts[3]);
      if (parts[1] && parts[2] === "leave" && method === "POST") return await leaveGroup(user, parts[1]);
    }

    return fail(404, "No such endpoint: " + method + " /" + path);
  } catch (e) {
    if (e && e.status) return fail(e.status, e.message);
    console.error("[api]", e);
    return fail(500, "Something went wrong on the server.");
  }
};

export const config = { path: "/api/*" };
