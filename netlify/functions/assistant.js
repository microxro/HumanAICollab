/* ==========================================================================
   assistant.js — natural-language add, photo schedule extraction, and the
   private data assistant

   Routes (all under /assistant). Everything that spends provider quota
   requires a signed-in account and is rate limited per account:
     GET  /assistant/health        [?probe=1]              → key/model diagnostics
     POST /assistant/parse-text    { text }                → { entries, periods, summary, clarify }
     POST /assistant/parse-image   { imageBase64, mimeType} → { entries, periods, summary, clarify }
     POST /assistant/parse-note-image { imageBase64, mimeType } → { title, body, tags, … }
     POST /assistant/from-url      { url, kind }             → schedule | events | courses
     POST /assistant/estimate      { title, type, … }      → { minutes, low, high, suggestedSteps }
     POST /assistant/act           { message, context }    → { answer, actions[] }
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
import { verifyToken } from "./_lib/auth.js";
import { readJSON, rateLimit } from "./_lib/blobs.js";
import { fetchPage } from "./_lib/urlguard.js";

const MAX_TEXT_LEN = 2000;
const MAX_IMAGE_B64_LEN = 6 * 1024 * 1024; // ~4.5MB decoded, well under Gemini's per-image limit
const MAX_CONTEXT_LEN = 60000;
// A school page is mostly navigation chrome. 40k characters of extracted text
// is far more than any bell-times table or events page needs, and keeping the
// cap here rather than at the fetch means a huge page is truncated instead of
// refused — the schedule is usually near the top anyway.
const MAX_PAGE_TEXT = 40000;
const ASK_MAX_OUTPUT_TOKENS = 220; // hard cap so an answer can't run long even if the model ignores the prompt

/* --------------------------------------------------------- quota limits -- */

// Generous for a student working normally, ruinous for a script. Text calls
// are cheap; image calls are not, so they get their own tighter bucket.
const LIMIT_TEXT_PER_HOUR = 60;
const LIMIT_IMAGE_PER_HOUR = 20;
const LIMIT_TEXT_PER_DAY = 300;
const LIMIT_IMAGE_PER_DAY = 60;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * These routes are same-origin only.
 *
 * They used to answer `Access-Control-Allow-Origin: *` with no auth of any
 * kind, so any page on the web could spend this deploy's Gemini quota from a
 * visitor's browser, and a plain curl loop drained the free tier in seconds.
 * Preflight is answered for this site's own origin; the JSON responses carry
 * no ACAO at all, which is what stops another site reading them.
 */
function corsFor(req) {
  const origin = req && req.headers ? req.headers.get("origin") : null;
  const allowed = process.env.SITE_URL || "";
  const base = {
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  if (!origin) return base;
  let allow = false;
  try { allow = !!allowed && new URL(origin).origin === new URL(allowed).origin; } catch (e) { allow = false; }
  return allow ? { ...base, "Access-Control-Allow-Origin": origin } : base;
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
const ok = (body) => json(body || { ok: true });
const fail = (status, message, extra) => json({ error: message, ...(extra || {}) }, status);

// Images are base64 in the JSON body, so the cap has to clear the largest
// legitimate image; anything past that is abuse, not use. Without any cap at
// all a single request could stream an unbounded body into the function.
const MAX_BODY_BYTES = 9 * 1024 * 1024;

async function body(req) {
  let text;
  try {
    text = await req.text();
  } catch (e) {
    throw { status: 400, message: "Couldn't read the request body." };
  }
  if (text.length > MAX_BODY_BYTES) throw { status: 413, message: "That request is too large." };
  try {
    return text ? JSON.parse(text) : {};
  } catch (e) {
    throw { status: 400, message: "Invalid JSON body." };
  }
}

/**
 * Whether this account runs the deploy, and may see its configuration.
 * Mirrors the same check in api.js — one environment variable, so only
 * whoever can set Netlify env vars can name the operator, and nobody is one
 * until they do.
 */
function isOperator(user) {
  const admin = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!admin) return false;
  return String((user && user.email) || "").trim().toLowerCase() === admin;
}

function requireConfigured() {
  if (!configured()) {
    throw { status: 503, message: "The AI assistant isn't set up yet — add a GEMINI_API_KEY in the Netlify environment." };
  }
}

/* ----------------------------------------------------------------- auth -- */

/** The signed-in account, or null. Same token format the main API issues. */
async function currentUser(req) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  try {
    const payload = await verifyToken(token);
    if (!payload || !payload.sub) return null;
    const profile = await readJSON("profiles", payload.sub);
    if (!profile) return null;
    // Honour the same revocation epoch the main API uses, so a password reset
    // cuts off AI access for a stolen token too.
    const epoch = Number(profile.tokenEpoch || 0);
    if (epoch && Number(payload.epoch || 0) < epoch) return null;
    return profile;
  } catch (e) {
    // A missing SCHOLAR_SECRET throws out of verifyToken. That's a
    // configuration failure, not an anonymous caller.
    throw { status: 503, message: "The server isn't configured yet — set SCHOLAR_SECRET in the Netlify environment." };
  }
}

