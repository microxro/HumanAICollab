/* ==========================================================================
   assistant.js — client for the AI features: natural-language add, photo
   schedule extraction, and the private data assistant

   Talks to the /assistant/* Netlify function (js side of
   netlify/functions/assistant.js). Every route that spends provider quota
   needs the signed-in account's bearer token and is rate limited per
   account, so this module (a) attaches that token, (b) builds the request
   (including, for /ask, a context digest computed entirely from this
   device's own local data) and (c) turns server and provider errors into
   messages a student would understand.
   ========================================================================== */

App.assistant = (function () {
  const U = App.utils, S = App.store;

  const MAX_IMAGE_DIM = 1600;
  const JPEG_QUALITY = 0.82;

  function base() {
    return (S.db.settings.apiBase || "").replace(/\/(api)?\/?$/, "") || "";
  }

  function authHeaders() {
    const t = App.sync && App.sync.authToken && App.sync.authToken();
    return t ? { Authorization: "Bearer " + t } : {};
  }

  /** True when the AI features are usable at all right now. */
  function available() {
    return !!(App.sync && App.sync.isSignedIn && App.sync.isSignedIn());
  }

  async function req(path, payload) {
    if (!available()) {
      throw new Error("Sign in to use the AI features — they run on a shared quota, so they're tied to your account.");
    }
    let res;
    try {
      res = await fetch(base() + "/assistant" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload || {})
      });
    } catch (e) {
      throw new Error("Can't reach the AI service. Check your connection.");
    }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      if (res.status === 401) throw new Error("Your session expired — sign in again to use the AI features.");
      if (res.status === 429) throw new Error((data && data.error) || "You've used your AI allowance for now.");
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      // Diagnostics ride on the error, not just the success path. A failure
      // that can show what the server actually read is the difference between
      // "it didn't work" and a cause the user can act on.
      if (data && data.source) err.source = data.source;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /**
   * Ask the server what it can see: is a key present, what model will it use,
   * and (with probe) does a real round-trip succeed. Surfaced in Settings so
   * "the AI doesn't work" becomes a specific, readable cause.
   */
  async function checkHealth(probe) {
    let res;
    try {
      res = await fetch(base() + "/assistant/health" + (probe ? "?probe=1" : ""),
        { headers: authHeaders() });
    } catch (e) {
      throw new Error("Can't reach the AI service. Check your connection, or the site may not have redeployed yet.");
    }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      throw new Error((data && data.error) ||
        (res.status === 404
          ? "The /assistant function isn't deployed. Push and redeploy the site."
          : `Health check failed (${res.status})`));
    }
    return data;
  }

  /* ---------------------------------------------------- schedule parsing -- */

  async function parseText(text) {
    return req("/parse-text", { text });
  }

  /**
   * Read a page the student pasted a link to, and pull structured data out.
   *
   * The fetch is done by the server, not here. A school website sends no CORS
   * headers to this origin, so the browser is not permitted to read it at
   * all — and a pasted URL needs screening against private addresses before
   * anything requests it, which only the server can enforce.
   *
   * `kind` is "schedule" | "bell" | "events" | "electives".
   */
  async function fromUrl(url, kind) {
    return req("/from-url", { url: String(url || "").trim(), kind: kind || "schedule" });
  }

  /**
   * Same extraction, but from text the student pasted rather than a page.
   *
   * The fallback for every page the server can't read: JavaScript-rendered
   * sites, anything behind a school login, and PDFs. Without it those pages
   * have no route through the feature at all.
   */
  async function fromText(text, kind) {
    return req("/from-url", { text: String(text || "").trim(), kind: kind || "schedule" });
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

  /** Photo of handwritten/printed notes → { title, body (Markdown), tags, … }. */
  async function parseNoteImage(file) {
    const { base64, mimeType } = await fileToImagePayload(file);
    return req("/parse-note-image", { imageBase64: base64, mimeType });
  }

  /* -------------------------------------------------- F160 study quiz --

     Two calls, and they have to stay two. The first sends the topic the
     student picked and gets a quiz back with no answers in it; the second
     sends what they picked and gets the score. Grading on the device would
     mean shipping the answer key to the device, which is the one thing this
     design exists to avoid.                                                 */

  /**
   * Topic → { ok:true, questions[], ticket, subject, difficulty } or
   * { ok:false, reason } when the topic isn't something school quizzes.
   *
   * `className` is context for the model, not a filter — "photosynthesis" in
   * Biology and in Geography are different questions.
   */
  async function makeTopicQuiz(topic, opts) {
    const o = opts || {};
    return req("/study-topic", {
      topic: String(topic || "").slice(0, 80),
      className: String(o.className || "").slice(0, 60),
      difficulty: String(o.difficulty || "medium")
    });
  }

  /** Answers → { correct, total, grade, tokens, wrong[], topic, difficulty }. */
  async function gradeStudyQuiz(ticket, answers) {
    return req("/study-quiz", {
      ticket: String(ticket || ""),
      answers: (answers || []).map((a) => Number(a))
    });
  }

  /**
   * AI time estimate for one assignment. Sends the student's own historical
   * estimate-vs-actual multiplier so the model can calibrate to how *this*
   * person works, not a generic student.
   */
  async function estimateAssignment(a) {
    const calibration = (() => {
      const done = S.db.assignments.filter((x) => x.actualMinutes > 0 && x.estMinutes > 0);
      if (done.length < 3) return null;
      const ratio = U.sum(done, (x) => x.actualMinutes) / U.sum(done, (x) => x.estMinutes);
      return { pastAssignments: done.length, actualVsEstimateRatio: Math.round(ratio * 100) / 100 };
    })();
    return req("/estimate", {
      title: a.title, type: a.type, className: S.className(a.classId),
      points: a.points, notes: a.notes, calibration
    });
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
   * Everything the assistant is allowed to know for one question — the
   * student's full scheduling/academic picture, built fresh from local data
   * every time and never persisted server-side. Free-time blocks are
   * precomputed here (not left for the model to derive) so "do I have time
   * to..." answers are arithmetic, not a guess. Respects the existing
   * "hide GPA" wellbeing preference — grade fields come back null rather
   * than silently ignoring a privacy setting the student already turned on
   * elsewhere in the app.
   */
  function buildContext() {
    const days = [];
    for (let i = 0; i < 14; i++) days.push(U.dateKey(U.addDays(new Date(), i)));

    const schedule = {};
    const freeTime = {};
    days.forEach((iso) => {
      const items = S.scheduleFor(iso)
        .map((x) => ({ kind: x.kind, title: x.title, start: x.start, end: x.end, location: x.location || "" }));
      schedule[iso] = items;
      freeTime[iso] = freeBlocksFor(items);
    });

    const hideGPA = !!(S.db.settings.wellbeing && S.db.settings.wellbeing.hideGPA);
    const term = S.currentTerm();

    const classes = S.termClasses().map((c) => ({
      name: c.name, code: c.code || "", room: c.room, credits: c.credits,
      teacher: S.teacher(c.teacherId) ? S.teacher(c.teacherId).name : "",
      period: S.classPeriod(c) ? S.classPeriod(c).name : "",
      offSchedule: !!c.offSchedule,
      days: c.days,
      grade: hideGPA ? null : S.classGrade(c.id)
    }));

    const assignments = S.db.assignments
      .filter((a) => a.status !== "archived")
      .map((a) => ({
        title: a.title, class: S.className(a.classId), due: a.due,
        status: a.status, priority: a.priority, type: a.type,
        overdue: S.overdue().some((o) => o.id === a.id)
      }));

    const activities = S.db.activities.map((a) => ({
      name: a.name, type: a.type, days: a.days, start: a.start, end: a.end,
      location: a.location || "", season: a.season || "",
      startDate: a.startDate || null, endDate: a.endDate || null,
      // Whether it is run by the school changes the answer to most questions
      // worth asking about it — whether it happens over the holidays, who to
      // contact, and whether it costs anything.
      outsideSchool: !!a.external,
      provider: a.provider || "", cost: a.cost == null ? null : a.cost, costPer: a.costPer || null
    }));

    const bellSchedule = S.db.periods.map((p) => ({ name: p.name, start: p.start, end: p.end }));

    const goals = S.db.goals.map((g) => {
      const p = S.goalProgress(g);
      return {
        title: g.title, target: g.target, unit: g.unit, deadline: g.deadline, done: g.done,
        current: (hideGPA && g.metric === "gpa") ? null : p.current,
        percentComplete: Math.round(p.pct)
      };
    });

    const habits = S.db.habits.map((h) => ({ name: h.name, currentStreakDays: S.habitStreak(h) }));

    const reading = S.db.reading.filter((r) => !r.done).map((r) => {
      const p = S.readingPace(r);
      return { title: r.title, class: S.className(r.classId), pagesLeft: p.pagesLeft, daysLeft: p.daysLeft, pagesPerDayNeeded: p.perDay };
    });

    const teachers = S.db.teachers.map((t) => ({ name: t.name, subject: t.subject, room: t.room, officeHours: t.office || "" }));

    return {
      today: U.today(), dayOfWeek: U.dowName(U.today(), true),
      student: S.db.profile ? { name: S.db.profile.name, grade: S.db.profile.grade, school: S.db.profile.school } : null,
      term: term ? { name: term.name, start: term.start, end: term.end } : null,
      gpaHidden: hideGPA,
      gpaWeighted: hideGPA || !term ? null : S.gpa(true, term.id),
      gpaUnweighted: hideGPA || !term ? null : S.gpa(false, term.id),
      cumulativeGpa: hideGPA ? null : S.cumulativeGpa(),
      classes,
      bellSchedule,
      schedule, freeTimeBlocks: freeTime,
      assignments,
      activities,
      goals, habits, reading,
      attendance: S.attendanceRate(),
      teachers
    };
  }

  /* -------------------------------------------------------- act (agentic) -- */

  /**
   * Send a message that might be a request to change something. Returns
   * { answer, actions } — actions are PROPOSALS. Nothing is written until
   * applyAction() is called, which the UI only does after the student
   * confirms. Includes assignment ids in the context so "mark X done" can
   * resolve to a real record rather than a fuzzy title match.
   */
  async function act(message) {
    const context = buildContext();
    context.assignmentIds = S.db.assignments
      .filter((a) => a.status !== "done" && a.status !== "archived")
      .slice(0, 100)
      .map((a) => ({ id: a.id, title: a.title, class: S.className(a.classId), due: a.due }));
    context.classNames = S.termClasses().map((c) => ({ id: c.id, name: c.name }));
    return req("/act", { message, context });
  }

  function classIdByName(name) {
    if (!name) return null;
    const want = String(name).toLowerCase().trim();
    const list = S.termClasses();
    const exact = list.find((c) => c.name.toLowerCase() === want);
    if (exact) return exact.id;
    const partial = list.find((c) => c.name.toLowerCase().includes(want) || want.includes(c.name.toLowerCase()));
    return partial ? partial.id : null;
  }

  /**
   * Execute one confirmed action against the local store. Deliberately strict:
   * an action referring to a record that no longer exists throws rather than
   * silently doing nothing, so the UI can tell the student it didn't apply.
   */
  function applyAction(a) {
    switch (a.kind) {
      case "addAssignment": {
        const classId = classIdByName(a.className) || (S.termClasses()[0] || {}).id || null;
        const cls = classId ? S.cls(classId) : null;
        const rec = S.insert("assignments", {
          title: a.title || "Untitled", classId,
          categoryId: cls && (cls.categories || [])[0] ? cls.categories[0].id : null,
          due: a.due || U.today(), type: a.type || "Homework", priority: "med",
          status: "todo", points: 100, earned: null, graded: false,
          estMinutes: 45, actualMinutes: 0, subtasks: [], notes: "",
          assigned: U.today(), termId: (S.currentTerm() || {}).id,
          scheduledFor: null, scheduledMin: null, missing: false
        });
        return `Added “${rec.title}”`;
      }
      case "completeAssignment": {
        const target = a.targetId ? S.byId("assignments", a.targetId) : null;
        if (!target) throw new Error(`Couldn't find that assignment any more.`);
        S.update("assignments", target.id, { status: "done" });
        return `Marked “${target.title}” done`;
      }
      case "addActivity": {
        const rec = S.insert("activities", {
          name: a.title || "Untitled", type: a.type || "Club", role: "", advisorId: null,
          location: "", start: a.start || "15:30", end: a.end || "17:00",
          season: "", color: S.PALETTE[S.db.activities.length % S.PALETTE.length],
          days: Array.isArray(a.days) && a.days.length ? a.days : ["Mon"],
          startDate: "", endDate: "", hours: [],
          external: false, provider: "", contactName: "", contactEmail: "",
          contactPhone: "", address: "", website: "", cost: null, costPer: "month",
          notes: "", addedBy: ""
        });
        return `Added “${rec.name}”`;
      }
      case "addNote": {
        const rec = S.insert("notes", {
          title: a.title || "Untitled", body: a.body || "",
          classId: classIdByName(a.className), tags: [], pinned: false,
          created: U.today(), updated: U.today()
        });
        return `Added note “${rec.title}”`;
      }
      case "addEvent": {
        // Events derive their colour from the linked class at render time
        // (see scheduleFor in store.js), so there's no colour field to set.
        const rec = S.insert("events", {
          title: a.title || "Untitled", date: a.due || U.today(),
          start: a.start || "", end: a.end || "", type: a.type || "Event",
          location: "", classId: classIdByName(a.className), notes: ""
        });
        return `Added “${rec.title}”`;
      }
      case "deleteAssignment": {
        const target = a.targetId ? S.byId("assignments", a.targetId) : null;
        if (!target) throw new Error(`Couldn't find that assignment any more.`);
        S.remove("assignments", target.id);
        return `Removed “${target.title}”`;
      }
      case "deleteActivity": {
        const target = a.targetId ? S.byId("activities", a.targetId) : null;
        if (!target) throw new Error(`Couldn't find that activity any more.`);
        S.remove("activities", target.id);
        return `Removed “${target.name}”`;
      }
      case "deleteNote": {
        const target = a.targetId ? S.byId("notes", a.targetId) : null;
        if (!target) throw new Error(`Couldn't find that note any more.`);
        S.remove("notes", target.id);
        return `Removed note “${target.title}”`;
      }
      case "deleteEvent": {
        const target = a.targetId ? S.byId("events", a.targetId) : null;
        if (!target) throw new Error(`Couldn't find that event any more.`);
        S.remove("events", target.id);
        return `Removed “${target.title}”`;
      }
      default:
        throw new Error(`Don't know how to do "${a.kind}".`);
    }
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

  return {
    parseText, parseImage, parseNoteImage, fromUrl, fromText, estimateAssignment,
    makeTopicQuiz, gradeStudyQuiz,
    ask, act, applyAction, buildContext,
    history, pushHistory, clearHistory, checkHealth, available
  };
})();
