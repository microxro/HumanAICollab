/* ==========================================================================
   _lib/auth.js — password hashing and signed session tokens

   Uses only Web Crypto (available in the Netlify Functions runtime):
     • PBKDF2-SHA256, 210k iterations, 16-byte random salt per user
     • HMAC-SHA256 signed, expiring bearer tokens (stateless sessions)
     • constant-time comparison everywhere a secret is checked

   SCHOLAR_SECRET must be set in the Netlify environment. A deploy without it
   refuses to issue tokens rather than falling back to a guessable default.
   ========================================================================== */

const enc = new TextEncoder();

const PBKDF2_ITERATIONS = 210000;
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days

/* ------------------------------------------------------------- encoding -- */

function toB64Url(bytes) {
  let bin = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(str) {
  const pad = str.length % 4 ? "=".repeat(4 - (str.length % 4)) : "";
  const bin = atob(String(str).replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Comparison whose duration doesn't depend on where the first mismatch is. */
function timingSafeEqual(a, b) {
  const A = typeof a === "string" ? enc.encode(a) : new Uint8Array(a);
  const B = typeof b === "string" ? enc.encode(b) : new Uint8Array(b);
  if (A.length !== B.length) return false;
  let diff = 0;
  for (let i = 0; i < A.length; i++) diff |= A[i] ^ B[i];
  return diff === 0;
}

function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

function randomId(bytes) {
  return toB64Url(randomBytes(bytes || 16));
}

/** Short, human-readable, unambiguous code for parent links and group joins. */
function randomCode(len) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no I/O/0/1
  const bytes = randomBytes(len || 6);
  let out = "";
  for (let i = 0; i < (len || 6); i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/* ------------------------------------------------------------ passwords -- */

async function hashPassword(password, saltB64) {
  const salt = saltB64 ? fromB64Url(saltB64) : randomBytes(16);
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key, 256
  );
  return { hash: toB64Url(bits), salt: toB64Url(salt), iterations: PBKDF2_ITERATIONS };
}

async function verifyPassword(password, stored) {
  if (!stored || !stored.hash || !stored.salt) return false;
  const { hash } = await hashPassword(password, stored.salt);
  return timingSafeEqual(hash, stored.hash);
}

/* --------------------------------------------------------------- tokens -- */

function secret() {
  const s = process.env.SCHOLAR_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SCHOLAR_SECRET is not configured (set a long random value in Netlify env vars).");
  }
  return s;
}

async function hmacKey() {
  return crypto.subtle.importKey(
    "raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
}

/** token = base64url(payload) + "." + base64url(hmac) */
async function signToken(payload) {
  const body = { ...payload, iat: Date.now(), exp: Date.now() + TOKEN_TTL_MS };
  const encoded = toB64Url(enc.encode(JSON.stringify(body)));
  const key = await hmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(encoded));
  return `${encoded}.${toB64Url(sig)}`;
}

async function verifyToken(token) {
  if (!token || typeof token !== "string" || token.indexOf(".") < 0) return null;
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) return null;

  const key = await hmacKey();
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", key, fromB64Url(sig), enc.encode(encoded));
  } catch (e) { return null; }
  if (!ok) return null;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromB64Url(encoded)));
  } catch (e) { return null; }

  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

/* ------------------------------------------------------------- helpers -- */

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/** Stable, non-reversible key for looking a user up by email. */
async function emailKey(email) {
  const data = enc.encode(normalizeEmail(email) + "|" + secret());
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toB64Url(digest).slice(0, 32);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizeEmail(email));
}

function passwordProblem(pw) {
  const p = String(pw || "");
  if (p.length < 8) return "Password must be at least 8 characters.";
  if (p.length > 200) return "Password is too long.";
  if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) return "Password needs at least one letter and one number.";
  return null;
}

export {
  hashPassword, verifyPassword, signToken, verifyToken,
  normalizeEmail, emailKey, validEmail, passwordProblem,
  randomId, randomCode, timingSafeEqual, toB64Url, fromB64Url
};
