/* ==========================================================================
   tests/stub/gemini-stub.mjs — scripted stand-in for _lib/gemini.js

   The study-proof routes are the only place in the app where a model's
   answer decides whether a student gets paid. That makes the interesting
   cases the ones a live model gives you rarely and unrepeatably: a photo it
   calls schoolwork, a photo it doesn't, a quiz with a duplicated option, an
   answerIndex out of range, a missing field.

   So the model is scripted here rather than called. Tests set the next
   reply; assistant.js is loaded and exercised unmodified, which is the same
   bargain blobs-stub.mjs makes with storage.
   ========================================================================== */

let queue = [];
let calls = [];

/** Script the next generateJSON() reply (or several, consumed in order). */
export function __queue(...replies) { queue.push(...replies); }
/** Every call made since the last reset: { system, prompt, image }. */
export function __calls() { return calls; }
export function __reset() { queue = []; calls = []; }

// Mirrors the real one exactly. Suites that only want the routes to exist
// (authwall) leave GEMINI_API_KEY unset and still get the honest 503; suites
// that want a reply set it and queue one.
export function configured() { return !!process.env.GEMINI_API_KEY; }

export const DEFAULT_MODEL = "stub-model";

export async function generateText({ prompt }) {
  calls.push({ prompt });
  return queue.length ? queue.shift() : "";
}

export async function generateJSON({ system, prompt, image, responseSchema }) {
  calls.push({ system, prompt, image, responseSchema });
  if (!queue.length) throw new Error("gemini-stub: no reply queued for this call");
  const next = queue.shift();
  // A queued Error is how a test drives the provider-failure path.
  if (next instanceof Error) throw next;
  return next;
}
