/* ==========================================================================
   store2.js — schema v3 extension, layered on top of store.js (App.store)

   Rather than re-editing the v2 store for every one of the 150 backlog
   items, this module:
     1. Adds any new fields/collections the v2 seed/migration doesn't have,
        idempotently, in ensureV3() — called once at boot.
     2. Wraps a handful of v2 selectors (classGrade, gpa, openAssignments…)
        so grading modes, exam weighting, snoozes, and dependencies are
        respected everywhere those selectors are already used, without
        touching store.js's internals.
     3. Adds new selectors for everything else.

   Every view in js/views/ can keep calling App.store.whatever() exactly as
   before — the wrapped functions are drop-in replacements.
   ========================================================================== */

(function () {
  const S = App.store, U = App.utils;

  /* ============================================================ ensureV3 */

  function ensureV3() {
    const db = S.db;
    if (db.schemaV3) return;

    // ---- new top-level collections
    const coll = {
      rubrics: [], gradeHistory: [], regrades: [], savedFilters: [],
      journal: [], vocabLists: [], conceptMaps: [], apExams: [],
      graduationReqs: [], apiTokens: [], webhooks: [], focusWindows: [],
      guardianNotes: [], checkIns: [], emergencyContacts: [], notifications: [],
      assistantChat: [],  // [{role: "user"|"assistant", text, at}] — the private assistant's thread
      feedComments: {}   // { feedItemId: [{id, byName, text, at}] }
    };
    Object.entries(coll).forEach(([k, v]) => { if (!Array.isArray(db[k]) && typeof db[k] !== "object") db[k] = v; });
    if (!db.navVisits) db.navVisits = {};    // { navId: count } — powers U02 auto-float-to-top
    if (!db.recentViews) db.recentViews = []; // U03 — most-recent-first nav ids
    if (!db.moodLog) db.moodLog = {};        // { "YYYY-MM-DD": {mood, energy} }
    if (!db.sleepLog) db.sleepLog = {};      // { "YYYY-MM-DD": {bed, wake, hours} }
    if (!db.sessionRatings) db.sessionRatings = []; // [{id, sessionId, quality, at}]
    if (!db.changeAlerts) db.changeAlerts = []; // dismissed/seen change-detection alerts
    if (db.streak.freezes === undefined) db.streak.freezes = 0; // F040

    // ---- settings additions
    const s = db.settings;
    if (!s.pinnedNav) s.pinnedNav = []; // U02 — empty by default; top-3 most-visited float up automatically (see effectivePinnedNav)
    if (s.sidebarCollapsed === undefined) s.sidebarCollapsed = false;   // U01
    if (!s.density) s.density = "comfortable";                          // U10
    if (!s.accent) s.accent = "indigo";                                 // U09
    if (!s.cvdPreview) s.cvdPreview = "none";                            // U46
    if (!s.fontSize) s.fontSize = "normal";                              // U11
    if (s.dyslexicFont === undefined) s.dyslexicFont = false;            // U11
    if (s.trueBlack === undefined) s.trueBlack = false;                  // U13
    if (!s.collapsedNavGroups) s.collapsedNavGroups = [];                 // U07
    if (s.onboarded === undefined) s.onboarded = true;                   // U49 (seed data ships pre-onboarded)
    if (!s.emptyStateStyle) s.emptyStateStyle = "drawn";                  // U16 — "drawn" or "emoji"
    if (!s.dashboardLayout) s.dashboardLayout = ["hero", "warnings", "stats", "countdowns", "schedule", "due", "trend", "grades", "study"]; // F083
    if (!s.locale) s.locale = "en";                                     // F099
    if (!s.wellbeing) s.wellbeing = { hideGPA: false, breakEveryMin: 50, breakLenMin: 8 };
    if (!s.retention) s.retention = { studyDays: 365, usageDays: 180, autoArchiveDays: 30 };
    if (!s.bellVariant) s.bellVariant = {}; // { "YYYY-MM-DD": "assembly"|"early"|"delayed"|"exam" }
    if (!s.bellVariants) {
      s.bellVariants = {
        assembly: { label: "Assembly schedule", shiftMin: -20 },
        early: { label: "Early release", shiftMin: -90 },
        delayed: { label: "Delayed start", shiftMin: 60 },
        exam: { label: "Exam schedule", shiftMin: 0 }
      };
    }
    if (!s.passingTimeMin) s.passingTimeMin = 5;   // F043
    if (!s.commute) s.commute = { toMin: 20, fromMin: 20, lastBus: "" }; // F051

    // ---- account additions
    if (!db.account.linkedFriends) db.account.linkedFriends = []; // real accept/decline friend state (F053)
    if (!db.account.sessions) db.account.sessions = []; // client-side cache of backend session list (F092)

    // ---- per-record field defaults
    db.classes.forEach((c) => {
      if (!c.subject) c.subject = guessSubject(c.name);
      if (c.gradingMode === undefined) c.gradingMode = "percentage"; // "percentage" | "standards"
      if (c.passFail === undefined) c.passFail = false;
      if (c.auditOnly === undefined) c.auditOnly = false;
      if (c.examWeight === undefined) c.examWeight = 0; // 0-100, % of final grade from "Final" type work
      if (c.percentileInput === undefined) c.percentileInput = null;
      if (c.timezone === undefined) c.timezone = null;
      if (!c.standardsScale) c.standardsScale = 4; // 1..4 proficiency
      if (c.latePenalty === undefined) c.latePenalty = null;    // { perDay, max } — F021
      if (!c.rules) c.rules = { dropLowest: {}, curve: 0 };
      if (!c.rules.catFloor) c.rules.catFloor = {};             // { categoryId: pct } — F009
      if (!c.rules.catCap) c.rules.catCap = {};
    });

    db.assignments.forEach((a) => {
      if (!a.dependsOn) a.dependsOn = [];        // F014
      if (a.actualStart === undefined) a.actualStart = null;   // F017 start/stop timer
      if (a.timeLog === undefined) a.timeLog = []; // [{start,end,minutes}]
      if (a.submissionMethod === undefined) a.submissionMethod = null; // F020
      if (a.submitted === undefined) a.submitted = false;
      if (a.snoozeUntil === undefined) a.snoozeUntil = null;   // F019
      if (a.snoozeReason === undefined) a.snoozeReason = "";
      if (a.parentId === undefined) a.parentId = null;         // F018/F026
      if (a.assignee === undefined) a.assignee = null;         // F026 "me" or a name
      if (a.standardsScore === undefined) a.standardsScore = null; // 1..4, for standards-mode classes
      if (a.rubricId === undefined) a.rubricId = null;         // F002
      if (a.rubricScores === undefined) a.rubricScores = {};   // {criterionId: levelId}
    });

    db.terms.forEach((t) => { if (t.parentId === undefined) t.parentId = null; }); // F007

    db.schemaV3 = true;
    S.commit();
  }

  function guessSubject(name) {
    const n = (name || "").toLowerCase();
    if (/calc|algebra|geometry|math|trig/.test(n)) return "Math";
    if (/chem|bio|physic|science/.test(n)) return "Science";
    if (/hist|govern|econ|geo/.test(n)) return "Social Studies";
    if (/eng|lit|writing/.test(n)) return "English";
    if (/span|french|lang|latin/.test(n)) return "World Language";
    if (/pe|fitness|health/.test(n)) return "PE / Health";
    if (/art|music|band|choir|theatre|drama/.test(n)) return "Arts";
    if (/cs|comput|robot/.test(n)) return "Technology";
    return "Elective";
  }

  /* ==================================================== wrapped selectors */

  const orig = {
    classGrade: S.classGrade,
    gpa: S.gpa,
    openAssignments: S.openAssignments,
    dueSoon: S.dueSoon,
    overdue: S.overdue,
    assignmentsFor: S.assignmentsFor
  };

  // F009 — category floors/caps: e.g. "homework can't drop the grade below
  // 50% in that bucket." Recomputes the weighted average from
  // categoryBreakdown() with each category's pct clamped first.
  function weightedFromCategories(classId) {
    const c = S.cls(classId);
    const rules = (c && c.rules) || {};
    const cats = S.categoryBreakdown(classId).filter((k) => k.pct != null);
    if (!cats.length) return null;
    let weighted = 0, usedWeight = 0;
    cats.forEach((cat) => {
      let pct = cat.pct;
      const floor = rules.catFloor && rules.catFloor[cat.id];
      const cap = rules.catCap && rules.catCap[cat.id];
      if (floor != null) pct = Math.max(pct, floor);
      if (cap != null) pct = Math.min(pct, cap);
      weighted += pct * cat.weight;
      usedWeight += cat.weight;
    });
    if (!usedWeight) return null;
    return U.clamp(weighted / usedWeight + (rules.curve || 0), 0, 150);
  }
  function hasCatRules(rules) {
    return rules && ((rules.catFloor && Object.keys(rules.catFloor).length) || (rules.catCap && Object.keys(rules.catCap).length));
  }

  // F001 standards mode + F005 pass/fail + F004 exam weighting, layered on
  // top of the original weighted-category math.
  S.classGrade = function (classId) {
    const c = S.cls(classId);
    if (!c) return orig.classGrade(classId);
    if (c.gradingMode === "standards" || c.passFail || c.auditOnly) return null;

    let pct = hasCatRules(c.rules) ? weightedFromCategories(classId) : orig.classGrade(classId);
    if (pct == null || !c.examWeight) return pct;

    const finals = S.assignmentsFor(classId).filter((a) => a.graded && a.earned != null && /final|semester exam/i.test(a.type + a.title));
    if (!finals.length) return pct;
    const finalPct = U.sum(finals, (a) => a.earned) / U.sum(finals, (a) => a.points) * 100;
    const w = U.clamp(c.examWeight, 0, 100) / 100;
    return pct * (1 - w) + finalPct * w;
  };

  // F001 — average proficiency (1..4) for a standards-graded class.
  function standardsAvg(classId) {
    const items = S.assignmentsFor(classId).filter((a) => a.standardsScore != null);
    if (!items.length) return null;
    return U.avg(items, (a) => a.standardsScore);
  }

  /** Unified grade display for a class regardless of grading mode — what every view should render. */
  S.gradeDisplay = function (classId) {
    const c = S.cls(classId);
    if (!c) return { mode: "percentage", value: null };
    if (c.auditOnly) return { mode: "audit", value: null, label: "Audit" };
    if (c.passFail) {
      const graded = S.assignmentsFor(classId).filter((a) => a.graded && a.earned != null && a.points > 0);
      if (!graded.length) return { mode: "passfail", value: null, label: "—" };
      const pct = U.sum(graded, (a) => a.earned) / U.sum(graded, (a) => a.points) * 100;
      return { mode: "passfail", value: pct, label: pct >= 60 ? "Pass" : "Fail" };
    }
    if (c.gradingMode === "standards") {
      const avg = standardsAvg(classId);
      return { mode: "standards", value: avg, label: avg == null ? "—" : `${U.round(avg, 1)} / ${c.standardsScale}` };
    }
    const pct = S.classGrade(classId);
    return { mode: "percentage", value: pct, label: pct == null ? "—" : U.round(pct, 1) + "%" };
  };

  // F007 — nested grading periods: a child term (Q1/Q2) rolls into its
  // parent's (S1) GPA, weighted by the child's own credit total.
  S.gpa = function (weighted, termId) {
    const kids = S.db.terms.filter((t) => t.parentId === termId);
    if (termId && kids.length) {
      let pts = 0, credits = 0;
      kids.forEach((k) => {
        // Live child terms compute from their current classes; archived
        // child terms use the final gpa/credits recorded when they closed —
        // same split cumulativeGpa() already uses for standalone terms.
        const g = k.current ? orig.gpa(weighted, k.id) : (k.gpa != null ? k.gpa : 0);
        const cr = k.current ? U.sum(S.termClasses(k.id), (c) => c.credits || 1) : (k.credits || 0);
        if (cr) { pts += g * cr; credits += cr; }
      });
      return credits ? pts / credits : 0;
    }
    return orig.gpa(weighted, termId);
  };

  // F019 snooze — a snoozed item drops out of "open" lists until the date passes.
  function notSnoozed(a) {
    return !a.snoozeUntil || a.snoozeUntil <= U.today();
  }
  S.openAssignments = function () { return orig.openAssignments().filter(notSnoozed); };
  S.dueSoon = function (days) { return orig.dueSoon(days).filter(notSnoozed); };
  S.overdue = function () { return orig.overdue().filter(notSnoozed); };

  S.snoozedAssignments = function () {
    return S.db.assignments.filter((a) => a.status !== "done" && a.snoozeUntil && a.snoozeUntil > U.today());
  };

  /* --------------------------------------------------- F014 dependencies */

  S.blockedBy = function (assignmentId) {
    const a = S.byId("assignments", assignmentId);
    if (!a || !a.dependsOn || !a.dependsOn.length) return [];
    return a.dependsOn.map((id) => S.byId("assignments", id)).filter((x) => x && x.status !== "done");
  };
  S.isBlocked = function (assignmentId) { return S.blockedBy(assignmentId).length > 0; };
  S.blocks = function (assignmentId) {
    return S.db.assignments.filter((a) => (a.dependsOn || []).includes(assignmentId));
  };

  /* ------------------------------------------------- F017 time tracking */

  S.startTimer = function (assignmentId) {
    const a = S.byId("assignments", assignmentId);
    if (!a || a.actualStart) return;
    S.update("assignments", assignmentId, { actualStart: Date.now(), status: a.status === "todo" ? "doing" : a.status });
  };
  S.stopTimer = function (assignmentId) {
    const a = S.byId("assignments", assignmentId);
    if (!a || !a.actualStart) return 0;
    const mins = Math.round((Date.now() - a.actualStart) / 60000);
    const log = (a.timeLog || []).concat([{ start: a.actualStart, end: Date.now(), minutes: mins }]);
    S.update("assignments", assignmentId, { actualStart: null, actualMinutes: (a.actualMinutes || 0) + mins, timeLog: log });
    return mins;
  };
  S.isTiming = function (assignmentId) {
    const a = S.byId("assignments", assignmentId);
    return !!(a && a.actualStart);
  };

  /* ---------------------------------------------------- F018/026 splits */

  S.subAssignments = function (assignmentId) {
    return S.db.assignments.filter((a) => a.parentId === assignmentId);
  };
  S.splitAssignment = function (assignmentId, parts) {
    const parent = S.byId("assignments", assignmentId);
    if (!parent) return [];
    const made = [];
    S.commit((db) => {
      parts.forEach((p) => {
        const child = Object.assign({}, parent, {
          id: U.uid("as"), title: p.title, points: p.points != null ? p.points : 0,
          earned: null, graded: false, status: "todo", parentId: parent.id,
          due: p.due || parent.due, assignee: p.assignee || null, subtasks: []
        });
        db.assignments.push(child);
        made.push(child);
      });
    });
    return made;
  };

  /* ------------------------------------------------------ F022 archive */

  S.autoArchive = function () {
    const days = S.settings.retention.autoArchiveDays;
    if (!days) return 0;
    const cutoff = U.dateKey(U.addDays(new Date(), -days));
    let n = 0;
    S.commit((db) => {
      db.assignments.forEach((a) => {
        if (a.status === "done" && !a.archived && a.due < cutoff) { a.archived = true; n++; }
      });
    });
    return n;
  };
  S.archivedAssignments = function () { return S.db.assignments.filter((a) => a.archived); };

  /* --------------------------------------------------- F021 late penalty */

  S.latePenaltyEstimate = function (assignmentId) {
    const a = S.byId("assignments", assignmentId);
    if (!a) return null;
    const c = S.cls(a.classId);
    const rule = c && c.latePenalty; // { perDay: 10, max: 50 } — set from class edit form
    if (!rule || !rule.perDay) return null;
    const daysLate = Math.max(0, U.diffDays(U.today(), a.due));
    if (!daysLate) return null;
    const pct = Math.min(rule.max || 100, rule.perDay * daysLate);
    return { daysLate, pctOff: pct, pointsOff: Math.round((a.points || 0) * pct / 100) };
  };

  /* --------------------------------------------------------- F023 notes */
  // Already supported: notes have classId; add direct assignment linkage.
  S.notesFor = function (assignmentId) {
    return S.db.notes.filter((n) => n.assignmentId === assignmentId);
  };

  /* --------------------------------------------------------- F002 rubric */

  S.rubricsFor = function (classId) { return S.db.rubrics.filter((r) => r.classId === classId); };
  S.scoreFromRubric = function (assignmentId) {
    const a = S.byId("assignments", assignmentId);
    if (!a || !a.rubricId) return null;
    const rubric = S.byId("rubrics", a.rubricId);
    if (!rubric) return null;
    const scores = a.rubricScores || {};
    let earned = 0, total = 0;
    rubric.criteria.forEach((crit) => {
      const max = Math.max(...crit.levels.map((l) => l.points), 0);
      total += max;
      const pickedId = scores[crit.id];
      const picked = crit.levels.find((l) => l.id === pickedId);
      earned += picked ? picked.points : 0;
    });
    return { earned, total };
  };

  /* --------------------------------------------------------- F003 audit */

  S.logGradeChange = function (assignmentId, field, from, to) {
    S.insert("gradeHistory", { assignmentId, field, from, to, at: Date.now() });
  };
  S.gradeHistoryFor = function (assignmentId) {
    return U.sortBy(S.db.gradeHistory.filter((h) => h.assignmentId === assignmentId), (h) => h.at, true);
  };

  /* -------------------------------------------------------- F008 regrade */

  S.requestRegrade = function (assignmentId, reason) {
    return S.insert("regrades", { assignmentId, requestedOn: U.today(), reason, outcome: null, resolvedOn: null });
  };
  S.regradesFor = function (assignmentId) { return S.db.regrades.filter((r) => r.assignmentId === assignmentId); };
  S.openRegrades = function () { return S.db.regrades.filter((r) => !r.outcome); };

  /* ------------------------------------------------------- F011 AP exams */

  S.apExamsUpcoming = function () {
    return U.sortBy(S.db.apExams.filter((e) => !e.actualScore), (e) => e.examDate);
  };

  // F049 — the handful of dates worth pinning where you can see them without
  // opening a view: AP exams, and events flagged Exam/Deadline/Competition.
  S.upcomingCountdowns = function () {
    const today = U.today();
    const fromExams = S.db.apExams.filter((e) => !e.actualScore && e.examDate >= today)
      .map((e) => ({ label: e.name, date: e.examDate, kind: "AP Exam" }));
    const fromEvents = S.db.events.filter((e) => e.date >= today && /^(Exam|Deadline|Competition)$/.test(e.type))
      .map((e) => ({ label: e.title, date: e.date, kind: e.type }));
    return U.sortBy(fromExams.concat(fromEvents), (c) => c.date).slice(0, 5);
  };

  /* ---------------------------------------------------- F012 graduation */

  S.graduationProgress = function () {
    const reqs = S.db.graduationReqs;
    const bySubject = U.groupBy(S.db.classes.filter((c) => !c.auditOnly), (c) => c.subject || "Elective");
    return reqs.map((r) => {
      const have = U.sum(bySubject.get(r.subject) || [], (c) => c.credits || 1);
      return { ...r, have, pct: r.creditsNeeded ? U.clamp((have / r.creditsNeeded) * 100, 0, 100) : 0 };
    });
  };

  /* ----------------------------------------------------- F010 transcript */

  S.transcriptRows = function () {
    return S.db.terms.filter((t) => !t.parentId).map((t) => ({
      term: t,
      classes: S.termClasses(t.id).map((c) => ({ cls: c, grade: t.current ? S.gradeDisplay(c.id) : null })),
      gpa: t.current ? S.gpa(null, t.id) : t.gpa,
      credits: t.current ? U.sum(S.termClasses(t.id), (c) => c.credits || 1) : t.credits
    }));
  };

  /* --------------------------------------------------- F009 category caps */
  // Applied inside classGrade indirectly via rules.floor/rules.cap on a category —
  // extend categoryBreakdown's consumer (grades.js) to clamp using c.rules.

  /* =================================================== F027-040 study === */

  // F027 cloze cards live on the same `decks` collection with a `cloze` flag
  // and `{text}` instead of front/back — study.js flashcards view renders both.
  S.addClozeCard = function (deckId, text) {
    const deck = S.byId("decks", deckId);
    if (!deck) return null;
    const card = { id: U.uid("c"), cloze: true, text, box: 1, next: U.today(), lastReviewed: null };
    deck.cards.push(card);
    S.commit();
    return card;
  };

  // F028 image occlusion: an image plus rectangular regions to hide/reveal.
  S.addOcclusionCard = function (deckId, imageAssetId, regions) {
    const deck = S.byId("decks", deckId);
    if (!deck) return null;
    const card = { id: U.uid("c"), occlusion: true, imageAssetId, regions, box: 1, next: U.today(), lastReviewed: null };
    deck.cards.push(card);
    S.commit();
    return card;
  };

  S.dueCardsAcrossDecks = function (interleave) {
    const due = [];
    S.db.decks.forEach((d) => d.cards.forEach((c) => {
      if (!c.next || c.next <= U.today()) due.push({ ...c, deckId: d.id, deckName: d.name });
    }));
    if (interleave) {
      // Round-robin by deck so consecutive cards are rarely from the same class.
      const byDeck = [...U.groupBy(due, (c) => c.deckId).values()];
      const out = [];
      let i = 0, remaining = due.length;
      while (remaining > 0) {
        byDeck.forEach((arr) => { if (arr[i]) { out.push(arr[i]); remaining--; } });
        i++;
      }
      return out;
    }
    return U.sortBy(due, () => Math.random() - 0.5);
  };

  S.rateSession = function (sessionId, quality) {
    S.insert("sessionRatings", { sessionId, quality, at: Date.now() });
  };
  S.avgSessionQuality = function () {
    const rows = S.db.sessionRatings;
    return rows.length ? U.avg(rows, (r) => r.quality) : null;
  };
  // Best study hour-of-day, from rated sessions joined to their study session's time-of-day.
  S.bestStudyHour = function () {
    const rows = S.db.sessionRatings.filter((r) => r.quality >= 4);
    if (rows.length < 3) return null;
    const hours = rows.map((r) => new Date(r.at).getHours());
    const counts = {};
    hours.forEach((h) => { counts[h] = (counts[h] || 0) + 1; });
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return best ? Number(best[0]) : null;
  };

  S.addJournalEntry = function (text) { return S.insert("journal", { date: U.today(), text, at: Date.now() }); };
  S.journalEntries = function () { return U.sortBy(S.db.journal, (j) => j.at, true); };

  S.spacedNotes = function () {
    // Notes due for a spaced re-read, same Leitner cadence idea as cards.
    return S.db.notes.filter((n) => !n.nextReview || n.nextReview <= U.today());
  };
  S.reviewNote = function (noteId, remembered) {
    const box = remembered ? 1 : 0;
    const intervals = [1, 3, 7, 16, 35];
    const n = S.byId("notes", noteId);
    if (!n) return;
    const nextBox = U.clamp((n.reviewBox || 0) + (remembered ? 1 : -1), 0, intervals.length - 1);
    S.update("notes", noteId, { reviewBox: nextBox, nextReview: U.dateKey(U.addDays(new Date(), intervals[nextBox])) });
  };

  S.formulaSheet = function (classId) {
    return S.db.notes.filter((n) => (n.tags || []).includes("formula") && (!classId || n.classId === classId));
  };

  /* ------------------------------------------------------- F030 deck i/o */

  S.exportDeck = function (deckId) {
    const deck = S.byId("decks", deckId);
    if (!deck) return null;
    return JSON.stringify({ scholarDeck: 1, name: deck.name, cards: deck.cards.map((c) => ({ ...c, id: undefined })) }, null, 2);
  };
  S.importDeck = function (json, classId) {
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.cards)) throw new Error("That doesn't look like a Scholar deck file.");
    const cards = parsed.cards.map((c) => Object.assign({}, c, { id: U.uid("c") }));
    return S.insert("decks", { name: parsed.name || "Imported deck", classId: classId || null, cards });
  };

  /* ------------------------------------------------------ F038/039 lists */

  S.vocabQuizQueue = function (listId) {
    const list = S.byId("vocabLists", listId);
    if (!list) return [];
    return U.sortBy(list.terms, () => Math.random() - 0.5);
  };

  /* --------------------------------------------------------- F040 streak */

  S.streakFreezes = function () { return S.db.streak.freezes || 0; };

  // Overrides store.js's touchStreak: banking a freeze every 7-day
  // milestone (cap 3) lets exactly one missed day bridge the streak
  // instead of resetting it to 1.
  S.touchStreak = function () {
    const t = U.today();
    const s = S.db.streak;
    if (s.freezes === undefined) s.freezes = 0;
    if (s.last === t) return;
    if (s.last) {
      const gap = U.diffDays(t, s.last);
      if (gap === 1) s.count = s.count + 1;
      else if (gap === 2 && s.freezes > 0) { s.freezes -= 1; s.count = s.count + 1; }
      else if (gap > 1) s.count = 1;
    } else {
      s.count = Math.max(1, s.count);
    }
    if (s.count > 0 && s.count % 7 === 0) s.freezes = Math.min(3, s.freezes + 1);
    s.xp += 15;
    s.last = t;
    S.save();
  };

  /* ============================================== F041-052 time/schedule */

  S.bellVariantFor = function (iso) { return S.settings.bellVariant[iso] || null; };
  S.setBellVariant = function (iso, key) {
    S.commit((db) => {
      if (key) db.settings.bellVariant[iso] = key; else delete db.settings.bellVariant[iso];
    });
  };
  // Shifted periods for a given date, honoring an assembly/early/delayed/exam day.
  S.periodsFor = function (iso) {
    const variant = S.bellVariantFor(iso);
    if (!variant) return S.db.periods;
    const cfg = S.settings.bellVariants[variant];
    if (!cfg) return S.db.periods;
    return S.db.periods.map((p) => ({
      ...p,
      start: U.fromMin(Math.max(0, U.toMin(p.start) + cfg.shiftMin)),
      end: U.fromMin(Math.max(0, U.toMin(p.end) + cfg.shiftMin))
    }));
  };

  S.busClock = function () { return S.settings.commute; };

  /* ============================================ F073-080 wellbeing ===== */

  S.logMood = function (mood, energy) {
    S.commit((db) => { db.moodLog[U.today()] = { mood, energy, at: Date.now() }; });
  };
  S.moodTrend = function (days) {
    const out = [];
    for (let i = (days || 21) - 1; i >= 0; i--) {
      const iso = U.dateKey(U.addDays(new Date(), -i));
      const rec = S.db.moodLog[iso];
      out.push({ date: iso, mood: rec ? rec.mood : null, energy: rec ? rec.energy : null });
    }
    return out;
  };

  S.logSleep = function (bed, wake) {
    const b = U.toMin(bed), w = U.toMin(wake);
    const hours = U.round(((w < b ? w + 24 * 60 : w) - b) / 60, 1);
    S.commit((db) => { db.sleepLog[U.today()] = { bed, wake, hours }; });
    return hours;
  };
  S.avgSleep = function (days) {
    const keys = [];
    for (let i = 0; i < (days || 7); i++) keys.push(U.dateKey(U.addDays(new Date(), -i)));
    const vals = keys.map((k) => S.db.sleepLog[k]).filter(Boolean).map((r) => r.hours);
    return vals.length ? U.avg(vals) : null;
  };

  // F074 burnout risk — a simple, explainable blend of workload, sleep, and study load.
  S.burnoutRisk = function () {
    const late = S.overdue().length;
    const sleep = S.avgSleep(7);
    const study = S.studyThisWeek();
    let score = 0;
    if (late >= 3) score += 30; else if (late >= 1) score += 12;
    if (sleep != null && sleep < 6.5) score += 30; else if (sleep != null && sleep < 7.5) score += 12;
    if (study > 900) score += 25; else if (study > 600) score += 10;
    const moods = Object.values(S.db.moodLog).slice(-5).map((m) => m.mood);
    if (moods.length >= 3 && U.avg(moods) < 2.5) score += 15;
    return { score: U.clamp(score, 0, 100), level: score >= 55 ? "high" : score >= 28 ? "medium" : "low" };
  };

  S.workloadRelief = function () {
    // Cheapest things to cut this week: lowest priority, furthest deadline, smallest point value.
    const week = S.dueSoon(7).filter((a) => a.priority !== "high");
    return U.sortBy(week, (a) => (a.points || 0)).slice(0, 3);
  };

  S.usageBySection = function () {
    // Approximate breakdown from time actually logged against assignments vs. general app time.
    const today = U.today();
    const assignmentMin = U.sum(S.db.assignments, (a) => U.sum((a.timeLog || []).filter((t) => U.dateKey(new Date(t.start)) === today), (t) => t.minutes));
    const total = S.db.usage[today] || 0;
    return { studying: Math.min(assignmentMin, total), other: Math.max(0, total - assignmentMin) };
  };

  /* =============================================== F081-092 insight ==== */

  S.saveFilter = function (view, name, filter) { return S.insert("savedFilters", { view, name, filter }); };
  S.filtersFor = function (view) { return S.db.savedFilters.filter((f) => f.view === view); };

  S.setDashboardLayout = function (order) { S.commit((db) => { db.settings.dashboardLayout = order; }); };

  // F085 per-category forecast: same regression as gradeForecast, scoped to one category.
  S.categoryForecast = function (classId, categoryId) {
    const graded = U.sortBy(S.db.assignments.filter((a) => a.classId === classId && a.categoryId === categoryId && a.graded && a.earned != null), (a) => a.due);
    if (graded.length < 3) return null;
    let e = 0, p = 0;
    const pts = graded.map((a) => { e += a.earned; p += a.points; return { x: U.parseDate(a.due).getTime() / 86400000, y: p ? (e / p) * 100 : 0 }; });
    const mx = U.avg(pts.map((d) => d.x)), my = U.avg(pts.map((d) => d.y));
    const denom = U.sum(pts, (d) => (d.x - mx) ** 2);
    if (!denom) return null;
    const slope = U.sum(pts.map((d) => (d.x - mx) * (d.y - my))) / denom;
    return { current: pts[pts.length - 1].y, slopePerWeek: slope * 7 };
  };

  // F086 change detection — flags a class whose recent average moved meaningfully.
  S.detectChanges = function () {
    const out = [];
    S.db.classes.forEach((c) => {
      const trend = S.gradeTrend(c.id);
      if (trend.length < 4) return;
      const recent = trend.slice(-3), before = trend.slice(-6, -3);
      if (before.length < 2) return;
      const delta = U.avg(recent.map((t) => t.pct)) - U.avg(before.map((t) => t.pct));
      if (Math.abs(delta) >= 6) {
        out.push({ classId: c.id, className: c.name, delta: U.round(delta, 1) });
      }
    });
    return out;
  };

  S.termComparison = function () {
    return S.db.terms.filter((t) => !t.parentId).map((t) => ({
      term: t.name,
      gpa: t.current ? U.round(S.gpa(null, t.id), 2) : t.gpa,
      current: !!t.current
    })).filter((r) => r.gpa != null);
  };

  S.exportTableCSV = function (rows, columns, filename) {
    const esc = (v) => { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const head = columns.map((c) => esc(c.label)).join(",");
    const body = rows.map((r) => columns.map((c) => esc(typeof c.get === "function" ? c.get(r) : r[c.key])).join(",")).join("\n");
    U.download(filename, head + "\n" + body, "text/csv");
  };

  S.applyRetention = function () {
    const r = S.settings.retention;
    let n = 0;
    S.commit((db) => {
      const studyCut = U.dateKey(U.addDays(new Date(), -r.studyDays));
      const before1 = db.studySessions.length;
      db.studySessions = db.studySessions.filter((s2) => s2.date >= studyCut);
      n += before1 - db.studySessions.length;

      const usageCut = U.dateKey(U.addDays(new Date(), -r.usageDays));
      Object.keys(db.usage).forEach((k) => { if (k < usageCut) { delete db.usage[k]; n++; } });
    });
    S.autoArchive();
    return n;
  };

  /* ============================================= F053-064 collaboration */

  // Friend requests layered onto `peers`: status "pending-out" | "pending-in" | "accepted".
  S.sendFriendRequest = function (name) {
    return S.insert("peers", { name, color: S.PALETTE[S.db.peers.length % S.PALETTE.length], sharing: false, classIds: [], status: "pending-out" });
  };
  S.respondFriendRequest = function (peerId, accept) {
    if (accept) S.update("peers", peerId, { status: "accepted", sharing: true });
    else S.remove("peers", peerId);
  };
  S.acceptedFriends = function () { return S.db.peers.filter((p) => p.status === "accepted" || !p.status); };

  S.commonFreePeriods = function (peerId) {
    // Compares this student's own free periods against a peer's declared classIds.
    const myBusy = new Set(S.termClasses().map((c) => c.periodId));
    const peer = S.byId("peers", peerId);
    if (!peer) return [];
    const peerBusy = new Set(peer.classIds.map((id) => { const c = S.cls(id); return c ? c.periodId : null; }));
    return S.db.periods.filter((p) => !myBusy.has(p.id) && !peerBusy.has(p.id));
  };

  S.postFeedComment = function (feedItemId, byName, text) {
    S.commit((db) => {
      if (!db.feedComments[feedItemId]) db.feedComments[feedItemId] = [];
      db.feedComments[feedItemId].push({ id: U.uid("cm"), byName, text, at: Date.now() });
    });
  };
  S.commentsFor = function (feedItemId) { return S.db.feedComments[feedItemId] || []; };

  /* =============================================== F065-072 parent ===== */

  S.requestCheckIn = function () { return S.insert("checkIns", { requestedAt: Date.now(), respondedAt: null, status: "pending" }); };
  S.respondCheckIn = function (id) { S.update("checkIns", id, { respondedAt: Date.now(), status: "ok" }); };
  S.openCheckIns = function () { return S.db.checkIns.filter((c) => c.status === "pending"); };

  S.addFocusWindow = function (start, end, days) { return S.insert("focusWindows", { start, end, days, agreedAt: Date.now() }); };
  S.activeFocusWindow = function () {
    const now = U.nowMin(), dow = U.dowName(U.today());
    return S.db.focusWindows.find((w) => w.days.includes(dow) && now >= U.toMin(w.start) && now < U.toMin(w.end)) || null;
  };

  S.addGuardianNote = function (from, text) { return S.insert("guardianNotes", { from, text, at: Date.now() }); };
  S.recentGuardianNotes = function () { return U.sortBy(S.db.guardianNotes, (n) => n.at, true).slice(0, 10); };

  S.addEmergencyContact = function (name, phone, relation) { return S.insert("emergencyContacts", { name, phone, relation }); };

  /* ================================================ F093-100 platform === */

  /* --------------------------------------------------- U02 pinned nav === */

  // Every real navigation counts as a visit; doesn't persist a full write
  // each time (piggybacks on the next commit) to keep clicking cheap.
  S.trackNavVisit = function (id) {
    S.db.navVisits[id] = (S.db.navVisits[id] || 0) + 1;
    // U03 — most-recent-first, deduped, capped. Separate from navVisits
    // (frequency) since "recent" and "most-used" answer different questions.
    if (!S.db.recentViews) S.db.recentViews = [];
    S.db.recentViews = [id, ...S.db.recentViews.filter((x) => x !== id)].slice(0, 6);
    S.save();
  };
  S.recentViews = function (excludeId) {
    return (S.db.recentViews || []).filter((id) => id !== excludeId);
  };

  S.togglePinnedNav = function (id) {
    S.commit((db) => {
      const i = db.settings.pinnedNav.indexOf(id);
      if (i >= 0) db.settings.pinnedNav.splice(i, 1);
      else db.settings.pinnedNav.push(id);
    });
  };

  S.isPinnedNav = function (id) { return S.settings.pinnedNav.includes(id); };

  // What the "Pinned" nav group actually shows: explicit pins first (in the
  // order the user set them), then — only if they haven't pinned 3 yet —
  // filled out with their most-visited remaining screens.
  S.effectivePinnedNav = function (excludeIds, limit) {
    const n = limit || 3;
    const pinned = S.settings.pinnedNav.filter((id) => !excludeIds || !excludeIds.includes(id));
    if (pinned.length >= n) return { ids: pinned.slice(0, n), auto: [] };

    const ranked = Object.entries(S.db.navVisits)
      .filter(([id, count]) => count > 0 && !pinned.includes(id) && (!excludeIds || !excludeIds.includes(id)))
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);

    const auto = ranked.slice(0, n - pinned.length);
    return { ids: pinned.concat(auto), auto };
  };

  /* ------------------------------------------------- U26 toast history === */

  S.logNotification = function (title, msg, kind) {
    S.db.notifications.unshift({ id: U.uid("nt"), title, msg, kind, at: Date.now() });
    if (S.db.notifications.length > 60) S.db.notifications.length = 60;
    S.save();
  };
  S.recentNotifications = function (n) { return S.db.notifications.slice(0, n || 20); };

  S.mintApiToken = function (label) {
    return S.insert("apiTokens", { label, token: U.uid("tok") + U.uid(""), createdAt: Date.now() });
  };
  S.revokeApiToken = function (id) { S.remove("apiTokens", id); };

  S.addWebhook = function (url, events) { return S.insert("webhooks", { url, events, createdAt: Date.now() }); };

  ensureV3();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) ensureV3(); });
})();
