/* ==========================================================================
   assistant.js — natural-language add, photo schedule extraction, and the
   private data assistant

   Routes (all under /assistant, all anonymous — no Blobs, no auth, nothing
   stored server-side):
     POST /assistant/parse-text    { text }                → { entries, periods, summary, clarify }
     POST /assistant/parse-image   { imageBase64, mimeType} → { entries, periods, summary, clarify }
     POST /assistant/ask           { question, context }   → { answer }

   The client builds `context` for /ask from its own local data before
   calling — this function never reads or stores anything about a student
   beyond the single request it's handling, so nothing leaks between
   accounts and nothing lingers after the response goes out. All three
   routes degrade to a clear 503 (not a crash) when GEMINI_API_KEY isn't
   set, so the UI can show "AI assistant isn't set up yet" instead of an
   error page.
   ========================================================================== */

import { configured, generateText, generateJSON, DEFAULT_MODEL as DEFAULT_MODEL_NAME } from "./_lib/gemini.js";

const MAX_TEXT_LEN = 2000;
const MAX_IMAGE_B64_LEN = 6 * 1024 * 1024; // ~4.5MB decoded, well under Gemini's per-image limit
const MAX_CONTEXT_LEN = 60000;
const ASK_MAX_OUTPUT_TOKENS = 220; // hard cap so an answer can't run long even if the model ignores the prompt

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

async function body(req) {
  try {
    const text = await req.text();
    return text ? JSON.parse(text) : {};
  } catch (e) {
    throw { status: 400, message: "Invalid JSON body." };
  }
}

function requireConfigured() {
  if (!configured()) {
    throw { status: 503, message: "The AI assistant isn't set up yet — add a GEMINI_API_KEY in the Netlify environment." };
  }
}

/* ------------------------------------------------------------- schema -- */

const DAY_ENUM = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const SCHEDULE_SCHEMA = {
  type: "OBJECT",
  properties: {
    entries: {
      type: "ARRAY",
      description: "One entry per recurring commitment found (a class, practice, club, job, etc). Empty array if none.",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          category: { type: "STRING", enum: ["Sport", "Club", "Service", "Music", "Arts", "Academic", "Job", "Other"] },
          days: { type: "ARRAY", items: { type: "STRING", enum: DAY_ENUM } },
          start: { type: "STRING", description: "24-hour HH:MM" },
          end: { type: "STRING", description: "24-hour HH:MM" },
          location: { type: "STRING", description: "Room, field, address — empty string if not mentioned" },
          startDate: { type: "STRING", description: "YYYY-MM-DD if a start date was given, else empty string" },
          endDate: { type: "STRING", description: "YYYY-MM-DD if an end date was given, else empty string" }
        },
        required: ["name", "category", "days", "start", "end", "location", "startDate", "endDate"]
      }
    },
    periods: {
      type: "ARRAY",
      description: "Only fill this in if the input is a school bell/period-times table (Period 1: 8:00-8:50, etc), not a personal activity list. Empty array otherwise.",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          start: { type: "STRING", description: "24-hour HH:MM" },
          end: { type: "STRING", description: "24-hour HH:MM" }
        },
        required: ["name", "start", "end"]
      }
    },
    summary: { type: "STRING", description: "One short, friendly sentence describing what was found." },
    clarify: { type: "STRING", description: "A short question for the student if something important was ambiguous or missing. Empty string if nothing needs clarifying." }
  },
  required: ["entries", "periods", "summary", "clarify"]
};

const SCHEDULE_SYSTEM = `You help a middle/high school student turn a description or a photo into their
personal schedule. Extract every recurring commitment you can find (classes, practices, clubs,
lessons, jobs, appointments) as entries, and extract a school bell/period-times table separately
into periods if that's what's shown. Times are always 24-hour HH:MM. Days are three-letter
abbreviations. If a date range like "starting September 5 through October 25" is given, fill
startDate/endDate; if no year is stated, assume the nearest future occurrence of that date relative
to today. Never invent a location, date, or day that isn't stated or clearly implied — leave it
blank instead. If a photo is blurry, cropped, or ambiguous, still extract what you're confident
about and use "clarify" to ask about the rest.`;

async function parseText(req) {
  requireConfigured();
  const b = await body(req);
  const text = String(b.text || "").trim().slice(0, MAX_TEXT_LEN);
  if (!text) return fail(400, "Describe what you want to add.");

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Today's date is ${today}. Extract the schedule from this description:\n\n"""${text}"""`;
  const result = await generateJSON({ system: SCHEDULE_SYSTEM, prompt, responseSchema: SCHEDULE_SCHEMA });
  return ok(result);
}