async function requireUser(req) {
  const user = await currentUser(req);
  if (!user) {
    throw { status: 401, message: "Sign in to use the AI features. They run on a shared quota, so they're tied to an account." };
  }
  return user;
}

/**
 * Charge one call against the signed-in account's hourly and daily budget.
 * `kind` is "text" or "image"; images cost far more, so they have their own
 * counters rather than sharing one pool.
 */
async function charge(user, kind) {
  const isImage = kind === "image";
  const perHour = isImage ? LIMIT_IMAGE_PER_HOUR : LIMIT_TEXT_PER_HOUR;
  const perDay = isImage ? LIMIT_IMAGE_PER_DAY : LIMIT_TEXT_PER_DAY;

  const hourly = await rateLimit(`ai-${kind}-h`, user.id, perHour, HOUR);
  if (!hourly.allowed) {
    const mins = Math.max(1, Math.ceil((hourly.resetAt - Date.now()) / 60000));
    throw { status: 429, message: `You've used this hour's AI allowance. It resets in ${mins} minute${mins === 1 ? "" : "s"}.` };
  }
  const daily = await rateLimit(`ai-${kind}-d`, user.id, perDay, DAY);
  if (!daily.allowed) {
    throw { status: 429, message: "You've used today's AI allowance. It resets tomorrow." };
  }
  return { remainingHour: hourly.remaining, remainingDay: daily.remaining };
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

/* ------------------------------------------------------------ from a link -- */

const EVENT_SCHEMA = {
  type: "OBJECT",
  properties: {
    events: {
      type: "ARRAY",
      description: "Every dated event found on the page. Empty array if none.",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          date: { type: "STRING", description: "YYYY-MM-DD. Empty string if no date is stated." },
          endDate: { type: "STRING", description: "YYYY-MM-DD for a multi-day event, else empty string." },
          start: { type: "STRING", description: "24-hour HH:MM, or empty string." },
          end: { type: "STRING", description: "24-hour HH:MM, or empty string." },
          allDay: { type: "BOOLEAN" },
          location: { type: "STRING", description: "Room, building or address — empty string if not stated." },
          type: { type: "STRING", enum: ["Exam", "Holiday", "Trip", "Meeting", "Deadline", "Sport", "Performance", "Other"] },
          notes: { type: "STRING", description: "Anything else stated that matters. Empty string if nothing." }
        },
        required: ["title", "date", "endDate", "start", "end", "allDay", "location", "type", "notes"]
      }
    },
    summary: { type: "STRING", description: "One short sentence on what was found." },
    clarify: { type: "STRING", description: "A short question if something important was ambiguous. Empty string if nothing." }
  },
  required: ["events", "summary", "clarify"]
};

