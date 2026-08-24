/* ==========================================================================
   _lib/blobs.js — thin helpers over Netlify Blobs

   Stores used:
     users      emailKey → { id, email, name, role, pw:{hash,salt}, createdAt }
     profiles   userId   → { id, email, name, role, links, groups, … }
     state      userId   → the whole Scholar DB (JSON) + a version counter
     links      code     → { studentId, createdAt, usedBy[] }
     locations  userId   → last known status (small, frequently overwritten)
     groups     groupId  → { id, code, name, ownerId, members[], decks[], feed[] }
     codes      code     → groupId  (join-code lookup)
     checkins       studentId → [{ id, fromId, fromName, at, respondedAt }]
     guardianNotes  studentId → [{ id, fromId, fromName, text, at, read }]
     focusWindows   studentId → [{ id, fromId, fromName, startAt, endAt, note, status, ... }]
     activitySuggestions studentId → [{ id, fromId, fromName, activity, at, status }]
     locationEvents studentId → [{ type: "arrival"|"departure", at }]
     icsTokens      userId    → { token }
     icsFeeds       token     → { ics, updatedAt }
     passwordResets token     → { userId, expiresAt }
     apiTokens      sk_token  → { userId, label, createdAt, lastUsedAt }
     rateLimits     bucket:id → { count, resetAt }
   ========================================================================== */

import { getStore } from "@netlify/blobs";

const STORES = [
  "users", "profiles", "state", "links", "locations", "groups", "codes",
  "checkins", "guardianNotes", "focusWindows", "locationEvents",
  "activitySuggestions",
  "icsTokens", "icsFeeds", "passwordResets", "apiTokens", "rateLimits"
];

function store(name) {
  if (!STORES.includes(name)) throw new Error("Unknown store: " + name);
  return getStore({ name: "scholar-" + name, consistency: "strong" });
}

async function readJSON(name, key, fallback) {
  try {
    const val = await store(name).get(key, { type: "json" });
    return val == null ? (fallback === undefined ? null : fallback) : val;
  } catch (e) {
    if (e && /not\s*found/i.test(e.message || "")) return fallback === undefined ? null : fallback;
    throw e;
  }
}

async function writeJSON(name, key, value) {
  await store(name).setJSON(key, value);
  return value;
}

/**
 * Read a JSON blob together with the etag needed to write it back safely.
 *
 * Every mutating route in this codebase was read-modify-write with no guard,
 * which on a shared blob (a study group) or a multi-device one (synced state)
 * silently drops whichever write lands second. Pair this with writeJSONIf().
 */
async function readJSONWithEtag(name, key, fallback) {
  try {
    const res = await store(name).getWithMetadata(key, { type: "json" });
    if (!res) return { value: fallback === undefined ? null : fallback, etag: null };
    return { value: res.data == null ? (fallback === undefined ? null : fallback) : res.data, etag: res.etag || null };
  } catch (e) {
    if (e && /not\s*found/i.test(e.message || "")) return { value: fallback === undefined ? null : fallback, etag: null };
    throw e;
  }
}

/**
 * Conditional write. Returns true when it landed, false when another writer
 * got there first (the caller should re-read and retry, or report a conflict).
 *
 * `etag` of null means "only if this key does not exist yet".
 */
async function writeJSONIf(name, key, value, etag) {
  const opts = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
  try {
    const res = await store(name).setJSON(key, value, opts);
    // The SDK reports the outcome as { modified: boolean }; older builds
    // resolve with undefined on success, so treat that as a win too.
    return res == null ? true : res.modified !== false;
  } catch (e) {
    if (e && /precondition|conflict|etag/i.test(e.message || "")) return false;
    throw e;
  }
}

/**
 * Read-modify-write with optimistic retry. `mutate` receives the current
 * value (or `fallback`) and returns the value to store; returning undefined
 * aborts without writing. Throws after `attempts` lost races, which is a
 * genuine conflict rather than something to paper over.
 */
async function updateJSON(name, key, mutate, { fallback = null, attempts = 5 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const { value, etag } = await readJSONWithEtag(name, key, fallback);
    const next = await mutate(value);
    if (next === undefined) return value;
    if (await writeJSONIf(name, key, next, etag)) return next;
  }
  throw Object.assign(new Error("Couldn't save — too many concurrent updates. Try again."), { status: 409 });
}

/**
 * Fixed-window rate limit backed by Blobs. Not distributed-perfect — two
 * requests can read the same window — but it is bounded by `attempts` and it
 * turns "unlimited" into "roughly the limit", which is the difference that
 * matters for quota and brute-force protection.
 */
async function rateLimit(bucket, id, limit, windowMs) {
  const key = `${bucket}:${id}`;
  const now = Date.now();
  let state = null;
  try {
    state = await updateJSON("rateLimits", key, (cur) => {
      if (!cur || typeof cur.resetAt !== "number" || cur.resetAt <= now) {
        return { count: 1, resetAt: now + windowMs };
      }
      return { count: (cur.count || 0) + 1, resetAt: cur.resetAt };
    }, { fallback: null, attempts: 3 });
  } catch (e) {
    // Storage trouble must not take the feature offline — fail open, but say
    // so, because a silently disabled limiter is worse than none.
    console.error("[ratelimit] storage error, allowing request", bucket, e && e.message);
    return { allowed: true, remaining: limit, resetAt: now + windowMs, degraded: true };
  }
  const count = (state && state.count) || 1;
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetAt: (state && state.resetAt) || now + windowMs
  };
}

async function remove(name, key) {
  try { await store(name).delete(key); } catch (e) { /* already gone */ }
}

/**
 * Every key in a store, following pagination.
 *
 * A bare list() returns only the first page, so once the profile count grew
 * past it the weekly digest silently stopped reaching the parents whose keys
 * sorted later — no error, just people quietly not getting email.
 */
async function listKeys(name, prefix) {
  const opts = { paginate: true };
  if (prefix) opts.prefix = prefix;
  const keys = [];
  for await (const page of store(name).list(opts)) {
    for (const b of page.blobs || []) keys.push(b.key);
  }
  return keys;
}

export { store, readJSON, writeJSON, remove, listKeys, readJSONWithEtag, writeJSONIf, updateJSON, rateLimit };
