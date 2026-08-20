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
   ========================================================================== */

import { getStore } from "@netlify/blobs";

const STORES = ["users", "profiles", "state", "links", "locations", "groups", "codes", "checkins", "guardianNotes"];

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

async function remove(name, key) {
  try { await store(name).delete(key); } catch (e) { /* already gone */ }
}

async function listKeys(name, prefix) {
  const res = await store(name).list(prefix ? { prefix } : undefined);
  return (res.blobs || []).map((b) => b.key);
}

export { store, readJSON, writeJSON, remove, listKeys };