const ELECTIVE_SCHEMA = {
  type: "OBJECT",
  properties: {
    courses: {
      type: "ARRAY",
      description: "Every course offered that a student could choose. Empty array if the page isn't a course list.",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          code: { type: "STRING", description: "Course code if given, else empty string." },
          subject: { type: "STRING", enum: ["cs", "math", "physics", "chem", "bio", "eng", "english", "history", "econ", "psych", "language", "arts", "music", "health", "other"], description: "Best-fit subject area." },
          level: { type: "STRING", enum: ["regular", "honors", "ap", "ib", "dual", "unknown"] },
          grades: { type: "STRING", description: "Which year groups can take it, as written. Empty string if not stated." },
          prereq: { type: "STRING", description: "Prerequisites as written. Empty string if none stated." },
          description: { type: "STRING", description: "One short sentence from the catalogue. Empty string if none." }
        },
        required: ["name", "code", "subject", "level", "grades", "prereq", "description"]
      }
    },
    schoolName: { type: "STRING", description: "The school's name if the page states it, else empty string." },
    summary: { type: "STRING" },
    clarify: { type: "STRING" }
  },
  required: ["courses", "schoolName", "summary", "clarify"]
};

const LINK_SYSTEM = `You are reading the text of a real web page a student pasted a link to, so they
don't have to retype what's on it. Extract only what the page actually states. Never invent a date,
time, room or course that isn't there — leave the field blank instead, and mention the gap in
"clarify". Web pages carry a lot of navigation and footer text; ignore it and extract only the
substantive content. Times are 24-hour HH:MM, dates are YYYY-MM-DD.`;

const LINK_KINDS = {
  schedule: {
    schema: () => SCHEDULE_SCHEMA,
    prompt: (t) => `Today's date is ${t}. This page is a class schedule, an activity schedule, a school
bell/period-times table, or several of those. Extract everything you can read. If it is a bell
schedule, put the periods in "periods" and leave "entries" empty.`
  },
  bell: {
    schema: () => SCHEDULE_SCHEMA,
    prompt: (t) => `Today's date is ${t}. This page contains a school bell schedule — the period
times for a normal day. Put every period, lunch and passing period into "periods" in the order they
occur, and leave "entries" empty. If the page shows several different day types (regular, early
release, assembly), extract the regular/standard one and say in "clarify" which others exist.`
  },
  events: {
    schema: () => EVENT_SCHEMA,
    prompt: (t) => `Today's date is ${t}. This page lists events — a school calendar, an athletics
schedule, an exam timetable, or a single event page. Extract every dated event. When a year isn't
stated, choose the one that makes the date fall in the current school year relative to today.`
  },
  electives: {
    schema: () => ELECTIVE_SCHEMA,
    prompt: () => `This page is a school's course catalogue or course-selection list. Extract every
course a student could choose to take. Include core courses as well as electives — the student's
own record decides which are relevant, not you. If the page is not a course list, return an empty
"courses" array and say so in "clarify".`
  }
};

/**
 * Links on the page that might be the real course list.
 *
 * Ranked so a PDF course guide and anything whose text says "course",
 * "catalog", "registration" or "guide" floats to the top. This is what makes
 * an index page recoverable rather than a dead end.
 */
function candidateLinks(links, kind) {
  const want = {
    electives: /course|catalog|catalogue|elective|registration|program of stud|curriculum|guide|handbook/i,
    bell:      /bell|schedule|daily|period|start.*time|hour/i,
    schedule:  /schedule|calendar|practice|season|roster/i,
    events:    /calendar|event|schedule|athletic|game|exam|final/i
  }[kind] || /./;
  return (links || [])
    .map((l) => ({ ...l, hit: want.test(l.text) || want.test(l.url) }))
    .filter((l) => l.hit)
    // A PDF course guide is the single most common answer, so surface it first.
    .sort((a, b) => (b.pdf ? 1 : 0) - (a.pdf ? 1 : 0))
    .slice(0, 8)
    .map((l) => ({ url: l.url, text: l.text, pdf: l.pdf }));
}