async function parseImage(req) {
  requireConfigured();
  const b = await body(req);
  const imageBase64 = String(b.imageBase64 || "");
  const mimeType = String(b.mimeType || "image/jpeg");
  if (!imageBase64) return fail(400, "No image received.");
  if (imageBase64.length > MAX_IMAGE_B64_LEN) return fail(413, "That image is too large — try a smaller photo.");
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(mimeType)) return fail(400, "Unsupported image type.");

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Today's date is ${today}. This photo is either a personal class/activity schedule, a
school bell/period-times table, or both. Extract everything you can read.`;
  const result = await generateJSON({
    system: SCHEDULE_SYSTEM, prompt, responseSchema: SCHEDULE_SCHEMA,
    image: { base64: imageBase64, mimeType }
  });
  return ok(result);
}

const ASK_SYSTEM = `You are the private assistant built into Scholar, a school-tracker app, for one
student. You only know what's in the JSON context you're given for this one message — no memory
of anything else, no access to any other student's data, nothing stored between questions.

Your scope is exactly two things, and nothing else:
1. Answering questions about the context you were given — this student's own classes, schedule,
   assignments, grades/GPA, activities, goals, habits, reading, attendance, and bell schedule.
2. Explaining how to use the Scholar app — where a feature lives, what something does, how a
   part of the app works. You don't have a manual; reason from the context and common sense about
   a student schedule-tracking app, and say plainly if you're not sure of an exact detail rather
   than inventing one.

That's it. If asked for anything outside those two things — writing essays or other assignments,
general knowledge, opinions, advice unrelated to their own schedule, casual chat, anything about
another person — decline in one short sentence and say what you can help with instead. Don't
lecture or over-explain the refusal.

Within scope: answer only from the given context; if it doesn't contain what's needed, say so
rather than guessing. Always be brief — one to three sentences for most answers, a short list only
when the question genuinely calls for enumerating several things (e.g. "what classes do I have
today"). Never write a long-form answer, multiple paragraphs, or an essay, even if asked to —
redirect to a short answer instead. Speak directly to the student ("you have..."). For free-time
questions, use the precomputed free-time blocks in the context rather than recalculating from the
schedule yourself. If GPA/grade fields in the context are null, that means the student has chosen
to hide them — say so rather than treating it as missing data. Light markdown only where it aids
scanning (a short list, bold on one key number) — never headings, never long blocks.`;

async function ask(req) {
  requireConfigured();
  const b = await body(req);
  const question = String(b.question || "").trim().slice(0, 500);
  if (!question) return fail(400, "Ask a question.");
  let context = b.context;
  if (typeof context !== "string") context = JSON.stringify(context || {});
  if (context.length > MAX_CONTEXT_LEN) context = context.slice(0, MAX_CONTEXT_LEN);

  const prompt = `Context (JSON):\n${context}\n\nQuestion: ${question}`;
  const answer = await generateText({ system: ASK_SYSTEM, prompt, maxOutputTokens: ASK_MAX_OUTPUT_TOKENS });
  return ok({ answer });
}

/* --------------------------------------------------------------- health -- */

/**
 * Answers "why isn't the AI working?" without anyone reading server logs.
 * Deliberately reports the *shape* of the key (present? plausible length?)
 * and never the key itself, plus a real round-trip when ?probe=1 so a bad
 * model name or a rejected key surfaces as the provider's own error string
 * instead of a generic failure in the UI.
 */
async function health(req) {
  const key = process.env.GEMINI_API_KEY || "";
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL_NAME;
  const out = {
    configured: !!key,
    keyPresent: !!key,
    keyLength: key.length,
    keyLooksTrimmed: key === key.trim(),
    model,
    modelSource: process.env.GEMINI_MODEL ? "GEMINI_MODEL env var" : "built-in default"
  };

  const probe = new URL(req.url).searchParams.get("probe");
  if (probe && key) {
    const started = Date.now();
    try {
      const answer = await generateText({
        system: "Reply with exactly the word: ok",
        prompt: "Say ok.",
        maxOutputTokens: 10
      });
      out.probe = { ok: true, ms: Date.now() - started, reply: String(answer).trim().slice(0, 40) };
    } catch (e) {
      out.probe = {
        ok: false,
        ms: Date.now() - started,
        code: e.code || "unknown",
        status: e.status || null,
        error: e.message
      };
    }
  } else if (probe) {
    out.probe = { ok: false, code: "not-configured", error: "GEMINI_API_KEY isn't set on this deploy." };
  }

  return ok(out);
}

/* --------------------------------------------------------------- routes -- */

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/assistant\/?/, "").replace(/\/+$/, "");
  const method = req.method.toUpperCase();

  try {
    if (path === "health" && method === "GET") return await health(req);
    if (path === "parse-text" && method === "POST") return await parseText(req);
    if (path === "parse-image" && method === "POST") return await parseImage(req);
    if (path === "ask" && method === "POST") return await ask(req);
    return fail(404, "No such endpoint: " + method + " /" + path);
  } catch (e) {
    if (e && e.status) return fail(e.status, e.message);
    if (e && e.code === "not-configured") {
      return fail(503, "The AI assistant isn't set up yet — add a GEMINI_API_KEY in the Netlify environment.");
    }
    console.error("[assistant]", e);
    return fail(500, (e && e.message) || "Something went wrong.");
  }
};

export const config = { path: "/assistant/*" };
