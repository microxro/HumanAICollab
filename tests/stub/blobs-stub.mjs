/* ==========================================================================
   tests/stub/blobs-stub.mjs — in-memory stand-in for _lib/blobs.js

   Netlify Blobs only exists inside the real Netlify runtime, so this
   substitutes the storage layer and nothing else: api.js and assistant.js
   are loaded and exercised unmodified.

   The etag semantics are real, not decorative. Conditional writes are the
   whole defence against the lost-update bugs these tests exist to catch, so
   a stub that always accepted a write would make the tests pass while the
   product stayed broken.
   ========================================================================== */

const MEM = new Map();           // "store::key" -> { json, etag }
let etagSeq = 0;
const k = (store, key) => `${store}::${key}`;
const nextEtag = () => `"e${++etagSeq}"`;

export async function readJSON(store, key, fallback) {
  const hit = MEM.get(k(store, key));
  if (hit === undefined) return fallback === undefined ? null : fallback;
  return JSON.parse(hit.json);
}

export async function writeJSON(store, key, value) {
  MEM.set(k(store, key), { json: JSON.stringify(value), etag: nextEtag() });
  return value;
}

export async function readJSONWithEtag(store, key, fallback) {
  const hit = MEM.get(k(store, key));
  if (hit === undefined) return { value: fallback === undefined ? null : fallback, etag: null };
  return { value: JSON.parse(hit.json), etag: hit.etag };
}

export async function writeJSONIf(store, key, value, etag) {
  const id = k(store, key);
  const cur = MEM.get(id);
  if (etag == null) {
    // onlyIfNew — refuse when something is already there.
    if (cur !== undefined) return false;
  } else {
    if (cur === undefined || cur.etag !== etag) return false;
  }
  MEM.set(id, { json: JSON.stringify(value), etag: nextEtag() });
  return true;
}

export async function updateJSON(store, key, mutate, { fallback = null, attempts = 5 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const { value, etag } = await readJSONWithEtag(store, key, fallback);
    const next = await mutate(value);
    if (next === undefined) return value;
    if (await writeJSONIf(store, key, next, etag)) return next;
  }
  throw Object.assign(new Error("Couldn't save — too many concurrent updates. Try again."), { status: 409 });
}

export async function rateLimit(bucket, id, limit, windowMs) {
  const key = `${bucket}:${id}`;
  const now = Date.now();
  const state = await updateJSON("rateLimits", key, (cur) => {
    if (!cur || typeof cur.resetAt !== "number" || cur.resetAt <= now) return { count: 1, resetAt: now + windowMs };
    return { count: (cur.count || 0) + 1, resetAt: cur.resetAt };
  }, { fallback: null, attempts: 3 });
  const count = (state && state.count) || 1;
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt: state.resetAt };
}

export async function remove(store, key) { MEM.delete(k(store, key)); }

export async function listKeys(store) {
  return [...MEM.keys()].filter((x) => x.startsWith(store + "::")).map((x) => x.slice(store.length + 2));
}

export function store() { throw new Error("store() is not available under the test stub"); }

/* --------------------------------------------------------- test helpers -- */

export function __reset() { MEM.clear(); etagSeq = 0; }

/** Read the raw etag, so a test can simulate a competing writer. */
export function __etag(storeName, key) {
  const hit = MEM.get(k(storeName, key));
  return hit ? hit.etag : null;
}

/** Write behind the caller's back, invalidating any etag they hold. */
export function __clobber(storeName, key, value) {
  MEM.set(k(storeName, key), { json: JSON.stringify(value), etag: nextEtag() });
}

export function __dump() {
  const out = {};
  for (const [id, v] of MEM) out[id] = JSON.parse(v.json);
  return out;
}