/**
 * POST /assistant/from-url { url | text, kind }
 *
 * Fetching happens here rather than in the browser for two reasons: a school
 * website will not send CORS headers to a Netlify origin, so the browser
 * simply cannot read it; and a URL somebody pasted needs SSRF screening
 * before anything requests it, which only the server can enforce.
 *
 * `text` is the escape hatch, and it matters more than it looks: plenty of
 * school pages render their content with JavaScript, sit behind a login, or
 * publish the real list as a PDF. Without a paste path those pages have no
 * route through the feature at all.
 *
 * Every response carries `source`, including a sample of what was actually
 * read. When extraction finds nothing, that sample is the difference between
 * "it didn't work" and "the page served navigation and nothing else" — the
 * caller can see the cause rather than guess at it.
 */
async function fromUrl(req) {
  requireConfigured();
  const b = await body(req);
  const kind = String(b.kind || "schedule");
  const spec = LINK_KINDS[kind];
  if (!spec) return fail(400, `Unknown kind "${kind}".`);

  const pasted = String(b.text || "").trim();
  const url = String(b.url || "").trim();
  if (!pasted && !url) return fail(400, "Paste a link, or paste the text itself.");

  let page;
  if (pasted) {
    page = { url: "", title: "", text: pasted.slice(0, MAX_PAGE_TEXT * 2), links: [], unrendered: false };
  } else {
    // Throws {status, message} for anything unfetchable — a private address,
    // a login wall, a PDF, a timeout — each with a message naming what to do
    // instead rather than a generic failure.
    page = await fetchPage(url, { allowHttp: true });
  }

  const source = {
    url: page.url,
    title: page.title,
    chars: page.text.length,
    // Enough to recognise the page, short enough not to be a second copy of it.
    sample: page.text.slice(0, 600),
    unrendered: !!page.unrendered,
    candidates: pasted ? [] : candidateLinks(page.links, kind)
  };

  if (!page.text || page.text.length < 40) {
    return fail(422, "That page had almost no readable text at all. Open it, select the part you want, " +
      "and paste it in as text instead.", { source });
  }
  if (page.unrendered) {
    return fail(422, "That page served its navigation but not its content — it builds the page with " +
      "JavaScript, which a server-side fetch can't run. Paste the text instead, or try a direct link " +
      "to the document itself.", { source });
  }

  const today = new Date().toISOString().slice(0, 10);
  const text = page.text.slice(0, MAX_PAGE_TEXT);
  const result = await generateJSON({
    system: LINK_SYSTEM,
    prompt: `${spec.prompt(today)}
${page.title ? `\nPage title: ${page.title}` : ""}${page.url ? `\nPage URL: ${page.url}` : ""}

"""${text}"""`,
    responseSchema: spec.schema()
  });

  return ok({ ...result, source });
}

/* ------------------------------------------------------- notes from a photo -- */

const NOTE_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING", description: "A short, specific title for these notes." },
    body: { type: "STRING", description: "The note content as Markdown. Preserve headings, bullet lists, numbering, and any term — definition pairs. Use $...$ style plain text for formulas if you can't render them." },
    tags: { type: "ARRAY", items: { type: "STRING" }, description: "0-4 short lowercase topic tags." },
    subject: { type: "STRING", description: "Best guess at the school subject, or empty string." },
    confidence: { type: "STRING", enum: ["high", "medium", "low"] },
    clarify: { type: "STRING", description: "A short note about anything unreadable. Empty string if all clear." }
  },
  required: ["title", "body", "tags", "subject", "confidence", "clarify"]
};

const NOTE_SYSTEM = `You transcribe a photo of a student's notes — handwritten, printed, a textbook
page, or a whiteboard — into clean Markdown they can study from. Transcribe what's actually there;
never invent content to fill a gap. Keep the original structure: headings stay headings, bullets
stay bullets, "term — definition" lines keep that shape so they can become flashcards later. If a
word or symbol is genuinely illegible, write [?] in place of it and mention it in clarify rather
than guessing. If the page is mostly unreadable, say so in clarify and set confidence to low.`;

