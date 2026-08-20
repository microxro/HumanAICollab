/* ==========================================================================
   assistant.js — client for the AI features: natural-language add, photo
   schedule extraction, and the private data assistant

   Talks to the /assistant/* Netlify function (js side of
   netlify/functions/assistant.js). Nothing here is authenticated — the
   endpoints are stateless, so this module's whole job is (a) building the
   request (including, for /ask, a context digest computed entirely from
   this device's own local data) and (b) turning provider errors into
   messages a student would understand.
   ========================================================================== */

App.assistant = (function () {
  const U = App.utils, S = App.store;

  const MAX_IMAGE_DIM = 1600;
  const JPEG_QUALITY = 0.82;

  function base() {
    return (S.db.settings.apiBase || "").replace(/\/(api)?\/?$/, "") || "";
  }

  async function req(path, payload) {
    let res;
    try {
      res = await fetch(base() + "/assistant" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {})
      });
    } catch (e) {
      throw new Error("Can't reach the AI service. Check your connection.");
    }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  /* ---------------------------------------------------- schedule parsing -- */

  async function parseText(text) {
    return req("/parse-text", { text });
  }

  /** Downscales + re-encodes a photo client-side before it ever leaves the device. */
  function fileToImagePayload(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM) {
          const scale = MAX_IMAGE_DIM / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
        resolve({ mimeType: "image/jpeg", base64: dataUrl.split(",")[1] });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image.")); };
      img.src = url;
    });
  }

  async function parseImage(file) {
    const { base64, mimeType } = await fileToImagePayload(file);
    return req("/parse-image", { imageBase64: base64, mimeType });
  }

  /* --------------------------------------------------------- ask (Q&A) -- */

  const FREE_BLOCK_MIN_MINUTES = 20;
  const DAY_START_MIN = 7 * 60;      // 7:00am
  const DAY_END_MIN = 22 * 60;       // 10:00pm

  function freeBlocksFor(items) {
    const busy = items
      .filter((x) => x.start && x.end)
      .map((x) => [U.toMin(x.start), U.toMin(x.end)])
      .sort((a, b) => a[0] - b[0]);

    const merged = [];
    busy.forEach(([s, e]) => {
      const last = merged[merged.length - 1];
      if (last && s <= last[1]) last[1] = Math.max(last[1], e);
      else merged.push([s, e]);
    });

    const free = [];
    let cursor = DAY_START_MIN;
    merged.forEach(([s, e]) => {
      if (s - cursor >= FREE_BLOCK_MIN_MINUTES) free.push([cursor, s]);
      cursor = Math.max(cursor, e);
    });
    if (DAY_END_MIN - cursor >= FREE_BLOCK_MIN_MINUTES) free.push([cursor, DAY_END_MIN]);

    return free.map(([s, e]) => ({ start: U.fromMin(s), end: U.fromMin(e), minutes: e - s }));
  }

  /**
   * Everything the assistant is allowed to know for one question — built
   * fresh from local data every time, never persisted server-side. Free-time
   * blocks are precomputed here (not left for the model to derive) so
   * "do I have time to..." answers are arithmetic, not a guess.
   */
  function buildContext() {
    const days = [];
    for (let i = 0; i < 7; i++) days.push(U.dateKey(U.addDays(new Date(), i)));

    const schedule = {};
    const freeTime = {};
    days.forEach((iso) => {
      const items = S.scheduleFor(iso)
        .map((x) => ({ kind: x.kind, title: x.title, start: x.start, end: x.end, location: x.location || "" }));
      schedule[iso] = items;
      freeTime[iso] = freeBlocksFor(items);
    });

    const windowEnd = U.dateKey(U.addDays(new Date(), 14));
    const assignments = S.db.assignments
      .filter((a) => a.status !== "done" && a.status !== "archived" && a.due <= windowEnd)
      .map((a) => ({
        title: a.title, class: S.className(a.classId), due: a.due,
        status: a.status, priority: a.priority, overdue: S.overdue().some((o) => o.id === a.id)
      }));

    const classes = S.termClasses().map((c) => ({
      name: c.name, room: c.room,
      teacher: S.teacher(c.teacherId) ? S.teacher(c.teacherId).name : "",
      grade: S.classGrade(c.id)
    }));

    const term = S.currentTerm();

    return {
      today: U.today(), dayOfWeek: U.dowName(U.today(), true),
      schedule, freeTimeBlocks: freeTime,
      assignmentsDueSoon: assignments,
      classes, gpa: term ? S.gpa(false, term.id) : null
    };
  }

  const HISTORY_KEY = "assistantChat";
  const MAX_HISTORY = 40;

  function history() { return S.db[HISTORY_KEY] || []; }

  function pushHistory(role, text) {
    S.commit((db) => {
      if (!db[HISTORY_KEY]) db[HISTORY_KEY] = [];
      db[HISTORY_KEY].push({ role, text, at: Date.now() });
      if (db[HISTORY_KEY].length > MAX_HISTORY) db[HISTORY_KEY] = db[HISTORY_KEY].slice(-MAX_HISTORY);
    });
  }

  function clearHistory() {
    S.commit((db) => { db[HISTORY_KEY] = []; });
  }

  async function ask(question) {
    pushHistory("user", question);
    try {
      const context = buildContext();
      const { answer } = await req("/ask", { question, context });
      pushHistory("assistant", answer);
      return answer;
    } catch (e) {
      pushHistory("assistant", e.message);
      throw e;
    }
  }

  return { parseText, parseImage, ask, buildContext, history, clearHistory };
})();
