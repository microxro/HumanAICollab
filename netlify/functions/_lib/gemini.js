/* ==========================================================================
   _lib/gemini.js — text + vision calls to Google's Gemini API

   One place that knows how to talk to Gemini; every AI feature (natural-
   language schedule add, photo/schedule-image extraction, the private
   assistant) calls generateJSON() or generateText() rather than building
   requests by hand. Uses Gemini specifically because its free tier covers
   both text and vision from a single API key — no card, no bill, as long
   as usage stays inside Google's free quota. Missing GEMINI_API_KEY
   doesn't crash the caller — configured() lets the route return a clear
   "not set up" error instead of a 500.
   ========================================================================== */

const DEFAULT_MODEL = "gemini-3.7-flash";

function configured() {
  return !!process.env.GEMINI_API_KEY;
}

function endpoint() {
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

async function callGemini({ system, parts, responseSchema, maxOutputTokens }) {
  if (!configured()) {
    throw Object.assign(new Error("not-configured"), { code: "not-configured" });
  }

  const generationConfig = { temperature: 0.2 };
  if (responseSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = responseSchema;
  }
  if (maxOutputTokens) generationConfig.maxOutputTokens = maxOutputTokens;

  const res = await fetch(endpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      generationConfig
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[gemini] request failed", res.status, text);
    // Surface what the provider actually said. Swallowing this behind a
    // generic "try again" made a wrong key or a bad model name look identical
    // to a transient blip, which is the difference between a two-minute fix
    // and an unfixable mystery.
    let detail = "";
    try {
      const parsed = JSON.parse(text);
      detail = (parsed && parsed.error && parsed.error.message) || "";
    } catch (e) {
      detail = String(text || "").slice(0, 200);
    }
    const generic = res.status >= 500
      ? "The AI service is having trouble — try again in a moment."
      : "The AI service rejected that request.";
    throw Object.assign(new Error(detail || generic),
      { code: "provider-error", status: res.status, detail });
  }

  const data = await res.json();
  const candidate = data.candidates && data.candidates[0];
  const blockReason = data.promptFeedback && data.promptFeedback.blockReason;
  if (blockReason) throw Object.assign(new Error("That request couldn't be processed."), { code: "blocked" });
  const textOut = candidate && candidate.content && candidate.content.parts
    ? candidate.content.parts.map((p) => p.text || "").join("")
    : "";
  if (!textOut) throw Object.assign(new Error("The AI didn't return anything usable — try rephrasing."), { code: "empty" });
  return textOut;
}

/** Free-form text answer (the private assistant). */
async function generateText({ system, prompt, maxOutputTokens }) {
  const text = await callGemini({ system, parts: [{ text: prompt }], maxOutputTokens });
  return text;
}

/**
 * Structured extraction (schedule parsing, photo parsing). `responseSchema`
 * is a Gemini-flavored JSON Schema object; the model is constrained to
 * return exactly that shape, so callers don't need to defend against
 * loosely-formatted text.
 */
async function generateJSON({ system, prompt, image, responseSchema }) {
  const parts = [{ text: prompt }];
  if (image) parts.push({ inline_data: { mime_type: image.mimeType, data: image.base64 } });
  const text = await callGemini({ system, parts, responseSchema });
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("[gemini] non-JSON response", text.slice(0, 300));
    throw Object.assign(new Error("The AI's answer wasn't in the expected format — try again."), { code: "bad-json" });
  }
}

export { configured, generateText, generateJSON, DEFAULT_MODEL };