async function parseNoteImage(req) {
  requireConfigured();
  const b = await body(req);
  const imageBase64 = String(b.imageBase64 || "");
  const mimeType = String(b.mimeType || "image/jpeg");
  if (!imageBase64) return fail(400, "No image received.");
  if (imageBase64.length > MAX_IMAGE_B64_LEN) return fail(413, "That image is too large — try a smaller photo.");
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(mimeType)) return fail(400, "Unsupported image type.");

  const result = await generateJSON({
    system: NOTE_SYSTEM,
    prompt: "Transcribe these notes into Markdown.",
    responseSchema: NOTE_SCHEMA,
    image: { base64: imageBase64, mimeType }
  });
  return ok(result);
}

/* ---------------------------------------------------------- time estimate -- */

const ESTIMATE_SCHEMA = {
  type: "OBJECT",
  properties: {
    minutes: { type: "INTEGER", description: "Estimated focused working minutes for a typical student at this level." },
    low: { type: "INTEGER", description: "Optimistic estimate in minutes." },
    high: { type: "INTEGER", description: "Pessimistic estimate in minutes." },
    reasoning: { type: "STRING", description: "One short sentence on what drove the estimate." },
    suggestedSteps: {
      type: "ARRAY",
      description: "2-6 concrete steps to break the work into. Empty array for something genuinely atomic.",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          minutes: { type: "INTEGER" }
        },
        required: ["title", "minutes"]
      }
    }
  },
  required: ["minutes", "low", "high", "reasoning", "suggestedSteps"]
};

const ESTIMATE_SYSTEM = `You estimate how long a school assignment will realistically take one student
of focused work, and suggest how to break it up. Be realistic, not optimistic — students
consistently underestimate. Account for the assignment type (an essay needs planning, drafting and
revision; a problem set is more linear), the stated point value, and how the student's own past
estimates compared to reality if that's given. Keep suggestedSteps genuinely actionable, and make
their minutes roughly add up to your estimate. If the description is too vague to judge, still give
a sensible default for that assignment type and say so in reasoning.`;

/** Keep only the handful of numbers the prompt actually uses. */
function clampCalibration(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    samples: n(raw.samples),
    ratio: n(raw.ratio),
    avgEstimateMin: n(raw.avgEstimateMin),
    avgActualMin: n(raw.avgActualMin)
  };
}

async function estimate(req) {
  requireConfigured();
  const b = await body(req);
  const title = String(b.title || "").trim().slice(0, 300);
  if (!title) return fail(400, "Give the assignment a title first.");
  const detail = {
    title,
    type: String(b.type || "").slice(0, 60),
    className: String(b.className || "").slice(0, 100),
    points: Number(b.points) || null,
    notes: String(b.notes || "").slice(0, 1000),
    // Every sibling field is capped; this one was passed through whole, so a
    // multi-megabyte object went straight into the prompt — an expensive call
    // any caller could trigger at will.
    studentCalibration: clampCalibration(b.calibration)
  };
  const result = await generateJSON({
    system: ESTIMATE_SYSTEM,
    prompt: `Estimate this assignment:\n${JSON.stringify(detail, null, 2)}`,
    responseSchema: ESTIMATE_SCHEMA
  });
  return ok(result);
}

/* -------------------------------------------------------- assistant actions -- */

const ACTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    answer: { type: "STRING", description: "A short reply to show the student. If proposing actions, describe them in one sentence." },
    actions: {
      type: "ARRAY",
      description: "Changes to propose. Empty array when the message is only a question.",
      items: {
        type: "OBJECT",
        properties: {
          kind: { type: "STRING", enum: [
            "addAssignment", "completeAssignment", "addActivity", "addNote", "addEvent",
            "deleteAssignment", "deleteActivity", "deleteNote", "deleteEvent"
          ] },
          title: { type: "STRING" },
          className: { type: "STRING", description: "Class name to attach to, or empty string." },
          due: { type: "STRING", description: "YYYY-MM-DD, or empty string." },
          type: { type: "STRING", description: "Assignment type (Homework, Essay, Test...) or activity type. Empty string if not applicable." },
          days: { type: "ARRAY", items: { type: "STRING", enum: DAY_ENUM }, description: "For addActivity only." },
          start: { type: "STRING", description: "24-hour HH:MM, or empty string." },
          end: { type: "STRING", description: "24-hour HH:MM, or empty string." },
          body: { type: "STRING", description: "For addNote only." },
          targetId: { type: "STRING", description: "For completeAssignment and every delete* kind: the exact id from context. Empty string otherwise." },
          summary: { type: "STRING", description: "One plain-language line describing this change, shown for confirmation." }
        },
        required: ["kind", "title", "className", "due", "type", "days", "start", "end", "body", "targetId", "summary"]
      }
    }
  },
  required: ["answer", "actions"]
};

const ACT_SYSTEM = `You are the private assistant built into StudyHold, a school-tracker app, for one
student. You only know the JSON context given for this one message.

You can do two things: answer questions about that context, and propose changes to the student's
own data. Scope is strictly their schedule, coursework, and how to use the app — decline anything
else (essay writing, homework answers, general knowledge, chit-chat) in one short sentence.

Propose actions ONLY when the student is clearly asking to record or change something ("add...",
"I have a test Friday", "mark X done"). A question like "what's due?" gets an answer and an empty
actions array. Never propose an action the student didn't ask for.

For completeAssignment and every delete* kind, targetId must be an exact id copied from the
context — never invent one; if you can't find a confident match, ask which one instead of guessing.
Only propose a delete* action when the student clearly asks to remove or cancel something, never as
a side effect of another request. Dates are YYYY-MM-DD; resolve relative dates ("Friday", "next
week") against today's date in the context. Match className to a real class name in the context when
you can, otherwise leave it blank.

Keep "answer" brief — a sentence or two. Every action needs a clear "summary", because the student
sees it and confirms before anything is saved.`;

async function act(req) {
  requireConfigured();
  const b = await body(req);
  const message = String(b.message || "").trim().slice(0, 500);
  if (!message) return fail(400, "Say something first.");
  let context = b.context;
  if (typeof context !== "string") context = JSON.stringify(context || {});
  if (context.length > MAX_CONTEXT_LEN) context = context.slice(0, MAX_CONTEXT_LEN);

  const result = await generateJSON({
    system: ACT_SYSTEM,
    prompt: `Context (JSON):\n${context}\n\nStudent says: ${message}`,
    responseSchema: ACTION_SCHEMA
  });
  return ok(result);
}

const ASK_SYSTEM = `You are the private assistant built into StudyHold, a school-tracker app, for one
student. You only know what's in the JSON context you're given for this one message — no memory
of anything else, no access to any other student's data, nothing stored between questions.

Your scope is exactly two things, and nothing else:
1. Answering questions about the context you were given — this student's own classes, schedule,
   assignments, grades/GPA, activities, goals, habits, reading, attendance, and bell schedule.
2. Explaining how to use the StudyHold app — where a feature lives, what something does, how a
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

  // Anonymous callers learn only whether the feature is switched on — enough
  // for the UI to say "AI isn't set up" without an account. The key's length
  // and the model configuration are deployment details, and ?probe=1 spends
  // real quota, so both need a signed-in account. Previously all of it,
  // including a billable round-trip per GET, was open to anyone.
  const user = await currentUser(req);
  if (!user) return ok({ configured: !!key });

  // The key's length and the model name are this deploy's configuration.
  // Signing up is not authorisation to read it — anyone can sign up, and
  // "authenticated" is a low bar the moment the app is public. The operator
  // (ADMIN_EMAIL) gets the full picture; everyone else gets the on/off fact
  // the UI needs plus a probe that says whether the round-trip worked.
  const operator = isOperator(user);
  const out = { configured: !!key, operator };
  if (operator) {
    Object.assign(out, {
      keyPresent: !!key,
      keyLength: key.length,
      keyLooksTrimmed: key === key.trim(),
      model,
      modelSource: process.env.GEMINI_MODEL ? "GEMINI_MODEL env var" : "built-in default"
    });
  }

  const probe = new URL(req.url).searchParams.get("probe");
  if (probe && key) {
    // A probe is a real call; charge it like one.
    await charge(user, "text");
    const started = Date.now();
    try {
      const answer = await generateText({
        system: "Reply with exactly the word: ok",
        prompt: "Say ok.",
        maxOutputTokens: 10
      });
      out.probe = { ok: true, ms: Date.now() - started, reply: String(answer).trim().slice(0, 40) };
    } catch (e) {
      // Google's own error text carries the Cloud project number on a quota
      // rejection and the model name on a bad-model one. Operator only.
      out.probe = operator
        ? { ok: false, ms: Date.now() - started, code: e.code || "unknown", status: e.status || null, error: e.message }
        : { ok: false, ms: Date.now() - started, error: "The AI service didn't answer." };
    }
  } else if (probe) {
    out.probe = { ok: false, code: "not-configured", error: "GEMINI_API_KEY isn't set on this deploy." };
  }

  return ok(out);
}

/* --------------------------------------------------------------- routes -- */

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsFor(req) });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/assistant\/?/, "").replace(/\/+$/, "");
  const method = req.method.toUpperCase();

  try {
    if (path === "health" && method === "GET") return await health(req);

    // Everything past here spends provider quota, so it needs an account and
    // a budget. charge() throws 429 when the account is over its allowance.
    if (path === "parse-text" && method === "POST") {
      const user = await requireUser(req); await charge(user, "text");
      return await parseText(req);
    }
    if (path === "parse-image" && method === "POST") {
      const user = await requireUser(req); await charge(user, "image");
      return await parseImage(req);
    }
    if (path === "parse-note-image" && method === "POST") {
      const user = await requireUser(req); await charge(user, "image");
      return await parseNoteImage(req);
    }
    // Costs a page fetch plus a long-context call, so it is charged at the
    // image rate rather than the text rate.
    if (path === "from-url" && method === "POST") {
      const user = await requireUser(req); await charge(user, "image");
      return await fromUrl(req);
    }
    if (path === "estimate" && method === "POST") {
      const user = await requireUser(req); await charge(user, "text");
      return await estimate(req);
    }
    if (path === "act" && method === "POST") {
      const user = await requireUser(req); await charge(user, "text");
      return await act(req);
    }
    if (path === "ask" && method === "POST") {
      const user = await requireUser(req); await charge(user, "text");
      return await ask(req);
    }
    return fail(404, "No such endpoint: " + method + " /" + path);
  } catch (e) {
    if (e && e.code === "not-configured") {
      return fail(503, "The AI assistant isn't set up yet — add a GEMINI_API_KEY in the Netlify environment.");
    }
    // Provider errors carried Google's own text straight to the client —
    // quota messages include the Google Cloud project number, and any
    // uncaught TypeError from our own code went out as the response body.
    // Deployment detail stays in the logs; the caller gets something useful
    // and nothing internal.
    if (e && e.code === "provider-error") {
      console.error("[assistant] provider error", e.status, e.detail || e.message);
      return fail(e.status >= 500 ? 503 : 502,
        e.status === 429
          ? "The AI service is over its quota right now. Try again later."
          : "The AI service couldn't handle that request. Try again in a moment.");
    }
    if (e && e.status) return fail(e.status, e.message);
    console.error("[assistant]", e);
    return fail(500, "Something went wrong.");
  }
};

export const config = { path: "/assistant/*" };
